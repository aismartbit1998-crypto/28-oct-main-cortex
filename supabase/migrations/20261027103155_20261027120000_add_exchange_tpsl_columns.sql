-- Add columns to track CoinDCX exchange-side TP/SL orders on positions.
-- exchange_position_id: CoinDCX's internal position UUID (needed for create_tpsl API)
-- exchange_sl_order_id: The stop-loss order ID returned by create_tpsl
-- exchange_tp_order_id: The take-profit order ID returned by create_tpsl
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS exchange_position_id text,
  ADD COLUMN IF NOT EXISTS exchange_sl_order_id text,
  ADD COLUMN IF NOT EXISTS exchange_tp_order_id text;