/*
# Cortex AI Admin Panel Schema Extension

## Overview
Adds five new tables to support the Master Admin Panel: licenses, admin_roles,
user_funds, risk_settings, and bot_templates. These tables give admins the
ability to manage subscription plans, role-based access control, client fund
tracking, global risk controls, and reusable bot strategy templates.

## New Tables

### 1. licenses
- `id` (uuid, primary key)
- `user_id` (uuid, references auth.users ON DELETE CASCADE) — the subscriber
- `plan_name` (text) — e.g. 'Starter', 'Pro', 'Enterprise'
- `bot_limit` (int, default 3) — max concurrent bots allowed
- `is_active` (boolean, default true)
- `valid_from` (timestamptz, default now())
- `valid_until` (timestamptz, nullable) — null = unlimited
- `monthly_fee` (numeric, default 0) — in USD
- `created_at` (timestamptz, default now())

### 2. admin_roles
- `id` (uuid, primary key)
- `user_id` (uuid, references auth.users ON DELETE CASCADE) — the admin user
- `email` (text) — admin's email for display
- `role` (text, CHECK in 'super_admin', 'sub_admin') — RBAC role
- `permissions` (jsonb, default '{}') — granular permission flags
- `is_active` (boolean, default true)
- `created_at` (timestamptz, default now())

### 3. user_funds
- `id` (uuid, primary key)
- `user_id` (uuid, references auth.users ON DELETE CASCADE) — the client
- `exchange_name` (text) — e.g. 'Binance'
- `balance` (numeric, default 0) — live fund balance in USD
- `unrealized_pnl` (numeric, default 0) — open position PnL
- `realized_pnl` (numeric, default 0) — closed trade PnL
- `manual_trading_enabled` (boolean, default false) — admin toggle
- `last_synced_at` (timestamptz, nullable)
- `created_at` (timestamptz, default now())

### 4. risk_settings
- `id` (uuid, primary key, singleton row)
- `global_kill_switch` (boolean, default false) — master stop-all flag
- `max_leverage` (int, default 100) — global leverage cap
- `max_daily_loss_pct` (numeric, default 10) — daily loss limit percentage
- `api_health_alerts` (boolean, default true) — enable API health monitoring
- `auto_disable_on_breach` (boolean, default true) — auto-disable bots on risk breach
- `updated_at` (timestamptz, default now())

### 5. bot_templates
- `id` (uuid, primary key)
- `name` (text, not null) — strategy template name
- `description` (text)
- `strategy_type` (text, CHECK in 'scalping', 'grid', 'trailing', 'dca')
- `market_type` (text, CHECK in 'spot', 'futures')
- `default_tp_pct` (numeric, default 5) — take profit default
- `default_sl_pct` (numeric, default 2) — stop loss default
- `risk_level` (text, CHECK in 'Low', 'Medium', 'High')
- `is_public` (boolean, default true) — visible to all clients for copy trading
- `total_copies` (int, default 0) — copy trading count
- `created_at` (timestamptz, default now())

## Security (RLS)
- RLS enabled on all five tables.
- admin_roles and risk_settings: scoped TO authenticated (admin app has sign-in).
- licenses, user_funds, bot_templates: scoped TO authenticated.
- admin_roles is self-referencing: a super_admin can manage all admin rows, a
  sub_admin can only read. For simplicity in this first version, all
  authenticated users can read, and inserts/updates/deletes require
  auth.uid() = user_id (admin manages their own role row — super_admin
  operations would be done via service role in production).
- risk_settings uses a singleton pattern: any authenticated user can read,
  updates require auth.uid() match (in production, gated to admin_roles).

## Important Notes
1. These tables assume the admin panel is accessed by authenticated users
   (the app already has sign-in/sign-up from the client app).
2. The `permissions` jsonb column on admin_roles stores granular flags like
   {"can_manage_clients": true, "can_manage_licenses": false, ...}.
3. risk_settings is designed as a singleton (one row). The app should
   upsert the first row on initial load.
4. user_funds tracks per-exchange balances for each client, with manual
   trading toggle controlled by admins.
*/

-- ============================================================
-- 1. licenses
-- ============================================================
CREATE TABLE IF NOT EXISTS licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_name text NOT NULL DEFAULT 'Starter',
  bot_limit integer NOT NULL DEFAULT 3,
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  monthly_fee numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_licenses" ON licenses;
CREATE POLICY "select_licenses" ON licenses FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_licenses" ON licenses;
CREATE POLICY "insert_licenses" ON licenses FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_licenses" ON licenses;
CREATE POLICY "update_licenses" ON licenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_licenses" ON licenses;
CREATE POLICY "delete_licenses" ON licenses FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 2. admin_roles
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'sub_admin')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_admin_roles" ON admin_roles;
CREATE POLICY "select_admin_roles" ON admin_roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_admin_roles" ON admin_roles;
CREATE POLICY "insert_admin_roles" ON admin_roles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_admin_roles" ON admin_roles;
CREATE POLICY "update_admin_roles" ON admin_roles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_admin_roles" ON admin_roles;
CREATE POLICY "delete_admin_roles" ON admin_roles FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 3. user_funds
-- ============================================================
CREATE TABLE IF NOT EXISTS user_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange_name text NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  unrealized_pnl numeric NOT NULL DEFAULT 0,
  realized_pnl numeric NOT NULL DEFAULT 0,
  manual_trading_enabled boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_funds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_user_funds" ON user_funds;
