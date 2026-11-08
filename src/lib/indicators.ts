// Technical indicator helpers — standard formulas.
// All operate on an ordered Candle[] (oldest → newest).

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Exponential Moving Average — returns the EMA value at the last candle.
// seed = SMA of the first `period` closes, then recurse with the multiplier.
export function calcEMA(candles: Candle[], period: number): number {
  const n = candles.length;
  if (n === 0) return 0;
  if (n < period) {
    // Not enough data for a proper EMA — fall back to the mean of closes.
    const sum = candles.reduce((s, c) => s + c.close, 0);
    return sum / n;
  }
  const k = 2 / (period + 1);
  // Seed with SMA of the first `period` closes.
  let ema = 0;
  for (let i = 0; i < period; i++) ema += candles[i].close;
  ema /= period;
  for (let i = period; i < n; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

// Relative Strength Index (Wilder's smoothing), value 0–100.
export function calcRSI(candles: Candle[], period: number = 14): number {
  const n = candles.length;
  if (n <= period) return 50; // insufficient data — treat as neutral
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < n; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Average True Range (Wilder's smoothing), returned in price units.
export function calcATR(candles: Candle[], period: number = 14): number {
  const n = candles.length;
  if (n <= 1) return 0;
  if (n <= period) {
    // Fall back to the mean true range of what we have.
    let sum = 0;
    for (let i = 1; i < n; i++) sum += trueRange(candles, i);
    return sum / (n - 1);
  }
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += trueRange(candles, i);
  atr /= period;
  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + trueRange(candles, i)) / period;
  }
  return atr;
}

function trueRange(candles: Candle[], i: number): number {
  const prev = candles[i - 1];
  const cur = candles[i];
  const hl = cur.high - cur.low;
  const hc = Math.abs(cur.high - prev.close);
  const lc = Math.abs(cur.low - prev.close);
  return Math.max(hl, hc, lc);
}
