/* Phase 2: exchange-adapter now reads broker URLs from broker_settings table
 * Strategy-Runner Edge Function — The Core Trading Brain (v3 — virtual SL/TP, user_id-scoped daily limit)
 *
 * This is the autonomous evaluation engine that runs continuously via pg_cron
 * (every 1 minute). For each active bot it:
 *
 *   1. Fetches all bots with status = 'running' (live or paper)
 *   2. Checks for existing open positions (skip if one is already active)
 *   3. Fetches live OHLCV kline data from Binance for the bot's trading pair
 *   4. Computes technical indicators (RSI, EMA, MACD) on the candle data
 *   5. Evaluates entry conditions based on the bot's configured indicator
 *   6. Runs the RiskCalculator validation layer (license, daily limits, balance)
 *   7. Applies Martingale position sizing if the bot uses that strategy
 *   8. Triggers trade execution via the internal execute-trade edge function
 *
 * The engine/src modules (RiskCalculator, TrailingStopEngine, martingale) are
 * inlined as Deno-compatible modules since edge functions cannot import from
 * the project's engine/src directory at runtime.
 *
 * Called by: pg_cron job 'strategy_runner_cron' (every 1 minute)
 * Manual trigger: POST with service role key Authorization header
 *
 * POST body: { } (no parameters — operates on all active bots)
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  ExchangeAdapter,
  decryptBrokerKeys,
  executeGoldenTrade,
  fetchTickerPrice,
  fetchTickerPricesBatch as sharedFetchTickerPricesBatch,
  verifyPositionClosed,
  verifyOrderFilled,
  type OrderResponse,
} from "../_shared/exchange-adapter.ts";
import { fetchProSentiment } from "../_shared/pro-score.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ═══════════════════════════════════════════════════════════════════════
//  DECIMAL MATH (from engine/src/RiskCalculator.ts)
//  String-based BigInt arithmetic — no floating point errors
// ═══════════════════════════════════════════════════════════════════════

function normalizeDecimal(str: string): string {
  if (!str || str === "0" || str === "0.0" || str === "0.00") return "0";
  const negative = str.startsWith("-");
  let s = negative ? str.slice(1) : str;
  if (!s.includes(".")) s = s + ".0";
  s = s.replace(/0+$/, "");
  s = s.replace(/\.$/, "");
  if (s === "" || s === "0") return "0";
  return (negative ? "-" : "") + s;
}

function getDecimalPlaces(str: string): number {
  const parts = str.split(".");
  return parts.length > 1 ? parts[1].length : 0;
}

function shiftRight(str: string, places: number): string {
  if (str === "0") return "0";
  const negative = str.startsWith("-");
  let s = negative ? str.slice(1) : str;
  const dotIndex = s.indexOf(".");
  if (dotIndex === -1) {
    s = s + "0".repeat(places);
  } else {
    const intPart = s.slice(0, dotIndex);
    const decPart = s.slice(dotIndex + 1);
    if (decPart.length >= places) {
      s = intPart + decPart.slice(0, places) + "." + decPart.slice(places);
    } else {
      s = intPart + decPart + "0".repeat(places - decPart.length);
    }
  }
  return (negative ? "-" : "") + normalizeDecimal(s);
}

function shiftLeft(str: string, places: number): string {
  if (str === "0") return "0";
  const negative = str.startsWith("-");
  let s = negative ? str.slice(1) : str;
  s = s.replace(".", "");
  while (s.length <= places) s = "0" + s;
  const insertPos = s.length - places;
  s = s.slice(0, insertPos) + "." + s.slice(insertPos);
  return (negative ? "-" : "") + normalizeDecimal(s);
}

function addDecimals(a: string, b: string): string {
  const maxPlaces = Math.max(getDecimalPlaces(a), getDecimalPlaces(b));
  const ai = shiftRight(a, maxPlaces);
  const bi = shiftRight(b, maxPlaces);
  const result = BigInt(ai) + BigInt(bi);
  return normalizeDecimal(shiftLeft(result.toString(), maxPlaces));
}

function subtractDecimals(a: string, b: string): string {
  const maxPlaces = Math.max(getDecimalPlaces(a), getDecimalPlaces(b));
  const ai = shiftRight(a, maxPlaces);
  const bi = shiftRight(b, maxPlaces);
  const result = BigInt(ai) - BigInt(bi);
  return normalizeDecimal(shiftLeft(result.toString(), maxPlaces));
}

function multiplyDecimals(a: string, b: string): string {
  const aPlaces = getDecimalPlaces(a);
  const bPlaces = getDecimalPlaces(b);
  const totalPlaces = aPlaces + bPlaces;
  const ai = a.replace(".", "").replace("-", "");
  const bi = b.replace(".", "").replace("-", "");
  const negative = (a.startsWith("-") || b.startsWith("-")) && !(a.startsWith("-") && b.startsWith("-"));
  const result = BigInt(ai) * BigInt(bi);
  const raw = shiftLeft(result.toString(), totalPlaces);
  return negative ? normalizeDecimal("-" + raw) : normalizeDecimal(raw);
}

function divideDecimals(a: string, b: string, precision: number = 18): string {
  if (b === "0") throw new Error("Division by zero");
  const aPlaces = getDecimalPlaces(a);
  const bPlaces = getDecimalPlaces(b);
  const shift = bPlaces - aPlaces + precision;
  const ai = a.replace(".", "").replace("-", "");
  const bi = b.replace(".", "").replace("-", "");
  const negative = (a.startsWith("-") || b.startsWith("-")) && !(a.startsWith("-") && b.startsWith("-"));
  let dividend = BigInt(ai);
  if (shift > 0) dividend = dividend * BigInt(10 ** shift);
  else if (shift < 0) {
    const divisor = BigInt(10 ** Math.abs(shift));
    dividend = dividend / divisor;
  }
  const result = dividend / BigInt(bi);
  const raw = shiftLeft(result.toString(), precision);
  return negative ? normalizeDecimal("-" + raw) : normalizeDecimal(raw);
}

function compareDecimals(a: string, b: string): number {
  const maxPlaces = Math.max(getDecimalPlaces(a), getDecimalPlaces(b));
  const ai = BigInt(shiftRight(a, maxPlaces));
  const bi = BigInt(shiftRight(b, maxPlaces));
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

function absDecimal(a: string): string {
  return a.startsWith("-") ? a.slice(1) : a;
}

// ═══════════════════════════════════════════════════════════════════════
//  RISK CALCULATOR (from engine/src/RiskCalculator.ts)
// ═══════════════════════════════════════════════════════════════════════

interface RiskConfig {
  maxTradesPerDay: number;
  maxDailyLossThreshold: string;
  maxDrawdownPct: string;
  tpPct: string;
  slPct: string;
  maxLeverage: number;
  tradeSizing: "fixed_quote" | "percent_balance" | "risk_based";
  sizingValue: string;
  riskPerTradePct: string;
  maxNotional: string;
  trailingEnabled: boolean;
  trailingDistancePct: string;
}

interface ValidationContext {
  licenseValid: boolean;
  licenseExpiry: string | null;
  botStatus: "active" | "paused";
  isPaperMode: boolean;
  dailyTradeCount: number;
  dailyLoss: string;
  availableBalance: string;
  currentDrawdownPct: string;
}

type ValidationRejection =
  | "LICENSE_INVALID"
  | "LICENSE_EXPIRED"
  | "BOT_PAUSED"
  | "DAILY_TRADE_LIMIT_REACHED"
  | "DAILY_LOSS_BREACHED"
  | "INSUFFICIENT_BALANCE"
  | "MAX_DRAWDOWN_BREACHED"
  | "MAX_NOTIONAL_EXCEEDED";

interface ValidationResult {
  approved: boolean;
  rejections: ValidationRejection[];
  computedSize: string | null;
}

function calculatePositionSize(
  config: RiskConfig,
  balance: string,
  entryPrice: string,
): string {
  switch (config.tradeSizing) {
    case "fixed_quote":
      return config.sizingValue;
    case "percent_balance": {
      const pct = divideDecimals(config.sizingValue, "100", 18);
      return multiplyDecimals(balance, pct);
    }
    case "risk_based": {
      const riskPct = divideDecimals(config.riskPerTradePct, "100", 18);
      const riskAmount = multiplyDecimals(balance, riskPct);
      const slPct = divideDecimals(config.slPct, "100", 18);
      if (slPct === "0") return "0";
      const slDistance = multiplyDecimals(entryPrice, slPct);
      if (slDistance === "0") return "0";
      const rawSize = divideDecimals(riskAmount, slDistance, 18);
      if (compareDecimals(rawSize, "0") <= 0) return "0";
      return rawSize;
    }
    default:
      return "0";
  }
}

function clampNotional(positionSize: string, maxNotional: string): string {
  if (compareDecimals(positionSize, maxNotional) > 0) return maxNotional;
  return positionSize;
}

function validateOrder(
  config: RiskConfig,
  ctx: ValidationContext,
  entryPrice: string,
): ValidationResult {
  const rejections: ValidationRejection[] = [];

  if (!ctx.licenseValid) rejections.push("LICENSE_INVALID");

  if (ctx.licenseExpiry) {
    const now = new Date();
    const expiry = new Date(ctx.licenseExpiry);
    if (expiry < now) rejections.push("LICENSE_EXPIRED");
  }

  if (ctx.botStatus !== "active") rejections.push("BOT_PAUSED");

  const dailyLossBreached =
    compareDecimals(absDecimal(ctx.dailyLoss), config.maxDailyLossThreshold) >= 0 &&
    ctx.dailyLoss.startsWith("-");

  if (dailyLossBreached) rejections.push("DAILY_LOSS_BREACHED");

  if (ctx.dailyTradeCount >= config.maxTradesPerDay) {
    rejections.push("DAILY_TRADE_LIMIT_REACHED");
  }

  if (compareDecimals(ctx.currentDrawdownPct, config.maxDrawdownPct) >= 0) {
    rejections.push("MAX_DRAWDOWN_BREACHED");
  }

  const computedSize = calculatePositionSize(config, ctx.availableBalance, entryPrice);
  const clampedSize = clampNotional(computedSize, config.maxNotional);

  if (compareDecimals(clampedSize, "0") <= 0) {
    rejections.push("INSUFFICIENT_BALANCE");
  }

  if (compareDecimals(clampedSize, ctx.availableBalance) > 0) {
    rejections.push("INSUFFICIENT_BALANCE");
  }

  const hardBlocks: ValidationRejection[] = ["LICENSE_INVALID", "LICENSE_EXPIRED", "BOT_PAUSED"];
  const hasHardBlock = rejections.some((r) => hardBlocks.includes(r));
  const approved = rejections.length === 0 && !hasHardBlock;

  return {
    approved,
    rejections,
    computedSize: approved ? clampedSize : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  MARTINGALE STRATEGY (from engine/src/trading/strategies/martingale.ts)
// ═══════════════════════════════════════════════════════════════════════

interface MartingaleConfig {
  martingale_multiplier: number;
  max_martingale_steps: number;
  base_position_size: number;
  max_drawdown_pct: number;
}

interface MartingaleState {
  current_step: number;
  current_position_size: number;
  total_pnl: number;
  starting_capital: number;
  halted: boolean;
  halt_reason: string | null;
}

function createMartingaleState(config: MartingaleConfig): MartingaleState {
  return {
    current_step: 0,
    current_position_size: config.base_position_size,
    total_pnl: 0,
    starting_capital: config.base_position_size,
    halted: false,
    halt_reason: null,
  };
}

function processMartingaleResult(
  state: MartingaleState,
  pnl: number,
  config: MartingaleConfig,
): { next_position_size: number; new_state: MartingaleState } {
  if (state.halted) {
    return { next_position_size: 0, new_state: state };
  }

  const was_loss = pnl < 0;
  let newStep = state.current_step;
  let nextSize = state.current_position_size;
  const totalPnl = state.total_pnl + pnl;
  let halted = false;
  let haltReason: string | null = null;

  if (was_loss) {
    newStep = state.current_step + 1;
    if (newStep >= config.max_martingale_steps) {
      halted = true;
      haltReason = `Max martingale steps (${config.max_martingale_steps}) reached.`;
      nextSize = 0;
    } else {
      nextSize = state.current_position_size * config.martingale_multiplier;
    }
  } else {
    newStep = 0;
    nextSize = config.base_position_size;
  }

  const drawdownPct = (totalPnl / state.starting_capital) * 100;
  if (drawdownPct <= -config.max_drawdown_pct) {
    halted = true;
    haltReason = `Max drawdown (${config.max_drawdown_pct}%) breached.`;
    nextSize = 0;
  }

  return {
    next_position_size: nextSize,
    new_state: {
      current_step: newStep,
      current_position_size: nextSize,
      total_pnl: totalPnl,
      starting_capital: state.starting_capital,
      halted,
      halt_reason: haltReason,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  TECHNICAL INDICATORS
//  Computed from live Binance OHLCV kline data
// ═══════════════════════════════════════════════════════════════════════

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

/** Relative Strength Index — standard 14-period */
function computeRSI(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smooth the remaining candles (Wilder's smoothing)
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + (-diff)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Exponential Moving Average */
function computeEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

/** MACD: returns { macd, signal, histogram } */
function computeMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macd: number; signal: number; histogram: number } | null {
  const closes = candles.map((c) => c.close);
  if (closes.length < slowPeriod + signalPeriod) return null;

  // Compute fast and slow EMA series
  const kFast = 2 / (fastPeriod + 1);
  const kSlow = 2 / (slowPeriod + 1);

  const fastEMA: number[] = [];
  const slowEMA: number[] = [];

  // Seed with SMA
  let fastSeed = closes.slice(0, fastPeriod).reduce((a, b) => a + b, 0) / fastPeriod;
  let slowSeed = closes.slice(0, slowPeriod).reduce((a, b) => a + b, 0) / slowPeriod;
  fastEMA.push(fastSeed);
  slowEMA.push(slowSeed);

  for (let i = fastPeriod; i < closes.length; i++) {
    fastSeed = closes[i] * kFast + fastSeed * (1 - kFast);
    fastEMA.push(fastSeed);
  }
  for (let i = slowPeriod; i < closes.length; i++) {
    slowSeed = closes[i] * kSlow + slowSeed * (1 - kSlow);
    slowEMA.push(slowSeed);
  }

  // MACD line = fast EMA - slow EMA (aligned at same index)
  const macdLine: number[] = [];
  const offset = slowPeriod - fastPeriod;
  for (let i = 0; i < slowEMA.length; i++) {
    macdLine.push(fastEMA[i + offset] - slowEMA[i]);
  }

  // Signal line = EMA of MACD line
  const kSignal = 2 / (signalPeriod + 1);
  let signalSeed = macdLine.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
  for (let i = signalPeriod; i < macdLine.length; i++) {
    signalSeed = macdLine[i] * kSignal + signalSeed * (1 - kSignal);
  }

  const macd = macdLine[macdLine.length - 1];
  const signal = signalSeed;
  return { macd, signal, histogram: macd - signal };
}

// ═══════════════════════════════════════════════════════════════════════
//  SIGNAL EVALUATION
//  Determines whether the bot's configured entry conditions are met
// ═══════════════════════════════════════════════════════════════════════

interface SignalResult {
  shouldEnter: boolean;
  signalType: "BUY" | "SELL" | "NONE";
  reason: string;
  indicator: string;
  rsi: number | null;
  emaFast: number | null;
  emaSlow: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
}

function evaluateEntryConditions(
  bot: BotRow,
  candles: Candle[],
): SignalResult {
  const result: SignalResult = {
    shouldEnter: false,
    signalType: "NONE",
    reason: "No signal",
    indicator: bot.indicator ?? "none",
    rsi: null,
    emaFast: null,
    emaSlow: null,
    macd: null,
  };

  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const direction: "long" | "short" = bot.trade_direction === "short" ? "short" : "long";
  const buySignal = direction === "short" ? "SELL" : "BUY";

  // ── Indicators explicitly OFF — force immediate market entry ──
  if (bot.indicators_enabled === false) {
    result.shouldEnter = true;
    result.signalType = buySignal;
    result.reason = `Indicators OFF — forced market entry at ${lastClose}`;
    return result;
  }

  // ── Strategy-specific entry logic by bot_type ──
  const botType = bot.bot_type ?? "scalper";

  // SCALPER: Fast EMA crossover (9 vs 21) + RSI momentum confirmation
  if (botType === "scalper" || botType === "scalping") {
    const closes = candles.map((c) => c.close);
    result.emaFast = computeEMA(closes, 9);
    result.emaSlow = computeEMA(closes, 21);
    result.rsi = computeRSI(candles, 14);

    if (result.emaFast === null || result.emaSlow === null) {
      result.reason = "Insufficient candles for scalper EMA crossover";
      return result;
    }

    const bullishCross = result.emaFast > result.emaSlow;
    const bearishCross = result.emaFast < result.emaSlow;
    const rsiBullish = result.rsi !== null && result.rsi > 40 && result.rsi < 70;
    const rsiBearish = result.rsi !== null && result.rsi > 30 && result.rsi < 60;

    if (direction === "long" && bullishCross && rsiBullish) {
      result.shouldEnter = true;
      result.signalType = "BUY";
      result.reason = `Scalper: EMA-9 (${result.emaFast.toFixed(2)}) > EMA-21 (${result.emaSlow.toFixed(2)}) + RSI ${result.rsi!.toFixed(1)} — bullish momentum entry`;
    } else if (direction === "short" && bearishCross && rsiBearish) {
      result.shouldEnter = true;
      result.signalType = "SELL";
      result.reason = `Scalper: EMA-9 (${result.emaFast.toFixed(2)}) < EMA-21 (${result.emaSlow.toFixed(2)}) + RSI ${result.rsi!.toFixed(1)} — bearish momentum entry`;
    } else {
      result.reason = `Scalper: EMA-9 ${result.emaFast.toFixed(2)} vs EMA-21 ${result.emaSlow.toFixed(2)}, RSI ${result.rsi?.toFixed(1) ?? "N/A"} — no confirmed entry`;
    }
    return result;
  }

  // DCA: Enter on initial position; subsequent entries on price drop or RSI oversold
  // Since the open-position check already prevents duplicates, DCA enters when
  // price has dropped at least 1% from recent high (averaging down) or RSI < 35
  if (botType === "dca") {
    const recentHigh = Math.max(...candles.slice(-20).map((c) => c.high));
    const dropPct = ((recentHigh - lastClose) / recentHigh) * 100;
    result.rsi = computeRSI(candles, 14);

    const priceDropEntry = dropPct >= 1.0;
    const oversoldEntry = result.rsi !== null && result.rsi < 35;

    if (direction === "long" && (priceDropEntry || oversoldEntry)) {
      result.shouldEnter = true;
      result.signalType = "BUY";
      result.reason = `DCA: price ${dropPct.toFixed(2)}% below recent high${oversoldEntry ? ` + RSI oversold ${result.rsi!.toFixed(1)}` : ""} — averaging down entry`;
    } else if (direction === "short" && dropPct <= -1.0) {
      result.shouldEnter = true;
      result.signalType = "SELL";
      result.reason = `DCA: price ${Math.abs(dropPct).toFixed(2)}% above recent low — averaging up entry`;
    } else {
      result.reason = `DCA: price ${dropPct.toFixed(2)}% from recent high, RSI ${result.rsi?.toFixed(1) ?? "N/A"} — no DCA entry condition`;
    }
    return result;
  }

  // GRID: Calculate upper/lower range from recent high/low, enter at grid lines
  if (botType === "grid") {
    const lookback = candles.slice(-30);
    const rangeHigh = Math.max(...lookback.map((c) => c.high));
    const rangeLow = Math.min(...lookback.map((c) => c.low));
    const range = rangeHigh - rangeLow;
    if (range <= 0) {
      result.reason = "Grid: zero range detected";
      return result;
    }
    const gridLevels = 4;
    const gridSpacing = range / gridLevels;
    const lowerGrid = rangeLow + gridSpacing;
    const upperGrid = rangeHigh - gridSpacing;

    if (direction === "long" && lastClose <= lowerGrid) {
      result.shouldEnter = true;
      result.signalType = "BUY";
      result.reason = `Grid: price ${lastClose} at lower grid line ${lowerGrid.toFixed(4)} (range ${rangeLow.toFixed(4)}-${rangeHigh.toFixed(4)}) — buy at support`;
    } else if (direction === "short" && lastClose >= upperGrid) {
      result.shouldEnter = true;
      result.signalType = "SELL";
      result.reason = `Grid: price ${lastClose} at upper grid line ${upperGrid.toFixed(4)} (range ${rangeLow.toFixed(4)}-${rangeHigh.toFixed(4)}) — sell at resistance`;
    } else {
      result.reason = `Grid: price ${lastClose} mid-range (${rangeLow.toFixed(4)}-${rangeHigh.toFixed(4)}), lower=${lowerGrid.toFixed(4)}, upper=${upperGrid.toFixed(4)} — no grid trigger`;
    }
    return result;
  }

  // MARTINGALE: Entry based on EMA trend direction; position sizing handled later
  if (botType === "martingale") {
    const closes = candles.map((c) => c.close);
    result.emaFast = computeEMA(closes, 9);
    result.emaSlow = computeEMA(closes, 21);
    result.rsi = computeRSI(candles, 14);

    if (result.emaFast === null || result.emaSlow === null) {
      result.reason = "Insufficient candles for martingale EMA trend";
      return result;
    }

    const trendBullish = result.emaFast > result.emaSlow;
    const trendBearish = result.emaFast < result.emaSlow;

    if (direction === "long" && trendBullish) {
      result.shouldEnter = true;
      result.signalType = "BUY";
      result.reason = `Martingale: EMA trend bullish (9>${result.emaSlow.toFixed(2)}) + RSI ${result.rsi?.toFixed(1) ?? "N/A"} — recovery entry`;
    } else if (direction === "short" && trendBearish) {
      result.shouldEnter = true;
      result.signalType = "SELL";
      result.reason = `Martingale: EMA trend bearish (9<${result.emaSlow.toFixed(2)}) + RSI ${result.rsi?.toFixed(1) ?? "N/A"} — recovery entry`;
    } else {
      result.reason = `Martingale: EMA trend not aligned (${result.emaFast.toFixed(2)} vs ${result.emaSlow.toFixed(2)}) — waiting for trend confirmation`;
    }
    return result;
  }

  // COPIER / TRAILING: Follow trend momentum with trailing stop logic
  // Uses EMA-20 slope + MACD histogram for trend confirmation
  if (botType === "copier" || botType === "trailing" || bot.strategy === "trailing") {
    const closes = candles.map((c) => c.close);
    result.emaFast = computeEMA(closes, 20);
    result.macd = computeMACD(candles);

    if (result.emaFast === null) {
      result.reason = "Insufficient candles for trailing EMA-20";
      return result;
    }

    const ema20Prev = computeEMA(closes.slice(0, -1), 20);
    const slope = ema20Prev !== null ? result.emaFast - ema20Prev : 0;
    const macdBullish = result.macd !== null && result.macd.histogram > 0;
    const macdBearish = result.macd !== null && result.macd.histogram < 0;

    if (direction === "long" && slope > 0 && macdBullish) {
      result.shouldEnter = true;
      result.signalType = "BUY";
      result.reason = `Trailing: EMA-20 rising (slope ${slope.toFixed(6)}) + MACD hist ${result.macd!.histogram.toFixed(6)} — bullish trend follow`;
    } else if (direction === "short" && slope < 0 && macdBearish) {
      result.shouldEnter = true;
      result.signalType = "SELL";
      result.reason = `Trailing: EMA-20 falling (slope ${slope.toFixed(6)}) + MACD hist ${result.macd!.histogram.toFixed(6)} — bearish trend follow`;
    } else {
      result.reason = `Trailing: EMA-20 slope ${slope.toFixed(6)}, MACD hist ${result.macd?.histogram.toFixed(6) ?? "N/A"} — no aligned trend`;
    }
    return result;
  }

  // ── Custom / fallback: indicator-based logic ──
  if (!bot.indicators_enabled || !bot.indicator) {
    // No indicator configured — use momentum (price vs EMA-20) as default
    if (candles.length >= 20) {
      const ema20 = computeEMA(candles.map((c) => c.close), 20);
      if (ema20 !== null) {
        result.emaFast = ema20;
        if (direction === "long" && lastClose > ema20) {
          result.shouldEnter = true;
          result.signalType = "BUY";
          result.reason = `Price ${lastClose} above EMA-20 ${ema20.toFixed(4)} — bullish momentum`;
        } else if (direction === "short" && lastClose < ema20) {
          result.shouldEnter = true;
          result.signalType = "SELL";
          result.reason = `Price ${lastClose} below EMA-20 ${ema20.toFixed(4)} — bearish momentum`;
        }
      }
    }
    return result;
  }

  const indicator = bot.indicator.toUpperCase();

  if (indicator === "RSI") {
    result.rsi = computeRSI(candles, 14);
    if (result.rsi === null) {
      result.reason = "Insufficient candles for RSI(14)";
      return result;
    }

    if (direction === "long" && result.rsi < 30) {
      result.shouldEnter = true;
      result.signalType = "BUY";
      result.reason = `RSI(14) = ${result.rsi.toFixed(2)} — oversold, long entry signal`;
    } else if (direction === "short" && result.rsi > 70) {
      result.shouldEnter = true;
      result.signalType = "SELL";
      result.reason = `RSI(14) = ${result.rsi.toFixed(2)} — overbought, short entry signal`;
    } else {
      result.reason = `RSI(14) = ${result.rsi.toFixed(2)} — no entry signal`;
    }
    return result;
  }

  if (indicator === "MACD" || indicator === "MACD DIVERGENCE") {
    result.macd = computeMACD(candles);
    if (result.macd === null) {
      result.reason = "Insufficient candles for MACD";
      return result;
    }

    if (direction === "long" && result.macd.histogram > 0) {
      result.shouldEnter = true;
      result.signalType = "BUY";
      result.reason = `MACD histogram = ${result.macd.histogram.toFixed(6)} > 0 — bullish crossover`;
    } else if (direction === "short" && result.macd.histogram < 0) {
      result.shouldEnter = true;
      result.signalType = "SELL";
      result.reason = `MACD histogram = ${result.macd.histogram.toFixed(6)} < 0 — bearish crossover`;
    } else {
      result.reason = `MACD histogram = ${result.macd.histogram.toFixed(6)} — no crossover signal`;
    }
    return result;
  }

  if (indicator === "EMA" || indicator === "EMA CROSSOVER") {
    const closes = candles.map((c) => c.close);
    result.emaFast = computeEMA(closes, 9);
    result.emaSlow = computeEMA(closes, 21);

    if (result.emaFast === null || result.emaSlow === null) {
      result.reason = "Insufficient candles for EMA crossover";
      return result;
    }

    if (direction === "long" && result.emaFast > result.emaSlow) {
      result.shouldEnter = true;
      result.signalType = "BUY";
      result.reason = `EMA-9 (${result.emaFast.toFixed(4)}) > EMA-21 (${result.emaSlow.toFixed(4)}) — golden cross`;
    } else if (direction === "short" && result.emaFast < result.emaSlow) {
      result.shouldEnter = true;
      result.signalType = "SELL";
      result.reason = `EMA-9 (${result.emaFast.toFixed(4)}) < EMA-21 (${result.emaSlow.toFixed(4)}) — death cross`;
    } else {
      result.reason = `EMA-9 (${result.emaFast.toFixed(4)}) vs EMA-21 (${result.emaSlow.toFixed(4)}) — no crossover`;
    }
    return result;
  }

  // SMC Order Blocks — detect recent sharp moves
  if (indicator === "SMC ORDER BLOCKS" || indicator === "ORDER BLOCKS") {
    if (candles.length < 10) {
      result.reason = "Insufficient candles for order block detection";
      return result;
    }

    const recent = candles.slice(-5);
    const maxBody = Math.max(...recent.map((c) => Math.abs(c.close - c.open)));
    const avgBody = candles.slice(-20).reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / Math.min(20, candles.length);

    if (maxBody > avgBody * 2) {
      result.shouldEnter = true;
      result.signalType = buySignal;
      result.reason = `Order block detected: max body ${maxBody.toFixed(4)} > 2x avg ${avgBody.toFixed(4)}`;
    } else {
      result.reason = `No significant order block (max body ${maxBody.toFixed(4)} <= 2x avg ${avgBody.toFixed(4)})`;
    }
    return result;
  }

  result.reason = `Unknown indicator: ${bot.indicator}`;
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
//  SENTIMENT AUTO-DIRECTION (pro score — multi-factor)
//  Replaces the old ±0.5% avg-15m-change filter, which mislabelled every
//  low-volatility bar as "sideways" and skipped trades even when structure,
//  EMA, RSI, and volume agreed. The pro score combines all five factors and
//  only the TREND strategies skip in the 45–55 band; scalper/grid/dca
//  strategies thrive in sideways markets and execute anyway.
// ═══════════════════════════════════════════════════════════════════════

// Strategies that should NOT skip on a sideways score — they are designed
// for range-bound markets (grid scalping, DCA averaging).
function isSidewaysTolerantStrategy(bot: { bot_type: string | null; strategy: string | null }): boolean {
  const t = (bot.bot_type ?? "").toLowerCase();
  const s = (bot.strategy ?? "").toLowerCase();
  return (
    t === "scalper" ||
    t === "grid" ||
    t === "dca" ||
    s === "scalper" ||
    s === "grid" ||
    s === "dca" ||
    s === "smart_dca"
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  BINANCE OHLCV DATA FETCHER
// ═══════════════════════════════════════════════════════════════════════

interface KlineResponse {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
}

async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
  isFutures: boolean,
): Promise<Candle[]> {
  const baseUrl = isFutures
    ? "https://fapi.binance.com/fapi/v1/klines"
    : "https://api.binance.com/api/v3/klines";

  const url = `${baseUrl}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const raw = await resp.json() as unknown[][];

    return raw.map((k) => ({
      openTime: Number(k[0]),
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
      closeTime: Number(k[6]),
    }));
  } catch {
    return [];
  }
}

/** Maps bot_type to a Binance kline interval */
function getKlineInterval(botType: string | null): string {
  switch (botType) {
    case "scalper":
      return "5m";
    case "grid":
      return "15m";
    case "dca":
      return "1h";
    case "martingale":
      return "15m";
    case "copier":
      return "15m";
    case "custom":
      return "15m";
    default:
      return "15m";
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════

interface BotRow {
  id: string;
  user_id: string;
  name: string;
  market_type: "spot" | "futures";
  coin: string;
  strategy: string;
  status: string;
  trade_direction: "long" | "short" | "auto" | null;
  bot_type: string | null;
  order_type: "market" | "limit" | null;
  leverage: number | null;
  capital: number | null;
  indicators_enabled: boolean | null;
  indicator: string | null;
  quantity_mode: string | null;
  quantity_value: number | null;
  percent_value: number | null;
  max_trades_per_day: number | null;
  rr_ratio: number | null;
  tp_sl_mode: string | null;
  take_profit: number | null;
  stop_loss: number | null;
  tp_fixed: number | null;
  sl_fixed: number | null;
  trailing_enabled: boolean | null;
  trailing_distance: number | null;
  max_daily_loss: number | null;
  max_daily_profit: number | null;
  cooldown_minutes: number | null;
  is_paper_mode: boolean | null;
  martingale_multiplier: number | null;
  max_martingale_steps: number | null;
  dca_price_deviation_pct: number | null;
  dca_max_safety_orders: number | null;
  dca_safety_order_multiplier: number | null;
}

function isDcaBot(bot: { bot_type: string | null; strategy: string | null }): boolean {
  return bot.bot_type === "dca" || bot.strategy === "dca" || bot.strategy === "smart_dca";
}

interface RiskSettingsRow {
  global_kill_switch: boolean;
  max_leverage: number;
  max_daily_loss_pct: number;
  auto_disable_on_breach: boolean;
  ai_circuit_breaker: boolean;
  max_slippage_pct: number;
}

interface LicenseRow {
  plan_name: string;
  is_active: boolean;
  valid_until: string | null;
  bot_limit: number | null;
}

interface UserFundsRow {
  balance: number;
  unrealized_pnl: number;
  realized_pnl: number;
}

// ═══════════════════════════════════════════════════════════════════════
//  LOGGING
// ═══════════════════════════════════════════════════════════════════════

async function logApiCall(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  broker: string,
  endpoint: string,
  status: "success" | "error" | "pending",
  latencyMs: number,
  detail: string,
): Promise<void> {
  const { error: logErr } = await adminClient.from("broker_api_logs").insert({
    user_id: userId,
    broker,
    endpoint,
    status,
    latency_ms: latencyMs,
    detail,
  });
  if (logErr) {
    console.error(`logApiCall insert failed (${broker}/${endpoint}):`, logErr.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  TRADE EXECUTION (internal call to execute-trade edge function)
// ═══════════════════════════════════════════════════════════════════════

async function triggerTradeExecution(
  supabaseUrl: string,
  serviceRoleKey: string,
  botId: string,
  userId: string,
  adminClient: ReturnType<typeof createClient>,
): Promise<{ success: boolean; detail: string }> {
  const startTime = Date.now();

  try {
    // Fetch the user's access token to pass to execute-trade
    // execute-trade requires a user JWT for auth.getUser — but the cron job
    // only has the service role key. We call execute-trade's logic directly
    // by inserting the position ourselves using the admin client, after
    // performing the same risk checks here.

    // For now, we perform the trade inline (same logic as execute-trade but
    // with admin client privileges) to avoid the JWT roundtrip problem.

    const { data: botData } = await adminClient
      .from("bots")
      .select("*")
      .eq("id", botId)
      .maybeSingle();

    if (!botData) {
      return { success: false, detail: "Bot not found" };
    }

    const bot = botData as BotRow;

    // CEO DIRECTIVE: Re-check for existing active/pending position BEFORE any
    // trade work. The main loop's botsWithOpenPositions set is built at the
    // START of each tick, but between that check and this call there is a long
    // chain of async operations (direction resolution, kline fetch, signal
    // eval, risk validation). A concurrent cron invocation or a user click via
    // execute-trade could have inserted a PENDING row in that gap. This fresh
    // query closes the race window.
    const { data: existingPos } = await adminClient
      .from("positions")
      .select("id")
      .eq("bot_id", bot.id)
      .in("status", ["open", "pending"])
      .limit(1)
      .maybeSingle();
    if (existingPos) {
      return { success: false, detail: "Aborted: bot already has an active/pending position (pre-trade re-check)" };
    }

    // Phase 3: Resolve 'auto' direction using the pro score (multi-factor:
    // structure / EMA / RSI / volume / range position) on the BTC+ETH 15m
    // index. The old ±0.5% avg-change filter skipped every low-volatility bar
    // even when the multi-factor read was clearly bearish/bullish.
    //
    // Sideways-tolerant strategies (scalper / grid / dca) execute in the
    // 45–55 band — they are built for range markets. Trend strategies skip.
    // CEO FIRST-TRADE BYPASS: a bot with zero trade_history always enters.
    let resolvedDirection: "long" | "short" = "long";
    if (bot.trade_direction === "short") {
      resolvedDirection = "short";
    } else if (bot.trade_direction === "auto") {
      const { score, avgChange } = await fetchProSentiment();

      const [{ count: botHistCount }] = await Promise.all([
        adminClient.from("trade_history").select("*", { count: "exact", head: true })
          .eq("bot_id", bot.id),
      ]);
      const isFirstTrade = (botHistCount ?? 0) === 0;
      const sidewaysTolerant = isSidewaysTolerantStrategy(bot);

      if (isFirstTrade) {
        resolvedDirection = avgChange >= 0 ? "long" : "short";
      } else if (score < 45) {
        resolvedDirection = "short";
      } else if (score > 55) {
        resolvedDirection = "long";
      } else if (sidewaysTolerant) {
        // Scalper/grid/dca thrive in sideways — execute, default to long.
        resolvedDirection = "long";
      } else {
        return {
          success: false,
          detail: `Auto → SKIP (pro score ${score}, avg 15m ${avgChange.toFixed(2)}% — sideways 45–55 band, trend strategy).`,
        };
      }
    }

    // ── GLOBAL DIRECTIONAL COLLISION LOCK (CEO One-Way Mode fix) ──
    // On a One-Way Mode futures account, a LONG and a SHORT on the same asset
    // net out at the exchange — the new order closes the existing position
    // while the DB still shows both as open, creating phantom positions.
    // Block any new trade whose direction OPPOSES an already-open position on
    // the SAME asset across ALL of the user's bots (not just this bot).
    {
      const collisionSymbol = `${bot.coin.toUpperCase()}USDT`;
      const oppositeSide = resolvedDirection === "short" ? "BUY" : "SELL";
      const { data: collisionPos } = await adminClient
        .from("positions")
        .select("id, bot_id, side")
        .eq("user_id", userId)
        .eq("symbol", collisionSymbol)
        .in("status", ["open", "pending"])
        .limit(1)
        .maybeSingle();
      if (collisionPos && (collisionPos as { side: string }).side === oppositeSide) {
        await logApiCall(adminClient, userId, "SYSTEM", "/directional-collision-lock", "error", 0,
          `Trade skipped: Opposite position already active on ${collisionSymbol} (existing side=${oppositeSide}). One-Way mode netting prevented.`);
        return {
          success: false,
          detail: `Trade skipped: Opposite position already active on ${collisionSymbol}.`,
        };
      }
    }

    // Paper mode — simulate (only when explicitly enabled by the user)
    if (bot.is_paper_mode === true) {
      const symbol = `${bot.coin.toUpperCase()}USDT`;
      const side = resolvedDirection === "short" ? "SELL" : "BUY";
      const isFutures = bot.market_type === "futures";

      // Fetch current price — NEVER use $0; abort on failure
      let paperPrice: number;
      try {
        paperPrice = await fetchTickerPrice(symbol, isFutures);
      } catch (priceErr) {
        await logApiCall(adminClient, userId, "PAPER", "/price-fetch", "error", 0,
          `Failed to fetch live price for ${symbol}: ${(priceErr as Error).message}`);
        return { success: false, detail: `Paper trade aborted: could not fetch live price for ${symbol}. ${(priceErr as Error).message}` };
      }

      // Compute TP/SL — fixed-amount → absolute prices, percentage → pct columns
      let paperTpPct: number | null = bot.take_profit;
      let paperSlPct: number | null = bot.stop_loss;
      let paperTpAmount: number | null = null;
      let paperSlPrice: number | null = null;
      if (bot.tp_sl_mode === "fixed" && paperPrice > 0) {
        const qty = (bot.capital ?? 0) * (bot.leverage ?? 1) / paperPrice;
        // CEO DIRECTIVE: Fixed TP/SL inputs are in INR — convert to USDT (quote
        // currency) before deriving the absolute target/stop price.
        const USD_INR_RATE = 102;
        const tpF = (bot.tp_fixed ?? bot.take_profit ?? 0) / USD_INR_RATE;
        const slF = (bot.sl_fixed ?? bot.stop_loss ?? 0) / USD_INR_RATE;
        if (tpF > 0 && qty > 0) {
          const move = tpF / qty;
          const raw = resolvedDirection === "long" ? paperPrice + move : paperPrice - move;
          paperTpAmount = raw > 0 ? raw : null;
          paperTpPct = null;
        }
        if (slF > 0 && qty > 0) {
          const move = slF / qty;
          const raw = resolvedDirection === "long" ? paperPrice - move : paperPrice + move;
          paperSlPrice = raw > 0 ? raw : null;
          paperSlPct = null;
        }
      }

      // CEO DIRECTIVE: Paper mode must use the SAME atomic PENDING lock as live
      // mode. Insert PENDING first, check the unique constraint, then promote to
      // OPEN. The previous code inserted directly as 'open' with NO error check —
      // if the unique index blocked a duplicate, the code blindly continued and
      // inserted phantom rows into trades/trade_history, causing 3x spam.
      const { data: paperLockRow, error: paperLockErr } = await adminClient.from("positions").insert({
        bot_id: bot.id,
        user_id: userId,
        symbol,
        side,
        entry_price: 0,
        quantity: 0,
        leverage: bot.leverage ?? 1,
        take_profit_pct: paperTpPct,
        stop_loss_pct: paperSlPct,
        take_profit_amount: paperTpAmount,
        current_stop_loss: paperSlPrice,
        trailing_enabled: bot.trailing_enabled ?? false,
        trailing_distance_pct: bot.trailing_distance,
        fixed_profit: bot.tp_sl_mode === "fixed" ? (bot.tp_fixed ?? null) : null,
        fixed_loss: bot.tp_sl_mode === "fixed" ? (bot.sl_fixed ?? null) : null,
        max_trades_per_day: bot.max_trades_per_day ?? null,
        max_daily_loss: bot.max_daily_loss ?? null,
        max_daily_profit: bot.max_daily_profit ?? null,
        trailing_stop_loss_pct: bot.trailing_distance ?? null,
        status: "pending",
        is_paper: true,
        unrealized_pnl: 0,
      }).select("id").maybeSingle();

      if (paperLockErr || !paperLockRow) {
        const detail = paperLockErr?.code === "23505"
          ? "Aborted: bot already has an active/pending position (paper atomic lock held)"
          : `Paper atomic lock insert failed: ${paperLockErr?.message ?? "no row returned"}`;
        await logApiCall(adminClient, userId, "SYSTEM", "/strategy-runner/paper-atomic-lock", "error", 0, detail);
        return { success: false, detail };
      }
      const paperLockId = (paperLockRow as { id: string }).id;

      // Promote PENDING → OPEN with the real paper price and quantity
      await adminClient.from("positions").update({
        status: "open",
        entry_price: paperPrice,
        quantity: bot.capital ?? 0,
        dca_safety_orders_count: 0,
        dca_last_safety_price: paperPrice,
        dca_last_safety_at: new Date().toISOString(),
      }).eq("id", paperLockId);

      // Also insert into trades table so the trade appears in Trade History
      const tradeQty = bot.capital ?? 0;
      const tradeLev = bot.leverage ?? 1;
      await adminClient.from("trades").insert({
        client_id: userId,
        client_name: bot.name ?? "AI Bot",
        coin: bot.coin,
        market_type: bot.market_type,
        direction: resolvedDirection,
        entry_price: paperPrice,
        amount: tradeQty,
        quantity: tradeQty,
        leverage: tradeLev,
        position_size: tradeQty * tradeLev,
        tp_pct: bot.take_profit ?? null,
        sl_pct: bot.stop_loss ?? null,
        status: "open",
        executed_by: bot.name ?? "AI Bot",
        fixed_profit: bot.tp_sl_mode === "fixed" ? (bot.tp_fixed ?? null) : null,
        fixed_loss: bot.tp_sl_mode === "fixed" ? (bot.sl_fixed ?? null) : null,
        max_trades_per_day: bot.max_trades_per_day ?? null,
        max_daily_loss: bot.max_daily_loss ?? null,
        max_daily_profit: bot.max_daily_profit ?? null,
        trailing_stop_loss: bot.trailing_distance ?? null,
      });

      // Also insert into trade_history for Dashboard P&L
      await adminClient.from("trade_history").insert({
        user_id: userId,
        bot_id: bot.id,
        coin: bot.coin,
        timestamp: new Date().toISOString(),
        pair: symbol,
        side: side as "BUY" | "SELL",
        amount: tradeQty,
        price: paperPrice,
        entry_price: paperPrice,
        pnl: 0,
        realized_pnl: 0,
        leverage: bot.leverage ?? 1,
        margin_used: (bot.capital ?? 0),
        strategy: bot.strategy ?? bot.bot_type ?? "ai",
        status: "open",
      });

      await logApiCall(
        adminClient,
        userId,
        "PAPER",
        "/strategy-runner/simulated-order",
        "success",
        Date.now() - startTime,
        `PAPER: ${side} ${symbol} @ ${paperPrice} | strategy=${bot.strategy} | bot_type=${bot.bot_type}`,
      );

      return { success: true, detail: `Paper trade executed @ ${paperPrice}` };
    }

    // LIVE mode — CoinDCX INR-M Golden Payload (same logic as execute-trade)
    const brokerKeys = await decryptBrokerKeys(adminClient, userId);
    if (!brokerKeys) {
      await logApiCall(adminClient, userId, "SYSTEM", "/strategy-runner/no-broker", "error", 0, "No connected broker for live trade");
      return { success: false, detail: "No connected broker" };
    }

    const baseCoin = bot.coin.toUpperCase();
    const symbol = `${baseCoin}USDT`;
    const side = resolvedDirection === "short" ? "SELL" : "BUY";
    const requestedLeverage = bot.leverage ?? 1;
    const marginInr = bot.capital && bot.capital > 0 ? bot.capital : 100;

    // ── ATOMIC DB LOCK (CEO race-condition fix) ──
    // Insert a PENDING position row BEFORE touching the exchange. The unique
    // partial index uniq_one_active_position_per_bot guarantees only one
    // active (open/pending) row per bot — a concurrent cron tick or repeated
    // user click that tries to insert for the same bot_id fails here and
    // aborts before any exchange order is dispatched.
    const { data: lockRow, error: lockErr } = await adminClient.from("positions").insert({
      bot_id: bot.id,
      user_id: userId,
      symbol,
      side,
      entry_price: 0,
      quantity: 0,
      leverage: bot.leverage ?? 1,
      take_profit_pct: bot.take_profit ?? null,
      stop_loss_pct: bot.stop_loss ?? null,
      trailing_enabled: bot.trailing_enabled ?? false,
      trailing_distance_pct: bot.trailing_distance,
      fixed_profit: bot.tp_sl_mode === "fixed" ? (bot.tp_fixed ?? null) : null,
      fixed_loss: bot.tp_sl_mode === "fixed" ? (bot.sl_fixed ?? null) : null,
      max_trades_per_day: bot.max_trades_per_day ?? null,
      max_daily_loss: bot.max_daily_loss ?? null,
      max_daily_profit: bot.max_daily_profit ?? null,
      trailing_stop_loss_pct: bot.trailing_distance ?? null,
      status: "pending",
      is_paper: false,
      unrealized_pnl: 0,
    }).select("id").maybeSingle();

    if (lockErr || !lockRow) {
      // Unique-violation (23505) means another tick already locked this bot.
      const detail = lockErr?.code === "23505"
        ? `Aborted: bot already has an active/pending position (atomic lock held)`
        : `Atomic lock insert failed: ${lockErr?.message ?? "no row returned"}`;
      await logApiCall(adminClient, userId, "SYSTEM", "/strategy-runner/atomic-lock", "error", 0, detail);
      return { success: false, detail };
    }
    const lockPositionId = (lockRow as { id: string }).id;

    const startTime = Date.now();
    const golden = await executeGoldenTrade({
      apiKey: brokerKeys.apiKey,
      apiSecret: brokerKeys.apiSecret,
      baseCoin,
      side: side as "BUY" | "SELL",
      leverage: requestedLeverage,
      marginInr,
    });

    if (!golden.success && golden.livePriceUsdt <= 0) {
      // Exchange unreachable — release the lock so a later tick can retry.
      await adminClient.from("positions").delete().eq("id", lockPositionId);
      return { success: false, detail: golden.errorDetail ?? `Failed to fetch live price for ${baseCoin}.` };
    }

    const latencyMs = Date.now() - startTime;
    const orderStatus = golden.success ? "success" : "error";
    const orderDetail = golden.success
      ? `Order ${side} ${symbol} filled. OrderId: ${golden.orderId}`
      : golden.errorDetail ?? "Unknown error";

    await logApiCall(adminClient, userId, brokerKeys.exchangeName, "/order", orderStatus, latencyMs, orderDetail);

    // Promote the PENDING lock to OPEN on success, or release it on failure.
    if (golden.success) {
      const entryPrice = golden.entryPrice;
      const quantity = golden.executedQty;

      // Compute TP/SL — fixed-amount → absolute prices, percentage → pct columns
      let liveTpPct: number | null = bot.take_profit;
      let liveSlPct: number | null = bot.stop_loss;
      let liveTpAmount: number | null = null;
      let liveSlPrice: number | null = null;
      if (bot.tp_sl_mode === "fixed" && entryPrice > 0) {
        const qty = quantity;
        // CEO DIRECTIVE: Fixed TP/SL inputs are in INR — convert to USDT (quote
        // currency) before deriving the absolute target/stop price.
        const USD_INR_RATE = 102;
        const tpF = (bot.tp_fixed ?? bot.take_profit ?? 0) / USD_INR_RATE;
        const slF = (bot.sl_fixed ?? bot.stop_loss ?? 0) / USD_INR_RATE;
        if (tpF > 0 && qty > 0) {
          const move = tpF / qty;
          const raw = resolvedDirection === "long" ? entryPrice + move : entryPrice - move;
          liveTpAmount = raw > 0 ? raw : null;
          liveTpPct = null;
        }
        if (slF > 0 && qty > 0) {
          const move = slF / qty;
          const raw = resolvedDirection === "long" ? entryPrice - move : entryPrice + move;
          liveSlPrice = raw > 0 ? raw : null;
          liveSlPct = null;
        }
      }

      await adminClient.from("positions").update({
        status: "open",
        entry_price: entryPrice,
        quantity,
        take_profit_pct: liveTpPct,
        stop_loss_pct: liveSlPct,
        take_profit_amount: liveTpAmount,
        current_stop_loss: liveSlPrice,
        exchange_order_id: golden.orderId,
        dca_safety_orders_count: 0,
        dca_last_safety_price: entryPrice,
        dca_last_safety_at: new Date().toISOString(),
      }).eq("id", lockPositionId);

      // ── EXCHANGE-SIDE STOP LOSS (The Ironclad Shield) ──
      // ── VIRTUAL SL/TP (No native exchange conditional orders) ──
      // SL/TP is handled entirely by the Virtual Execution Engine in
      // monitor-positions and strategy-runner, which software-calculate
      // threshold crosses and fire reduce-only market orders. Native
      // exchange conditional orders (create_tpsl) are abandoned to avoid
      // conflicts between exchange-side and backend-side stop logic.
      if (!bot.is_paper_mode) {
        try {
          await logApiCall(adminClient, userId, brokerKeys.exchangeName, "/order-fill-raw", "info", 0,
            `Order raw response: ${JSON.stringify(golden.rawResponse).slice(0, 500)} | orderId=${golden.orderId}`);
        } catch {
          // best-effort log
        }
      }

      // Also insert into trades table so the trade appears in Trade History
      const liveLev = bot.leverage ?? 1;
      await adminClient.from("trades").insert({
        client_id: userId,
        client_name: bot.name ?? "AI Bot",
        coin: bot.coin,
        market_type: bot.market_type,
        direction: resolvedDirection,
        entry_price: entryPrice,
        amount: quantity,
        quantity: quantity,
        leverage: liveLev,
        position_size: quantity * liveLev,
        tp_pct: bot.take_profit ?? null,
        sl_pct: bot.stop_loss ?? null,
        status: "open",
        executed_by: bot.name ?? "AI Bot",
        fixed_profit: bot.tp_sl_mode === "fixed" ? (bot.tp_fixed ?? null) : null,
        fixed_loss: bot.tp_sl_mode === "fixed" ? (bot.sl_fixed ?? null) : null,
        max_trades_per_day: bot.max_trades_per_day ?? null,
        max_daily_loss: bot.max_daily_loss ?? null,
        max_daily_profit: bot.max_daily_profit ?? null,
        trailing_stop_loss: bot.trailing_distance ?? null,
      });

      // Also insert into trade_history for Dashboard P&L
      await adminClient.from("trade_history").insert({
        user_id: userId,
        bot_id: bot.id,
        coin: bot.coin,
        timestamp: new Date().toISOString(),
        pair: symbol,
        side: side as "BUY" | "SELL",
        amount: quantity,
        price: entryPrice,
        entry_price: entryPrice,
        pnl: 0,
        realized_pnl: 0,
        leverage: bot.leverage ?? 1,
        margin_used: marginInr,
        strategy: bot.strategy ?? bot.bot_type ?? "ai",
        status: "open",
      });
    } else {
      // Exchange REJECTED the order (reachable but returned HTTP 400/403 etc,
      // e.g. "Minimum order value should be 2448.0 INR"). Release the atomic
      // lock so the bot can trade again after restart, but HARD-PAUSE the bot
      // immediately so the 5-second sub-tick loop cannot retry and spam the
      // exchange API. The user must manually restart the bot after fixing the
      // config (e.g. increasing capital to meet the minimum order value).
      await adminClient.from("positions").delete().eq("id", lockPositionId);
      await adminClient.from("bots").update({ status: "paused" }).eq("id", bot.id);
      await logApiCall(adminClient, userId, "SYSTEM", "/strategy-runner/auto-pause-on-rejection", "error", 0,
        `Bot AUTO-PAUSED: Exchange rejected order — ${golden.errorDetail ?? "Unknown error"}. Bot will NOT retry until manually restarted.`);
    }

    // Auto-disable bot on risk breach if configured (separate from exchange
    // rejections above — this catches edge cases where the order status is
    // "error" but the unconditional pause above didn't fire)
    if (orderStatus === "error") {
      const { data: riskData } = await adminClient
        .from("risk_settings")
        .select("auto_disable_on_breach")
        .limit(1)
        .maybeSingle();
      if (riskData?.auto_disable_on_breach) {
        await adminClient.from("bots").update({ status: "paused" }).eq("id", bot.id);
      }
    }

    return { success: orderStatus === "success", detail: orderDetail };
  } catch (err) {
    return { success: false, detail: `Trade execution error: ${(err as Error).message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  DCA SAFETY-ORDER EXECUTION (strategy-aware atomic lock)
//  For DCA bots only. Averages down the EXISTING open position instead of
//  opening a new one — so no new positions row is inserted and the
//  uniq_one_active_position_per_bot index is never touched. Spam is guarded
//  by (a) a required price drop of dca_price_deviation_pct from the last
//  safety/entry price, (b) a 30s cooldown since the last fill, and
//  (c) a hard cap of dca_max_safety_orders per cycle.
// ═══════════════════════════════════════════════════════════════════════

const DCA_SAFETY_COOLDOWN_MS = 30_000;

async function triggerDcaSafetyOrder(
  adminClient: ReturnType<typeof createClient>,
  bot: BotRow,
  livePrice: number,
): Promise<{ success: boolean; detail: string; action: string }> {
  try {
    // Load the existing OPEN position for this bot.
    const { data: posRow, error: posErr } = await adminClient
      .from("positions")
      .select("id, entry_price, quantity, side, dca_safety_orders_count, dca_last_safety_price, dca_last_safety_at, is_paper")
      .eq("bot_id", bot.id)
      .eq("status", "open")
      .maybeSingle();

    if (posErr || !posRow) {
      return { success: false, action: "DCA_SKIP", detail: "No open position to average down" };
    }
    const pos = posRow as {
      id: string;
      entry_price: number;
      quantity: number;
      side: "BUY" | "SELL";
      dca_safety_orders_count: number | null;
      dca_last_safety_price: number | null;
      dca_last_safety_at: string | null;
      is_paper: boolean;
    };

    const safetyCount = pos.dca_safety_orders_count ?? 0;
    const maxSafety = bot.dca_max_safety_orders ?? 5;
    if (safetyCount >= maxSafety) {
      return { success: false, action: "DCA_MAXED", detail: `DCA safety-order cap reached (${safetyCount}/${maxSafety})` };
    }

    // Cooldown guard — prevents same-millisecond / same-tick API spam.
    if (pos.dca_last_safety_at) {
      const elapsed = Date.now() - new Date(pos.dca_last_safety_at).getTime();
      if (elapsed < DCA_SAFETY_COOLDOWN_MS) {
        return { success: false, action: "DCA_COOLDOWN", detail: `DCA cooldown (${Math.round((DCA_SAFETY_COOLDOWN_MS - elapsed) / 1000)}s remaining)` };
      }
    }

    // Price-deviation guard — live price must have dropped by the configured
    // % from the last safety/entry price (for longs; risen for shorts).
    const deviationPct = bot.dca_price_deviation_pct ?? 1.0;
    const referencePrice = pos.dca_last_safety_price ?? pos.entry_price;
    const isLong = pos.side === "BUY";
    const priceDropPct = isLong
      ? ((referencePrice - livePrice) / referencePrice) * 100
      : ((livePrice - referencePrice) / referencePrice) * 100;
    if (priceDropPct < deviationPct) {
      return { success: false, action: "DCA_NO_DEVIATION", detail: `Price moved ${priceDropPct.toFixed(2)}% — needs ${deviationPct}% adverse move from ${referencePrice}` };
    }

    const baseCoin = bot.coin.toUpperCase();
    const symbol = `${baseCoin}USDT`;
    const side = pos.side; // same direction as the base order
    const requestedLeverage = bot.leverage ?? 1;
    const multiplier = bot.dca_safety_order_multiplier ?? 1.0;
    const baseMarginInr = bot.capital && bot.capital > 0 ? bot.capital : 100;
    const marginInr = baseMarginInr * multiplier;

    // Paper mode — simulate the safety order (no exchange call).
    if (bot.is_paper_mode === true) {
      const fillQty = marginInr * requestedLeverage / livePrice;
      const oldQty = pos.quantity;
      const newQty = oldQty + fillQty;
      const newEntry = (pos.entry_price * oldQty + livePrice * fillQty) / newQty;

      await adminClient.from("positions").update({
        entry_price: newEntry,
        quantity: newQty,
        dca_safety_orders_count: safetyCount + 1,
        dca_last_safety_price: livePrice,
        dca_last_safety_at: new Date().toISOString(),
      }).eq("id", pos.id);

      await adminClient.from("trade_history").insert({
        user_id: bot.user_id,
        bot_id: bot.id,
        coin: bot.coin,
        timestamp: new Date().toISOString(),
        pair: symbol,
        side,
        amount: fillQty,
        price: livePrice,
        entry_price: pos.entry_price,
        pnl: 0,
        realized_pnl: 0,
        leverage: requestedLeverage,
        margin_used: baseMarginInr * multiplier,
        strategy: "dca-safety",
        status: "open",
      });

      await logApiCall(adminClient, bot.user_id, "PAPER", "/strategy-runner/dca-safety", "success", 0,
        `PAPER DCA safety #${safetyCount + 1}: ${side} ${fillQty.toFixed(6)} ${symbol} @ ${livePrice} | avg entry ${newEntry.toFixed(4)}`);
      return { success: true, action: "DCA_SAFETY", detail: `Paper DCA safety #${safetyCount + 1} filled @ ${livePrice}` };
    }

    // LIVE mode — send the safety order to the exchange.
    const brokerKeys = await decryptBrokerKeys(adminClient, bot.user_id);
    if (!brokerKeys) {
      return { success: false, action: "DCA_SKIP", detail: "No connected broker for DCA safety order" };
    }

    const orderStart = Date.now();
    const golden = await executeGoldenTrade({
      apiKey: brokerKeys.apiKey,
      apiSecret: brokerKeys.apiSecret,
      baseCoin,
      side: side as "BUY" | "SELL",
      leverage: requestedLeverage,
      marginInr,
    });

    if (!golden.success) {
      await logApiCall(adminClient, bot.user_id, brokerKeys.exchangeName, "/dca-safety-order", "error", Date.now() - orderStart,
        `DCA safety order FAILED: ${golden.errorDetail ?? "Unknown error"}`);
      return { success: false, action: "DCA_SAFETY_FAILED", detail: golden.errorDetail ?? "DCA safety order failed" };
    }

    const fillQty = golden.executedQty;
    const fillPrice = golden.entryPrice;
    const oldQty = pos.quantity;
    const newQty = oldQty + fillQty;
    const newEntry = (pos.entry_price * oldQty + fillPrice * fillQty) / newQty;

    await adminClient.from("positions").update({
      entry_price: newEntry,
      quantity: newQty,
      dca_safety_orders_count: safetyCount + 1,
      dca_last_safety_price: fillPrice,
      dca_last_safety_at: new Date().toISOString(),
    }).eq("id", pos.id);

    await adminClient.from("trade_history").insert({
      user_id: bot.user_id,
      bot_id: bot.id,
      coin: bot.coin,
      timestamp: new Date().toISOString(),
      pair: symbol,
      side,
      amount: fillQty,
      price: fillPrice,
      entry_price: pos.entry_price,
      pnl: 0,
      realized_pnl: 0,
      leverage: requestedLeverage,
      margin_used: marginInr,
      strategy: "dca-safety",
      status: "open",
    });

    await logApiCall(adminClient, bot.user_id, brokerKeys.exchangeName, "/dca-safety-order", "success", Date.now() - orderStart,
      `DCA safety #${safetyCount + 1}: ${side} ${fillQty} ${symbol} @ ${fillPrice} | new avg entry ${newEntry.toFixed(4)} | OrderId: ${golden.orderId}`);

    return { success: true, action: "DCA_SAFETY", detail: `DCA safety #${safetyCount + 1} filled @ ${fillPrice}, new avg ${newEntry.toFixed(4)}` };
  } catch (err) {
    return { success: false, action: "DCA_ERROR", detail: `DCA safety error: ${(err as Error).message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PARALLEL KLINE BATCH FETCHER
//  Fetches all unique (symbol, interval, isFutures) combos in one Promise.all
// ═══════════════════════════════════════════════════════════════════════

async function fetchKlinesBatch(
  botConfigs: Array<{ symbol: string; interval: string; isFutures: boolean }>,
): Promise<Map<string, Candle[]>> {
  const cache = new Map<string, Candle[]>();
  const uniqueKeys = new Set<string>();
  const fetches: Promise<void>[] = [];

  for (const cfg of botConfigs) {
    const key = `${cfg.symbol}|${cfg.interval}|${cfg.isFutures}`;
    if (uniqueKeys.has(key)) continue;
    uniqueKeys.add(key);

    fetches.push(
      (async () => {
        const candles = await fetchKlines(cfg.symbol, cfg.interval, 100, cfg.isFutures);
        cache.set(key, candles);
      })(),
    );
  }

  await Promise.all(fetches);
  return cache;
}

// Re-export the shared batch ticker fetcher for internal use
const fetchTickerPricesAll = sharedFetchTickerPricesBatch;

// ═══════════════════════════════════════════════════════════════════════
//  INLINE POSITION EXIT — TP/SL/TRAILING evaluation every 5 seconds
//  Closes positions across positions + trades tables, logs to broker_api_logs
// ═══════════════════════════════════════════════════════════════════════

interface OpenPositionRow {
  id: string;
  bot_id: string | null;
  user_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  entry_price: number;
  quantity: number;
  leverage: number;
  take_profit_pct: number | null;
  stop_loss_pct: number | null;
  trailing_enabled: boolean;
  trailing_distance_pct: number | null;
  highest_price: number | null;
  lowest_price: number | null;
  take_profit_amount: number | null;
  current_stop_loss: number | null;
  is_paper: boolean;
  exchange_order_id: string | null;
  exchange_position_id: string | null;
  fixed_loss: number | null;
  fixed_profit: number | null;
  max_daily_loss: number | null;
  max_daily_profit: number | null;
}

async function checkAndClosePositions(
  adminClient: ReturnType<typeof createClient>,
  priceMap: Map<string, number>,
  botMarketMap: Map<string, "spot" | "futures">,
): Promise<{ closed: number; details: string[] }> {
  const { data: openPositions } = await adminClient
    .from("positions")
    .select("id, bot_id, user_id, symbol, side, entry_price, quantity, leverage, take_profit_pct, stop_loss_pct, trailing_enabled, trailing_distance_pct, highest_price, lowest_price, take_profit_amount, current_stop_loss, is_paper, exchange_order_id, exchange_position_id, fixed_loss, fixed_profit, max_daily_loss, max_daily_profit")
    .eq("status", "open");

  const positions = (openPositions as OpenPositionRow[]) ?? [];
  const closedDetails: string[] = [];
  let closedCount = 0;

  for (const pos of positions) {
    const isFutures = pos.bot_id ? (botMarketMap.get(pos.bot_id) === "futures") : false;

    // ── FIX: Price Fetch Resilience ──
    // Never silently skip a position when the ticker fetch failed. Retry
    // immediately within the sub-tick loop (up to 3 attempts with 500ms
    // backoff) so we don't wait for the next 1-minute cron cycle.
    let livePrice = priceMap.get(pos.symbol);
    if (livePrice === undefined) {
      for (let retry = 0; retry < 3 && livePrice === undefined; retry++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          livePrice = await fetchTickerPrice(pos.symbol, isFutures);
          if (livePrice !== undefined && livePrice > 0) {
            priceMap.set(pos.symbol, livePrice);
          }
        } catch {
          // retry again
        }
      }
      if (livePrice === undefined || livePrice <= 0) {
        await logApiCall(adminClient, pos.user_id, "SYSTEM", "/strategy-runner/price-fetch-failed", "error", 0,
          `Ticker fetch failed for ${pos.symbol} after 3 retries — position kept OPEN, will retry next tick.`);
        closedDetails.push(`${pos.symbol}: price fetch failed after retries, position kept OPEN`);
        continue;
      }
    }

    const direction: "long" | "short" = pos.side === "BUY" ? "long" : "short";
    const entry = pos.entry_price;
    let shouldClose = false;
    let closeReason = "";
    let closeStatus: "closed_tp" | "closed_sl" = "closed_tp";

    if (direction === "long") {
      const tpPct = pos.take_profit_pct;
      const slPct = pos.stop_loss_pct;

      // Golden Logic: check trailed TP first if available
      if (pos.take_profit_amount && pos.take_profit_amount > 0) {
        if (livePrice >= pos.take_profit_amount) {
          shouldClose = true;
          closeReason = `Golden TP trailed: ${livePrice} >= ${pos.take_profit_amount.toFixed(2)}`;
          closeStatus = "closed_tp";
        }
      }

      if (!shouldClose && tpPct && tpPct > 0) {
        // Margin-based TP: pct applies to margin, not leveraged notional.
        // PriceMove = (entry * pct) / (leverage * 100)
        const tpPrice = entry * (1 + tpPct / (pos.leverage * 100));
        if (livePrice >= tpPrice) {
          shouldClose = true;
          closeReason = `TP hit: ${livePrice} >= ${tpPrice.toFixed(2)}`;
          closeStatus = "closed_tp";
        }
      }

      if (!shouldClose && slPct && slPct > 0) {
        // Margin-based SL: pct applies to margin, not leveraged notional.
        const slPrice = entry * (1 - slPct / (pos.leverage * 100));
        if (livePrice <= slPrice) {
          shouldClose = true;
          closeReason = `SL hit: ${livePrice} <= ${slPrice.toFixed(2)}`;
          closeStatus = "closed_sl";
        }
      }

      // Fixed-amount mode: check absolute stop_loss_price
      if (!shouldClose && pos.current_stop_loss !== null && pos.current_stop_loss > 0 && (!slPct || slPct <= 0)) {
        if (livePrice <= pos.current_stop_loss) {
          shouldClose = true;
          closeReason = `SL (fixed) hit: ${livePrice} <= ${pos.current_stop_loss.toFixed(2)}`;
          closeStatus = "closed_sl";
        }
      }

      if (!shouldClose && pos.trailing_enabled && pos.trailing_distance_pct) {
        // Margin-based trailing: distance% applies to margin/ROI, not raw price.
        // PriceMove = (highest * trailDist) / leverage, so on 50x a 10% trail
        // triggers at a 0.2% raw price pullback from the peak.
        const trailDist = pos.trailing_distance_pct / 100;
        const lev = pos.leverage || 1;
        const currentHigh = Math.max(pos.highest_price ?? entry, livePrice);
        const priceMove = (currentHigh * trailDist) / lev;
        const trailingStop = currentHigh - priceMove;
        if (livePrice <= trailingStop && currentHigh > entry) {
          shouldClose = true;
          closeReason = `Trailing stop hit: ${livePrice} <= ${trailingStop.toFixed(2)}`;
          closeStatus = "closed_tp";
        }
      }
    } else {
      const tpPct = pos.take_profit_pct;
      const slPct = pos.stop_loss_pct;

      // Golden Logic: check trailed TP first if available
      if (pos.take_profit_amount && pos.take_profit_amount > 0) {
        if (livePrice <= pos.take_profit_amount) {
          shouldClose = true;
          closeReason = `Golden TP trailed (short): ${livePrice} <= ${pos.take_profit_amount.toFixed(2)}`;
          closeStatus = "closed_tp";
        }
      }

      if (!shouldClose && tpPct && tpPct > 0) {
        // Margin-based TP (short): pct applies to margin, not leveraged notional.
        const tpPrice = entry * (1 - tpPct / (pos.leverage * 100));
        if (livePrice <= tpPrice) {
          shouldClose = true;
          closeReason = `TP hit (short): ${livePrice} <= ${tpPrice.toFixed(2)}`;
          closeStatus = "closed_tp";
        }
      }

      if (!shouldClose && slPct && slPct > 0) {
        // Margin-based SL (short): pct applies to margin, not leveraged notional.
        const slPrice = entry * (1 + slPct / (pos.leverage * 100));
        if (livePrice >= slPrice) {
          shouldClose = true;
          closeReason = `SL hit (short): ${livePrice} >= ${slPrice.toFixed(2)}`;
          closeStatus = "closed_sl";
        }
      }

      // Fixed-amount mode: check absolute stop_loss_price
      if (!shouldClose && pos.current_stop_loss !== null && pos.current_stop_loss > 0 && (!slPct || slPct <= 0)) {
        if (livePrice >= pos.current_stop_loss) {
          shouldClose = true;
          closeReason = `SL (fixed) hit (short): ${livePrice} >= ${pos.current_stop_loss.toFixed(2)}`;
          closeStatus = "closed_sl";
        }
      }

      if (!shouldClose && pos.trailing_enabled && pos.trailing_distance_pct) {
        // Margin-based trailing (short): distance% applies to margin/ROI.
        const trailDist = pos.trailing_distance_pct / 100;
        const lev = pos.leverage || 1;
        const currentLow = Math.min(pos.lowest_price ?? entry, livePrice);
        const priceMove = (currentLow * trailDist) / lev;
        const trailingStop = currentLow + priceMove;
        if (livePrice >= trailingStop && currentLow < entry) {
          shouldClose = true;
          closeReason = `Trailing stop hit (short): ${livePrice} >= ${trailingStop.toFixed(2)}`;
          closeStatus = "closed_tp";
        }
      }
    }

    // ── BACKEND MAX LOSS ENFORCEMENT (The ₹10 Fixed Limit) ──
    // Compute unrealized PnL in INR (entry is USDT, PnL formula uses the
    // 102 USD→INR rate consistent with the Golden Payload sizing).
    const priceDiffRaw = direction === "long"
      ? livePrice - entry
      : entry - livePrice;
    const unrealizedPnlInr = (priceDiffRaw * pos.quantity * pos.leverage) * 102;

    // Fixed-loss (₹ amount) — close immediately if unrealized loss hits the limit
    if (!shouldClose && pos.fixed_loss !== null && pos.fixed_loss > 0 && unrealizedPnlInr <= -pos.fixed_loss) {
      shouldClose = true;
      closeReason = `Fixed loss limit hit: unrealized PnL ₹${unrealizedPnlInr.toFixed(2)} <= -₹${pos.fixed_loss}`;
      closeStatus = "closed_sl";
    }

    // Fixed-profit (₹ amount) — close immediately if unrealized profit hits the target
    if (!shouldClose && pos.fixed_profit !== null && pos.fixed_profit > 0 && unrealizedPnlInr >= pos.fixed_profit) {
      shouldClose = true;
      closeReason = `Fixed profit target hit: unrealized PnL ₹${unrealizedPnlInr.toFixed(2)} >= ₹${pos.fixed_profit}`;
      closeStatus = "closed_tp";
    }

    // Max daily loss — query today's realized PnL for this user and close if breached
    if (!shouldClose && pos.max_daily_loss !== null && pos.max_daily_loss > 0) {
      const istOffsetMs3 = 5.5 * 60 * 60 * 1000;
      const istNow3 = new Date(Date.now() + istOffsetMs3);
      const todayStartIst3 = new Date(Date.UTC(istNow3.getUTCFullYear(), istNow3.getUTCMonth(), istNow3.getUTCDate()) - istOffsetMs3);
      const { data: todayClosed } = await adminClient
        .from("trade_history")
        .select("realized_pnl")
        .eq("user_id", pos.user_id)
        .gte("closed_at", todayStartIst3.toISOString());
      const todayRealizedPnl = ((todayClosed as { realized_pnl: number | null }[]) ?? [])
        .reduce((sum, r) => sum + (r.realized_pnl ?? 0), 0);
      const combinedPnlInr = todayRealizedPnl + unrealizedPnlInr;
      if (combinedPnlInr <= -pos.max_daily_loss) {
        shouldClose = true;
        closeReason = `Max daily loss hit: combined PnL ₹${combinedPnlInr.toFixed(2)} <= -₹${pos.max_daily_loss}`;
        closeStatus = "closed_sl";
      }
    }

    // Max daily profit — close if combined daily profit hits the ceiling
    if (!shouldClose && pos.max_daily_profit !== null && pos.max_daily_profit > 0) {
      const istOffsetMs4 = 5.5 * 60 * 60 * 1000;
      const istNow4 = new Date(Date.now() + istOffsetMs4);
      const todayStartIst4 = new Date(Date.UTC(istNow4.getUTCFullYear(), istNow4.getUTCMonth(), istNow4.getUTCDate()) - istOffsetMs4);
      const { data: todayClosed2 } = await adminClient
        .from("trade_history")
        .select("realized_pnl")
        .eq("user_id", pos.user_id)
        .gte("closed_at", todayStartIst4.toISOString());
      const todayRealizedPnl2 = ((todayClosed2 as { realized_pnl: number | null }[]) ?? [])
        .reduce((sum, r) => sum + (r.realized_pnl ?? 0), 0);
      const combinedPnlInr2 = todayRealizedPnl2 + unrealizedPnlInr;
      if (combinedPnlInr2 >= pos.max_daily_profit) {
        shouldClose = true;
        closeReason = `Max daily profit hit: combined PnL ₹${combinedPnlInr2.toFixed(2)} >= ₹${pos.max_daily_profit}`;
        closeStatus = "closed_tp";
      }
    }

    if (!shouldClose) {
      // Update trailing high/low watermarks AND Golden Logic TP trail
      const updates: Record<string, number> = {};
      if (direction === "long" && livePrice > (pos.highest_price ?? entry)) {
        updates.highest_price = livePrice;
      }
      if (direction === "short" && livePrice < (pos.lowest_price ?? entry)) {
        updates.lowest_price = livePrice;
      }

      // Golden Logic: trail TP alongside SL by the same favorable distance
      // Works for both percentage mode (take_profit_pct) and fixed-amount mode (take_profit_amount)
      if (pos.trailing_enabled && pos.trailing_distance_pct) {
        let originalTp: number;
        if (pos.take_profit_amount !== null && pos.take_profit_amount > 0) {
          originalTp = pos.take_profit_amount;
        } else if (pos.take_profit_pct && pos.take_profit_pct > 0) {
          // Margin-based: pct applies to margin, not leveraged notional.
          originalTp = direction === "long"
            ? entry * (1 + pos.take_profit_pct / (pos.leverage * 100))
            : entry * (1 - pos.take_profit_pct / (pos.leverage * 100));
        } else {
          // No TP configured — skip trailing TP, only trail SL via current_stop_loss
          originalTp = 0;
        }

        if (originalTp > 0) {
          if (direction === "long") {
            const currentHigh = Math.max(pos.highest_price ?? entry, livePrice);
            if (currentHigh > entry) {
              const favorableDist = currentHigh - entry;
              const goldenTp = originalTp + favorableDist;
              if (pos.take_profit_amount === null || goldenTp > pos.take_profit_amount) {
                updates.take_profit_amount = goldenTp;
              }
            }
          } else {
            const currentLow = Math.min(pos.lowest_price ?? entry, livePrice);
            if (currentLow < entry) {
              const favorableDist = entry - currentLow;
              const goldenTp = originalTp - favorableDist;
              if (pos.take_profit_amount === null || goldenTp < pos.take_profit_amount) {
                updates.take_profit_amount = goldenTp;
              }
            }
          }
        }
      } // end if trailing_enabled

      // ── Persist the ratcheted trailing SL to current_stop_loss ──
      // The trailing stop is recalculated each tick from highest/lowest_price.
      // Write it back to current_stop_loss so the UI shows the live protected
      // price and the frontend HFT failsafe can read it directly.
      if (pos.trailing_enabled && pos.trailing_distance_pct) {
        const trailDist = pos.trailing_distance_pct / 100;
        const lev = pos.leverage || 1;
        let trailingSlChanged = false;
        let trailingNewSl = 0;
        if (direction === "long") {
          const currentHigh = Math.max(pos.highest_price ?? entry, livePrice);
          if (currentHigh > entry) {
            const priceMove = (currentHigh * trailDist) / lev;
            const newSl = currentHigh - priceMove;
            if (pos.current_stop_loss === null || newSl > pos.current_stop_loss) {
              updates.current_stop_loss = parseFloat(newSl.toFixed(8));
              trailingSlChanged = true;
              trailingNewSl = newSl;
            }
          }
        } else {
          const currentLow = Math.min(pos.lowest_price ?? entry, livePrice);
          if (currentLow < entry) {
            const priceMove = (currentLow * trailDist) / lev;
            const newSl = currentLow + priceMove;
            if (pos.current_stop_loss === null || newSl < pos.current_stop_loss) {
              updates.current_stop_loss = parseFloat(newSl.toFixed(8));
              trailingSlChanged = true;
              trailingNewSl = newSl;
            }
          }
        }

        // ── TRAILING STOP (Virtual Engine only) ──
        // The trailing SL is tracked in the DB and enforced by the Virtual
        // Execution Engine firing reduce-only market orders. Native exchange
        // conditional orders (cancel_tpsl + create_tpsl) are abandoned.
      }

      if (Object.keys(updates).length > 0) {
        // Strip the exchange_sl_order_id from the numeric updates map —
        // it's a string column and must be updated separately.
        const exchangeSlOrderId = updates.exchange_sl_order_id as unknown as number | undefined;
        delete updates.exchange_sl_order_id;
        const updatePayload: Record<string, unknown> = { ...updates };
        if (exchangeSlOrderId !== undefined) {
          updatePayload.exchange_sl_order_id = String(exchangeSlOrderId);
        }
        await adminClient.from("positions").update(updatePayload).eq("id", pos.id);
      }
      continue;
    }

    // Calculate realized PnL
    const priceDiff = direction === "long"
      ? subtractDecimals(livePrice.toString(), entry.toString())
      : subtractDecimals(entry.toString(), livePrice.toString());
    const grossPnl = multiplyDecimals(priceDiff, pos.quantity.toString());
    const realizedPnl = parseFloat(multiplyDecimals(grossPnl, pos.leverage.toString()));
    const coinFromSymbol = pos.symbol.replace("USDT", "");

    // For LIVE positions, send a real close order via the exchange adapter,
    // then VERIFY the position is actually closed on the exchange before
    // marking it closed in our DB. If verification fails, keep the DB row
    // OPEN so the next cycle retries — never mark closed on an unconfirmed close.
    let exchangeCloseConfirmed = pos.is_paper; // paper = always confirmed
    let exchangeRealizedPnl = 0;
    if (!pos.is_paper) {
      const brokerKeys = await decryptBrokerKeys(adminClient, pos.user_id);
      if (!brokerKeys) {
        await logApiCall(adminClient, pos.user_id, "SYSTEM", "/strategy-runner/no-broker-close", "error", 0, `No connected broker for ${pos.symbol} — cannot close. Position kept OPEN in DB.`);
        closedDetails.push(`${pos.symbol}: no broker, position kept OPEN`);
        // Do NOT close in DB — skip the rest of the close logic.
        continue;
      }
      try {
        const adapter = ExchangeAdapter.create(brokerKeys.exchangeName);
        const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
        const isFutures = pos.bot_id ? (botMarketMap.get(pos.bot_id) === "futures") : false;
        const closeStartTime = Date.now();

        const closeResp = await adapter.closeOrder({
          apiKey: brokerKeys.apiKey,
          apiSecret: brokerKeys.apiSecret,
          symbol: pos.symbol,
          side: closeSide,
          marketType: isFutures ? "futures" : "spot",
          reduceOnly: isFutures,
        });
        const closeLatency = Date.now() - closeStartTime;

        if (closeResp.success) {
          await logApiCall(adminClient, pos.user_id, brokerKeys.exchangeName, "/close-order", "success", closeLatency, `Close order ${closeSide} ${pos.symbol} placed. OrderId: ${closeResp.orderId} | reason=${closeReason}`);

          // VERIFY: poll order status endpoint to confirm the order is 'filled'.
          const baseCoin = pos.symbol.replace(/USDT$/, "").replace(/^B-/, "");
          const futuresPair = `B-${baseCoin}_USDT`;
          let actualFillPrice = 0;
          let orderFillConfirmed = false;

          if (closeResp.orderId && closeResp.orderId !== "N/A") {
            const orderVerification = await verifyOrderFilled({
              apiKey: brokerKeys.apiKey,
              apiSecret: brokerKeys.apiSecret,
              orderId: closeResp.orderId,
            });
            orderFillConfirmed = orderVerification.confirmed;
            actualFillPrice = orderVerification.fillPrice;
            if (!orderFillConfirmed) {
              await logApiCall(adminClient, pos.user_id, brokerKeys.exchangeName, "/close-verify", "error", 0, `CLOSE FAILED — order ${closeResp.orderId} status='${orderVerification.status}' (not filled). DB NOT marked closed. reason=${closeReason}`);
              closedDetails.push(`${pos.symbol}: close order not filled (status=${orderVerification.status}), position kept OPEN`);
              continue;
            }
          }

          // Double-check: poll exchange to confirm the position size is actually zero.
          const verification = await verifyPositionClosed({
            apiKey: brokerKeys.apiKey,
            apiSecret: brokerKeys.apiSecret,
            futuresPair,
          });
          if (verification.confirmed) {
            exchangeCloseConfirmed = true;
            exchangeRealizedPnl = verification.realizedPnl;
            // Use the actual fill price from the order, not the mark price.
            if (actualFillPrice > 0) {
              livePrice = actualFillPrice;
            } else if (closeResp.entryPrice > 0) {
              livePrice = closeResp.entryPrice;
            }
          } else {
            await logApiCall(adminClient, pos.user_id, brokerKeys.exchangeName, "/close-verify", "error", 0, `CLOSE FAILED — ${pos.symbol} still live on exchange (remaining size ${verification.remainingSize}). DB NOT marked closed. reason=${closeReason}`);
            closedDetails.push(`${pos.symbol}: exchange close NOT confirmed (size ${verification.remainingSize}), position kept OPEN`);
            continue;
          }
        } else {
          await logApiCall(adminClient, pos.user_id, brokerKeys.exchangeName, "/close-order", "error", closeLatency, `${closeResp.errorDetail} | reason=${closeReason}`);
          closedDetails.push(`${pos.symbol}: exchange close failed, position kept OPEN — ${closeResp.errorDetail}`);
          continue;
        }
      } catch (closeErr) {
        await logApiCall(adminClient, pos.user_id, "SYSTEM", "/strategy-runner/close-error", "error", 0, `Failed to close ${pos.symbol} on exchange (position kept OPEN): ${(closeErr as Error).message}`);
        closedDetails.push(`${pos.symbol}: exchange error, position kept OPEN — ${(closeErr as Error).message}`);
        continue;
      }
    }

    // Close in trades table (match by client_id + coin + status=open)
    await adminClient.from("trades").update({
      status: closeStatus,
    }).eq("client_id", pos.user_id)
      .eq("coin", coinFromSymbol)
      .eq("status", "open");

    // Prefer the exchange's realized PnL when available; fall back to local calc
    // using the ACTUAL fill price (not the mark price snapshot).
    let finalRealizedPnl: number;
    if (exchangeRealizedPnl !== 0) {
      finalRealizedPnl = exchangeRealizedPnl;
    } else {
      const actualPriceDiff = direction === "long"
        ? subtractDecimals(livePrice.toString(), entry.toString())
        : subtractDecimals(entry.toString(), livePrice.toString());
      const actualGrossPnl = multiplyDecimals(actualPriceDiff, pos.quantity.toString());
      finalRealizedPnl = parseFloat(multiplyDecimals(actualGrossPnl, pos.leverage.toString()));
    }

    // Insert a comprehensive record into trade_history, then DELETE the
    // position row. The positions table must ONLY hold open/pending rows —
    // closed rows are ghost positions that break the first-trade-bypass.
    // Margin: entry_price is USDT-denominated; convert to INR via the 102 rate
    // so the displayed margin matches what the user actually posted in INR.
    const closedAt = new Date().toISOString();
    const marginUsedInr = (pos.quantity * pos.entry_price) / pos.leverage * 102;
    await adminClient.from("trade_history").insert({
      user_id: pos.user_id,
      bot_id: pos.bot_id,
      coin: coinFromSymbol,
      timestamp: closedAt,
      pair: pos.symbol,
      side: pos.side,
      amount: pos.quantity,
      price: livePrice,
      pnl: finalRealizedPnl,
      leverage: pos.leverage,
      margin_used: marginUsedInr,
      entry_price: pos.entry_price,
      exit_price: livePrice,
      realized_pnl: finalRealizedPnl,
      closed_at: closedAt,
      status: closeStatus,
      strategy: "auto-exit",
    });

    // Now delete the ghost position row.
    await adminClient.from("positions").delete().eq("id", pos.id);

    // Log the close
    await logApiCall(
      adminClient,
      pos.user_id,
      pos.is_paper ? "PAPER" : "EXCHANGE",
      "/strategy-runner/auto-close",
      "success",
      0,
      `AUTO-CLOSE ${closeStatus}: ${pos.symbol} @ ${livePrice} | ${closeReason} | pnl=${finalRealizedPnl} | margin_inr=${marginUsedInr.toFixed(2)}`,
    );

    closedCount++;
    closedDetails.push(`${pos.symbol}: ${closeReason} (pnl=${finalRealizedPnl})`);
  }

  return { closed: closedCount, details: closedDetails };
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN HANDLER — 5-SECOND SUB-TICK LOOP (50s max runtime)
// ═══════════════════════════════════════════════════════════════════════

const TICK_INTERVAL_MS = 5000;
const MAX_RUNTIME_MS = 50000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const runStartTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── EARLY EXIT GUARD ──
    // If zero running bots AND zero open positions, exit immediately.
    // No heartbeat logs, no klines calls, no scan logs — saves DB quotas.
    const { count: runningBotsCount } = await adminClient
      .from("bots")
      .select("*", { count: "exact", head: true })
      .eq("status", "running");

    const { count: openPositionsCount } = await adminClient
      .from("positions")
      .select("*", { count: "exact", head: true })
      .in("status", ["open", "pending"]);

    if ((runningBotsCount ?? 0) === 0 && (openPositionsCount ?? 0) === 0) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: "No active bots and no open positions — early exit to save DB quotas",
        timestamp: new Date().toISOString(),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If there are open positions but no running bots, only run position
    // monitoring (TP/SL/trailing exits). Skip klines, market scan, and all
    // scan/heartbeat logging — nothing to evaluate for new entries.
    const positionsOnlyMode = (runningBotsCount ?? 0) === 0 && (openPositionsCount ?? 0) > 0;

    // ── STARTUP HEARTBEAT ──
    // Insert immediately so the Broker Response UI proves the cron is alive,
    // even if everything below crashes. (Skipped in positions-only mode.)
    if (!positionsOnlyMode) {
      const startupTs = new Date().toISOString();
      const { error: heartbeatErr } = await adminClient.from("broker_api_logs").insert({
        user_id: "00000000-0000-0000-0000-000000000000",
        broker: "CRON",
        endpoint: "POST /functions/v1/strategy-runner",
        status: "success",
        latency_ms: 0,
        detail: `Strategy runner started at ${startupTs}`,
      });
      if (heartbeatErr) {
        console.error("Startup heartbeat insert failed:", heartbeatErr.message);
      }
    }

    // This function is called by pg_cron with the service role key.
    // It can also be called manually with a Bearer token.
    const authHeader = req.headers.get("Authorization") ?? "";
    const isCronCall = authHeader.includes(serviceRoleKey) || !authHeader.startsWith("Bearer ");

    // 1. Fetch global risk settings
    const { data: riskData } = await adminClient
      .from("risk_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    const risk = (riskData as RiskSettingsRow | null) ?? {
      global_kill_switch: false,
      max_leverage: 125,
      max_daily_loss_pct: 10,
      auto_disable_on_breach: true,
      ai_circuit_breaker: false,
      max_slippage_pct: 1.5,
    };

    // 2. Kill switch check — halt everything
    if (risk.global_kill_switch) {
      await logApiCall(adminClient, "00000000-0000-0000-0000-000000000000", "CRON", "POST /functions/v1/strategy-runner", "success", Date.now() - runStartTime, "Kill switch active — all trading halted");
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: "Global kill switch is active — all trading halted",
        timestamp: new Date().toISOString(),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STALE PENDING LOCK CLEANUP ──
    // If a previous invocation crashed between inserting a PENDING lock and
    // promoting/deleting it, that row would permanently block the bot. Sweep
    // any PENDING row older than 90s (far beyond any single exchange call)
    // and delete it so the bot can trade again.
    const stalePendingCutoff = new Date(Date.now() - 90 * 1000).toISOString();
    const { data: stalePendings } = await adminClient
      .from("positions")
      .select("id, bot_id, user_id, symbol")
      .eq("status", "pending")
      .lt("created_at", stalePendingCutoff);
    for (const sp of (stalePendings as { id: string; bot_id: string; user_id: string; symbol: string }[]) ?? []) {
      await adminClient.from("positions").delete().eq("id", sp.id);
      await logApiCall(adminClient, sp.user_id, "SYSTEM", "/strategy-runner/stale-pending-cleanup", "error", 0,
        `Deleted stale PENDING lock for bot ${sp.bot_id} (${sp.symbol}) — previous invocation likely crashed mid-execution`);
    }

    // ── ORPHANED POSITION RECOVERY ──
    // If a bot was set to 'inactive' but still has open positions (e.g. exchange
    // close failed during kill switch), force-close those orphaned positions now.
    const { data: inactiveBotsData } = await adminClient
      .from("bots")
      .select("id, market_type, user_id, coin")
      .eq("status", "inactive");

    const inactiveBots = (inactiveBotsData as Array<{ id: string; market_type: "spot" | "futures"; user_id: string; coin: string }>) ?? [];
    if (inactiveBots.length > 0) {
      const inactiveBotIds = inactiveBots.map(b => b.id);
      const { data: orphanedPositions } = await adminClient
        .from("positions")
        .select("id, bot_id, user_id, symbol, side, entry_price, quantity, leverage, is_paper")
        .eq("status", "open")
        .in("bot_id", inactiveBotIds);

      const orphans = (orphanedPositions as Array<{ id: string; bot_id: string; user_id: string; symbol: string; side: "BUY" | "SELL"; entry_price: number; quantity: number; leverage: number; is_paper: boolean }>) ?? [];

      if (orphans.length > 0) {
        const orphanBotMap = new Map<string, { market_type: "spot" | "futures"; user_id: string; coin: string }>();
        for (const ib of inactiveBots) {
          orphanBotMap.set(ib.id, { market_type: ib.market_type, user_id: ib.user_id, coin: ib.coin });
        }

        const orphanSymbols = [...new Set(orphans.map(o => {
          const botInfo = orphanBotMap.get(o.bot_id);
          return { symbol: o.symbol, isFutures: botInfo?.market_type === "futures" };
        }))];
        const orphanPriceMap = await fetchTickerPricesAll(orphanSymbols);

        for (const pos of orphans) {
          const botInfo = orphanBotMap.get(pos.bot_id);
          const isFutures = botInfo?.market_type === "futures";
          const livePrice = orphanPriceMap.get(pos.symbol);
          if (livePrice === undefined) {
            await logApiCall(adminClient, pos.user_id, "SYSTEM", "/strategy-runner/orphan-close", "error", 0, `Cannot close orphaned ${pos.symbol} — no live price`);
            continue;
          }

          const direction: "long" | "short" = pos.side === "BUY" ? "long" : "short";
          const priceDiff = direction === "long"
            ? subtractDecimals(livePrice.toString(), pos.entry_price.toString())
            : subtractDecimals(pos.entry_price.toString(), livePrice.toString());
          const grossPnl = multiplyDecimals(priceDiff, pos.quantity.toString());
          const realizedPnl = parseFloat(multiplyDecimals(grossPnl, pos.leverage.toString()));
          const coinFromSymbol = pos.symbol.replace("USDT", "");

          // For live positions, attempt close order via exchange adapter (best-effort)
          if (!pos.is_paper) {
            const brokerKeys = await decryptBrokerKeys(adminClient, pos.user_id);
            if (!brokerKeys) {
              await logApiCall(adminClient, pos.user_id, "SYSTEM", "/strategy-runner/orphan-close", "error", 0, `No broker for orphaned ${pos.symbol} — force-closing in DB only`);
            } else {
              try {
                const adapter = ExchangeAdapter.create(brokerKeys.exchangeName);
                const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
                const closeStartTime = Date.now();

                const closeResp = await adapter.closeOrder({
                  apiKey: brokerKeys.apiKey,
                  apiSecret: brokerKeys.apiSecret,
                  symbol: pos.symbol,
                  side: closeSide,
                  marketType: isFutures ? "futures" : "spot",
                  reduceOnly: isFutures,
                });
                const closeLatency = Date.now() - closeStartTime;

                if (closeResp.success) {
                  await logApiCall(adminClient, pos.user_id, brokerKeys.exchangeName, "/strategy-runner/orphan-close", "success", closeLatency, `ORPHAN CLOSE: ${pos.symbol} ${closeSide} filled. OrderId: ${closeResp.orderId}`);
                } else {
                  await logApiCall(adminClient, pos.user_id, brokerKeys.exchangeName, "/strategy-runner/orphan-close", "error", closeLatency, `ORPHAN CLOSE exchange error (force-closing DB): ${closeResp.errorDetail}`);
                }
              } catch (closeErr) {
                await logApiCall(adminClient, pos.user_id, "SYSTEM", "/strategy-runner/orphan-close", "error", 0, `Orphan close exchange error for ${pos.symbol} (force-closing DB): ${(closeErr as Error).message}`);
              }
            }
          }

          // ALWAYS close in DB — force-close orphaned positions regardless of exchange result
          const orphanClosedAt = new Date().toISOString();
          const orphanMarginInr = (pos.quantity * pos.entry_price) / pos.leverage * 102;
          await adminClient.from("trades").update({
            status: "closed_manual",
          }).eq("client_id", pos.user_id)
            .eq("coin", coinFromSymbol)
            .eq("status", "open");

          // Insert comprehensive trade_history record, then delete the ghost.
          await adminClient.from("trade_history").insert({
            user_id: pos.user_id,
            bot_id: pos.bot_id,
            coin: coinFromSymbol,
            timestamp: orphanClosedAt,
            pair: pos.symbol,
            side: pos.side,
            amount: pos.quantity,
            price: livePrice,
            pnl: realizedPnl,
            leverage: pos.leverage,
            margin_used: orphanMarginInr,
            entry_price: pos.entry_price,
            exit_price: livePrice,
            realized_pnl: realizedPnl,
            closed_at: orphanClosedAt,
            status: "closed_manual",
            strategy: "orphan-recovery",
          });

          await adminClient.from("positions").delete().eq("id", pos.id);

          await logApiCall(
            adminClient,
            pos.user_id,
            pos.is_paper ? "PAPER" : "EXCHANGE",
            "/strategy-runner/orphan-close",
            "success",
            0,
            `ORPHAN RECOVERY CLOSE: ${pos.symbol} @ ${livePrice} | pnl=${realizedPnl} (bot was inactive with open position)`,
          );
          closedCount++;
        }
      }
    }

    // 3. Fetch all active bots (status = 'running')
    // Phase 2: Auto-revert 'cooldown' bots back to 'running' after their cooldown period expires
    const { data: cooldownBots } = await adminClient
      .from("bots")
      .select("id, cooldown_minutes, updated_at")
      .eq("status", "cooldown");

    for (const cb of (cooldownBots as { id: string; cooldown_minutes: number | null; updated_at: string }[]) ?? []) {
      if (cb.cooldown_minutes && cb.cooldown_minutes > 0) {
        const updatedAt = new Date(cb.updated_at).getTime();
        const elapsedMin = (Date.now() - updatedAt) / 60000;
        if (elapsedMin >= cb.cooldown_minutes) {
          await adminClient.from("bots").update({ status: "running" }).eq("id", cb.id);
        }
      }
    }

    // ── DAILY LIMIT AUTO-WAKE (Midnight IST Reset) ──
    // Any bot that was put into 'daily_limit' status (max_daily_loss,
    // max_daily_profit, or max_trades_per_day hit) is automatically reverted
    // to 'running' once IST midnight passes. The dynamic trade_history query
    // will return 0 trades for the new day, so the bot resumes immediately.
    //
    // SAFETY: This query is scoped to status='daily_limit' ONLY. Manually
    // paused or stopped bots (status='paused'/'inactive') are NEVER touched
    // by this reset — they remain dead until the user clicks Start again.
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + istOffsetMs);
    const istMidnightToday = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffsetMs);
    const { data: dailyLimitBots } = await adminClient
      .from("bots")
      .select("id, updated_at, status")
      .eq("status", "daily_limit");

    for (const dlb of (dailyLimitBots as { id: string; updated_at: string; status: string }[]) ?? []) {
      // Double-check: only 'daily_limit' bots get woken. Never wake a
      // paused/inactive bot even if it somehow appears in this result set.
      if (dlb.status !== "daily_limit") continue;
      const pausedAt = new Date(dlb.updated_at).getTime();
      // Only wake if the pause happened on a PREVIOUS IST day.
      // If the bot was paused today, it must wait until tomorrow's IST midnight.
      if (pausedAt < istMidnightToday.getTime()) {
        await adminClient.from("bots").update({ status: "running" }).eq("id", dlb.id);
      }
    }

    const { data: botsData, error: botsErr } = await adminClient
      .from("bots")
      .select("*")
      .eq("status", "running");

    if (botsErr) {
      return new Response(JSON.stringify({ error: botsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bots = (botsData as BotRow[]) ?? [];
    if (bots.length === 0) {
      // In positions-only mode, run position monitoring (TP/SL/trailing)
      // without logging "No active bots" — saves DB write quotas.
      if (positionsOnlyMode) {
        let posClosedCount = 0;
        const posBotMarketMap = new Map<string, "spot" | "futures">();

        // Fetch market types from bots that own the open positions
        const { data: openPosWithBot } = await adminClient
          .from("positions")
          .select("bot_id, symbol")
          .eq("status", "open")
          .not("bot_id", "is", null);

        const posRows = (openPosWithBot as { bot_id: string; symbol: string }[]) ?? [];
        const posBotIds = [...new Set(posRows.map((p) => p.bot_id))];
        if (posBotIds.length > 0) {
          const { data: posBots } = await adminClient
            .from("bots")
            .select("id, market_type")
            .in("id", posBotIds);
          for (const pb of (posBots as { id: string; market_type: "spot" | "futures" }[]) ?? []) {
            posBotMarketMap.set(pb.id, pb.market_type);
          }
        }

        // Build unique symbol+marketType pairs for price fetching
        const symbolSet = new Map<string, { symbol: string; isFutures: boolean }>();
        for (const p of posRows) {
          const key = p.symbol;
          if (!symbolSet.has(key)) {
            const mt = posBotMarketMap.get(p.bot_id);
            symbolSet.set(key, { symbol: p.symbol, isFutures: mt === "futures" });
          }
        }
        const posSymbols = Array.from(symbolSet.values());

        if (posSymbols.length > 0) {
          const posPriceMap = await fetchTickerPricesAll(posSymbols);
          const posExitResult = await checkAndClosePositions(adminClient, posPriceMap, posBotMarketMap);
          posClosedCount = posExitResult.closed;
        }

        // Cleanup old logs even in positions-only mode
        const posCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        await adminClient.from("broker_api_logs").delete().lt("created_at", posCutoff);

        return new Response(JSON.stringify({
          success: true,
          evaluated: 0,
          traded: 0,
          skipped: 0,
          closed: posClosedCount,
          mode: "positions-only",
          timestamp: new Date().toISOString(),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Truly no bots and no positions — return silently (early exit already handled)
      return new Response(JSON.stringify({
        success: true,
        evaluated: 0,
        traded: 0,
        message: "No active bots to evaluate",
        timestamp: new Date().toISOString(),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Fetch latest sentiment for circuit breaker check (once per cron invocation)
    let sentimentBlocked = false;
    let sentimentClassification = "neutral";
    if (risk.ai_circuit_breaker) {
      const { data: sentimentData } = await adminClient
        .from("sentiment_scores")
        .select("overall_score, classification, long_entries_blocked")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sentimentData) {
        sentimentClassification = (sentimentData as { classification: string }).classification;
        if ((sentimentData as { long_entries_blocked: boolean }).long_entries_blocked) {
          sentimentBlocked = true;
        }
      }
    }

    // 5. Fetch all active licenses (batch — once per cron invocation)
    const userIds = [...new Set(bots.map((b) => b.user_id))];
    const { data: licensesData } = await adminClient
      .from("licenses")
      .select("user_id, plan_name, is_active, valid_until, bot_limit")
      .in("user_id", userIds)
      .eq("is_active", true);

    const licenseMap = new Map<string, LicenseRow>();
    for (const lic of (licensesData as LicenseRow[]) ?? []) {
      if (!licenseMap.has(lic.user_id)) {
        licenseMap.set(lic.user_id, lic);
      }
    }

    // 6. Fetch all user funds (batch — once per cron invocation)
    const { data: fundsData } = await adminClient
      .from("user_funds")
      .select("user_id, balance, unrealized_pnl, realized_pnl")
      .in("user_id", userIds);

    const fundsMap = new Map<string, UserFundsRow>();
    for (const fund of (fundsData as (UserFundsRow & { user_id: string })[]) ?? []) {
      fundsMap.set(fund.user_id, {
        balance: fund.balance,
        unrealized_pnl: fund.unrealized_pnl,
        realized_pnl: fund.realized_pnl,
      });
    }

    // Build bot market-type map for position exit lookups
    const botMarketMap = new Map<string, "spot" | "futures">();
    for (const b of bots) {
      botMarketMap.set(b.id, b.market_type);
    }

    // ── Results array (shared between copier sync and tick loop) ──
    const results: Array<{
      botId: string;
      botName: string;
      userId: string;
      action: string;
      detail: string;
      signal?: string;
    }> = [];

    // ── COPIER BOT SYNC: Invoke sync-copy-trades for active copier bots ──
    // Runs once per cron invocation (not per tick) to avoid duplicate syncs.
    const copierBots = bots.filter((b) => b.bot_type === "copier");
    let copierSynced = 0;
    if (copierBots.length > 0 && !risk.global_kill_switch) {
      try {
        const syncResp = await fetch(`${supabaseUrl}/functions/v1/sync-copy-trades`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({}), // empty body = scan mode
        });
        if (syncResp.ok) {
          const syncData = await syncResp.json() as { totalSynced?: number };
          copierSynced = syncData.totalSynced ?? 0;
          if (copierSynced > 0) {
            results.push({
              botId: "copier-sync",
              botName: "Copy Trading Engine",
              userId: "system",
              action: "COPIER_SYNC",
              detail: `Synced ${copierSynced} copy trades across ${copierBots.length} copier bots`,
            });
          }
        }
      } catch (syncErr) {
        results.push({
          botId: "copier-sync",
          botName: "Copy Trading Engine",
          userId: "system",
          action: "COPIER_SYNC_FAILED",
          detail: `Copy trade sync error: ${(syncErr as Error).message}`,
        });
      }
    }

    // ── 5-SECOND SUB-TICK LOOP (v2: copier sync wired) ──
    // Runs up to 10 sub-ticks spaced 5s apart, strictly exiting before 50s
    // total runtime so consecutive pg_cron invocations never overlap.
    let evaluatedCount = 0;
    let tradedCount = 0;
    let skippedCount = 0;
    let closedCount = 0;

    const MAX_TICKS = 10;
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      const tickStart = Date.now();
      const elapsed = tickStart - runStartTime;
      if (elapsed > MAX_RUNTIME_MS - TICK_INTERVAL_MS) break;

      // ── (a) Parallel kline fetch for all unique (symbol, interval, isFutures) ──
      const botKlineConfigs = bots.map((b) => ({
        symbol: `${b.coin.toUpperCase()}USDT`,
        interval: getKlineInterval(b.bot_type),
        isFutures: b.market_type === "futures",
      }));
      const klineCache = await fetchKlinesBatch(botKlineConfigs);

      // ── (b) Parallel ticker price fetch for position-exit evaluation ──
      const tickerSyms = [...new Set(
        bots.map((b) => ({
          symbol: `${b.coin.toUpperCase()}USDT`,
          isFutures: b.market_type === "futures",
        })),
      )];
      const priceMap = await fetchTickerPricesAll(tickerSyms);

      // ── (c) Inline position exit: TP/SL/trailing on all open positions ──
      const exitResult = await checkAndClosePositions(adminClient, priceMap, botMarketMap);
      closedCount += exitResult.closed;

      // ── (d) Re-query active positions every tick so bots can't double-enter ──
      // Includes 'pending' so an in-flight exchange order (atomic lock row)
      // blocks the next tick from firing a duplicate. DCA bots are handled
      // separately via triggerDcaSafetyOrder (they UPDATE the existing row,
      // never insert a second one), so they are excluded from this skip set.
      const { data: activePosTick } = await adminClient
        .from("positions")
        .select("bot_id")
        .in("status", ["open", "pending"]);

      const botsWithOpenPositions = new Set(
        ((activePosTick as { bot_id: string | null }[]) ?? [])
          .map((p) => p.bot_id)
          .filter(Boolean) as string[],
      );

      // ── (e) Evaluate each bot for new entry on this tick ──
      for (const bot of bots) {
        // HARD FAILSAFE: never trade a bot that is not strictly 'running'.
        // This guard is redundant with the status='running' query above, but
        // protects against future refactors or race conditions that could
        // inject a non-running bot into this loop. Manually paused/stopped
        // bots must NEVER wake up — only 'daily_limit' bots auto-reset at
        // UTC midnight (handled by the auto-wake block above).
        if (bot.status !== "running") {
          continue;
        }

        // ── DAILY LIMIT ENFORCEMENT (IST Midnight Reset) ──
        // This is the GLOBAL OVERTRADE BLOCK. It runs BEFORE any signal
        // evaluation, candle fetching, or market data calls. If the bot has
        // hit its daily trade limit, daily loss limit, or daily profit
        // target, it is immediately put to sleep — no signal generation, no
        // API calls, no bypasses.
        {
          const istOffsetMsTop = 5.5 * 60 * 60 * 1000;
          const istNowTop = new Date(Date.now() + istOffsetMsTop);
          const todayStartIstTop = new Date(Date.UTC(istNowTop.getUTCFullYear(), istNowTop.getUTCMonth(), istNowTop.getUTCDate()) - istOffsetMsTop);

          const [positionsTodayTop, historyTodayTop] = await Promise.all([
            adminClient
              .from("positions")
              .select("id", { count: "exact", head: true })
              .eq("user_id", bot.user_id)
              .gte("created_at", todayStartIstTop.toISOString()),
            adminClient
              .from("trade_history")
              .select("id", { count: "exact", head: true })
              .eq("user_id", bot.user_id)
              .gte("timestamp", todayStartIstTop.toISOString()),
          ]);

          const positionsTodayCountTop = positionsTodayTop.count ?? 0;
          const historyTodayCountTop = historyTodayTop.count ?? 0;
          const todayTradeCountTop = Math.max(positionsTodayCountTop, historyTodayCountTop);

          const { data: todayClosedTop } = await adminClient
            .from("trade_history")
            .select("realized_pnl")
            .eq("user_id", bot.user_id)
            .gte("closed_at", todayStartIstTop.toISOString());

          const todayRowsTop = (todayClosedTop as { realized_pnl: number | null }[]) ?? [];
          const todayRealizedPnlTop = todayRowsTop.reduce(
            (sum, r) => sum + (r.realized_pnl ?? 0),
            0,
          );

          // Max Daily Loss
          if (bot.max_daily_loss && todayRealizedPnlTop <= -bot.max_daily_loss) {
            if (bot.status !== "daily_limit") {
              await adminClient.from("bots").update({ status: "daily_limit" }).eq("id", bot.id);
            }
            skippedCount++;
            if (tick === 0) {
              results.push({
                botId: bot.id, botName: bot.name, userId: bot.user_id,
                action: "DAILY_LOSS_SLEEP",
                detail: `Daily loss limit hit: ${todayRealizedPnlTop} <= -${bot.max_daily_loss}. Bot sleeping until IST midnight.`,
              });
            }
            continue;
          }

          // Max Daily Profit
          if (bot.max_daily_profit && todayRealizedPnlTop >= bot.max_daily_profit) {
            if (bot.status !== "daily_limit") {
              await adminClient.from("bots").update({ status: "daily_limit" }).eq("id", bot.id);
            }
            skippedCount++;
            if (tick === 0) {
              results.push({
                botId: bot.id, botName: bot.name, userId: bot.user_id,
                action: "DAILY_PROFIT_SLEEP",
                detail: `Daily profit target reached: ${todayRealizedPnlTop} >= ${bot.max_daily_profit}. Bot sleeping until IST midnight.`,
              });
            }
            continue;
          }

          // Max Trades Per Day
          if (bot.max_trades_per_day && todayTradeCountTop >= bot.max_trades_per_day) {
            if (bot.status !== "daily_limit") {
              await adminClient.from("bots").update({ status: "daily_limit" }).eq("id", bot.id);
            }
            skippedCount++;
            if (tick === 0) {
              results.push({
                botId: bot.id, botName: bot.name, userId: bot.user_id,
                action: "DAILY_TRADE_LIMIT_SLEEP",
                detail: `Daily trade limit reached: ${todayTradeCountTop}/${bot.max_trades_per_day} trades. Bot sleeping until IST midnight.`,
              });
            }
            continue;
          }
        }

        evaluatedCount++;

        if (botsWithOpenPositions.has(bot.id)) {
          // Strategy-aware lock: DCA bots may average down an existing OPEN
          // position via a safety order (no new position row is created). All
          // other engines are strictly locked to one active position.
          if (isDcaBot(bot)) {
            const dcaSymbol = `${bot.coin.toUpperCase()}USDT`;
            const dcaLivePrice = priceMap.get(dcaSymbol);
            if (dcaLivePrice === undefined) {
              skippedCount++;
              if (tick === 0) {
                results.push({ botId: bot.id, botName: bot.name, userId: bot.user_id, action: "SKIP", detail: "No live price for DCA safety check" });
              }
              continue;
            }
            const dcaResult = await triggerDcaSafetyOrder(adminClient, bot, dcaLivePrice);
            if (dcaResult.success) {
              tradedCount++;
              results.push({ botId: bot.id, botName: bot.name, userId: bot.user_id, action: dcaResult.action, detail: dcaResult.detail });
            } else if (tick === 0 || dcaResult.action === "DCA_SAFETY_FAILED") {
              results.push({ botId: bot.id, botName: bot.name, userId: bot.user_id, action: dcaResult.action, detail: dcaResult.detail });
            }
            continue;
          }

          skippedCount++;
          if (tick === 0) {
            results.push({
              botId: bot.id,
              botName: bot.name,
              userId: bot.user_id,
              action: "SKIP",
              detail: "Already has an open position",
            });
          }
          continue;
        }

        // License check
        const license = licenseMap.get(bot.user_id);
        if (!license || !license.is_active) {
          skippedCount++;
          if (tick === 0) {
            results.push({
              botId: bot.id,
              botName: bot.name,
              userId: bot.user_id,
              action: "SKIP",
              detail: "No active license",
            });
          }
          continue;
        }

        // Strategy tier validation — check bot_templates.required_tier against user's plan
        const planName = (license.plan_name ?? "starter").toLowerCase();
        const botStrategyId = (bot as BotRow & { strategy_id?: string }).strategy_id;

        if (botStrategyId) {
          const { data: templateData } = await adminClient
            .from("bot_templates")
            .select("required_tier, strategy_id")
            .or(`strategy_id.eq.${botStrategyId},name.eq.${botStrategyId}`)
            .limit(1)
            .maybeSingle();

          const requiredTier = (templateData as { required_tier?: string } | null)?.required_tier ?? "enterprise";
          const TIER_RANK: Record<string, number> = { starter: 0, pro: 1, enterprise: 2 };
          const PLAN_RANK: Record<string, number> = { starter: 0, pro: 1, enterprise: 2 };
          const planRank = PLAN_RANK[planName] ?? 0;
          const tierRank = TIER_RANK[requiredTier] ?? 2;

          if (planRank < tierRank) {
            skippedCount++;
            if (tick === 0) {
              results.push({
                botId: bot.id,
                botName: bot.name,
                userId: bot.user_id,
                action: "REJECTED",
                detail: `Strategy '${botStrategyId}' locked for plan ${planName} (requires ${requiredTier})`,
              });
            }
            continue;
          }
        }

        // AI sentiment circuit breaker
        if (sentimentBlocked && (bot.trade_direction ?? "long") === "long") {
          skippedCount++;
          if (tick === 0) {
            results.push({
              botId: bot.id,
              botName: bot.name,
              userId: bot.user_id,
              action: "SKIP",
              detail: `AI circuit breaker: long entries blocked (sentiment: ${sentimentClassification})`,
            });
          }
          continue;
        }

        // Leverage cap
        const requestedLeverage = bot.leverage ?? 1;
        if (requestedLeverage > risk.max_leverage) {
          skippedCount++;
          if (tick === 0) {
            results.push({
              botId: bot.id,
              botName: bot.name,
              userId: bot.user_id,
              action: "SKIP",
              detail: `Leverage ${requestedLeverage}x exceeds platform max ${risk.max_leverage}x`,
            });
          }
          continue;
        }

        // ── Phase 3+4: Sentiment Auto-Direction (pro score, multi-factor) ──
        // The old ±0.5% avg-15m-change filter skipped every low-volatility bar
        // even when structure/EMA/RSI/volume agreed on a direction. The pro
        // score combines all five factors; score < 45 → SHORT, > 55 → LONG.
        // Sideways-tolerant strategies (scalper/grid/dca) execute in the 45–55
        // band instead of skipping — they are built for range markets.
        // CEO FIRST-TRADE BYPASS: a brand-new bot with zero trade_history
        // always enters on the raw micro-direction.
        let effectiveBot = bot;
        if (bot.trade_direction === "auto") {
          const { score, avgChange } = await fetchProSentiment();

          const [{ count: botHistCount }] = await Promise.all([
            adminClient.from("trade_history").select("*", { count: "exact", head: true })
              .eq("bot_id", bot.id),
          ]);
          const isFirstTrade = (botHistCount ?? 0) === 0;
          const sidewaysTolerant = isSidewaysTolerantStrategy(bot);

          if (isFirstTrade) {
            const forcedDir: "long" | "short" = avgChange >= 0 ? "long" : "short";
            effectiveBot = { ...bot, trade_direction: forcedDir };
            if (tick === 0) {
              results.push({
                botId: bot.id,
                botName: bot.name,
                userId: bot.user_id,
                action: "FIRST_TRADE_BYPASS",
                detail: `First-trade bypass → ${forcedDir.toUpperCase()} (pro score ${score}, avg 15m ${avgChange.toFixed(2)}%)`,
              });
            }
          } else if (score < 45) {
            effectiveBot = { ...bot, trade_direction: "short" };
            if (tick === 0) {
              results.push({
                botId: bot.id,
                botName: bot.name,
                userId: bot.user_id,
                action: "AUTO_DIR",
                detail: `Auto → SHORT (pro score ${score}, avg 15m ${avgChange.toFixed(2)}%)`,
              });
            }
          } else if (score > 55) {
            effectiveBot = { ...bot, trade_direction: "long" };
            if (tick === 0) {
              results.push({
                botId: bot.id,
                botName: bot.name,
                userId: bot.user_id,
                action: "AUTO_DIR",
                detail: `Auto → LONG (pro score ${score}, avg 15m ${avgChange.toFixed(2)}%)`,
              });
            }
          } else if (sidewaysTolerant) {
            // Scalper/grid/dca thrive in sideways — execute, default to long.
            effectiveBot = { ...bot, trade_direction: "long" };
            if (tick === 0) {
              results.push({
                botId: bot.id,
                botName: bot.name,
                userId: bot.user_id,
                action: "AUTO_DIR",
                detail: `Auto → LONG (pro score ${score} — sideways band, ${bot.bot_type ?? bot.strategy} executes in range markets)`,
              });
            }
          } else {
            skippedCount++;
            if (tick === 0) {
              results.push({
                botId: bot.id,
                botName: bot.name,
                userId: bot.user_id,
                action: "AUTO_SKIP",
                detail: `Auto → SKIP (pro score ${score}, avg 15m ${avgChange.toFixed(2)}% — sideways 45–55 band, trend strategy)`,
              });
            }
            continue;
          }
        }

        // Fetch from parallel cache
        const symbol = `${bot.coin.toUpperCase()}USDT`;
        const interval = getKlineInterval(bot.bot_type);
        const isFutures = bot.market_type === "futures";
        const cacheKey = `${symbol}|${interval}|${isFutures}`;
        const candles = klineCache.get(cacheKey) ?? [];

        if (candles.length < 20) {
          skippedCount++;
          if (tick === 0) {
            results.push({
              botId: bot.id,
              botName: bot.name,
              userId: bot.user_id,
              action: "SKIP",
              detail: `Insufficient candle data (${candles.length} candles for ${symbol} ${interval})`,
            });
          }
          continue;
        }

        // Evaluate entry conditions using the effective bot (with resolved direction)
        const signal = evaluateEntryConditions(effectiveBot, candles);

        if (!signal.shouldEnter) {
          skippedCount++;
          if (tick === 0) {
            results.push({
              botId: bot.id,
              botName: bot.name,
              userId: bot.user_id,
              action: "WAIT",
              detail: signal.reason,
              signal: signal.signalType,
            });
          }
          continue;
        }

        // ── Cooldown Timer (applies after ANY trade closes, not just SL) ──
        // CEO DIRECTIVE: The bot must pause for `cooldown_minutes` after the
        // most recent trade close (TP, SL, manual, or any other exit) before
        // being eligible to enter a new position. This prevents HFT-style
        // instant re-entry right after a Take Profit top.
        if (bot.cooldown_minutes && bot.cooldown_minutes > 0) {
          const { data: lastClosedRow } = await adminClient
            .from("trade_history")
            .select("closed_at")
            .eq("bot_id", bot.id)
            .order("closed_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();

          const lastClosed = (lastClosedRow as { closed_at: string | null } | null)?.closed_at;
          if (lastClosed) {
            const closedMs = new Date(lastClosed).getTime();
            const cooldownMs = bot.cooldown_minutes * 60 * 1000;
            const remainingMs = (closedMs + cooldownMs) - Date.now();
            if (remainingMs > 0) {
              skippedCount++;
              if (tick === 0) {
                results.push({
                  botId: bot.id,
                  botName: bot.name,
                  userId: bot.user_id,
                  action: "COOLDOWN",
                  detail: `Cooldown active: ${Math.ceil(remainingMs / 1000)}s remaining after last trade close`,
                  signal: signal.signalType,
                });
              }
              continue;
            }
          }
        }

        // ── Daily P&L and Trade Count (for Risk Calculator) ──
        // The daily limit ENFORCEMENT already ran at the top of the loop
        // (the GLOBAL OVERTRADE BLOCK). This block fetches the same data
        // for the Risk Calculator validation context below.
        const istOffsetMs2 = 5.5 * 60 * 60 * 1000;
        const istNow2 = new Date(Date.now() + istOffsetMs2);
        const todayStartIst = new Date(Date.UTC(istNow2.getUTCFullYear(), istNow2.getUTCMonth(), istNow2.getUTCDate()) - istOffsetMs2);

        const [positionsToday, historyToday] = await Promise.all([
          adminClient
            .from("positions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", bot.user_id)
            .gte("created_at", todayStartIst.toISOString()),
          adminClient
            .from("trade_history")
            .select("id", { count: "exact", head: true })
            .eq("user_id", bot.user_id)
            .gte("timestamp", todayStartIst.toISOString()),
        ]);

        const positionsTodayCount = positionsToday.count ?? 0;
        const historyTodayCount = historyToday.count ?? 0;
        const todayTradeCount = Math.max(positionsTodayCount, historyTodayCount);

        const { data: todayClosed } = await adminClient
          .from("trade_history")
          .select("realized_pnl")
          .eq("user_id", bot.user_id)
          .gte("closed_at", todayStartIst.toISOString());

        const todayRows = (todayClosed as { realized_pnl: number | null }[]) ?? [];
        const todayRealizedPnl = todayRows.reduce(
          (sum, r) => sum + (r.realized_pnl ?? 0),
          0,
        );

        // ── Risk Calculator Validation ──
        const funds = fundsMap.get(bot.user_id);
        const isPaper = bot.is_paper_mode ?? false;
        const availableBalance = isPaper
          ? "10000"
          : (funds ? funds.balance.toString() : "0");
        const dailyLoss = todayRealizedPnl < 0 ? todayRealizedPnl.toString() : "0";

        const tradeSizing: "fixed_quote" | "percent_balance" | "risk_based" =
          bot.quantity_mode === "percent" ? "percent_balance" : "fixed_quote";
        const sizingValue =
          bot.quantity_mode === "percent"
            ? (bot.percent_value ?? 10).toString()
            : (bot.quantity_value ?? bot.capital ?? 5000).toString();

        const riskConfig: RiskConfig = {
          maxTradesPerDay: bot.max_trades_per_day ?? 20,
          maxDailyLossThreshold: (bot.max_daily_loss ?? 500).toString(),
          maxDrawdownPct: "20",
          tpPct: (bot.take_profit ?? 5).toString(),
          slPct: (bot.stop_loss ?? 2).toString(),
          maxLeverage: risk.max_leverage,
          tradeSizing,
          sizingValue,
          riskPerTradePct: "1",
          maxNotional: "1000000",
          trailingEnabled: bot.trailing_enabled ?? false,
          trailingDistancePct: (bot.trailing_distance ?? 1.5).toString(),
        };

        const currentPrice = candles[candles.length - 1].close.toString();

        const validationCtx: ValidationContext = {
          licenseValid: license.is_active,
          licenseExpiry: license.valid_until,
          botStatus: "active",
          isPaperMode: bot.is_paper_mode ?? false,
          dailyTradeCount: todayTradeCount,
          dailyLoss,
          availableBalance,
          currentDrawdownPct: "0",
        };

        const validation = validateOrder(riskConfig, validationCtx, currentPrice);

        if (!validation.approved) {
          skippedCount++;
          if (tick === 0) {
            results.push({
              botId: bot.id,
              botName: bot.name,
              userId: bot.user_id,
              action: "REJECTED",
              detail: `Risk check failed: ${validation.rejections.join(", ")}`,
              signal: signal.signalType,
            });
          }

          if (
            risk.auto_disable_on_breach &&
            (validation.rejections.includes("LICENSE_INVALID") ||
              validation.rejections.includes("LICENSE_EXPIRED"))
          ) {
            await adminClient.from("bots").update({ status: "paused" }).eq("id", bot.id);
          }
          continue;
        }

        // ── Martingale position sizing (if applicable) ──
        let finalSize = validation.computedSize ?? sizingValue;

        if (bot.bot_type === "martingale" && bot.martingale_multiplier && bot.max_martingale_steps) {
          const { data: recentHistory } = await adminClient
            .from("trade_history")
            .select("realized_pnl, status")
            .eq("bot_id", bot.id)
            .order("closed_at", { ascending: false })
            .limit(20);

          const closedPositions = (recentHistory as { realized_pnl: number | null; status: string }[]) ?? [];

          if (closedPositions.length > 0) {
            const martingaleConfig: MartingaleConfig = {
              martingale_multiplier: bot.martingale_multiplier,
              max_martingale_steps: bot.max_martingale_steps,
              base_position_size: parseFloat(sizingValue),
              max_drawdown_pct: 20,
            };

            let state = createMartingaleState(martingaleConfig);
            for (const pos of closedPositions.reverse()) {
              const pnl = pos.realized_pnl ?? 0;
              const result = processMartingaleResult(state, pnl, martingaleConfig);
              state = result.new_state;
              if (state.halted) break;
            }

            if (state.halted) {
              skippedCount++;
              if (tick === 0) {
                results.push({
                  botId: bot.id,
                  botName: bot.name,
                  userId: bot.user_id,
                  action: "HALTED",
                  detail: `Martingale halted: ${state.halt_reason}`,
                  signal: signal.signalType,
                });
              }
              await adminClient.from("bots").update({ status: "paused" }).eq("id", bot.id);
              continue;
            }

            if (state.current_position_size > 0) {
              finalSize = state.current_position_size.toString();
            }
          }
        }

        // ── Execute the trade ──
        if (compareDecimals(finalSize, "0") > 0) {
          await adminClient.from("bots").update({
            capital: parseFloat(finalSize),
          }).eq("id", bot.id);
        }

        const tradeResult = await triggerTradeExecution(
          supabaseUrl,
          serviceRoleKey,
          bot.id,
          bot.user_id,
          adminClient,
        );

        if (tradeResult.success) {
          tradedCount++;
          results.push({
            botId: bot.id,
            botName: bot.name,
            userId: bot.user_id,
            action: "TRADED",
            detail: `[tick ${tick}] ${signal.signalType} — ${signal.reason} | ${tradeResult.detail}`,
            signal: signal.signalType,
          });
        } else {
          results.push({
            botId: bot.id,
            botName: bot.name,
            userId: bot.user_id,
            action: "TRADE_FAILED",
            detail: `[tick ${tick}] ${signal.signalType} — ${signal.reason} | FAILED: ${tradeResult.detail}`,
            signal: signal.signalType,
          });
        }
      }

      // ── Sleep until next 5-second boundary (unless this is the last tick) ──
      const tickElapsed = Date.now() - tickStart;
      const sleepMs = TICK_INTERVAL_MS - tickElapsed;
      if (sleepMs > 0 && tick < MAX_TICKS - 1) {
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }
    }

    // 7. Scan-complete heartbeat log — ONE summary per cron minute
    const scanDetail = `5s-engine: ${evaluatedCount} evals, ${tradedCount} traded, ${skippedCount} skipped, ${closedCount} positions closed. ` +
      results.filter(r => r.action === "TRADED" || r.action === "TRADE_FAILED").slice(0, 3).map(r => `${r.botName}: ${r.action}`).join("; ");
    const scanBots = [...new Set(bots.map(b => `${b.coin}/${b.bot_type ?? b.strategy}`))].slice(0, 3).join(", ");
    await logApiCall(
      adminClient,
      bots[0]?.user_id ?? "00000000-0000-0000-0000-000000000000",
      bots[0]?.is_paper_mode ? "PAPER" : "EXCHANGE",
      "GET /api/v3/klines",
      "success",
      Math.round(Date.now() - runStartTime),
      `Market scan: ${scanBots} — ${scanDetail}`,
    );

    // 8. Cleanup — delete logs older than 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await adminClient.from("broker_api_logs").delete().lt("created_at", cutoff);

    return new Response(JSON.stringify({
      success: true,
      evaluated: evaluatedCount,
      traded: tradedCount,
      skipped: skippedCount,
      closed: closedCount,
      ticks: Math.min(MAX_TICKS, Math.ceil((Date.now() - runStartTime) / TICK_INTERVAL_MS)),
      killSwitchActive: risk.global_kill_switch,
      sentimentCircuitBreaker: sentimentBlocked,
      sentimentClassification,
      timestamp: new Date().toISOString(),
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // FATAL CRASH LOGGING — ensure the UI shows why the runner failed
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const crashClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await crashClient.from("broker_api_logs").insert({
        user_id: "00000000-0000-0000-0000-000000000000",
        broker: "CRON",
        endpoint: "POST /functions/v1/strategy-runner",
        status: "error",
        latency_ms: Date.now() - runStartTime,
        detail: `FATAL: ${(err as Error).message}`,
      });
    } catch {
      // If even the error log fails, there's nothing more we can do
    }
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


