/*
# Add advanced manual-trade risk controls

1. Purpose
- Extends the existing `trades` table so manually executed client trades can carry optional institutional-style risk limits.

2. Modified Table: `trades`
- `fixed_profit` (numeric, nullable) — optional fixed profit target amount.
- `fixed_loss` (numeric, nullable) — optional fixed loss stop amount.
- `max_trades_per_day` (integer, nullable) — optional maximum number of trades allowed for the client in one day.
- `max_daily_loss` (numeric, nullable) — optional daily loss threshold.
- `max_daily_profit` (numeric, nullable) — optional daily profit threshold at which trading should stop.

3. Data integrity
- Optional values remain nullable so existing trades continue to work unchanged.
- When supplied, all five values must be zero or greater.
- `max_trades_per_day` must be a whole number.

4. Security
- No new table or access policy is introduced.
- Existing `trades` row-level security and authenticated admin trade workflow remain unchanged.

5. Important notes
- These columns persist the controls selected in the manual trade modal for downstream monitoring and enforcement.
- This migration only adds columns and constraints; it does not remove or alter existing trade data.
*/

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS fixed_profit numeric,
  ADD COLUMN IF NOT EXISTS fixed_loss numeric,
  ADD COLUMN IF NOT EXISTS max_trades_per_day integer,
  ADD COLUMN IF NOT EXISTS max_daily_loss numeric,
  ADD COLUMN IF NOT EXISTS max_daily_profit numeric;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_fixed_profit_nonnegative') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_fixed_profit_nonnegative CHECK (fixed_profit IS NULL OR fixed_profit >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_fixed_loss_nonnegative') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_fixed_loss_nonnegative CHECK (fixed_loss IS NULL OR fixed_loss >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_max_trades_per_day_positive') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_max_trades_per_day_positive CHECK (max_trades_per_day IS NULL OR max_trades_per_day >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_max_daily_loss_nonnegative') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_max_daily_loss_nonnegative CHECK (max_daily_loss IS NULL OR max_daily_loss >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_max_daily_profit_nonnegative') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_max_daily_profit_nonnegative CHECK (max_daily_profit IS NULL OR max_daily_profit >= 0);
  END IF;
END $$;