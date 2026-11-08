ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS trailing_stop_loss numeric;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_trailing_stop_loss_nonnegative') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_trailing_stop_loss_nonnegative CHECK (trailing_stop_loss IS NULL OR trailing_stop_loss >= 0);
  END IF;
END $$;