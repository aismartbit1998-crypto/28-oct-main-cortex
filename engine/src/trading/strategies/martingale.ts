/*
 * Martingale Recovery Strategy — Execution Engine
 *
 * Core logic: after a position closes at a loss, the next entry size
 * is multiplied by `martingale_multiplier`, up to `max_martingale_steps`.
 * If the step limit is reached or global max drawdown is breached, the bot halts.
 */

export interface MartingaleConfig {
  martingale_multiplier: number;
  max_martingale_steps: number;
  base_position_size: number;
  max_drawdown_pct: number;
  take_profit_pct: number;
  stop_loss_pct: number;
}

export interface MartingaleState {
  current_step: number;
  current_position_size: number;
  total_pnl: number;
  starting_capital: number;
  halted: boolean;
  halt_reason: string | null;
}

export interface MartingaleTradeResult {
  pnl: number;
  was_loss: boolean;
  new_state: MartingaleState;
  next_position_size: number;
}

export function createInitialState(config: MartingaleConfig): MartingaleState {
  return {
    current_step: 0,
    current_position_size: config.base_position_size,
    total_pnl: 0,
    starting_capital: config.base_position_size,
    halted: false,
    halt_reason: null,
  };
}

/**
 * Calculates the next position size after a trade closes.
 * If the trade was a loss, multiplies position size by the multiplier
 * and increments the step counter. If a win, resets to base size and step 0.
 */
export function processTradeResult(
  state: MartingaleState,
  pnl: number,
  config: MartingaleConfig,
): MartingaleTradeResult {
  if (state.halted) {
    return {
      pnl,
      was_loss: pnl < 0,
      new_state: state,
      next_position_size: 0,
    };
  }

  const was_loss = pnl < 0;
  let newStep = state.current_step;
  let nextSize = state.current_position_size;
  let totalPnl = state.total_pnl + pnl;
  let halted = false;
  let haltReason: string | null = null;

  if (was_loss) {
    newStep = state.current_step + 1;

    if (newStep >= config.max_martingale_steps) {
      halted = true;
      haltReason = `Max martingale steps (${config.max_martingale_steps}) reached. Halting to prevent cascading losses.`;
      nextSize = 0;
    } else {
      nextSize = state.current_position_size * config.martingale_multiplier;
    }
  } else {
    // Win resets the recovery ladder
    newStep = 0;
    nextSize = config.base_position_size;
  }

  // Check global max drawdown
  const drawdownPct = (totalPnl / state.starting_capital) * 100;
  if (drawdownPct <= -config.max_drawdown_pct) {
    halted = true;
    haltReason = `Max drawdown (${config.max_drawdown_pct}%) breached. Halting immediately.`;
    nextSize = 0;
  }

  const newState: MartingaleState = {
    current_step: newStep,
    current_position_size: nextSize,
    total_pnl: totalPnl,
    starting_capital: state.starting_capital,
    halted,
    halt_reason: haltReason,
  };

  return {
    pnl,
    was_loss,
    new_state: newState,
    next_position_size: nextSize,
  };
}

/**
 * Simulates a full martingale sequence given an array of trade outcomes (as percentages).
 * Returns the final state and an array of position sizes used per trade.
 */
export function simulateMartingale(
  config: MartingaleConfig,
  tradeOutcomesPct: number[],
): { finalState: MartingaleState; positionSizes: number[]; pnls: number[] } {
  let state = createInitialState(config);
  const positionSizes: number[] = [];
  const pnls: number[] = [];

  for (const outcomePct of tradeOutcomesPct) {
    if (state.halted) break;
    const tradePnl = (state.current_position_size * outcomePct) / 100;
    const result = processTradeResult(state, tradePnl, config);
    positionSizes.push(state.current_position_size);
    pnls.push(tradePnl);
    state = result.new_state;
  }

  return { finalState: state, positionSizes, pnls };
}

/**
 * Validates that user-provided martingale parameters do not exceed
 * the admin-defined ceiling from the bot template.
 */
export function validateMartingaleParams(
  userMultiplier: number,
  userSteps: number,
  adminMaxMultiplier: number,
  adminMaxSteps: number,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (userMultiplier <= 0) {
    errors.push('Multiplier must be greater than 0.');
  }
  if (userMultiplier > adminMaxMultiplier) {
    errors.push(`Multiplier ${userMultiplier}x exceeds admin ceiling of ${adminMaxMultiplier}x.`);
  }
  if (userSteps < 1) {
    errors.push('Steps must be at least 1.');
  }
  if (userSteps > adminMaxSteps) {
    errors.push(`Steps ${userSteps} exceeds admin ceiling of ${adminMaxSteps}.`);
  }

  return { valid: errors.length === 0, errors };
}
