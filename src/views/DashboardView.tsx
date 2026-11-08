import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Brain, Activity, DollarSign, Target, Shield, AlertOctagon } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Sparkline from '@/components/Sparkline';
import { SkeletonStat, SkeletonRow } from '@/components/Skeleton';
import { supabase, type Bot, type TradeHistory, type Signal, type License, type UserFund, type SentimentScore } from '@/lib/supabase';
import { useLivePrices } from '@/hooks/useLivePrices';
import { useUnrealizedPnl } from '@/hooks/useUnrealizedPnl';
import { useCoinDcxPositionStream } from '@/hooks/useCoinDcxPositionStream';
import AiMarketPredictor from '@/components/AiMarketPredictor';
import { computeMarketSentiment } from '@/lib/marketSentiment';
import type { Trade as OpenTrade } from '@/lib/supabase';

const accentMap = {
  green: { text: 'text-neon-green', border: 'border-neon-green/30', bg: 'bg-neon-green/10', glow: 'neon-glow-green', hex: '#00ff9d' },
  cyan: { text: 'text-neon-cyan', border: 'border-neon-cyan/30', bg: 'bg-neon-cyan/10', glow: 'neon-glow-cyan', hex: '#00e5ff' },
  amber: { text: 'text-neon-amber', border: 'border-neon-amber/30', bg: 'bg-neon-amber/10', glow: '', hex: '#ffb020' },
};

