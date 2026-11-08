/*
# Phase 2: Add 'cooldown' bot status + take_profit_amount column for Golden Logic

1. Changes
- Adds 'cooldown' to the bots status CHECK constraint so the engine can
  park a bot after daily loss/profit limits are breached.
- Adds `take_profit_amount` (numeric, nullable) to the positions table.
  This stores the dynamically adjusted take-profit price that trails
  alongside the trailing stop loss (the "Golden Logic" — when price moves
  favorably, both the stop loss AND the take profit shift by the same
  favorable distance).
2. Security
- No RLS or policy changes.
*/

ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_status_check;
ALTER TABLE bots ADD CONSTRAINT bots_status_check
  CHECK (status = ANY (ARRAY['running', 'paused', 'idle', 'paper', 'inactive', 'cooldown']));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'positions' AND column_name = 'take_profit_amount'
  ) THEN
    ALTER TABLE positions ADD COLUMN take_profit_amount numeric;
  END IF;
END $$;
