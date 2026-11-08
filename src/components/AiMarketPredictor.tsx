import { useState, useEffect, useMemo } from 'react';
import { Sparkles, TrendingUp, TrendingDown, Minus, Activity, AlertTriangle, Zap, AlertOctagon } from 'lucide-react';
import type { ConnectionStatus, OrderBookPressure } from '@/hooks/useLivePrices';
import type { Candle } from '@/lib/indicators';
import { calcATR } from '@/lib/indicators';
import { computeProScore } from '@/lib/marketSentiment';

const SUPPORTED_COINS = ['BTC', 'ETH'] as const;
type SupportedCoin = (typeof SUPPORTED_COINS)[number];

interface LiveCoin {
  symbol: string;
  price: number;
  change24h: number;
  change15m: number;
}

const trendConfig = {
  Bullish: { icon: TrendingUp, color: '#00ff9d', bg: 'bg-neon-green/10', border: 'border-neon-green/30', label: 'Bullish' },
  Bearish: { icon: TrendingDown, color: '#ff3b5c', bg: 'bg-neon-red/10', border: 'border-neon-red/30', label: 'Bearish' },
  Sideways: { icon: Minus, color: '#ffb020', bg: 'bg-neon-amber/10', border: 'border-neon-amber/30', label: 'Sideways' },
} as const;

interface Props {
  formatInr: (n: number) => string;
  coins: LiveCoin[];
  isLiveConnected: boolean;
  connectionStatus: ConnectionStatus;
  orderBooks: Record<string, OrderBookPressure>;
  candlesBySymbol: Record<string, Candle[]>;
}

// Pro prediction — candle-driven, multi-factor (structure / EMA / RSI / volume /
// range position via computeProScore). Confidence and trend derive from the
// SAME score the Fear & Greed meter uses, so the two widgets can never disagree.
function derivePredictionPro(
  candles: Candle[],
  fallbackPrice: number,
  fallbackChange15m: number,
): {
  trend: 'Bullish' | 'Bearish' | 'Sideways';
  moveLowPct: number;
  moveHighPct: number;
  baseMovePct: number;
  confidence: number;
  reason: string;
} {
  const n = candles.length;
  const hasCandles = n >= 21;
  const price = hasCandles ? candles[n - 1].close : fallbackPrice;

  if (!price || price <= 0) {
    return {
      trend: 'Sideways',
      moveLowPct: 0,
      moveHighPct: 0,
      baseMovePct: 0,
      confidence: 0,
      reason: 'Awaiting live market data to generate a forecast.',
    };
  }

  // Insufficient candle history — keep the UI alive with a conservative
  // sideways verdict while candles load, but never fake a trend.
  if (!hasCandles) {
    const baseMove = Math.max(0.05, Math.abs(fallbackChange15m) * 0.85);
    return {
      trend: 'Sideways',
      moveLowPct: 0,
      moveHighPct: 0,
      baseMovePct: baseMove,
      confidence: 50,
      reason: `Loading candle history for multi-factor analysis. Current 15M change is ${fallbackChange15m.toFixed(2)}%. Verdict will update once the pro score (market structure, EMA, RSI, volume, range position) is available.`,
    };
  }

  const score = computeProScore(candles);
  const trend: 'Bullish' | 'Bearish' | 'Sideways' =
    score < 45 ? 'Bearish' : score > 55 ? 'Bullish' : 'Sideways';
  const confidence = Math.min(85, Math.round(50 + Math.abs(score - 50) * 1.2));
  const change15m = ((candles[n - 1].close - candles[Math.max(0, n - 4)].close) / candles[Math.max(0, n - 4)].close) * 100;

  // Expected move — genuinely dynamic. Blends ATR(14) (half an ATR over
  // the next 5 minutes) with the live 15m momentum so the projected range
  // scales with actual market movement instead of defaulting to a flat floor.
  const atr = calcATR(candles, 14);
  const atrPct = (atr / price) * 100 * 0.5;
  const momentumPct = Math.abs(change15m) * 0.85;
  const expectedMovePct = Math.max(0.05, (atrPct + momentumPct) / 2);
  const dir = trend === 'Bullish' ? 1 : trend === 'Bearish' ? -1 : 0;

  const reason =
    trend === 'Bullish'
      ? `Pro score is ${score}/100 (Bullish). Market structure, EMA alignment, RSI, and buy-side volume pressure favour an upward continuation. ATR(14) projects a short-term move of approximately ${expectedMovePct.toFixed(2)}% from the live price of ${formatPriceBrief(price)}.`
      : trend === 'Bearish'
      ? `Pro score is ${score}/100 (Bearish). Lower highs/lows, price below EMA21, and sell-side volume dominance signal downward pressure. ATR(14) projects a short-term move of approximately ${expectedMovePct.toFixed(2)}% from the live price of ${formatPriceBrief(price)}.`
      : `Pro score is ${score}/100 (Sideways). Mixed signals across structure, EMA, RSI, and volume — no directional conviction. Expect range-bound movement of approximately ${expectedMovePct.toFixed(2)}% in either direction from ${formatPriceBrief(price)}.`;

  return {
    trend,
    moveLowPct: dir * expectedMovePct * 0.6,
    moveHighPct: dir * expectedMovePct,
    baseMovePct: expectedMovePct,
    confidence,
    reason,
  };
}

