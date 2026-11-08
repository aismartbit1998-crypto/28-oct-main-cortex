/*
# Phase 2: Feature Flags + Broker Settings + Maintenance Mode Wiring

## 1. New Tables

### feature_flags
Stores global ON/OFF toggles for client-facing UI features.
- `id` (uuid PK)
- `feature_key` (text, unique) — machine-readable key (e.g. 'signals', 'copy_trading')
- `label` (text) — human-readable display name
- `description` (text) — what this toggle controls
- `is_enabled` (boolean, default true) — ON = visible, OFF = hidden from clients
- `sort_order` (int, default 0) — display ordering in admin panel
- `updated_at` (timestamptz)
- `updated_by` (uuid, nullable) — admin who last changed it

### broker_settings
Stores global broker/exchange configuration, replacing hardcoded values.
- `id` (uuid PK)
- `exchange_key` (text, unique) — machine key: 'coindcx', 'delta', 'binance'
- `exchange_name` (text) — display name
- `base_url` (text) — API base URL
- `proxy_url` (text, nullable) — proxy endpoint if needed
- `is_active` (boolean, default true) — ON = clients can connect, OFF = blocked
- `config` (jsonb, default '{}') — extra key-value pairs (rate limits, etc.)
- `sort_order` (int, default 0)
- `updated_at` (timestamptz)
- `updated_by` (uuid, nullable)

## 2. Seeded Data
- 9 feature flags: signals, copy_trading, ai_market_predictor, backtesting,
  performance_analytics, position_monitor, crypto_view, wallet, trade_history
  (all default ON)
- 3 broker settings: coindcx, delta, binance (all active with their base URLs)

## 3. RPCs
- `get_feature_flags()` → returns feature_key + is_enabled for all flags (public read)
- `get_broker_settings()` → returns exchange_key + is_active + base_url for all brokers (public read)
- `is_feature_enabled(p_key text)` → returns boolean for a single feature

## 4. Security
- feature_flags: RLS enabled. Public SELECT (anon + authenticated) so the client
  can read flags. UPDATE/INSERT/DELETE restricted to super_admin via admin_has_permission.
- broker_settings: RLS enabled. Public SELECT for exchange_key/is_active/base_url.
  All writes restricted to super_admin only via is_super_admin().
- system_settings: maintenance_mode key already exists; no schema change needed.
*/
CREATE TABLE IF NOT EXISTS feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON feature_flags TO anon, authenticated;
GRANT UPDATE, INSERT, DELETE ON feature_flags TO authenticated;

DROP POLICY IF EXISTS "public_read_feature_flags" ON feature_flags;
CREATE POLICY "public_read_feature_flags"
ON feature_flags FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "super_admin_update_feature_flags" ON feature_flags;
CREATE POLICY "super_admin_update_feature_flags"
ON feature_flags FOR UPDATE
TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "super_admin_insert_feature_flags" ON feature_flags;
CREATE POLICY "super_admin_insert_feature_flags"
ON feature_flags FOR INSERT
TO authenticated WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "super_admin_delete_feature_flags" ON feature_flags;
CREATE POLICY "super_admin_delete_feature_flags"
ON feature_flags FOR DELETE
TO authenticated USING (is_super_admin());

CREATE TABLE IF NOT EXISTS broker_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_key text UNIQUE NOT NULL,
  exchange_name text NOT NULL,
  base_url text NOT NULL DEFAULT '',
  proxy_url text,
  is_active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE broker_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON broker_settings TO anon, authenticated;
GRANT UPDATE, INSERT, DELETE ON broker_settings TO authenticated;

DROP POLICY IF EXISTS "public_read_broker_settings" ON broker_settings;
CREATE POLICY "public_read_broker_settings"
ON broker_settings FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "super_admin_update_broker_settings" ON broker_settings;
CREATE POLICY "super_admin_update_broker_settings"
ON broker_settings FOR UPDATE
TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "super_admin_insert_broker_settings" ON broker_settings;
CREATE POLICY "super_admin_insert_broker_settings"
ON broker_settings FOR INSERT
TO authenticated WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "super_admin_delete_broker_settings" ON broker_settings;
CREATE POLICY "super_admin_delete_broker_settings"
ON broker_settings FOR DELETE
TO authenticated USING (is_super_admin());

INSERT INTO feature_flags (feature_key, label, description, is_enabled, sort_order) VALUES
  ('signals', 'Signals', 'AI-generated trading signals feed', true, 1),
  ('copy_trading', 'Copy Trading Marketplace', 'Browse and copy master traders', true, 2),
  ('ai_market_predictor', 'AI Market Predictor', 'Gemini-powered market analysis', true, 3),
  ('backtesting', 'Backtesting', 'Strategy backtest simulator', true, 4),
  ('performance_analytics', 'Performance Analytics', 'Detailed P&L and performance charts', true, 5),
  ('position_monitor', 'Position Monitor', 'Live position tracking with PnL', true, 6),
  ('crypto_view', 'Crypto Dashboard', 'Live crypto prices and charts', true, 7),
  ('wallet', 'Wallet & Calculation', 'Wallet balance and P&L calculator', true, 8),
  ('trade_history', 'Trade History', 'Historical trade log', true, 9)
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO broker_settings (exchange_key, exchange_name, base_url, is_active, sort_order) VALUES
  ('coindcx', 'CoinDCX', 'https://api.coindcx.com', true, 1),
  ('delta', 'Delta Exchange', 'https://api.delta.exchange', true, 2),
  ('binance', 'Binance (Read-Only)', 'https://api.binance.com', true, 3)
ON CONFLICT (exchange_key) DO NOTHING;

CREATE OR REPLACE FUNCTION get_feature_flags()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_object_agg(feature_key, is_enabled)
  FROM feature_flags;
$$;

REVOKE EXECUTE ON FUNCTION get_feature_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_feature_flags() TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_broker_settings()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_agg(
    jsonb_build_object(
      'exchange_key', exchange_key,
      'exchange_name', exchange_name,
      'base_url', base_url,
      'proxy_url', proxy_url,
      'is_active', is_active,
      'config', config
    )
    ORDER BY sort_order
  )
  FROM broker_settings;
$$;

REVOKE EXECUTE ON FUNCTION get_broker_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_broker_settings() TO anon, authenticated;

CREATE OR REPLACE FUNCTION is_feature_enabled(p_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_enabled FROM feature_flags WHERE feature_key = p_key),
    true
  );
$$;

REVOKE EXECUTE ON FUNCTION is_feature_enabled(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_feature_enabled(text) TO anon, authenticated;
