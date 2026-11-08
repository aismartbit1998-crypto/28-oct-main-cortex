import type { LiveCoin } from '@/hooks/useLivePrices';
import type { Candle } from '@/lib/indicators';
import { calcEMA, calcRSI } from '@/lib/indicators';

const SENTIMENT_INDEX_COINS = ['BTC', 'ETH'];

export interface MarketSentiment {
  fearGreedIndex: number;
  fearGreedLabel: string;
  fearGreedColor: string;
  bullishPercent: number;
  volatility: 'Low' | 'Moderate' | 'High' | 'Extreme';
  advancing: number;
  declining: number;
  topGainer: LiveCoin | null;
  topLoser: LiveCoin | null;
  avgChange: number;
  summary: string;
  recommendation: string;
  // The single pro score — exposed so every widget reads the SAME number.
  score: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * computeProScore — multi-factor market-structure score (0–100).
 * Combines: swing structure (30%), EMA 9/21 (20%), RSI 14 (20%),
 * volume pressure (15%), and 50-candle range position (15%).
 *
 * Requires >= 21 candles; returns 50 (neutral) when data is insufficient.
 * This is the single source of truth used by BOTH the Fear & Greed meter
 * and the AI Predictor, so they can never disagree again.
 */
export function computeProScore(candles: Candle[]): number {
  const n = candles.length;
  if (n < 21) return 50;

  let score = 50;
  const price = candles[n - 1].close;

  // 1. MARKET STRUCTURE (30%): last 3 sampled swing highs/lows.
  const highs = [candles[n - 15].high, candles[n - 10].high, candles[n - 5].high];
  const lows = [candles[n - 15].low, candles[n - 10].low, candles[n - 5].low];
  if (highs[2] < highs[1] && highs[1] < highs[0] && lows[2] < lows[1]) {
    score -= 12; // Lower Highs, Lower Lows — downtrend
  } else if (highs[2] > highs[1] && highs[1] > highs[0] && lows[2] > lows[1]) {
    score += 12; // Higher Highs, Higher Lows — uptrend
  } else {
    score += 0; // Sideways range
  }

  // 2. EMA (20%): EMA 9 vs EMA 21 vs price.
  const ema9 = calcEMA(candles, 9);
  const ema21 = calcEMA(candles, 21);
  if (price < ema21) score -= 8; else score += 8;
  if (ema9 < ema21) score -= 4; else score += 4;

  // 3. RSI 14 (20%)
  const rsi = calcRSI(candles, 14);
  if (rsi < 30) score += 3; // oversold — contrarian bullish
  else if (rsi < 45) score -= 5;
  else if (rsi > 55) score += 5;
  else if (rsi > 70) score -= 3; // overbought — contrarian bearish

  // 4. VOLUME (15%): last 10 candles, buy vs sell by candle direction.
  let buyVol = 0;
  let sellVol = 0;
  for (let i = n - 10; i < n; i++) {
    if (candles[i].close >= candles[i].open) buyVol += candles[i].volume;
    else sellVol += candles[i].volume;
  }
  if (sellVol > buyVol * 1.2) score -= 5;
  else if (buyVol > sellVol * 1.2) score += 5;

  // 5. RANGE POSITION (15%): last 50 candles.
  const last50 = candles.slice(-50);
  const high50 = Math.max(...last50.map((c) => c.high));
  const low50 = Math.min(...last50.map((c) => c.low));
  const range = high50 - low50;
  const pos = range > 0 ? (price - low50) / range : 0.5;
  if (pos < 0.2) score -= 4; else if (pos > 0.8) score += 4;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function labelForScore(score: number): { label: string; color: string } {
  if (score < 25) return { label: 'Extreme Fear', color: '#ff3b5c' };
  if (score < 45) return { label: 'Fear', color: '#ffb020' };
  if (score < 55) return { label: 'Neutral', color: '#00e5ff' };
  if (score < 75) return { label: 'Greed', color: '#00ff9d' };
  return { label: 'Extreme Greed', color: '#00ff9d' };
}

function volatilityFromChange(maxAbsChange: number): MarketSentiment['volatility'] {
  if (maxAbsChange < 3) return 'Low';
  if (maxAbsChange < 7) return 'Moderate';
  if (maxAbsChange < 12) return 'High';
  return 'Extreme';
}

/**
 * computeMarketSentiment — now candle-driven. The Fear & Greed index is the
 * pro score over the BTC+ETH 15m candles, so every widget reads ONE number.
 *
 * `candlesBySymbol` maps "BTC" / "ETH" → their recent 15m candle arrays.
 * `coins` is still passed for breadth/advancing/declining + gainer/loser.
 */
export function computeMarketSentiment(
  coins: LiveCoin[],
  candlesBySymbol: Record<string, Candle[]>,
  feedOnline: boolean = true,
): MarketSentiment {
  const hasRealData =
    coins.length > 0 &&
    coins.some((c) => typeof c.change15m === 'number' && c.price > 0);

  if (coins.length === 0 || !hasRealData || !feedOnline) {
    return {
      fearGreedIndex: 50,
      fearGreedLabel: feedOnline ? 'Loading' : 'Feed Offline',
      fearGreedColor: feedOnline ? '#00e5ff' : '#ff3b5c',
      bullishPercent: 50,
      volatility: 'Moderate',
      advancing: 0,
      declining: 0,
      topGainer: null,
      topLoser: null,
      avgChange: 0,
      summary: feedOnline
        ? 'Connecting to live market data feed...'
        : 'DATA FEED OFFLINE — primary and fallback price sources unreachable. Reconnecting automatically.',
      recommendation: feedOnline ? 'Standby' : 'Do not trade — live market data unavailable.',
      score: 50,
    };
  }

  const indexCoins = coins.filter((c) => SENTIMENT_INDEX_COINS.includes(c.symbol));
  const sentimentCoins = indexCoins.length > 0 ? indexCoins : coins;
  const advancing = sentimentCoins.filter((c) => c.change15m > 0).length;
  const declining = sentimentCoins.filter((c) => c.change15m < 0).length;
  const avgChange =
    sentimentCoins.reduce((sum, c) => sum + c.change15m, 0) / sentimentCoins.length;
  const maxAbsChange = Math.max(...sentimentCoins.map((c) => Math.abs(c.change15m)));
  const topGainer = [...sentimentCoins].sort((a, b) => b.change15m - a.change15m)[0] ?? null;
  const topLoser = [...sentimentCoins].sort((a, b) => a.change15m - b.change15m)[0] ?? null;

  // ── Pro score: average the BTC and ETH candle scores so both majors share
  // one index value. Falls back to 50 (Neutral) when candles aren't loaded yet.
  const indexCandles = SENTIMENT_INDEX_COINS
    .map((s) => candlesBySymbol[s])
    .filter((arr): arr is Candle[] => Array.isArray(arr) && arr.length >= 21);

  const score =
    indexCandles.length > 0
      ? Math.round(indexCandles.reduce((sum, c) => sum + computeProScore(c), 0) / indexCandles.length)
      : 50;

  const { label: fearGreedLabel, color: fearGreedColor } = labelForScore(score);
  const fearGreedIndex = score;

  const volatility = volatilityFromChange(maxAbsChange);

  // Bullish percent — anchored to the single pro score so it tracks the meter.
  const bullishPercent = clamp(Math.round(((score - 25) / 50) * 100), 0, 100);

  const isSideways = score >= 45 && score <= 55;
  const direction = isSideways ? 'consolidating' : score >= 55 ? 'bullish' : 'bearish';
  const momentum = isSideways ? 'holding' : score >= 55 ? 'accumulating' : 'distributing';
  const topGainerText = topGainer ? `${topGainer.symbol} (+${topGainer.change15m.toFixed(1)}%)` : 'N/A';
  const topLoserText = topLoser ? `${topLoser.symbol} (${topLoser.change15m.toFixed(1)}%)` : 'N/A';

  const timeframeLabel = '15M';
  const summary = isSideways
    ? `Macro Index (BTC/ETH - ${timeframeLabel}) is consolidating with a pro score of ${score}. Market structure is range-bound; ${advancing}/${sentimentCoins.length} majors advancing (${timeframeLabel}). Top gainer: ${topGainerText}. Top laggard: ${topLoserText}. Volatility is ${volatility.toLowerCase()}. Smart Money appears to be ${momentum} — no clear directional conviction.`
    : `Macro Index (BTC/ETH - ${timeframeLabel}) is ${direction} with a pro score of ${score}. ${advancing}/${sentimentCoins.length} majors advancing (${timeframeLabel}). Top gainer: ${topGainerText}. Top laggard: ${topLoserText}. Volatility is ${volatility.toLowerCase()}. Smart Money appears to be ${momentum} key assets.`;

  let recommendation: string;
  if (score < 25) {
    recommendation = 'DCA accumulation zone — fear creates buying opportunities for spot positions';
  } else if (score < 45) {
    recommendation = 'Selective DCA entries — watch for reversal confirmations before scaling in';
  } else if (score < 55) {
    recommendation = 'Balanced approach — maintain existing positions, wait for clearer direction';
  } else if (score < 75) {
    recommendation = 'DCA accumulation favorable — caution on high-leverage futures due to volatility';
  } else {
    recommendation = 'Take partial profits — extreme greed increases reversal risk, trim leverage';
  }

  return {
    fearGreedIndex,
    fearGreedLabel,
    fearGreedColor,
    bullishPercent,
    volatility,
    advancing,
    declining,
    topGainer,
    topLoser,
    avgChange,
    summary,
    recommendation,
    score,
  };
}
