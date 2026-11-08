import { useState, useEffect } from 'react';
import {
  X, Rocket, TrendingUp, Target, Shield,
  Activity, Zap, Award, Clock, Check, Loader2, Brain, AlertTriangle,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { BotFactoryDraft } from '@/components/admin/BotFactoryModal';
import { proxyKlines } from '@/lib/binanceProxy';

interface Props {
  draft: BotFactoryDraft;
  onClose: () => void;
}

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradeResult {
  entryIndex: number;
  entryPrice: number;
  exitIndex: number;
  exitPrice: number;
  pnlPct: number;
  isWin: boolean;
  exitReason: 'tp' | 'sl' | 'close';
}

interface BacktestResult {
  trades: TradeResult[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  maxDrawdown: number;
  profitFactor: number;
  equityCurve: { label: string; equity: number }[];
  finalEquity: number;
  totalReturn: number;
  avgWin: number;
  avgLoss: number;
  longestWinStreak: number;
  avgHoldCandles: number;
  sharpeRatio: number;
  recoveryFactor: number;
}

const INTERVAL_HOURS = 1;
const CANDLE_LIMIT = 720;
// CoinDCX synthetic USD→INR rate — applied to all backtest financial metrics
// so projections match the real execution engine's INR denomination.
const INR_RATE = 102;

async function fetchKlines(symbol: string): Promise<Candle[]> {
  const raw = await proxyKlines(symbol, '1h', CANDLE_LIMIT);
  return raw.map((row) => ({
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

function computeRSI(candles: Candle[], period: number, index: number): number | null {
  if (index < period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function shouldEnter(
  candles: Candle[],
  index: number,
  strategy: string,
  tradeDirection: 'long' | 'short',
  indicators: string[],
): boolean {
  if (index < 14) return false;

  if (strategy === 'scalper') {
    const prev = candles[index - 1];
    const curr = candles[index];
    const bodySize = Math.abs(curr.close - curr.open) / curr.open;
    const prevBodySize = Math.abs(prev.close - prev.open) / prev.open;
    if (tradeDirection === 'long') {
      return curr.close > curr.open && bodySize > prevBodySize * 1.2;
    } else {
      return curr.close < curr.open && bodySize > prevBodySize * 1.2;
    }
  }

  if (strategy === 'dca') {
    const lookback = Math.min(12, index);
    let dipCount = 0;
    for (let i = index - lookback; i < index; i++) {
      if (candles[i].close < candles[i].open) dipCount++;
    }
    if (tradeDirection === 'long') {
      return dipCount >= Math.floor(lookback * 0.6);
    } else {
      let upCount = 0;
      for (let i = index - lookback; i < index; i++) {
        if (candles[i].close > candles[i].open) upCount++;
      }
      return upCount >= Math.floor(lookback * 0.6);
    }
  }

  if (strategy === 'grid') {
    const lookback = 20;
    if (index < lookback) return false;
    let high = -Infinity;
    let low = Infinity;
    for (let i = index - lookback; i < index; i++) {
      if (candles[i].high > high) high = candles[i].high;
      if (candles[i].low < low) low = candles[i].low;
    }
    const range = high - low;
    if (range <= 0) return false;
    const positionInRange = (candles[index - 1].close - low) / range;
    if (tradeDirection === 'long') {
      return positionInRange < 0.3;
    } else {
      return positionInRange > 0.7;
    }
  }

  if (strategy === 'martingale') {
    const rsi = computeRSI(candles, 14, index - 1);
    if (rsi === null) return false;
    if (tradeDirection === 'long') {
      return rsi < 35;
    } else {
      return rsi > 65;
    }
  }

  if (indicators.includes('RSI')) {
    const rsi = computeRSI(candles, 14, index - 1);
    if (rsi === null) return false;
    if (tradeDirection === 'long') return rsi < 30;
    return rsi > 70;
  }

  if (indicators.includes('MACD')) {
    if (index < 26) return false;
    const ema12 = computeEMA(candles, 12, index - 1);
    const ema26 = computeEMA(candles, 26, index - 1);
    const ema12Prev = computeEMA(candles, 12, index - 2);
    const ema26Prev = computeEMA(candles, 26, index - 2);
    if (ema12 === null || ema26 === null || ema12Prev === null || ema26Prev === null) return false;
    const macdPrev = ema12Prev - ema26Prev;
    const macdCurr = ema12 - ema26;
    if (tradeDirection === 'long') return macdPrev < 0 && macdCurr > 0;
    return macdPrev > 0 && macdCurr < 0;
  }

  if (indicators.includes('EMA Crossover')) {
    if (index < 26) return false;
    const ema9 = computeEMA(candles, 9, index - 1);
    const ema21 = computeEMA(candles, 21, index - 1);
    const ema9Prev = computeEMA(candles, 9, index - 2);
    const ema21Prev = computeEMA(candles, 21, index - 2);
    if (ema9 === null || ema21 === null || ema9Prev === null || ema21Prev === null) return false;
    if (tradeDirection === 'long') return ema9Prev <= ema21Prev && ema9 > ema21;
    return ema9Prev >= ema21Prev && ema9 < ema21;
  }

  const prev = candles[index - 1];
  const curr = candles[index];
  if (tradeDirection === 'long') return curr.close > prev.close;
  return curr.close < prev.close;
}

function computeEMA(candles: Candle[], period: number, index: number): number | null {
  if (index < period - 1) return null;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = index - period + 1; i <= index; i++) {
    if (i === index - period + 1) {
      let sum = 0;
      for (let j = i; j <= index; j++) sum += candles[j].close;
      ema = sum / period;
    } else {
      ema = candles[i].close * k + ema * (1 - k);
    }
  }
  return ema;
}

function runSimulation(
  candles: Candle[],
  config: NonNullable<BotFactoryDraft['backtest_config']>,
  indicators: string[],
): BacktestResult {
  const {
    strategy,
    trade_direction: direction,
    capital,
    tp_sl_mode: tpSlMode,
    take_profit: tpPct,
    stop_loss: slPct,
    tp_fixed: tpFixed,
    sl_fixed: slFixed,
    leverage,
    max_trades_per_day: maxTradesPerDay,
    cooldown_minutes: cooldownMinutes,
    martingale_multiplier: martingaleMult,
    martingale_steps: martingaleMaxSteps,
    trailing_enabled: trailingEnabled,
    trailing_distance: trailingDist,
  } = config;

  const initialCapital = capital * INR_RATE;
  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let consecutiveLosses = 0;
  let currentMartingaleStep = 0;
  let currentMartingaleMultiplier = 1;
  let lastTradeExitIndex = -999;
  let tradesToday = 0;
  let currentDay = -1;
  let dailyPnl = 0;

  const trades: TradeResult[] = [];
  const equityCurve: { label: string; equity: number }[] = [];
  const dailyReturns: number[] = [];

  const cooldownCandles = Math.ceil(cooldownMinutes / INTERVAL_HOURS);
  const candlesPerDay = Math.floor(24 / INTERVAL_HOURS);

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const dayIndex = Math.floor(i / candlesPerDay);
    if (dayIndex !== currentDay) {
      currentDay = dayIndex;
      tradesToday = 0;
      if (dailyPnl !== 0) {
        dailyReturns.push(dailyPnl / initialCapital);
        dailyPnl = 0;
      }
    }

    const cooldownPassed = i - lastTradeExitIndex >= cooldownCandles;
    const canTrade = tradesToday < maxTradesPerDay && cooldownPassed;

    if (canTrade && shouldEnter(candles, i, strategy, direction, indicators)) {
      const entryPrice = candle.close;
      let positionMultiplier = currentMartingaleMultiplier;
      const tradeCapital = (equity * 0.1) * positionMultiplier;
      const leveragedCapital = tradeCapital * leverage;

      const tpTarget = tpSlMode === 'percentage'
        ? direction === 'long'
          ? entryPrice * (1 + tpPct / 100)
          : entryPrice * (1 - tpPct / 100)
        : direction === 'long'
          ? entryPrice + (tpFixed / leveragedCapital) * entryPrice
          : entryPrice - (tpFixed / leveragedCapital) * entryPrice;

      const slTarget = tpSlMode === 'percentage'
        ? direction === 'long'
          ? entryPrice * (1 - slPct / 100)
          : entryPrice * (1 + slPct / 100)
        : direction === 'long'
          ? entryPrice - (slFixed / leveragedCapital) * entryPrice
          : entryPrice + (slFixed / leveragedCapital) * entryPrice;

      let exitIndex = i;
      let exitPrice = entryPrice;
      let exitReason: 'tp' | 'sl' | 'close' = 'close';
      let trailingStop = slTarget;

      for (let j = i + 1; j < candles.length; j++) {
        const c = candles[j];
        if (direction === 'long') {
          if (trailingEnabled && c.high > trailingStop + (entryPrice * trailingDist / 100)) {
            trailingStop = c.high - (entryPrice * trailingDist / 100);
          }
          if (c.high >= tpTarget) {
            exitPrice = tpTarget;
            exitIndex = j;
            exitReason = 'tp';
            break;
          }
          if (c.low <= trailingStop) {
            exitPrice = trailingStop;
            exitIndex = j;
            exitReason = 'sl';
            break;
          }
        } else {
          if (trailingEnabled && c.low < trailingStop - (entryPrice * trailingDist / 100)) {
            trailingStop = c.low + (entryPrice * trailingDist / 100);
          }
          if (c.low <= tpTarget) {
            exitPrice = tpTarget;
            exitIndex = j;
            exitReason = 'tp';
            break;
          }
          if (c.high >= trailingStop) {
            exitPrice = trailingStop;
            exitIndex = j;
            exitReason = 'sl';
            break;
          }
        }
        exitIndex = j;
        exitPrice = c.close;
      }

      const priceDiff = direction === 'long'
        ? (exitPrice - entryPrice) / entryPrice
        : (entryPrice - exitPrice) / entryPrice;
      const tradePnLPct = priceDiff * leverage;
      const tradePnL = tradeCapital * tradePnLPct;

      equity += tradePnL;
      dailyPnl += tradePnL;
      tradesToday++;
      lastTradeExitIndex = exitIndex;

      const isWin = tradePnL > 0;
      trades.push({
        entryIndex: i,
        entryPrice,
        exitIndex,
        exitPrice,
        pnlPct: tradePnLPct * 100,
        isWin,
        exitReason,
      });

      if (isWin) {
        consecutiveLosses = 0;
        currentMartingaleStep = 0;
        currentMartingaleMultiplier = 1;
      } else {
        consecutiveLosses++;
        if (strategy === 'martingale' && currentMartingaleStep < martingaleMaxSteps && martingaleMult > 1) {
          currentMartingaleStep++;
          currentMartingaleMultiplier = Math.pow(martingaleMult, currentMartingaleStep);
        } else {
          currentMartingaleStep = 0;
          currentMartingaleMultiplier = 1;
        }
      }

      if (equity > peakEquity) peakEquity = equity;
      const drawdown = ((peakEquity - equity) / peakEquity) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      if (equity <= 0) break;
      i = exitIndex;
    }

    const labelIndex = Math.floor((i / candles.length) * 6);
    if (i % Math.floor(candles.length / 6) === 0 || i === candles.length - 1) {
      const monthLabels = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
      const label = monthLabels[labelIndex] ?? `M${labelIndex + 1}`;
      if (equityCurve.length === 0 || equityCurve[equityCurve.length - 1].label !== label) {
        equityCurve.push({ label, equity: Math.round(equity) });
      }
    }
  }

  if (dailyPnl !== 0) dailyReturns.push(dailyPnl / initialCapital);

  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.isWin).length;
  const losingTrades = totalTrades - winningTrades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  const grossProfit = trades.filter(t => t.isWin).reduce((sum, t) => sum + Math.abs(t.pnlPct), 0);
  const grossLoss = trades.filter(t => !t.isWin).reduce((sum, t) => sum + Math.abs(t.pnlPct), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

  const avgWin = winningTrades > 0
    ? trades.filter(t => t.isWin).reduce((sum, t) => sum + t.pnlPct, 0) / winningTrades
    : 0;
  const avgLoss = losingTrades > 0
    ? trades.filter(t => !t.isWin).reduce((sum, t) => sum + t.pnlPct, 0) / losingTrades
    : 0;

  let longestWinStreak = 0;
  let currentStreak = 0;
  for (const t of trades) {
    if (t.isWin) {
      currentStreak++;
      if (currentStreak > longestWinStreak) longestWinStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  const avgHoldCandles = totalTrades > 0
    ? trades.reduce((sum, t) => sum + (t.exitIndex - t.entryIndex), 0) / totalTrades
    : 0;

  const avgDailyReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    : 0;
  const stdDev = dailyReturns.length > 1
    ? Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) / dailyReturns.length)
    : 0;
  const sharpeRatio = stdDev > 0 ? (avgDailyReturn / stdDev) * Math.sqrt(365) : 0;

  const finalEquity = Math.round(equity);
  const totalReturn = ((equity - initialCapital) / initialCapital) * 100;
  const recoveryFactor = maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;

  return {
    trades,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    maxDrawdown,
    profitFactor,
    equityCurve: equityCurve.length > 0 ? equityCurve : [{ label: 'M1', equity: initialCapital }],
    finalEquity,
    totalReturn,
    avgWin,
    avgLoss,
    longestWinStreak,
    avgHoldCandles,
    sharpeRatio,
    recoveryFactor,
  };
}

export default function BacktestModal({ draft, onClose }: Props) {
  const [running, setRunning] = useState(true);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  useEffect(() => {
    const config = draft.backtest_config;
    if (!config) {
      setError('Backtest configuration is missing. Cannot run simulation.');
      setRunning(false);
      setShowResults(true);
      return;
    }

    const symbol = (draft.strategy_settings.trading_pairs[0] ?? 'BTCUSDT').replace('/', '');

    (async () => {
      try {
        const candles = await fetchKlines(symbol);
        if (candles.length < 50) {
          setError(`Insufficient historical data: only ${candles.length} candles received from Binance.`);
          setRunning(false);
          setShowResults(true);
          return;
        }
        const simResult = runSimulation(candles, config, draft.indicators);
        setResult(simResult);
        setRunning(false);
        setShowResults(true);
      } catch (err) {
        const msg = (err as Error).message || 'Failed to fetch market data from Binance.';
        setError(msg);
        setRunning(false);
        setShowResults(true);
      }
    })();
  }, [draft]);

  const riskColor = draft.risk_level === 'Low' ? 'text-neon-green' : draft.risk_level === 'Medium' ? 'text-neon-amber' : 'text-neon-red';
  const initialCapital = (draft.backtest_config?.capital ?? 5000) * INR_RATE;

  function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
      <div className="glass-strong rounded-xl px-3 py-2 text-xs border border-white/[0.08]">
        <p className="text-slate-400 mb-1">{label}</p>
        <p className="text-neon-green font-bold font-mono">₹{payload[0].value.toLocaleString('en-IN')}</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-base-900/85 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-3xl animate-scale-in">
        <div className="glass-strong neon-glow-cyan max-h-[92vh] overflow-y-auto scrollbar-thin rounded-2xl">
          {/* Header */}
          <div className="sticky top-0 z-20 bg-base-800/90 backdrop-blur-xl border-b border-white/[0.06] px-5 sm:px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center">
                <Brain className="w-5 h-5 text-neon-cyan" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">AI Backtesting Simulator</h2>
                <p className="text-[11px] text-slate-500">Real historical K-line data from Binance (30 days, 1H candles)</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/[0.06]">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 sm:px-6 py-5">
            {running ? (
              <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
                <div className="relative w-20 h-20 mb-5">
                  <div className="absolute inset-0 rounded-full border-2 border-neon-cyan/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-neon-cyan animate-spin" />
                  <Brain className="absolute inset-0 m-auto w-8 h-8 text-neon-cyan animate-pulse" />
                </div>
                <p className="text-sm font-bold text-white mb-1">Running AI Backtest Simulation...</p>
                <p className="text-xs text-slate-500">Fetching 720 historical 1H candles from Binance & simulating your strategy</p>
                <div className="mt-5 flex flex-wrap gap-2 justify-center max-w-md">
                  {['Fetching K-lines', 'Simulating entries/exits', 'Calculating PnL', 'Computing drawdown', 'Generating equity curve'].map((step, i) => (
                    <span key={i} className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[10px] text-slate-400 font-mono">
                      {step}...
                    </span>
                  ))}
                </div>
              </div>
            ) : showResults && error ? (
              <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
                <div className="w-14 h-14 rounded-xl bg-neon-red/10 border border-neon-red/30 flex items-center justify-center mb-4">
                  <AlertTriangle className="w-7 h-7 text-neon-red" />
                </div>
                <p className="text-sm font-bold text-white mb-1">Backtest Failed</p>
                <p className="text-xs text-slate-400 text-center max-w-sm">{error}</p>
                <p className="text-[11px] text-slate-500 mt-3">Binance API may be rate-limited or unreachable from your network. Please try again later.</p>
              </div>
            ) : showResults && result ? (
              <div className="space-y-5 animate-fade-in">
                {/* Strategy Summary Bar */}
                <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-neon-cyan" />
                    <span className="text-sm font-bold text-white">{draft.name || 'Custom Cortex Bot'}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${riskColor} bg-white/[0.04] border border-white/[0.06]`}>
                    {draft.risk_level} Risk
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold text-neon-cyan bg-neon-cyan/10 border border-neon-cyan/20 capitalize">
                    {draft.backtest_config?.strategy ?? 'custom'}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold text-neon-green bg-neon-green/10 border border-neon-green/20 capitalize">
                    {draft.market_type}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold capitalize ${draft.backtest_config?.trade_direction === 'long' ? 'text-neon-green bg-neon-green/10 border border-neon-green/20' : 'text-neon-red bg-neon-red/10 border border-neon-red/20'}`}>
                    {draft.backtest_config?.trade_direction ?? 'long'}
                  </span>
                </div>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <MetricCard
                    label="Win Rate"
                    value={`${result.winRate.toFixed(1)}%`}
                    icon={Target}
                    color={result.winRate >= 50 ? 'text-neon-green' : 'text-neon-red'}
                    bg={result.winRate >= 50 ? 'bg-neon-green/5' : 'bg-neon-red/5'}
                    border={result.winRate >= 50 ? 'border-neon-green/15' : 'border-neon-red/15'}
                  />
                  <MetricCard
                    label="Total Return"
                    value={`${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn.toFixed(1)}%`}
                    icon={Award}
                    color={result.totalReturn >= 0 ? 'text-neon-amber' : 'text-neon-red'}
                    bg={result.totalReturn >= 0 ? 'bg-neon-amber/5' : 'bg-neon-red/5'}
                    border={result.totalReturn >= 0 ? 'border-neon-amber/15' : 'border-neon-red/15'}
                  />
                  <MetricCard
                    label="Max Drawdown"
                    value={`-${result.maxDrawdown.toFixed(1)}%`}
                    icon={Shield}
                    color="text-neon-red"
                    bg="bg-neon-red/5"
                    border="border-neon-red/15"
                  />
                  <MetricCard
                    label="Profit Factor"
                    value={result.profitFactor.toFixed(2)}
                    icon={TrendingUp}
                    color={result.profitFactor >= 1 ? 'text-neon-cyan' : 'text-neon-red'}
                    bg="bg-neon-cyan/5"
                    border="border-neon-cyan/15"
                  />
                </div>

                {/* Equity Curve Chart */}
                <div className="glass-card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Activity className="w-4 h-4 text-neon-green" /> Equity Curve (30 Days)
                      </h3>
                      <p className="text-[10px] text-slate-500 mt-0.5">Simulated portfolio from ₹{initialCapital.toLocaleString('en-IN')} initial capital</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500">Final Equity</p>
                      <p className={`text-sm font-bold font-mono ${result.finalEquity >= initialCapital ? 'text-neon-green' : 'text-neon-red'}`}>
                        ₹{result.finalEquity.toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={result.equityCurve} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={result.finalEquity >= initialCapital ? '#00ff9d' : '#ff4444'} stopOpacity={0.4} />
                          <stop offset="100%" stopColor={result.finalEquity >= initialCapital ? '#00ff9d' : '#ff4444'} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="equity" stroke={result.finalEquity >= initialCapital ? '#00ff9d' : '#ff4444'} strokeWidth={2.5} fill="url(#equityGrad)" dot={{ fill: result.finalEquity >= initialCapital ? '#00ff9d' : '#ff4444', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: result.finalEquity >= initialCapital ? '#00ff9d' : '#ff4444', stroke: '#05060a', strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Detailed Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="glass-card p-4">
                    <p className="text-[10px] text-slate-500 uppercase font-semibold mb-3">Trade Statistics</p>
                    <div className="space-y-2 text-xs">
                      <StatRow label="Total Trades" value={`${result.totalTrades}`} />
                      <StatRow label="Winning Trades" value={`${result.winningTrades}`} accent="text-neon-green" />
                      <StatRow label="Losing Trades" value={`${result.losingTrades}`} accent="text-neon-red" />
                      <StatRow label="Avg Win" value={`+${result.avgWin.toFixed(2)}%`} accent="text-neon-green" />
                      <StatRow label="Avg Loss" value={`${result.avgLoss.toFixed(2)}%`} accent="text-neon-red" />
                      <StatRow label="Profit Factor" value={result.profitFactor.toFixed(2)} accent={result.profitFactor >= 1 ? 'text-neon-cyan' : 'text-neon-red'} />
                    </div>
                  </div>
                  <div className="glass-card p-4">
                    <p className="text-[10px] text-slate-500 uppercase font-semibold mb-3">Risk Analysis</p>
                    <div className="space-y-2 text-xs">
                      <StatRow label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)} accent={result.sharpeRatio >= 1 ? 'text-neon-cyan' : 'text-neon-red'} />
                      <StatRow label="Risk:Reward" value={`1:${draft.tp_sl_ratio.toFixed(1)}`} accent="text-neon-cyan" />
                      <StatRow label="Max Leverage" value={`${draft.max_leverage}x`} accent="text-neon-amber" />
                      <StatRow label="Recovery Factor" value={result.recoveryFactor.toFixed(1)} accent={result.recoveryFactor >= 1 ? 'text-neon-green' : 'text-neon-red'} />
                      <StatRow label="Longest Win Streak" value={`${result.longestWinStreak} wins`} />
                      <StatRow label="Avg Hold Time" value={`${(result.avgHoldCandles * INTERVAL_HOURS).toFixed(0)}h`} />
                    </div>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="flex items-start gap-2 p-3 rounded-xl bg-neon-amber/5 border border-neon-amber/15">
                  <Shield className="w-4 h-4 text-neon-amber flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Backtest results are based on {result.totalTrades} simulated trades over 720 real Binance 1H candles. Past performance does not guarantee future results. Crypto markets are highly volatile.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Footer */}
          {!running && showResults && (
            <div className="sticky bottom-0 bg-base-800/90 backdrop-blur-xl border-t border-white/[0.06] px-5 sm:px-6 py-4 flex items-center justify-between gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-sm text-slate-300 border border-white/[0.06] transition-all"
              >
                Close
              </button>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Clock className="w-3.5 h-3.5" />
                {result ? `Simulated on ${result.totalTrades} trades from 720 real Binance candles` : 'Simulation complete'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, color, bg, border }: {
  label: string; value: string; icon: typeof Target; color: string; bg: string; border: string;
}) {
  return (
    <div className={`p-4 rounded-xl ${bg} ${border} border relative overflow-hidden`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className={`text-xl font-bold ${color} font-mono`}>{value}</p>
    </div>
  );
}

function StatRow({ label, value, accent = 'text-slate-200' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={`${accent} font-mono font-semibold`}>{value}</span>
    </div>
  );
}
