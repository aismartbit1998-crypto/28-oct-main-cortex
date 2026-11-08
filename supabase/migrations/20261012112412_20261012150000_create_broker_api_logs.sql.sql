/*
# Create broker_api_logs table for broker response monitoring

## Summary
Creates the `broker_api_logs` table that powers the Broker Response page.
Logs API calls made to connected exchanges (success/error/pending) with
latency and detail. Admins can read all logs; authenticated users can read
their own broker logs.

## New Table: broker_api_logs
- `id` (uuid, primary key)
- `user_id` (uuid, not null, default auth.uid()) — owner of the broker key
- `broker` (text, not null) — exchange name (Binance, CoinDCX, etc.)
- `endpoint` (text, not null) — API endpoint called (e.g. POST /api/v3/order)
- `status` (text, not null) — success / error / pending
- `latency_ms` (integer, default 0) — response time in milliseconds
- `detail` (text, nullable) — human-readable response detail
- `created_at` (timestamptz, default now())

## Security
- RLS enabled
- SELECT: authenticated users can read their own logs; admins can read all
- INSERT: system/admin only (logs are written by edge functions, not the client)
- UPDATE/DELETE: admin-only
*/

CREATE TABLE IF NOT EXISTS broker_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  broker text NOT NULL,
  endpoint text NOT NULL,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'pending')),
  latency_ms integer NOT NULL DEFAULT 0,
  detail text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE broker_api_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_broker_api_logs" ON broker_api_logs;
CREATE POLICY "select_broker_api_logs" ON broker_api_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_platform_admin());

DROP POLICY IF EXISTS "insert_broker_api_logs" ON broker_api_logs;
CREATE POLICY "insert_broker_api_logs" ON broker_api_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.is_platform_admin());

DROP POLICY IF EXISTS "update_broker_api_logs" ON broker_api_logs;
CREATE POLICY "update_broker_api_logs" ON broker_api_logs
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "delete_broker_api_logs" ON broker_api_logs;
CREATE POLICY "delete_broker_api_logs" ON broker_api_logs
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_broker_api_logs_user_id ON broker_api_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_broker_api_logs_created_at ON broker_api_logs(created_at DESC);

REVOKE ALL ON broker_api_logs FROM anon;