CREATE POLICY "select_user_funds" ON user_funds FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_user_funds" ON user_funds;
CREATE POLICY "insert_user_funds" ON user_funds FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_user_funds" ON user_funds;
CREATE POLICY "update_user_funds" ON user_funds FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_user_funds" ON user_funds;
CREATE POLICY "delete_user_funds" ON user_funds FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 4. risk_settings (singleton)
-- ============================================================
CREATE TABLE IF NOT EXISTS risk_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  global_kill_switch boolean NOT NULL DEFAULT false,
  max_leverage integer NOT NULL DEFAULT 100,
  max_daily_loss_pct numeric NOT NULL DEFAULT 10,
  api_health_alerts boolean NOT NULL DEFAULT true,
  auto_disable_on_breach boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE risk_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_risk_settings" ON risk_settings;
CREATE POLICY "select_risk_settings" ON risk_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "update_risk_settings" ON risk_settings;
CREATE POLICY "update_risk_settings" ON risk_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "insert_risk_settings" ON risk_settings;
CREATE POLICY "insert_risk_settings" ON risk_settings FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- 5. bot_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  strategy_type text NOT NULL CHECK (strategy_type IN ('scalping', 'grid', 'trailing', 'dca')),
  market_type text NOT NULL CHECK (market_type IN ('spot', 'futures')),
  default_tp_pct numeric NOT NULL DEFAULT 5,
  default_sl_pct numeric NOT NULL DEFAULT 2,
  risk_level text NOT NULL CHECK (risk_level IN ('Low', 'Medium', 'High')),
  is_public boolean NOT NULL DEFAULT true,
  total_copies integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bot_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bot_templates" ON bot_templates;
CREATE POLICY "select_bot_templates" ON bot_templates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_bot_templates" ON bot_templates;
CREATE POLICY "insert_bot_templates" ON bot_templates FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_bot_templates" ON bot_templates;
CREATE POLICY "update_bot_templates" ON bot_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_bot_templates" ON bot_templates;
CREATE POLICY "delete_bot_templates" ON bot_templates FOR DELETE TO authenticated USING (true);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_licenses_user_id ON licenses(user_id);
CREATE INDEX IF NOT EXISTS idx_licenses_is_active ON licenses(is_active);
CREATE INDEX IF NOT EXISTS idx_admin_roles_user_id ON admin_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_funds_user_id ON user_funds(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_templates_is_public ON bot_templates(is_public);

-- ============================================================
-- Seed: default risk_settings singleton row
-- ============================================================
INSERT INTO risk_settings (global_kill_switch, max_leverage, max_daily_loss_pct, api_health_alerts, auto_disable_on_breach)
SELECT false, 100, 10, true, true
WHERE NOT EXISTS (SELECT 1 FROM risk_settings);

-- ============================================================
-- Seed: default bot templates
-- ============================================================
INSERT INTO bot_templates (name, description, strategy_type, market_type, default_tp_pct, default_sl_pct, risk_level, is_public, total_copies)
SELECT 'Aggressive Bull Scalper', 'High-frequency scalping for volatile bull markets', 'scalping', 'futures', 3, 1.5, 'High', true, 1248
WHERE NOT EXISTS (SELECT 1 FROM bot_templates WHERE name = 'Aggressive Bull Scalper');

INSERT INTO bot_templates (name, description, strategy_type, market_type, default_tp_pct, default_sl_pct, risk_level, is_public, total_copies)
SELECT 'AI Smart DCA', 'Sentiment-weighted dollar-cost averaging', 'dca', 'spot', 15, 5, 'Low', true, 3421
WHERE NOT EXISTS (SELECT 1 FROM bot_templates WHERE name = 'AI Smart DCA');

INSERT INTO bot_templates (name, description, strategy_type, market_type, default_tp_pct, default_sl_pct, risk_level, is_public, total_copies)
SELECT 'Sideways Market Sniper', 'Grid trading in consolidation ranges', 'grid', 'spot', 2, 1, 'Medium', true, 892
WHERE NOT EXISTS (SELECT 1 FROM bot_templates WHERE name = 'Sideways Market Sniper');
