import { useEffect, useState, useMemo } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Activity, Award, AlertTriangle,
  Loader2, Calendar, Target, Zap, Brain, ArrowUpRight, ArrowDownRight,
  Percent, DollarSign, Clock,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { supabase, type TradeHistory, type Position, type Bot, type UserFund } from '@/lib/supabase';

interface EquityPoint {
  date: string;
  equity: number;
  pnl: number;
  cumulativePnl: number;
  drawdown: number;
  peak: number;
}

interface BotPerformance {
  botId: string;
  botName: string;
  botType: string;
  status: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
  coin: string;
}

interface MonthlyPnl {
  month: string;
  monthLabel: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
}

const CHART_AXIS = '#475569';
const CHART_GRID = '#1e293b';

function formatMonthLabel(d: Date): string {
  return d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

export default function PerformanceAnalyticsView() {
  const { formatInr } = useApp();
  const { session } = useAuth();
  const userId = session?.user?.id ?? '';

  const [trades, setTrades] = useState<TradeHistory[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [funds, setFunds] = useState<UserFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'30d' | '90d' | 'all'>('30d');

  useEffect(() => {
    if (!userId) return;

    const cutoff = timeRange === '30d'
      ? new Date(Date.now() - 30 * 86400000).toISOString()
      : timeRange === '90d'
      ? new Date(Date.now() - 90 * 86400000).toISOString()
      : '1970-01-01T00:00:00Z';

    Promise.all([
      supabase
        .from('trade_history')
        .select('*')
        .eq('user_id', userId)
        .gte('timestamp', cutoff)
        .order('timestamp', { ascending: true }),
      supabase
        .from('positions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      supabase
        .from('bots')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('user_funds')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
    ]).then(([tradeRes, posRes, botRes, fundRes]) => {
      setTrades((tradeRes.data as TradeHistory[]) ?? []);
      setPositions((posRes.data as Position[]) ?? []);
      setBots((botRes.data as Bot[]) ?? []);
      setFunds((fundRes.data as UserFund[]) ?? []);
      setLoading(false);
    });
  }, [userId, timeRange]);

  // Starting capital = earliest fund balance + total realized PnL (reconstruct actual starting point)
  const startingCapital = funds.length > 0 ? funds[0].balance : 0;

  // ─── Equity Curve & Drawdown ───
  const equityData: EquityPoint[] = useMemo(() => {
    if (trades.length === 0) return [];

    let cumulative = 0;
    let peak = 0;
    const points: EquityPoint[] = [];

    for (const t of trades) {
      const pnl = Number(t.pnl);
      cumulative += pnl;
      peak = Math.max(peak, cumulative);
      const drawdown = cumulative - peak;

      points.push({
        date: new Date(t.timestamp).toLocaleString('en-US', { dateStyle: 'short' }),
        equity: startingCapital + cumulative,
        pnl,
        cumulativePnl: cumulative,
        drawdown,
        peak,
      });
    }
    return points;
  }, [trades, startingCapital]);

  // ─── Monthly P&L ───
  const monthlyData: MonthlyPnl[] = useMemo(() => {
    const map = new Map<string, MonthlyPnl>();

    for (const t of trades) {
      const d = new Date(t.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = formatMonthLabel(d);

      if (!map.has(key)) {
        map.set(key, { month: key, monthLabel: label, pnl: 0, trades: 0, wins: 0, losses: 0 });
      }
      const entry = map.get(key)!;
      const pnl = Number(t.pnl);
      entry.pnl += pnl;
      entry.trades += 1;
      if (pnl > 0) entry.wins += 1;
      else if (pnl < 0) entry.losses += 1;
    }

    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [trades]);

  // ─── Per-Bot Performance ───
  const botPerformance: BotPerformance[] = useMemo(() => {
    const map = new Map<string, BotPerformance>();

    for (const bot of bots) {
      map.set(bot.id, {
        botId: bot.id,
        botName: bot.name,
        botType: bot.bot_type ?? bot.strategy ?? 'scalper',
        status: bot.status,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalPnl: 0,
        avgPnl: 0,
        bestTrade: 0,
        worstTrade: 0,
        coin: bot.coin,
      });
    }

    for (const t of trades) {
      const botId = (t as TradeHistory & { bot_id?: string }).bot_id;
      if (!botId || !map.has(botId)) continue;
      const entry = map.get(botId)!;
      const pnl = Number(t.pnl);
      entry.totalTrades += 1;
      entry.totalPnl += pnl;
      if (pnl > 0) entry.wins += 1;
      else if (pnl < 0) entry.losses += 1;
      entry.bestTrade = Math.max(entry.bestTrade, pnl);
      entry.worstTrade = Math.min(entry.worstTrade, pnl);
    }

    const result = Array.from(map.values()).filter(b => b.totalTrades > 0);
    for (const b of result) {
      b.winRate = b.totalTrades > 0 ? (b.wins / b.totalTrades) * 100 : 0;
      b.avgPnl = b.totalTrades > 0 ? b.totalPnl / b.totalTrades : 0;
    }
    return result.sort((a, b) => b.totalPnl - a.totalPnl);
  }, [trades, bots]);

  // ─── Summary Stats ───
  const stats = useMemo(() => {
    const totalPnl = trades.reduce((s, t) => s + Number(t.pnl), 0);
    const wins = trades.filter(t => Number(t.pnl) > 0);
    const losses = trades.filter(t => Number(t.pnl) < 0);
    const winCount = wins.length;
    const lossCount = losses.length;
    const winRate = trades.length > 0 ? (winCount / trades.length) * 100 : 0;
    const avgWin = winCount > 0 ? wins.reduce((s, t) => s + Number(t.pnl), 0) / winCount : 0;
    const avgLoss = lossCount > 0 ? Math.abs(losses.reduce((s, t) => s + Number(t.pnl), 0) / lossCount) : 0;
    const profitFactor = avgLoss > 0 && lossCount > 0
      ? (wins.reduce((s, t) => s + Number(t.pnl), 0)) / Math.abs(losses.reduce((s, t) => s + Number(t.pnl), 0))
      : winCount > 0 ? Infinity : 0;
    const maxDrawdown = equityData.length > 0 ? Math.min(...equityData.map(d => d.drawdown)) : 0;
    const bestTrade = trades.length > 0 ? Math.max(...trades.map(t => Number(t.pnl))) : 0;
    const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => Number(t.pnl))) : 0;
    const openPositions = positions.filter(p => p.status === 'open').length;
    const totalUnrealized = positions
      .filter(p => p.status === 'open')
      .reduce((s, p) => s + p.unrealized_pnl, 0);

    return {
      totalPnl,
      winRate,
      winCount,
      lossCount,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdown,
      bestTrade,
      worstTrade,
      openPositions,
      totalUnrealized,
      totalTrades: trades.length,
    };
  }, [trades, positions, equityData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="space-y-5 animate-slide-up">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-neon-cyan" />
            Performance Analytics
          </h2>
          <p className="text-sm text-slate-400">Track your trading performance with detailed metrics</p>
        </div>
        <div className="glass-card p-12 flex flex-col items-center justify-center text-center">
          <BarChart3 className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-sm font-semibold text-slate-300">No performance data yet</p>
          <p className="text-xs text-slate-500 mt-1">Your analytics will appear here once your bots start executing trades.</p>
        </div>
      </div>
    );
  }

  const profitFactorDisplay = stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-neon-cyan" />
            Performance Analytics
          </h2>
          <p className="text-sm text-slate-400">Track your trading performance with detailed metrics</p>
        </div>
        {/* Time range selector */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-base-800/80 border border-white/[0.06]">
          {(['30d', '90d', 'all'] as const).map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                timeRange === range
                  ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {range === '30d' ? '30 Days' : range === '90d' ? '90 Days' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard
          label="Net P&L"
          value={formatInr(stats.totalPnl)}
          icon={stats.totalPnl >= 0 ? TrendingUp : TrendingDown}
          accent={stats.totalPnl >= 0 ? 'green' : 'red'}
          sub={`${stats.totalTrades} trades`}
        />
        <SummaryCard
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          icon={Target}
          accent={stats.winRate >= 50 ? 'green' : 'amber'}
          sub={`${stats.winCount}W / ${stats.lossCount}L`}
        />
        <SummaryCard
          label="Profit Factor"
          value={profitFactorDisplay}
          icon={Activity}
          accent={stats.profitFactor >= 1.5 ? 'green' : stats.profitFactor >= 1 ? 'amber' : 'red'}
          sub={stats.profitFactor >= 1.5 ? 'Excellent' : stats.profitFactor >= 1 ? 'Profitable' : 'Unprofitable'}
        />
        <SummaryCard
          label="Max Drawdown"
          value={formatInr(stats.maxDrawdown)}
          icon={AlertTriangle}
          accent="red"
          sub="Peak to trough"
        />
      </div>

      {/* Equity Curve */}
      <div className="glass-card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-neon-green" />
          <h3 className="text-sm font-bold text-white">Equity Curve</h3>
          <span className="text-[10px] text-slate-500 ml-auto">Starting capital: {formatInr(startingCapital)}</span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={equityData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00ff9d" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#00ff9d" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="date" tick={{ fill: CHART_AXIS, fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
            <Tooltip
              contentStyle={{ background: '#0b0e18', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(value: number) => [formatInr(value), 'Equity']}
            />
            <ReferenceLine y={startingCapital} stroke="#475569" strokeDasharray="3 3" label={{ value: 'Start', fill: '#475569', fontSize: 10 }} />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#00ff9d"
              strokeWidth={2}
              fill="url(#equityGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Drawdown Chart */}
      <div className="glass-card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-neon-red" />
          <h3 className="text-sm font-bold text-white">Drawdown Analysis</h3>
          <span className="text-[10px] text-slate-500 ml-auto">Worst: {formatInr(stats.maxDrawdown)}</span>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={equityData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff3b5c" stopOpacity={0} />
                <stop offset="100%" stopColor="#ff3b5c" stopOpacity={0.35} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="date" tick={{ fill: CHART_AXIS, fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#0b0e18', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(value: number) => [formatInr(value), 'Drawdown']}
            />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" />
            <Area
              type="monotone"
              dataKey="drawdown"
              stroke="#ff3b5c"
              strokeWidth={1.5}
              fill="url(#drawdownGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly P&L Bar Chart */}
      <div className="glass-card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-sm font-bold text-white">Monthly P&L Breakdown</h3>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="monthLabel" tick={{ fill: CHART_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#0b0e18', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(value: number, _name, props) => {
                const entry = props.payload as MonthlyPnl;
                return [`${formatInr(value)} · ${entry.trades} trades (${entry.wins}W/${entry.losses}L)`, 'P&L'];
              }}
            />
            <ReferenceLine y={0} stroke="#475569" />
            <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
              {monthlyData.map((entry, i) => (
                <Cell key={`cell-${i}`} fill={entry.pnl >= 0 ? '#00ff9d' : '#ff3b5c'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-Bot Performance Table */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
          <Award className="w-4 h-4 text-neon-amber" />
          <h3 className="text-sm font-bold text-white">Per-Bot Performance</h3>
          <span className="text-[10px] text-slate-500 ml-auto">{botPerformance.length} active bots</span>
        </div>
        {botPerformance.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-500">No bot performance data yet. Trades linked to bots will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04] text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="text-left py-2.5 px-5 font-semibold">Bot Name</th>
                  <th className="text-center py-2.5 px-3 font-semibold hidden sm:table-cell">Type</th>
                  <th className="text-center py-2.5 px-3 font-semibold">Trades</th>
                  <th className="text-center py-2.5 px-3 font-semibold">Win Rate</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Total P&L</th>
                  <th className="text-right py-2.5 px-3 font-semibold hidden md:table-cell">Avg P&L</th>
                  <th className="text-right py-2.5 px-3 font-semibold hidden lg:table-cell">Best</th>
                  <th className="text-right py-2.5 px-5 font-semibold hidden lg:table-cell">Worst</th>
                </tr>
              </thead>
              <tbody>
                {botPerformance.map((bot) => (
                  <tr key={bot.botId} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${bot.status === 'running' ? 'bg-neon-green' : bot.status === 'paper' ? 'bg-neon-cyan' : 'bg-slate-600'}`} />
                        <div>
                          <p className="font-semibold text-white text-xs">{bot.botName}</p>
                          <p className="text-[10px] text-slate-500">{bot.coin}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center hidden sm:table-cell">
                      <span className="px-2 py-0.5 rounded-md bg-white/[0.04] text-slate-400 text-[10px] font-bold capitalize">{bot.botType}</span>
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-300 text-xs">{bot.totalTrades}</td>
                    <td className="py-3 px-3 text-center">
                      <span className={`text-xs font-bold ${bot.winRate >= 60 ? 'text-neon-green' : bot.winRate >= 40 ? 'text-neon-amber' : 'text-neon-red'}`}>
                        {bot.winRate.toFixed(0)}%
                      </span>
                    </td>
                    <td className={`py-3 px-3 text-right font-mono text-xs font-bold ${bot.totalPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                      {bot.totalPnl >= 0 ? '+' : ''}{formatInr(bot.totalPnl)}
                    </td>
                    <td className={`py-3 px-3 text-right font-mono text-xs hidden md:table-cell ${bot.avgPnl >= 0 ? 'text-slate-300' : 'text-slate-400'}`}>
                      {bot.avgPnl >= 0 ? '+' : ''}{formatInr(bot.avgPnl)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-xs text-neon-green hidden lg:table-cell">
                      +{formatInr(bot.bestTrade)}
                    </td>
                    <td className="py-3 px-5 text-right font-mono text-xs text-neon-red hidden lg:table-cell">
                      {formatInr(bot.worstTrade)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trade Distribution & Risk Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Win/Loss Distribution */}
        <div className="glass-card p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Percent className="w-4 h-4 text-neon-cyan" />
            <h3 className="text-sm font-bold text-white">Win / Loss Distribution</h3>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="flex items-center gap-1.5 text-neon-green font-semibold">
                  <ArrowUpRight className="w-3.5 h-3.5" /> Winning Trades
                </span>
                <span className="text-slate-400 font-mono">{stats.winCount} · Avg +{formatInr(stats.avgWin)}</span>
              </div>
              <div className="h-3 rounded-full bg-base-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-neon-green/60 to-neon-green transition-all duration-1000"
                  style={{ width: `${stats.totalTrades > 0 ? (stats.winCount / stats.totalTrades) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="flex items-center gap-1.5 text-neon-red font-semibold">
                  <ArrowDownRight className="w-3.5 h-3.5" /> Losing Trades
                </span>
                <span className="text-slate-400 font-mono">{stats.lossCount} · Avg -{formatInr(stats.avgLoss)}</span>
              </div>
              <div className="h-3 rounded-full bg-base-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-neon-red/60 to-neon-red transition-all duration-1000"
                  style={{ width: `${stats.totalTrades > 0 ? (stats.lossCount / stats.totalTrades) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-white/[0.04] grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Best Trade</p>
              <p className="text-sm font-bold text-neon-green font-mono">+{formatInr(stats.bestTrade)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Worst Trade</p>
              <p className="text-sm font-bold text-neon-red font-mono">{formatInr(stats.worstTrade)}</p>
            </div>
          </div>
        </div>

        {/* Risk & Position Summary */}
        <div className="glass-card p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-neon-amber" />
            <h3 className="text-sm font-bold text-white">Risk & Position Summary</h3>
          </div>
          <div className="space-y-3">
            <RiskRow
              icon={DollarSign}
              label="Unrealized P&L (Open)"
              value={`${stats.totalUnrealized >= 0 ? '+' : ''}${formatInr(stats.totalUnrealized)}`}
              valueClass={stats.totalUnrealized >= 0 ? 'text-neon-green' : 'text-neon-red'}
            />
            <RiskRow
              icon={Activity}
              label="Open Positions"
              value={`${stats.openPositions}`}
              valueClass="text-white"
            />
            <RiskRow
              icon={Target}
              label="Profit Factor"
              value={profitFactorDisplay}
              valueClass={stats.profitFactor >= 1.5 ? 'text-neon-green' : stats.profitFactor >= 1 ? 'text-neon-amber' : 'text-neon-red'}
            />
            <RiskRow
              icon={AlertTriangle}
              label="Max Drawdown"
              value={formatInr(stats.maxDrawdown)}
              valueClass="text-neon-red"
            />
            <RiskRow
              icon={Clock}
              label="Avg Win / Avg Loss"
              value={`+${formatInr(stats.avgWin)} / -${formatInr(stats.avgLoss)}`}
              valueClass="text-slate-300"
            />
            <RiskRow
              icon={Brain}
              label="Risk-Reward Ratio"
              value={stats.avgLoss > 0 ? `${(stats.avgWin / stats.avgLoss).toFixed(2)} : 1` : 'N/A'}
              valueClass={stats.avgLoss > 0 && stats.avgWin / stats.avgLoss >= 1.5 ? 'text-neon-green' : 'text-neon-amber'}
            />
          </div>
        </div>
      </div>

      {/* Daily P&L Line Chart */}
      <div className="glass-card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-sm font-bold text-white">Cumulative P&L Over Time</h3>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={equityData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="date" tick={{ fill: CHART_AXIS, fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#0b0e18', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(value: number) => [formatInr(value), 'Cumulative P&L']}
            />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="cumulativePnl"
              stroke="#00e5ff"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#00e5ff' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  accent,
  sub,
}: {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  accent: 'green' | 'red' | 'cyan' | 'amber';
  sub: string;
}) {
  const accentMap = {
    green: { text: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/20' },
    red: { text: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20' },
    cyan: { text: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/20' },
    amber: { text: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20' },
  };
  const a = accentMap[accent];
  return (
    <div className={`glass-card p-4 border ${a.border}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</span>
        <div className={`w-7 h-7 rounded-lg ${a.bg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${a.text}`} />
        </div>
      </div>
      <p className={`text-lg font-bold font-mono ${a.text}`}>{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

function RiskRow({
  icon: Icon,
  label,
  value,
  valueClass,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-500" />
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <span className={`text-sm font-mono font-bold ${valueClass}`}>{value}</span>
    </div>
  );
}

// Cell helper removed — using recharts Cell directly
