/*
# Add Custom Bot Exchange, Trading Pairs, and Risk-Based Sizing Fields

## Purpose
Extends the `strategy_settings` JSONB column on `bot_templates` to support
the new Custom Bot Builder features: exchange selection, trading pairs,
risk-per-trade percentage, and max notional cap.

## Changes
1. The `strategy_settings` JSONB column already exists on `bot_templates`.
   No new columns needed — the JSONB column flexibly stores the new keys:
   - `exchange` (text) — selected exchange name
   - `trading_pairs` (text[]) — list of trading pair symbols
   - `risk_per_trade_pct` (numeric) — risk percentage for risk-based sizing
   - `max_notional` (numeric) — maximum notional position size cap

2. Creates a new RPC function `increment_daily_trade_count` that atomically
   increments a bot's daily trade counter using a advisory lock to prevent
   race conditions from concurrent workers. Returns -1 if the max has been
   reached, otherwise returns the new count.

## Security
- No new tables created.
- No RLS policy changes — existing policies on `bot_templates` remain intact.
- The RPC function is SECURITY DEFINER and owned by the postgres role,
  so it can safely increment counters without exposing the table directly.

## Notes
1. The RPC function uses `pg_advisory_xact_lock` to serialize concurrent
   increments for the same bot, preventing race conditions where two
   workers could both read the count as N and both write N+1.
2. The function accepts `p_bot_id` (uuid) and `p_max_trades` (integer).
3. If the current count is already >= p_max_trades, returns -1 (rejected).
4. Otherwise increments and returns the new count.
*/

-- Ensure the strategy_settings JSONB column exists (it should from prior migrations)
-- The column is already on bot_templates from migration 20261012204809

-- Create atomic increment function for daily trade counts
CREATE OR REPLACE FUNCTION public.increment_daily_trade_count(
  p_bot_id uuid,
  p_max_trades integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count integer;
  v_new_count integer;
  v_lock_key bigint;
BEGIN
  -- Generate a stable lock key from the bot_id using hashtext
  v_lock_key := hashtext(md5(p_bot_id::text));

  -- Acquire a transaction-scoped advisory lock to prevent concurrent race conditions
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Read current daily trade count from the bot's metadata
  SELECT COALESCE(
    (strategy_settings->>'daily_trade_count')::integer,
    0
  ) INTO v_current_count
  FROM public.bot_templates
  WHERE id = p_bot_id;

  -- Check if limit is already reached
  IF v_current_count >= p_max_trades THEN
    RETURN -1;
  END IF;

  -- Increment the count
  v_new_count := v_current_count + 1;

  -- Atomically update the JSONB field
  UPDATE public.bot_templates
  SET strategy_settings = jsonb_set(
    COALESCE(strategy_settings, '{}'::jsonb),
    '{daily_trade_count}',
    to_jsonb(v_new_count)
  )
  WHERE id = p_bot_id;

  RETURN v_new_count;
END;
$$;

-- Grant execute to authenticated and anon roles
GRANT EXECUTE ON FUNCTION public.increment_daily_trade_count(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_daily_trade_count(uuid, integer) TO anon;
