import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Activity, TrendingUp, TrendingDown, Shield, Zap, Radio,
  ArrowUp, ArrowDown, RefreshCw, AlertTriangle, CheckCircle2,
  Crosshair, Layers, Clock,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { supabase, type Position, type Bot } from '@/lib/supabase';
import { usePositionMonitor } from '@/hooks/usePositionMonitor';
import { useCoinDcxPositionStream } from '@/hooks/useCoinDcxPositionStream';
import { useLivePrices } from '@/hooks/useLivePrices';
import { useBrokerPnl } from '@/hooks/useBrokerPnl';

const USD_INR_RATE = 102;

interface MonitoredRow {
  position: Position;
  botName: string;
  livePrice: number;
  unrealizedPnlInr: number;
  pnlPct: number;
  currentStopLoss: number | null;
  takeProfitTarget: number | null;
  distanceToStopPct: number | null;
  distanceToTpPct: number | null;
  exchangeSlActive: boolean;
  trailingActive: boolean;
  isPaper: boolean;
  ageMinutes: number;
}

export default function PositionMonitorView() {
  const { formatInr } = useApp();
  const { effectiveUserId } = useAuth();
  const { positions, lastUpdate, refreshPositions, reconcileAlert } = usePositionMonitor();
  const { wsState } = useCoinDcxPositionStream();
  const { coins, connectionStatus } = useLivePrices();
  const { brokerPnlMap, lastSync } = useBrokerPnl(positions);
  const [bots, setBots] = useState<Bot[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [now, setNow] = useState(Date.now());

  // Fetch bot names for display
  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from('bots')
      .select('id, name, is_paper_mode')
      .eq('user_id', effectiveUserId)
      .then(({ data }) => {
        if (data) setBots(data as Bot[]);
      });
  }, [effectiveUserId]);

  // Tick "now" every second for age display + auto-refresh
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      if (autoRefresh) refreshPositions(effectiveUserId ?? '');
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, effectiveUserId, refreshPositions]);

  const botMap = useMemo(() => {
    const m = new Map<string, Bot>();
    for (const b of bots) m.set(b.id, b);
    return m;
  }, [bots]);

  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of coins) m.set(c.symbol.toUpperCase(), c.price);
    return m;
  }, [coins]);

  const rows: MonitoredRow[] = useMemo(() => {
    return positions
      .filter((p) => p.status === 'open')
      .map((pos) => {
        const baseCoin = pos.symbol.replace(/USDT$/, '').replace(/^B-/, '');
        const livePrice = priceMap.get(baseCoin.toUpperCase()) ?? 0;
        const bot = pos.bot_id ? botMap.get(pos.bot_id) : undefined;

        // Unrealized PnL — prefer broker PnL, fall back to local calc
        const brokerPnl = brokerPnlMap.get(pos.id);
        let unrealizedPnlInr: number;
        if (brokerPnl !== undefined && brokerPnl !== 0) {
          unrealizedPnlInr = brokerPnl;
        } else {
          const entry = pos.entry_price;
          const diff = pos.side === 'BUY' ? livePrice - entry : entry - livePrice;
          unrealizedPnlInr = (diff * pos.quantity) * USD_INR_RATE;
        }

        const marginInr = (pos.quantity * pos.entry_price) / pos.leverage * USD_INR_RATE;
        const pnlPct = marginInr > 0 ? (unrealizedPnlInr / marginInr) * 100 : 0;

        // Compute current stop loss (from ratcheted value or percentage)
        let currentStopLoss: number | null = pos.current_stop_loss;
        if ((!currentStopLoss || currentStopLoss <= 0) && pos.stop_loss_pct && pos.stop_loss_pct > 0) {
          currentStopLoss = pos.side === 'BUY'
            ? pos.entry_price * (1 - pos.stop_loss_pct / (pos.leverage * 100))
            : pos.entry_price * (1 + pos.stop_loss_pct / (pos.leverage * 100));
        }

        // Compute take profit target
        let takeProfitTarget: number | null = pos.take_profit_amount;
        if ((!takeProfitTarget || takeProfitTarget <= 0) && pos.take_profit_pct && pos.take_profit_pct > 0) {
          takeProfitTarget = pos.side === 'BUY'
            ? pos.entry_price * (1 + pos.take_profit_pct / (pos.leverage * 100))
            : pos.entry_price * (1 - pos.take_profit_pct / (pos.leverage * 100));
        }

        // Distance to stop / TP (in %)
        let distanceToStopPct: number | null = null;
        if (currentStopLoss && currentStopLoss > 0 && livePrice > 0) {
          distanceToStopPct = pos.side === 'BUY'
            ? ((livePrice - currentStopLoss) / livePrice) * 100
            : ((currentStopLoss - livePrice) / livePrice) * 100;
        }
        let distanceToTpPct: number | null = null;
        if (takeProfitTarget && takeProfitTarget > 0 && livePrice > 0) {
          distanceToTpPct = pos.side === 'BUY'
            ? ((takeProfitTarget - livePrice) / livePrice) * 100
            : ((livePrice - takeProfitTarget) / livePrice) * 100;
        }

        const ageMinutes = Math.round((now - new Date(pos.created_at).getTime()) / 60000);

        return {
          position: pos,
          botName: bot?.name ?? 'Manual Position',
          livePrice,
          unrealizedPnlInr,
          pnlPct,
          currentStopLoss,
          takeProfitTarget,
          distanceToStopPct,
          distanceToTpPct,
          exchangeSlActive: !!pos.exchange_sl_order_id,
          trailingActive: pos.trailing_enabled && (pos.trailing_distance_pct ?? 0) > 0,
          isPaper: pos.is_paper,
          ageMinutes,
        };
      });
  }, [positions, priceMap, botMap, brokerPnlMap, now]);

  // Aggregate stats
  const stats = useMemo(() => {
    const totalPnl = rows.reduce((s, r) => s + r.unrealizedPnlInr, 0);
    const totalMargin = rows.reduce((s, r) => {
      return s + (r.position.quantity * r.position.entry_price) / r.position.leverage * USD_INR_RATE;
    }, 0);
    const longCount = rows.filter((r) => r.position.side === 'BUY').length;
    const shortCount = rows.filter((r) => r.position.side === 'SELL').length;
    const exchangeProtected = rows.filter((r) => r.exchangeSlActive).length;
    const inProfit = rows.filter((r) => r.unrealizedPnlInr > 0).length;
    const inLoss = rows.filter((r) => r.unrealizedPnlInr < 0).length;
    const closestToStop = rows
      .filter((r) => r.distanceToStopPct !== null)
      .sort((a, b) => (a.distanceToStopPct ?? 999) - (b.distanceToStopPct ?? 999))[0];
    return {
      totalPnl,
      totalMargin,
      longCount,
      shortCount,
      exchangeProtected,
      inProfit,
      inLoss,
      closestToStop,
    };
  }, [rows]);

  const connColor = connectionStatus === 'connected' ? 'text-neon-green' : connectionStatus === 'reconnecting' ? 'text-neon-amber' : 'text-red-400';
  const connLabel = connectionStatus === 'connected' ? 'LIVE' : connectionStatus === 'reconnecting' ? 'RECONNECTING' : 'OFFLINE';

  const wsColor = wsState === 'connected' ? 'text-neon-green' : wsState === 'connecting' ? 'text-neon-amber' : 'text-red-400';
  const wsLabel = wsState === 'connected' ? 'EXCHANGE LIVE' : wsState === 'connecting' ? 'EXCHANGE SYNC' : 'EXCHANGE OFFLINE';

  return (
    <div className="space-y-5">
      {/* Reconciliation Alert */}
      {reconcileAlert && (
        <div className="rounded-2xl bg-neon-amber/10 border border-neon-amber/30 p-4 flex items-center gap-3 animate-slide-up">
          <div className="w-10 h-10 rounded-xl bg-neon-amber/15 border border-neon-amber/30 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-neon-amber" />
          </div>
          <div>
            <p className="text-sm font-bold text-neon-amber">Exchange Reconciliation Alert</p>
            <p className="text-xs text-slate-400 mt-0.5">{reconcileAlert}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-neon-cyan/10 border border-neon-cyan/20 flex items-center justify-center">
            <Crosshair className="w-5 h-5 text-neon-cyan" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Position Monitor</h2>
            <p className="text-xs text-slate-500">Real-time tracking of open positions, live prices & trailing stops</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
            <Radio className={`w-3.5 h-3.5 ${connColor}`} />
            <span className={`text-[11px] font-bold tracking-wide ${connColor}`}>{connLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]" title="Direct WebSocket stream from CoinDCX — position updates appear instantly with no polling">
            <Radio className={`w-3.5 h-3.5 ${wsColor} ${wsState === 'connected' ? 'animate-pulse' : ''}`} />
            <span className={`text-[11px] font-bold tracking-wide ${wsColor}`}>{wsLabel}</span>
          </div>
          <button
            onClick={() => { refreshPositions(effectiveUserId ?? ''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-slate-300 hover:text-white hover:bg-white/[0.08] transition-colors text-xs font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              autoRefresh
                ? 'bg-neon-green/10 border-neon-green/20 text-neon-green'
                : 'bg-white/[0.04] border-white/[0.06] text-slate-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Auto {autoRefresh ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Open Positions"
          value={String(rows.length)}
          sub={`${stats.longCount} Long / ${stats.shortCount} Short`}
          icon={<Layers className="w-4 h-4" />}
          accent="cyan"
        />
        <StatCard
          label="Total Unrealized P&L"
          value={formatInr(stats.totalPnl)}
          sub={`${stats.inProfit} profit / ${stats.inLoss} loss`}
          icon={stats.totalPnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          accent={stats.totalPnl >= 0 ? 'green' : 'red'}
        />
        <StatCard
          label="Exchange SL Protected"
          value={`${stats.exchangeProtected} / ${rows.length}`}
          sub={stats.exchangeProtected === rows.length && rows.length > 0 ? 'All protected on CoinDCX' : 'Some missing exchange SL'}
          icon={<Shield className="w-4 h-4" />}
          accent={stats.exchangeProtected === rows.length && rows.length > 0 ? 'green' : 'amber'}
        />
        <StatCard
          label="Total Margin at Risk"
          value={formatInr(stats.totalMargin)}
          sub={`Avg ${rows.length > 0 ? formatInr(stats.totalMargin / rows.length) : '—'} / pos`}
          icon={<Zap className="w-4 h-4" />}
          accent="cyan"
        />
      </div>

      {/* Last update timestamps */}
      <div className="flex items-center gap-4 text-[11px] text-slate-500">
        {lastUpdate && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Positions: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
        {lastSync && (
          <span className="flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            Broker P&L: {lastSync.toLocaleTimeString()}
          </span>
        )}
        {stats.closestToStop && (
          <span className="flex items-center gap-1 text-neon-amber">
            <AlertTriangle className="w-3 h-3" />
            Closest to stop: {stats.closestToStop.position.symbol} ({stats.closestToStop.distanceToStopPct?.toFixed(2)}%)
          </span>
        )}
      </div>

      {/* Position Table */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-base-850/30 p-12 text-center">
          <Activity className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No open positions</p>
          <p className="text-xs text-slate-600 mt-1">Positions will appear here in real time when your bots trade</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.06] bg-base-850/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="text-left font-semibold px-4 py-3">Bot / Symbol</th>
                  <th className="text-left font-semibold px-3 py-3">Side</th>
                  <th className="text-right font-semibold px-3 py-3">Entry</th>
                  <th className="text-right font-semibold px-3 py-3">Live Price</th>
                  <th className="text-right font-semibold px-3 py-3">Qty / Lev</th>
                  <th className="text-right font-semibold px-3 py-3">Unrealized P&L</th>
                  <th className="text-right font-semibold px-3 py-3">Trailing SL</th>
                  <th className="text-right font-semibold px-3 py-3">Dist. to SL</th>
                  <th className="text-right font-semibold px-3 py-3">TP Target</th>
                  <th className="text-center font-semibold px-3 py-3">Exchange SL</th>
                  <th className="text-center font-semibold px-3 py-3">Age</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pos = row.position;
                  const isLong = pos.side === 'BUY';
                  const pnlPositive = row.unrealizedPnlInr >= 0;
                  const stopClose = row.distanceToStopPct !== null && row.distanceToStopPct < 1;

                  return (
                    <tr
                      key={pos.id}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Bot / Symbol */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isLong ? 'bg-neon-green/10' : 'bg-red-400/10'
                          }`}>
                            {isLong ? <ArrowUp className="w-3.5 h-3.5 text-neon-green" /> : <ArrowDown className="w-3.5 h-3.5 text-red-400" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{row.botName}</p>
                            <p className="text-[11px] text-slate-500">
                              {pos.symbol}
                              {row.isPaper && <span className="ml-1.5 text-neon-cyan">PAPER</span>}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Side */}
                      <td className="px-3 py-3">
                        <span className={`text-xs font-bold ${isLong ? 'text-neon-green' : 'text-red-400'}`}>
                          {isLong ? 'LONG' : 'SHORT'}
                        </span>
                      </td>

                      {/* Entry */}
                      <td className="px-3 py-3 text-right text-slate-300 tabular-nums">
                        {pos.entry_price.toFixed(pos.entry_price < 1 ? 6 : 2)}
                      </td>

                      {/* Live Price */}
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.livePrice > 0 ? (
                          <span className={pnlPositive ? 'text-neon-green' : 'text-red-400'}>
                            {row.livePrice.toFixed(row.livePrice < 1 ? 6 : 2)}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Qty / Leverage */}
                      <td className="px-3 py-3 text-right">
                        <span className="text-slate-300 tabular-nums text-xs">{pos.quantity}</span>
                        <span className="text-slate-600 text-[10px] ml-1">{pos.leverage}x</span>
                      </td>

                      {/* Unrealized P&L */}
                      <td className="px-3 py-3 text-right tabular-nums">
                        <div className={`text-sm font-bold ${pnlPositive ? 'text-neon-green' : 'text-red-400'}`}>
                          {pnlPositive ? '+' : ''}{formatInr(row.unrealizedPnlInr)}
                        </div>
                        <div className={`text-[10px] ${pnlPositive ? 'text-neon-green/60' : 'text-red-400/60'}`}>
                          {pnlPositive ? '+' : ''}{row.pnlPct.toFixed(1)}%
                        </div>
                      </td>

                      {/* Trailing SL */}
                      <td className="px-3 py-3 text-right">
                        {row.currentStopLoss && row.currentStopLoss > 0 ? (
                          <div>
                            <span className="text-slate-300 tabular-nums text-xs">
                              {row.currentStopLoss.toFixed(row.currentStopLoss < 1 ? 6 : 2)}
                            </span>
                            {row.trailingActive && (
                              <span className="block text-[9px] text-neon-cyan/70 font-semibold">TRAILING</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Distance to SL */}
                      <td className="px-3 py-3 text-right">
                        {row.distanceToStopPct !== null ? (
                          <span className={`text-xs font-semibold tabular-nums ${stopClose ? 'text-red-400' : 'text-slate-400'}`}>
                            {row.distanceToStopPct.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>

                      {/* TP Target */}
                      <td className="px-3 py-3 text-right">
                        {row.takeProfitTarget && row.takeProfitTarget > 0 ? (
                          <div>
                            <span className="text-neon-green/80 tabular-nums text-xs">
                              {row.takeProfitTarget.toFixed(row.takeProfitTarget < 1 ? 6 : 2)}
                            </span>
                            {row.distanceToTpPct !== null && (
                              <span className="block text-[9px] text-slate-500">{row.distanceToTpPct.toFixed(2)}% away</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Exchange SL */}
                      <td className="px-3 py-3 text-center">
                        {row.isPaper ? (
                          <span className="text-[10px] text-neon-cyan/60">PAPER</span>
                        ) : row.exchangeSlActive ? (
                          <div className="flex items-center justify-center gap-1">
                            <CheckCircle2 className="w-4 h-4 text-neon-green" />
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1" title="No exchange-side SL — backend polling only">
                            <AlertTriangle className="w-4 h-4 text-neon-amber" />
                          </div>
                        )}
                      </td>

                      {/* Age */}
                      <td className="px-3 py-3 text-center">
                        <span className="text-xs text-slate-500 tabular-nums">
                          {row.ageMinutes < 60 ? `${row.ageMinutes}m` : `${Math.floor(row.ageMinutes / 60)}h ${row.ageMinutes % 60}m`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-5 text-[11px] text-slate-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-neon-green" />
          Stop-loss held on CoinDCX exchange
        </span>
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-neon-amber" />
          Backend polling only (no exchange SL)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-neon-cyan font-semibold">TRAILING</span>
          Stop ratchets with price movement
        </span>
      </div>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: 'cyan' | 'green' | 'red' | 'amber';
}

function StatCard({ label, value, sub, icon, accent }: StatCardProps) {
  const colorMap = {
    cyan: 'text-neon-cyan border-neon-cyan/20 bg-neon-cyan/5',
    green: 'text-neon-green border-neon-green/20 bg-neon-green/5',
    red: 'text-red-400 border-red-400/20 bg-red-400/5',
    amber: 'text-neon-amber border-neon-amber/20 bg-neon-amber/5',
  };
  const [textClass, ...borderBg] = colorMap[accent].split(' ');

  return (
    <div className={`rounded-xl border ${borderBg.join(' ')} bg-base-850/40 p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        <span className={textClass}>{icon}</span>
      </div>
      <p className={`text-lg font-bold ${textClass} tabular-nums`}>{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}
