/*
# Create master_traders table for Copy Trading Marketplace

## Summary
Creates the `master_traders` table that powers the Copy Trading Marketplace.
Both the admin panel (AdminApiControl) and user panel (CopyTradingView) read
from this table. Admins have full CRUD; users can only read active traders.

## New Table: master_traders
- `id` (uuid, primary key)
- `name` (text, not null) — display name of the master trader
- `bio` (text, nullable) — short description
- `exchange` (text, nullable) — exchange name (Binance, CoinDCX, etc.)
- `strategy` (text, nullable) — strategy description
- `market` (text, nullable) — spot/futures
- `roi_percentage` (numeric, default 0) — monthly return percentage
- `win_rate` (numeric, default 0) — win rate percentage
- `active_copiers` (integer, default 0) — number of users currently copying
- `risk_level` (text, default 'Medium') — Low/Medium/High
- `max_drawdown` (numeric, nullable) — max drawdown percentage
- `commission_pct` (numeric, default 0) — commission charged to copiers
- `status` (text, default 'active') — active/paused
- `created_at` (timestamptz, default now())

## Security
- RLS enabled
- SELECT: any authenticated user can read rows where status = 'active'
- INSERT/UPDATE/DELETE: admin-only via is_platform_admin()
*/

CREATE TABLE IF NOT EXISTS master_traders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  bio text,
  exchange text,
  strategy text,
  market text DEFAULT 'spot',
  roi_percentage numeric DEFAULT 0,
  win_rate numeric DEFAULT 0,
  active_copiers integer DEFAULT 0,
  risk_level text DEFAULT 'Medium' CHECK (risk_level IN ('Low', 'Medium', 'High')),
  max_drawdown numeric,
  commission_pct numeric DEFAULT 0,
  status text DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE master_traders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_master_traders" ON master_traders;
CREATE POLICY "select_master_traders" ON master_traders
  FOR SELECT TO authenticated
  USING (status = 'active' OR public.is_platform_admin());

DROP POLICY IF EXISTS "insert_master_traders" ON master_traders;
CREATE POLICY "insert_master_traders" ON master_traders
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "update_master_traders" ON master_traders;
CREATE POLICY "update_master_traders" ON master_traders
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "delete_master_traders" ON master_traders;
CREATE POLICY "delete_master_traders" ON master_traders
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

REVOKE ALL ON master_traders FROM anon;