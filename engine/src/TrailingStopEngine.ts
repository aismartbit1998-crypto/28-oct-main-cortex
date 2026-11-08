/*
 * TrailingStopEngine — Server-Side Trailing Stop Loss Worker
 *
 * Enforces strict monotonicity: stop loss can only move UP for longs,
 * DOWN for shorts. Uses Supabase RPC for atomic daily trade count
 * increments to prevent race conditions from concurrent workers.
 */

import {
  compareDecimals,
  subtractDecimals,
  multiplyDecimals,
  divideDecimals,
  absDecimal,
  normalizeDecimal,
} from './RiskCalculator';

export type { } from './RiskCalculator';

export interface TrailingStopState {
  botId: string;
  positionId: string;
  direction: 'long' | 'short';
  entryPrice: string;
  currentStopLoss: string;
  highestPrice: string;
  lowestPrice: string;
  trailingDistancePct: string;
  activated: boolean;
}

export interface TrailingStopUpdate {
  newStopLoss: string;
  wasMoved: boolean;
  shouldTrigger: boolean;
  reason: string;
}

/**
 * Computes the trailing stop based on current price and direction.
 * For longs: stop moves UP only, trailing behind the highest price.
 * For shorts: stop moves DOWN only, trailing behind the lowest price.
 */
export function computeTrailingStop(
  state: TrailingStopState,
  currentPrice: string,
): TrailingStopUpdate {
  const distPct = divideDecimals(state.trailingDistancePct, '100', 18);

  if (state.direction === 'long') {
    const newHighest = compareDecimals(currentPrice, state.highestPrice) > 0
      ? currentPrice
      : state.highestPrice;

    const trailingAmount = multiplyDecimals(newHighest, distPct);
    const proposedStop = subtractDecimals(newHighest, trailingAmount);

    const wasMoved = compareDecimals(proposedStop, state.currentStopLoss) > 0;
    const newStopLoss = wasMoved ? proposedStop : state.currentStopLoss;

    const shouldTrigger = compareDecimals(currentPrice, newStopLoss) <= 0;

    return {
      newStopLoss: normalizeDecimal(newStopLoss),
      wasMoved,
      shouldTrigger,
      reason: wasMoved
        ? `Trailing stop moved up to ${newStopLoss} (high: ${newHighest})`
        : shouldTrigger
        ? `Price ${currentPrice} hit trailing stop ${newStopLoss}`
        : `No movement — stop stays at ${newStopLoss}`,
    };
  } else {
    const newLowest = compareDecimals(currentPrice, state.lowestPrice) < 0
      ? currentPrice
      : state.lowestPrice;

    const trailingAmount = multiplyDecimals(newLowest, distPct);
    const proposedStop = addDecimalsSafe(newLowest, trailingAmount);

    const wasMoved = compareDecimals(proposedStop, state.currentStopLoss) < 0;
    const newStopLoss = wasMoved ? proposedStop : state.currentStopLoss;

    const shouldTrigger = compareDecimals(currentPrice, newStopLoss) >= 0;

    return {
      newStopLoss: normalizeDecimal(newStopLoss),
      wasMoved,
      shouldTrigger,
      reason: wasMoved
        ? `Trailing stop moved down to ${newStopLoss} (low: ${newLowest})`
        : shouldTrigger
        ? `Price ${currentPrice} hit trailing stop ${newStopLoss}`
        : `No movement — stop stays at ${newStopLoss}`,
    };
  }
}

function addDecimalsSafe(a: string, b: string): string {
  const maxPlaces = Math.max(
    a.split('.')[1]?.length ?? 0,
    b.split('.')[1]?.length ?? 0,
  );
  const ai = a.replace('.', '').replace('-', '');
  const bi = b.replace('.', '').replace('-', '');
  const result = BigInt(ai) + BigInt(bi);
  let str = result.toString();
  if (maxPlaces > 0) {
    while (str.length <= maxPlaces) str = '0' + str;
    str = str.slice(0, -maxPlaces) + '.' + str.slice(-maxPlaces);
  }
  return normalizeDecimal(str);
}

/**
 * Initializes trailing stop state from entry.
 */
export function initTrailingStop(
  botId: string,
  positionId: string,
  direction: 'long' | 'short',
  entryPrice: string,
  initialStopLoss: string,
  trailingDistancePct: string,
): TrailingStopState {
  return {
    botId,
    positionId,
    direction,
    entryPrice,
    currentStopLoss: initialStopLoss,
    highestPrice: direction === 'long' ? entryPrice : initialStopLoss,
    lowestPrice: direction === 'short' ? entryPrice : initialStopLoss,
    trailingDistancePct,
    activated: false,
  };
}

/**
 * Updates the trailing stop state after a price tick.
 * Returns the new state and the update result.
 */
export function tickTrailingStop(
  state: TrailingStopState,
  currentPrice: string,
): { state: TrailingStopState; update: TrailingStopUpdate } {
  const update = computeTrailingStop(state, currentPrice);

  const newState: TrailingStopState = {
    ...state,
    currentStopLoss: update.newStopLoss,
    highestPrice: compareDecimals(currentPrice, state.highestPrice) > 0
      ? currentPrice
      : state.highestPrice,
    lowestPrice: compareDecimals(currentPrice, state.lowestPrice) < 0
      ? currentPrice
      : state.lowestPrice,
    activated: state.activated || update.wasMoved,
  };

  return { state: newState, update };
}

/**
 * Atomic daily trade counter increment via Supabase RPC.
 * This prevents race conditions when concurrent workers try to
 * increment the daily trade count simultaneously.
 *
 * Returns the updated count, or -1 if the limit was already reached.
 */
export async function atomicIncrementDailyTrades(
  rpcCall: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>,
  botId: string,
  maxTradesPerDay: number,
): Promise<number> {
  const { data, error } = await rpcCall('increment_daily_trade_count', {
    p_bot_id: botId,
    p_max_trades: maxTradesPerDay,
  });

  if (error) {
    throw new Error(`Atomic increment failed: ${error.message}`);
  }

  const count = data as number;
  return count;
}
