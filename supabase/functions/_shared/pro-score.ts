// Deno-shared pro-score engine — mirrors src/lib/indicators.ts + computeProScore
// from src/lib/marketSentiment.ts. Edge functions can't import from src/, so
// this is the canonical copy for the server side.

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function calcEMA(candles: Candle[], period: number): number {
  const n = candles.length;
  if (n === 0) return 0;
  if (n < period) {
    const sum = candles.reduce((s, c) => s + c.close, 0);
    return sum / n;
  }
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += candles[i].close;
  ema /= period;
  for (let i = period; i < n; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

export function calcRSI(candles: Candle[], period = 14): number {
  const n = candles.length;
  if (n <= period) return 50;
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

export function calcATR(candles: Candle[], period = 14): number {
  const n = candles.length;
  if (n <= 1) return 0;
  const tr = (i: number): number => {
    const prev = candles[i - 1];
    const cur = candles[i];
    return Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
  };
  if (n <= period) {
    let sum = 0;
    for (let i = 1; i < n; i++) sum += tr(i);
    return sum / (n - 1);
  }
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += tr(i);
  atr /= period;
  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + tr(i)) / period;
  }
  return atr;
}

// Multi-factor pro score (0–100). Requires >= 21 candles; else 50 (Neutral).
export function computeProScore(candles: Candle[]): number {
  const n = candles.length;
  if (n < 21) return 50;

  let score = 50;
  const price = candles[n - 1].close;

  const highs = [candles[n - 15].high, candles[n - 10].high, candles[n - 5].high];
  const lows = [candles[n - 15].low, candles[n - 10].low, candles[n - 5].low];
  if (highs[2] < highs[1] && highs[1] < highs[0] && lows[2] < lows[1]) {
    score -= 12;
  } else if (highs[2] > highs[1] && highs[1] > highs[0] && lows[2] > lows[1]) {
    score += 12;
  }

  const ema9 = calcEMA(candles, 9);
  const ema21 = calcEMA(candles, 21);
  if (price < ema21) score -= 8; else score += 8;
  if (ema9 < ema21) score -= 4; else score += 4;

  const rsi = calcRSI(candles, 14);
  if (rsi < 30) score += 3;
  else if (rsi < 45) score -= 5;
  else if (rsi > 55) score += 5;
  else if (rsi > 70) score -= 3;

  let buyVol = 0;
  let sellVol = 0;
  for (let i = n - 10; i < n; i++) {
    if (candles[i].close >= candles[i].open) buyVol += candles[i].volume;
    else sellVol += candles[i].volume;
  }
  if (sellVol > buyVol * 1.2) score -= 5;
  else if (buyVol > sellVol * 1.2) score += 5;

  const last50 = candles.slice(-50);
  const high50 = Math.max(...last50.map((c) => c.high));
  const low50 = Math.min(...last50.map((c) => c.low));
  const range = high50 - low50;
  const pos = range > 0 ? (price - low50) / range : 0.5;
  if (pos < 0.2) score -= 4; else if (pos > 0.8) score += 4;

  return Math.max(0, Math.min(100, Math.round(score)));
}

const INDEX_COINS = ["BTC", "ETH"];
const BINANCE_HOSTS = ["https://api.binance.com", "https://api1.binance.com"];

// Fetch 60 × 15m candles for a single symbol, with mirror fallback.
export async function fetchCandlesForSymbol(
  coin: string,
  interval = "15m",
  limit = 60,
): Promise<Candle[]> {
  for (const host of BINANCE_HOSTS) {
    try {
      const resp = await fetch(
        `${host}/api/v3/klines?symbol=${coin}USDT&interval=${interval}&limit=${limit}`,
      );
      if (!resp.ok) continue;
      const raw = await resp.json() as unknown[][];
      const candles: Candle[] = raw
        .map((row) => ({
          open: parseFloat(row[1] as string),
          high: parseFloat(row[2] as string),
          low: parseFloat(row[3] as string),
          close: parseFloat(row[4] as string),
          volume: parseFloat(row[5] as string),
        }))
        .filter(
          (c) =>
            Number.isFinite(c.open) && Number.isFinite(c.high) &&
            Number.isFinite(c.low) && Number.isFinite(c.close) &&
            Number.isFinite(c.volume) && c.open > 0,
        );
      if (candles.length >= 21) return candles;
    } catch {
      // try next mirror
    }
  }
  return [];
}

// Averaged pro score across the BTC+ETH 15m index, plus the raw 15m avg change
// (kept for logging/back-compat with the first-trade bypass).
export async function fetchProSentiment(): Promise<{
  score: number;
  avgChange: number;
}> {
  const all = await Promise.all(
    INDEX_COINS.map(async (coin) => {
      const candles = await fetchCandlesForSymbol(coin);
      if (candles.length < 21) return null;
      const last = candles[candles.length - 1];
      const change = last.open > 0 ? ((last.close - last.open) / last.open) * 100 : 0;
      return { score: computeProScore(candles), change };
    }),
  );
  const valid = all.filter((v): v is { score: number; change: number } => v !== null);
  if (valid.length === 0) return { score: 50, avgChange: 0 };
  const score = Math.round(valid.reduce((s, v) => s + v.score, 0) / valid.length);
  const avgChange = valid.reduce((s, v) => s + v.change, 0) / valid.length;
  return { score, avgChange };
}
