/*
# Create signals table for AI trading signals

## Summary
Creates the `signals` table that powers the Signals page and the
"Latest AI Signals" section on the Dashboard. Admins can create signals;
all authenticated users can read them.

## New Table: signals
- `id` (uuid, primary key)
- `coin` (text, not null) — e.g. BTC, ETH
- `type` (text, not null) — BUY / SELL / HOLD
- `confidence` (integer, default 0) — 0-100 confidence percentage
- `entry` (numeric, not null) — entry price
- `target` (numeric, not null) — target price
- `stop_loss` (numeric, not null) — stop loss price
- `timeframe` (text, not null) — e.g. 4H, 1D
- `source` (text, not null) — AI engine / bot name that generated the signal
- `created_at` (timestamptz, default now())

## Security
- RLS enabled
- SELECT: any authenticated user can read all signals
- INSERT/UPDATE/DELETE: admin-only via is_platform_admin()
*/

CREATE TABLE IF NOT EXISTS signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coin text NOT NULL,
  type text NOT NULL CHECK (type IN ('BUY', 'SELL', 'HOLD')),
  confidence integer NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  entry numeric NOT NULL DEFAULT 0,
  target numeric NOT NULL DEFAULT 0,
  stop_loss numeric NOT NULL DEFAULT 0,
  timeframe text NOT NULL DEFAULT '4H',
  source text NOT NULL DEFAULT 'Cortex AI',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_signals" ON signals;
CREATE POLICY "select_signals" ON signals
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "insert_signals" ON signals;
CREATE POLICY "insert_signals" ON signals
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "update_signals" ON signals;
CREATE POLICY "update_signals" ON signals
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "delete_signals" ON signals;
CREATE POLICY "delete_signals" ON signals
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

REVOKE ALL ON signals FROM anon;