function formatPriceBrief(price: number): string {
  if (price >= 1000) return `$${(price / 1000).toFixed(1)}k`;
  return `$${price.toFixed(0)}`;
}

export default function AiMarketPredictor({
  formatInr,
  coins,
  isLiveConnected,
  connectionStatus,
  orderBooks,
  candlesBySymbol,
}: Props) {
  const [selectedCoin, setSelectedCoin] = useState<SupportedCoin>('BTC');
  const [syncing, setSyncing] = useState(true);

  const liveCoin = useMemo(
    () => coins.find((c) => c.symbol === selectedCoin),
    [coins, selectedCoin],
  );

  const livePrice = liveCoin?.price ?? 0;
  const change15m = liveCoin?.change15m ?? 0;
  const candles = candlesBySymbol[selectedCoin] ?? [];

  const prediction = useMemo(
    () => derivePredictionPro(candles, livePrice, change15m),
    [candles, livePrice, change15m],
  );

  // Recalculate target prices dynamically from the live price
  const targetLowUSD = livePrice > 0 ? livePrice * (1 + prediction.moveLowPct / 100) : 0;
  const targetHighUSD = livePrice > 0 ? livePrice * (1 + prediction.moveHighPct / 100) : 0;

  // Points (absolute dollar move)
  const pointsLow = livePrice > 0 ? livePrice * (prediction.moveLowPct / 100) : 0;
  const pointsHigh = livePrice > 0 ? livePrice * (prediction.moveHighPct / 100) : 0;

  // Real Order Book pressure — top-20 bid/ask depth from the live exchange feed.
  // Falls back to a neutral 50/50 only if the order book itself is unavailable.
  const ob = orderBooks[selectedCoin];
  const buyPct = ob ? ob.buyPct : 50;
  const sellPct = ob ? ob.sellPct : 50;
  const feedOffline = connectionStatus === 'offline';
  const feedReconnecting = connectionStatus === 'reconnecting';
  // UNIFIED STATE: Any non-connected status (reconnecting OR offline) must
  // show the red "Connection Lost" verdict. The old code only triggered
  // when livePrice === 0, which meant REST fallback data kept the green
  // "Synced" dot alive while the Fear & Greed meter correctly showed
  // "Reconnecting" — causing the split-brain bug.
  const connectionLost = connectionStatus !== 'connected';

  useEffect(() => {
    setSyncing(true);
    const t = setTimeout(() => setSyncing(false), 1200);
    return () => clearTimeout(t);
  }, [selectedCoin]);

  const cfg = trendConfig[prediction.trend];
  const TrendIcon = cfg.icon;

  // Blur the target cards whenever the feed is not fully connected.
  const offline = connectionStatus !== 'connected';

  // Connection-lost overrides: show "Connection Lost — Retrying..." instead
  // of stale Sideways/0% Confidence when the feed is actually dead.
  const displayTrend = connectionLost ? 'Connection Lost' : prediction.trend;
  const displayConfidence = connectionLost ? '—' : `${prediction.confidence}%`;
  const displayReason = connectionLost
    ? 'Connection to live market feed lost. Automatically retrying with exponential backoff. The forecast will refresh the moment data returns — no action needed.'
    : prediction.reason;
  const lostColor = '#ff3b5c';
  const lostBg = 'bg-neon-red/10';
  const lostBorder = 'border-neon-red/30';
  const verdictBg = connectionLost ? lostBg : cfg.bg;
  const verdictBorder = connectionLost ? lostBorder : cfg.border;
  const verdictColor = connectionLost ? lostColor : cfg.color;
  const VerdictIcon = connectionLost ? AlertOctagon : TrendIcon;

  // baseMove points — the absolute dollar magnitude of the expected move,
  // derived from baseMovePct (the same value cited in the reasoning paragraph).
  // In Sideways, moveLowPct/moveHighPct are both 0 (direction=0), so we must
  // use baseMovePct directly to surface the actual expected range.
  const baseMovePoints = livePrice > 0 ? livePrice * (prediction.baseMovePct / 100) : 0;

  const hasLivePrice = livePrice > 0;
  const pointsText = !hasLivePrice
    ? 'Awaiting data'
    : prediction.trend === 'Sideways'
    ? `±${Math.abs(baseMovePoints).toFixed(0)} pts`
    : `${pointsLow >= 0 ? '+' : ''}${pointsLow.toFixed(0)} to ${pointsHigh >= 0 ? '+' : ''}${pointsHigh.toFixed(0)} pts`;

  const targetText = !hasLivePrice
    ? 'Awaiting data'
    : prediction.trend === 'Sideways'
    ? `${formatInr(livePrice - baseMovePoints)} – ${formatInr(livePrice + baseMovePoints)}`
    : formatInr(targetHighUSD);

  return (
    <div className="glass-card p-5 sm:p-6 relative overflow-hidden h-full flex flex-col">
      <div className="absolute -top-16 -right-16 w-48 h-48 bg-neon-cyan/5 rounded-full blur-3xl pointer-events-none" />
      <div className="relative flex-1 flex flex-col justify-between gap-6">
        <div className="flex flex-col gap-6">
        {/* Connection Lost Banner — shown for BOTH offline and reconnecting states */}
        {connectionLost && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border animate-pulse ${feedOffline ? 'bg-neon-red/10 border-neon-red/40' : 'bg-neon-amber/10 border-neon-amber/40'}`}>
            <AlertOctagon className={`w-4 h-4 flex-shrink-0 ${feedOffline ? 'text-neon-red' : 'text-neon-amber'}`} />
            <span className={`text-[11px] font-bold tracking-wide ${feedOffline ? 'text-neon-red' : 'text-neon-amber'}`}>
              {feedOffline ? 'DATA FEED OFFLINE' : 'CONNECTION DROPPED'} — Retrying with exponential backoff...
            </span>
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-neon-cyan animate-pulse-glow" />
            <h2 className="text-xs font-bold text-white tracking-wide">AI MARKET PREDICTOR (NEXT 5M)</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`relative flex h-2 w-2 ${connectionLost ? '' : syncing ? '' : 'opacity-40'}`}>
              {!connectionLost && syncing && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-cyan opacity-75" />}
              {connectionLost && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-red opacity-75" />}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${connectionLost ? 'bg-neon-red' : 'bg-neon-cyan'}`} />
            </span>
            <span className={`text-[10px] ${connectionLost ? 'text-neon-red font-bold' : 'text-slate-500'}`}>
              {connectionLost ? 'Connection Lost - Retrying...' : syncing ? 'Live AI Syncing...' : 'Synced'}
            </span>
          </div>
        </div>
        <p className="text-[10px] text-slate-500">Cortex Neural Engine · Short-term forecast</p>

        {/* Coin selector — driven by SUPPORTED_COINS config array */}
        <div className="flex gap-2">
          {SUPPORTED_COINS.map((coin) => (
            <button
              key={coin}
              onClick={() => setSelectedCoin(coin)}
              className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all duration-200 active:scale-95 ${
                selectedCoin === coin
                  ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/40 neon-glow-cyan'
                  : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:bg-white/[0.06] hover:text-slate-200'
              }`}
            >
              {coin}
            </button>
          ))}
        </div>

        {/* The Verdict */}
        <div className={`flex items-center gap-3 p-5 rounded-xl border ${verdictBg} ${verdictBorder}`}>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${verdictBg} border ${verdictBorder}`}>
            <VerdictIcon className="w-5 h-5" style={{ color: verdictColor }} />
          </div>
          <div className="flex-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Predicted Trend</p>
            <p className="text-lg font-bold" style={{ color: verdictColor, textShadow: `0 0 10px ${verdictColor}44` }}>
              {displayTrend}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Confidence</p>
            <p className="text-sm font-bold font-mono text-slate-200">{displayConfidence}</p>
          </div>
        </div>

        {/* The Targets — dynamically calculated from live price */}
        <div className="grid grid-cols-2 gap-4">
          <div className="relative p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Expected Move</p>
            <p
              className={`text-sm font-bold font-mono transition-all duration-500 ${offline ? 'blur-sm opacity-50' : ''}`}
              style={{ color: cfg.color }}
            >
              {pointsText}
            </p>
            {offline && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[10px] font-bold text-neon-cyan animate-pulse tracking-wide flex items-center gap-1">
                  <Zap className="w-3 h-3" /> AI Re-calibrating to Live Market...
                </span>
              </div>
            )}
          </div>
          <div className="relative p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Target Price</p>
            <p
              className={`text-sm font-bold font-mono text-neon-cyan transition-all duration-500 ${offline ? 'blur-sm opacity-50' : ''}`}
            >
              {targetText}
            </p>
            {offline && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[10px] font-bold text-neon-cyan animate-pulse tracking-wide flex items-center gap-1">
                  <Zap className="w-3 h-3" /> AI Re-calibrating to Live Market...
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Current live price reference */}
        <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.02]">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Live {selectedCoin} Price</span>
          <span className="text-sm font-mono font-bold text-slate-200">
            {livePrice > 0 ? formatInr(livePrice) : 'Loading...'}
            <span className={`ml-2 text-[10px] ${change15m >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
              {change15m >= 0 ? '+' : ''}{change15m.toFixed(2)}%
            </span>
          </span>
        </div>

        {/* AI Reasoning */}
        <div className="flex items-start gap-3 p-6 rounded-xl bg-white/[0.02] border border-white/[0.05]">
          <Activity className="w-5 h-5 text-neon-cyan flex-shrink-0 mt-0.5" />
          <p className="text-sm italic text-slate-300 leading-loose">{displayReason}</p>
        </div>

        {/* Legal Disclaimer Badge */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-neon-amber/[0.04] border border-neon-amber/15">
          <AlertTriangle className="w-3 h-3 text-neon-amber flex-shrink-0" />
          <span className="text-[10px] font-semibold text-neon-amber/80 tracking-wide">BETA: Educational Forecast Only — Not Financial Advice</span>
        </div>
        </div>

        {/* Real Order Book Pressure — top-20 bid/ask depth from the live exchange */}
        <div className="pb-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-neon-cyan" />
              Order Book Pressure (Top 20)
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              <span className="text-neon-green font-bold">Bids {buyPct}%</span>
              <span className="text-slate-600 mx-1">|</span>
              <span className="text-neon-red font-bold">Asks {sellPct}%</span>
            </span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-base-700">
            <div
              className="h-full bg-gradient-to-r from-neon-green to-neon-green/70 transition-all duration-700"
              style={{ width: `${buyPct}%`, boxShadow: '0 0 12px rgba(0, 255, 157, 0.45)' }}
            />
            <div
              className="h-full bg-gradient-to-l from-neon-red to-neon-red/70 transition-all duration-700"
              style={{ width: `${sellPct}%`, boxShadow: '0 0 12px rgba(255, 59, 92, 0.45)' }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[9px] text-slate-600">
            <span>Bids{ob ? ` ${ob.bidDepth.toFixed(2)}` : ' —'}</span>
            <span>Asks{ob ? ` ${ob.askDepth.toFixed(2)}` : ' —'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
