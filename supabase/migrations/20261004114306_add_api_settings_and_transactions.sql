/*
# Add API Settings & Transactions tables for admin panel

## 1. New Tables
- `api_settings` — Stores global external API keys (AI engines, market data, exchange connectors) managed by super admin. Single-row settings table.
- `transactions` — Payment records for license/subscription purchases.

## 2. Columns
### api_settings
- id (uuid PK)
- openai_api_key (text, nullable)
- anthropic_api_key (text, nullable)
- deepseek_api_key (text, nullable)
- coingecko_api_key (text, nullable)
- coinmarketcap_api_key (text, nullable)
- tradingview_license_key (text, nullable)
- binance_api_key (text, nullable)
- binance_api_secret (text, nullable)
- coindcx_api_key (text, nullable)
- coindcx_api_secret (text, nullable)
- delta_api_key (text, nullable)
- delta_api_secret (text, nullable)
- wazirx_api_key (text, nullable)
- wazirx_api_secret (text, nullable)
- pi42_api_key (text, nullable)
- pi42_api_secret (text, nullable)
- created_at, updated_at (timestamptz)

### transactions
- id (uuid PK)
- client_name (text)
- client_email (text, nullable)
- plan_name (text)
- amount (numeric, default 0)
- currency (text, default 'USD')
- status (text: 'completed' | 'pending' | 'failed' | 'refunded')
- payment_method (text, nullable)
- created_at (timestamptz)

## 3. Security
- RLS enabled on both tables.
- Policies: anon + authenticated CRUD (admin panel reads/writes via anon key from the browser).
*/

CREATE TABLE IF NOT EXISTS api_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  openai_api_key text,
  anthropic_api_key text,
  deepseek_api_key text,
  coingecko_api_key text,
  coinmarketcap_api_key text,
  tradingview_license_key text,
  binance_api_key text,
  binance_api_secret text,
  coindcx_api_key text,
  coindcx_api_secret text,
  delta_api_key text,
  delta_api_secret text,
  wazirx_api_key text,
  wazirx_api_secret text,
  pi42_api_key text,
  pi42_api_secret text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE api_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_api_settings" ON api_settings;
CREATE POLICY "anon_select_api_settings" ON api_settings FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_api_settings" ON api_settings;
CREATE POLICY "anon_insert_api_settings" ON api_settings FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_api_settings" ON api_settings;
CREATE POLICY "anon_update_api_settings" ON api_settings FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_api_settings" ON api_settings;
CREATE POLICY "anon_delete_api_settings" ON api_settings FOR DELETE
TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  client_email text,
  plan_name text NOT NULL,
  amount numeric DEFAULT 0,
  currency text DEFAULT 'USD',
  status text DEFAULT 'completed',
  payment_method text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_transactions" ON transactions;
CREATE POLICY "anon_select_transactions" ON transactions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_transactions" ON transactions;
CREATE POLICY "anon_insert_transactions" ON transactions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_transactions" ON transactions;
CREATE POLICY "anon_update_transactions" ON transactions FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_transactions" ON transactions;
CREATE POLICY "anon_delete_transactions" ON transactions FOR DELETE
TO anon, authenticated USING (true);

-- Seed default api_settings row if none exists
INSERT INTO api_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM api_settings);

-- Seed sample transactions
INSERT INTO transactions (client_name, client_email, plan_name, amount, currency, status, payment_method, created_at)
SELECT * FROM UNNEST(
  ARRAY['Li Wei','Yuki Tanaka','Alex Trader','Dmitri Volkov','Fatima Al-Saud','Priya Sharma','Marco Rossi','Carlos Mendez','Li Wei','Yuki Tanaka']::text[],
  ARRAY['li.wei@163.com','yuki.tanaka@gmail.com','alex.trader@gmail.com','dmitri.volkov@yandex.ru','fatima.al@saudi.net','priya.sharma@yahoo.in','marco.rossi@libero.it','carlos.mendez@gmail.com','li.wei@163.com','yuki.tanaka@gmail.com']::text[],
  ARRAY['Enterprise','Enterprise','Enterprise','Pro','Pro','Pro','Pro','Starter','Enterprise','Enterprise']::text[],
  ARRAY[4990,4990,4990,990,990,990,990,290,4990,4990]::numeric[],
  ARRAY['USD','USD','USD','USD','USD','USD','USD','USD','USD','USD']::text[],
  ARRAY['completed','completed','completed','completed','completed','completed','completed','completed','pending','completed']::text[],
  ARRAY['UPI','Bank Transfer','Credit Card','UPI','Credit Card','UPI','Bank Transfer','UPI','Credit Card','Bank Transfer']::text[],
  ARRAY[
    '2026-05-01T10:00:00Z','2026-06-01T10:00:00Z','2026-07-01T10:00:00Z','2026-07-15T10:00:00Z',
    '2026-08-01T10:00:00Z','2026-08-15T10:00:00Z','2026-09-01T10:00:00Z','2026-09-15T10:00:00Z',
    '2026-10-01T10:00:00Z','2026-10-03T10:00:00Z'
  ]::timestamptz[]
)
WHERE NOT EXISTS (SELECT 1 FROM transactions);
