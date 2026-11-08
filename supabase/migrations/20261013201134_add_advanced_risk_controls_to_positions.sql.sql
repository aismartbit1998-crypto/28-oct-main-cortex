/*
 * Add advanced risk control columns to the positions table.
 *
 * The trades table already has these 6 columns (fixed_profit, fixed_loss,
 * max_trades_per_day, max_daily_loss, max_daily_profit, trailing_stop_loss)
 * but they were dead — nothing reads or enforces them.
 *
 * This migration propagates the same columns to the positions table so
 * the monitor-positions edge function can enforce them on every tick.
 * When a trade is executed (manually or via strategy-runner), these
 * values are copied from the trades/bots config into the positions row.
 */

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS fixed_profit numeric,
  ADD COLUMN IF NOT EXISTS fixed_loss numeric,
  ADD COLUMN IF NOT EXISTS max_trades_per_day integer,
  ADD COLUMN IF NOT EXISTS max_daily_loss numeric,
  ADD COLUMN IF NOT EXISTS max_daily_profit numeric,
  ADD COLUMN IF NOT EXISTS trailing_stop_loss_pct numeric;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_fixed_profit_nonnegative') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_fixed_profit_nonnegative CHECK (fixed_profit IS NULL OR fixed_profit >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_fixed_loss_nonnegative') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_fixed_loss_nonnegative CHECK (fixed_loss IS NULL OR fixed_loss >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_max_trades_per_day_positive') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_max_trades_per_day_positive CHECK (max_trades_per_day IS NULL OR max_trades_per_day >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_max_daily_loss_nonnegative') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_max_daily_loss_nonnegative CHECK (max_daily_loss IS NULL OR max_daily_loss >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_max_daily_profit_nonnegative') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_max_daily_profit_nonnegative CHECK (max_daily_profit IS NULL OR max_daily_profit >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_trailing_stop_loss_pct_nonnegative') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_trailing_stop_loss_pct_nonnegative CHECK (trailing_stop_loss_pct IS NULL OR trailing_stop_loss_pct >= 0);
  END IF;
END $$;

-- Index for fast daily P&L aggregation queries
CREATE INDEX IF NOT EXISTS idx_positions_user_status_closed ON positions(user_id, status, closed_at);