export default function DashboardView() {
  const { formatInr, formatCompact } = useApp();
  const [bots, setBots] = useState<Bot[]>([]);
  const [trades, setTrades] = useState<TradeHistory[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [license, setLicense] = useState<License | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [openTrades, setOpenTrades] = useState<OpenTrade[]>([]);
  const { effectiveUserId } = useAuth();
  const { coins, isLiveConnected, connectionStatus, orderBooks, candlesBySymbol } = useLivePrices();
  const { wsState: exchangeWsState } = useCoinDcxPositionStream();
  const sentiment = computeMarketSentiment(coins, candlesBySymbol, connectionStatus !== 'offline');
  const fg = sentiment.fearGreedIndex;
  const fgColor = sentiment.fearGreedColor;
  const fgNeedleAngle = Math.PI * (1 - fg / 100);
  const fgArcEndX = 100 + 78 * Math.cos(fgNeedleAngle);
  const fgArcEndY = 100 - 78 * Math.sin(fgNeedleAngle);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [updateAgo, setUpdateAgo] = useState('just now');
  const [aiSentiment, setAiSentiment] = useState<SentimentScore | null>(null);

  useEffect(() => {
    if (coins.length === 0) return;
    setLastUpdate(Date.now());
    const timer = setInterval(() => {
      const secs = Math.floor((Date.now() - lastUpdate) / 1000);
      setUpdateAgo(secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`);
    }, 1000);
    return () => clearInterval(timer);
  }, [coins, lastUpdate]);

  useEffect(() => {
    const refreshBots = () => {
      const uid = effectiveUserId ?? '';
      supabase.from('bots').select('*').eq('user_id', uid).neq('status', 'inactive').order('created_at', { ascending: false }).then(({ data }) => {
        setBots((data as Bot[]) ?? []);
      });
    };
    refreshBots();
    supabase.from('trade_history').select('*').eq('user_id', effectiveUserId ?? '').order('timestamp', { ascending: false }).limit(20).then(({ data }) => {
      setTrades((data as TradeHistory[]) ?? []);
    });
    supabase.from('trades').select('*').eq('client_id', effectiveUserId ?? '').eq('status', 'open').order('created_at', { ascending: false }).then(({ data }) => {
      setOpenTrades((data as OpenTrade[]) ?? []);
    });
    supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(5).then(({ data }) => {
      setSignals((data as Signal[]) ?? []);
    });

    // Fetch user's wallet balance for real portfolio value
    if (effectiveUserId) {
      supabase
        .from('user_funds')
        .select('*')
        .eq('user_id', effectiveUserId)
        .then(({ data }) => {
          const funds = (data as UserFund[]) ?? [];
          setWalletBalance(funds.reduce((s, f) => s + f.balance, 0));
        });
    }

    // Fetch user's active license for bot gating
    if (effectiveUserId) {
      supabase
        .from('licenses')
        .select('*')
        .eq('user_id', effectiveUserId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          setLicense(data as License | null);
        });
    }

    // ── Realtime: bots table (status changes like Close/terminate reflect instantly) ──
    const botsChannel = supabase
      .channel('dashboard_bots_realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bots', filter: `user_id=eq.${effectiveUserId ?? ''}` }, () => refreshBots())
      .subscribe();

    // ── Realtime: trades table (open positions + new entries) ──
    const refreshTrades = () => {
      const uid = effectiveUserId ?? '';
      supabase.from('trade_history').select('*').eq('user_id', uid).order('timestamp', { ascending: false }).limit(20).then(({ data }) => {
        setTrades((data as TradeHistory[]) ?? []);
      });
      supabase.from('trades').select('*').eq('client_id', uid).eq('status', 'open').order('created_at', { ascending: false }).then(({ data }) => {
        setOpenTrades((data as OpenTrade[]) ?? []);
      });
    };

    const tradesChannel = supabase
      .channel('dashboard_trades_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades' }, refreshTrades)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trades' }, refreshTrades)
      .subscribe();

    // ── Realtime: positions table (auto-close by 5s engine) ──
    const positionsChannel = supabase
      .channel('dashboard_positions_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'positions' }, refreshTrades)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'positions' }, refreshTrades)
      .subscribe();

    // ── Realtime: trade_history table (P&L updates) ──
    const historyChannel = supabase
      .channel('dashboard_history_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trade_history' }, refreshTrades)
      .subscribe();

    // Fetch latest AI sentiment from the database (written by analyze-market-sentiment cron)
    const fetchAiSentiment = () => {
      supabase
        .from('sentiment_scores')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setAiSentiment(data as SentimentScore);
        });
    };
    fetchAiSentiment();

    const sentimentChannel = supabase
      .channel('sentiment_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sentiment_scores' }, (payload) => {
        setAiSentiment(payload.new as SentimentScore);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(botsChannel);
      supabase.removeChannel(tradesChannel);
      supabase.removeChannel(positionsChannel);
      supabase.removeChannel(historyChannel);
      supabase.removeChannel(sentimentChannel);
    };
  }, [effectiveUserId]);

  const { totalUnrealized } = useUnrealizedPnl(openTrades);
  const totalPnl = trades.reduce((sum, t) => sum + Number(t.pnl), 0) + totalUnrealized;
  const activeCount = bots.filter(b => b.status === 'running' || b.status === 'paper').length;
  const winCount = trades.filter(t => Number(t.pnl) > 0).length;
  const winRate = trades.length > 0 ? ((winCount / trades.length) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Portfolio Value" value={formatInr(walletBalance)} icon={DollarSign} accent="cyan" sub={`${openTrades.length} open positions`} />
        <StatCard label="Total P&L" value={formatInr(totalPnl)} icon={TrendingUp} accent={totalPnl >= 0 ? 'green' : 'green'} sub={`${trades.length} closed · ${openTrades.length} open`} pnlValue={totalPnl} />
        <StatCard label="Active Bots" value={`${activeCount} / ${bots.length}`} icon={Activity} accent="amber" sub={bots.length > 0 ? `${bots.length} total` : 'No bots yet'} />
        <StatCard label="Win Rate" value={`${winRate}%`} icon={Target} accent="green" sub={`${winCount} wins`} />
      </div>

      {/* AI Market Sentiment: Fear & Greed + Analysis (merged) | AI Market Predictor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Fear & Greed Meter + Live AI Market Analysis — merged card */}
        <div className="glass-card p-6 sm:p-8 relative overflow-hidden h-full flex flex-col">
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl" style={{ backgroundColor: fgColor + '0d' }} />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: fgColor }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: fgColor }} />
              </span>
              <h2 className="text-xs font-bold text-white tracking-wide">FEAR & GREED METER · LIVE AI MARKET ANALYSIS</h2>
              <span className="ml-auto text-[10px] text-slate-500">{updateAgo}</span>
            </div>
            <p className="text-[10px] text-slate-500 mb-4">Cortex Neural Engine v3 · Live · {updateAgo}</p>

            {/* Data Feed Offline Banner — primary + fallback sources unreachable */}
            {connectionStatus === 'offline' && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-neon-red/10 border border-neon-red/40 animate-pulse mb-4">
                <AlertOctagon className="w-4 h-4 text-neon-red flex-shrink-0" />
                <span className="text-[11px] font-bold text-neon-red tracking-wide">
                  DATA FEED OFFLINE — Retrying connection...
                </span>
              </div>
            )}
            {connectionStatus === 'reconnecting' && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-neon-amber/10 border border-neon-amber/40 mb-4">
                <Activity className="w-4 h-4 text-neon-amber flex-shrink-0" />
                <span className="text-[11px] font-bold text-neon-amber tracking-wide">
                  Reconnecting to live market feed...
                </span>
              </div>
            )}

            {exchangeWsState === 'connected' && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neon-green/10 border border-neon-green/30 mb-4">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-neon-green" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-neon-green" />
                </span>
                <span className="text-[11px] font-bold text-neon-green tracking-wide">
                  EXCHANGE STREAM LIVE — Real-time position sync active (0-sec latency)
                </span>
              </div>
            )}
            {exchangeWsState === 'connecting' && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neon-amber/10 border border-neon-amber/30 mb-4">
                <Activity className="w-4 h-4 text-neon-amber flex-shrink-0 animate-pulse" />
                <span className="text-[11px] font-bold text-neon-amber tracking-wide">
                  Connecting to CoinDCX exchange stream...
                </span>
              </div>
            )}

            {/* Semicircular Gauge — centered */}
            <div className="flex flex-col items-center">
              <div className="relative w-[200px] h-[110px]">
                <svg width="200" height="110" viewBox="0 0 200 110" className="overflow-visible">
                  {/* Background arc */}
                  <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#141828" strokeWidth="14" strokeLinecap="round" />
                  {/* Colored segments */}
                  <path d="M 20 100 A 80 80 0 0 1 53 36" fill="none" stroke="#ff3b5c" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
                  <path d="M 53 36 A 80 80 0 0 1 100 20" fill="none" stroke="#ffb020" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
                  <path d="M 100 20 A 80 80 0 0 1 147 36" fill="none" stroke="#00e5ff" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
                  <path d="M 147 36 A 80 80 0 0 1 180 100" fill="none" stroke="#00ff9d" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
                  {/* Active arc up to live index */}
                  <path d={`M 20 100 A 80 80 0 0 1 ${fgArcEndX.toFixed(1)} ${fgArcEndY.toFixed(1)}`} fill="none" stroke={fgColor} strokeWidth="14" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 8px ${fgColor}99)` }} />
                  {/* Needle */}
                  <line
                    x1="100" y1="100"
                    x2={fgArcEndX.toFixed(1)}
                    y2={fgArcEndY.toFixed(1)}
                    stroke={fgColor} strokeWidth="2.5" strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 6px ${fgColor}cc)` }}
                  />
                  <circle cx="100" cy="100" r="6" fill="#0b0e18" stroke={fgColor} strokeWidth="2" style={{ filter: `drop-shadow(0 0 4px ${fgColor}99)` }} />
                </svg>
              </div>
              <div className="text-center -mt-2">
                <p className="text-3xl font-bold font-mono" style={{ color: fgColor, textShadow: `0 0 12px ${fgColor}66` }}>{fg}</p>
                <p className="text-sm font-bold" style={{ color: fgColor }}>{sentiment.fearGreedLabel}</p>
              </div>
            </div>

            {/* Labels */}
            <div className="flex justify-between mt-3 text-[9px] text-slate-600">
              <span className="text-neon-red">Extreme Fear</span>
              <span className="text-neon-amber">Fear</span>
              <span className="text-neon-cyan">Neutral</span>
              <span className="text-neon-green font-bold">Greed</span>
            </div>

            {/* ── Merged Live AI Market Analysis content ── */}
            <div className="mt-6 pt-6 border-t border-white/[0.06]">
              <p className="text-lg sm:text-xl font-bold text-white mb-3 leading-snug">
                <span style={{ color: fgColor, textShadow: `0 0 12px ${fgColor}55` }}>
                  {connectionStatus === 'offline' ? 'Connection Lost — Reconnecting...' : sentiment.score === 50 && coins.length === 0 ? 'Connecting to live market data...' : `${sentiment.score < 45 ? 'Bearish' : sentiment.score > 55 ? 'Bullish' : 'Consolidating'} market · ${sentiment.fearGreedLabel} (${fg})`}
                </span>
              </p>

              {/* AI-generated summary */}
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] mb-4">
                <div className="flex items-start gap-2.5">
                  <Brain className="w-4 h-4 text-neon-cyan flex-shrink-0 mt-0.5 animate-pulse-glow" />
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {sentiment.summary} The Fear & Greed index reads <span className="font-semibold" style={{ color: fgColor }}>{fg} ({sentiment.fearGreedLabel})</span>. Cortex AI recommends <span className="text-neon-cyan font-semibold">{sentiment.recommendation}</span>.
                  </p>
                </div>
              </div>

              {/* AI Sentiment Oracle — DB-powered live analysis */}
              {aiSentiment && (
                <div className={`p-4 rounded-xl border mb-4 ${aiSentiment.long_entries_blocked ? 'bg-neon-red/[0.06] border-neon-red/20' : aiSentiment.trailing_tightened ? 'bg-neon-amber/[0.06] border-neon-amber/20' : 'bg-neon-cyan/[0.04] border-neon-cyan/15'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`relative flex h-2 w-2`}>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: aiSentiment.long_entries_blocked ? '#ff3b5c' : aiSentiment.trailing_tightened ? '#ffb020' : '#00e5ff' }} />
                      <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: aiSentiment.long_entries_blocked ? '#ff3b5c' : aiSentiment.trailing_tightened ? '#ffb020' : '#00e5ff' }} />
                    </span>
                    <span className="text-[10px] font-bold tracking-wide text-white">CORTEX AI SENTIMENT ORACLE</span>
                    <span className="text-[10px] text-slate-500 ml-auto">{aiSentiment.classification.toUpperCase()} · {aiSentiment.overall_score}/100</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed mb-2">{aiSentiment.ai_summary}</p>
                  {aiSentiment.long_entries_blocked && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-neon-red">
                      <Shield className="w-3 h-3" />
                      LONG ENTRIES PAUSED — AI capital protection active
                    </div>
                  )}
                  {aiSentiment.trailing_tightened && !aiSentiment.long_entries_blocked && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-neon-amber">
                      <Shield className="w-3 h-3" />
                      TRAILING STOPS TIGHTENED — Reversal risk protection
                    </div>
                  )}
                </div>
              )}

              {/* Sentiment Progress Bar */}
              <div className="relative">
                <div className="flex justify-between text-[10px] text-slate-500 mb-1.5">
                  <span>Bearish</span>
                  <span>Neutral</span>
                  <span className="font-semibold" style={{ color: sentiment.score >= 45 && sentiment.score <= 55 ? '#00e5ff' : sentiment.score > 55 ? '#00ff9d' : '#ff3b5c' }}>
                    {sentiment.score >= 45 && sentiment.score <= 55 ? 'Sideways' : sentiment.score > 55 ? 'Bullish' : 'Bearish'} {sentiment.bullishPercent}%
                  </span>
                </div>
                <div className="h-3 rounded-full bg-base-700 overflow-hidden relative">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-red via-neon-amber to-neon-green transition-all duration-1000 relative"
                    style={{ width: `${sentiment.bullishPercent}%` }}
                  >
                    <div className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 20px ${sentiment.score >= 45 && sentiment.score <= 55 ? 'rgba(0, 229, 255, 0.5)' : sentiment.score > 55 ? 'rgba(0, 255, 157, 0.5)' : 'rgba(255, 59, 92, 0.5)'}` }} />
                    <div className="absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-white/30 to-transparent" />
                  </div>
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-slate-600">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Sub-sentiment chips */}
              <div className="flex flex-wrap gap-2 mt-4">
                {(() => {
                  const fgChipColor = fg < 45 ? 'amber' : fg >= 55 ? 'green' : 'cyan';
                  const volChipColor = sentiment.volatility === 'Low' ? 'green' : sentiment.volatility === 'Moderate' ? 'cyan' : sentiment.volatility === 'High' ? 'amber' : 'green';
                  const breadthColor = sentiment.advancing > sentiment.declining ? 'green' : sentiment.declining > sentiment.advancing ? 'amber' : 'cyan';
                  const gainColor = sentiment.topGainer ? 'green' : 'cyan';
                  return [
                    { label: 'Fear & Greed', value: `${fg} — ${sentiment.fearGreedLabel}`, color: fgChipColor },
                    { label: 'Breadth', value: `${sentiment.advancing} up / ${sentiment.declining} down`, color: breadthColor },
                    { label: 'Top Gainer', value: sentiment.topGainer ? `${sentiment.topGainer.symbol} +${sentiment.topGainer.change15m.toFixed(1)}%` : 'N/A', color: gainColor },
                    { label: 'Volatility', value: sentiment.volatility, color: volChipColor },
                  ].map((chip) => (
                    <div key={chip.label} className={`px-3 py-1.5 rounded-lg text-xs ${accentMap[chip.color as keyof typeof accentMap].bg} ${accentMap[chip.color as keyof typeof accentMap].border} border`}>
                      <span className="text-slate-400">{chip.label}: </span>
                      <span className={accentMap[chip.color as keyof typeof accentMap].text + ' font-semibold'}>{chip.value}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* AI Market Predictor — right column */}
        <AiMarketPredictor
          formatInr={formatInr}
          coins={coins}
          isLiveConnected={isLiveConnected}
          connectionStatus={connectionStatus}
          orderBooks={orderBooks}
          candlesBySymbol={candlesBySymbol}
        />
      </div>

      {/* Bottom: Recent signals + Top movers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Signals */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-neon-green" />
            Latest AI Signals
          </h3>
          <div className="space-y-2">
            {signals.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">No signals yet. AI signals will appear here in real-time.</p>
            ) : (
              signals.map((sig) => (
                <div key={sig.id} className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold ${sig.type === 'BUY' ? 'bg-neon-green/15 text-neon-green' : sig.type === 'SELL' ? 'bg-neon-red/15 text-neon-red' : 'bg-neon-amber/15 text-neon-amber'}`}>
                      {sig.type}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">{sig.coin}</p>
                      <p className="text-[10px] text-slate-500">{sig.timeframe} · {sig.source}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono text-slate-200">{formatInr(Number(sig.entry))}</p>
                    <p className="text-[10px] text-neon-cyan">{sig.confidence}% conf.</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Movers */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-cyan" />
            Top Movers (15M)
          </h3>
          <div className="space-y-2">
            {coins.length === 0 ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map(i => <SkeletonRow key={i} />)}
              </div>
            ) : (
              [...coins].sort((a, b) => Math.abs(b.change15m) - Math.abs(a.change15m)).slice(0, 5).map((c) => (
                <div key={c.symbol} className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center text-[10px] font-bold text-slate-300">
                      {c.symbol.slice(0, 3)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{c.symbol}</p>
                      <p className="text-[10px] text-slate-500">{formatCompact(c.quoteVolume24h)} vol</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Sparkline data={c.sparkline} color={c.change15m >= 0 ? '#00ff9d' : '#ff3b5c'} width={60} height={24} />
                    <div className="text-right">
                      <p className="text-sm font-mono tabular-nums text-slate-200">{formatInr(c.price)}</p>
                      <p className={`text-[10px] font-semibold tabular-nums ${c.change15m >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                        {c.change15m >= 0 ? '+' : ''}{c.change15m.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, accent, sub, pnlValue }: { label: string; value: string; icon: typeof DollarSign; accent: keyof typeof accentMap; sub: string; pnlValue?: number }) {
  const a = accentMap[accent];
  return (
    <div className="glass-card p-4 relative overflow-hidden group hover:border-white/[0.12] transition-all duration-300">
      <div className={`absolute -top-8 -right-8 w-24 h-24 ${a.bg} rounded-full blur-2xl opacity-50 group-hover:opacity-100 transition-opacity`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</span>
          <Icon className={`w-4 h-4 ${a.text}`} />
        </div>
        <p className={`text-lg sm:text-xl font-bold font-mono tabular-nums ${pnlValue !== undefined ? (pnlValue > 0 ? 'text-neon-green' : pnlValue < 0 ? 'text-neon-red' : 'text-slate-400') : 'text-white'}`}>{pnlValue !== undefined ? `${pnlValue > 0 ? '+' : ''}${value}` : value}</p>
        <p className={`text-[10px] mt-0.5 ${a.text}`}>{sub}</p>
      </div>
    </div>
  );
}


