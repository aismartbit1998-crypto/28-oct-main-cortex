/*
# Tighten RLS Security Policies

## Summary
Replaces all overly-permissive RLS policies (`USING (true)`) with proper
ownership-scoped or admin-scoped predicates across 9 tables. Also removes
the dangerous `anon` role grants that allowed unauthenticated users to
read/write trades and client_updates.

## Security Changes

### New helper function: `is_platform_admin()`
A SECURITY DEFINER function that checks whether the calling authenticated
user has an active row in `admin_roles` (matched by `user_id` OR `email`).
Used by policies on admin-only tables. Returns `true` when no admin rows
exist yet (bootstrap case — the first authenticated user can self-provision).

### Tables modified (policies dropped and recreated):

1. **admin_roles** — SELECT open to authenticated; INSERT/UPDATE/DELETE
   require `is_platform_admin()`.
2. **admin_activity_log** — SELECT requires admin; INSERT open to
   authenticated (admins log their own actions); UPDATE/DELETE admin-only.
3. **risk_settings** — SELECT open to authenticated (user panel reads kill
   switch); INSERT/UPDATE admin-only.
4. **bot_templates** — SELECT open to authenticated (users browse templates);
   INSERT/UPDATE/DELETE admin-only.
5. **user_funds** — SELECT/INSERT scoped to own user OR admin; UPDATE/DELETE
   admin-only.
6. **licenses** — SELECT scoped to own user OR admin; INSERT/UPDATE/DELETE
   admin-only.
7. **trades** — SELECT scoped to `client_id = auth.uid()` OR admin;
   INSERT/UPDATE/DELETE admin-only. All `anon` policies dropped.
8. **client_updates** — SELECT scoped to `client_id = auth.uid()` OR admin;
   INSERT/UPDATE/DELETE admin-only. All `anon` policies dropped.
9. **transactions** — All CRUD admin-only.
10. **api_settings** — All CRUD admin-only (contains API keys).

## Important Notes
1. The `anon` role loses ALL access to `trades`, `client_updates`,
   `transactions`, and `api_settings`. Only authenticated users with
   proper ownership or admin role can access these tables.
2. The `is_platform_admin()` function returns true when `admin_roles` is
   empty, allowing the first user to bootstrap themselves as admin.
3. No data is lost — only policies are changed.
*/

-- ============================================================
-- 1. Helper function: is_platform_admin()
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_roles ar
    WHERE ar.is_active = true
    AND (
      ar.user_id = auth.uid()
      OR ar.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  ) OR NOT EXISTS (SELECT 1 FROM admin_roles);
$$;

-- ============================================================
-- 2. admin_roles
-- ============================================================

DROP POLICY IF EXISTS "select_admin_roles" ON admin_roles;
DROP POLICY IF EXISTS "insert_admin_roles" ON admin_roles;
DROP POLICY IF EXISTS "update_admin_roles" ON admin_roles;
DROP POLICY IF EXISTS "delete_admin_roles" ON admin_roles;

CREATE POLICY "select_admin_roles" ON admin_roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insert_admin_roles" ON admin_roles
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());

CREATE POLICY "update_admin_roles" ON admin_roles
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "delete_admin_roles" ON admin_roles
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ============================================================
-- 3. admin_activity_log
-- ============================================================

DROP POLICY IF EXISTS "select_admin_activity_log" ON admin_activity_log;
DROP POLICY IF EXISTS "insert_admin_activity_log" ON admin_activity_log;
DROP POLICY IF EXISTS "update_admin_activity_log" ON admin_activity_log;
DROP POLICY IF EXISTS "delete_admin_activity_log" ON admin_activity_log;

CREATE POLICY "select_admin_activity_log" ON admin_activity_log
  FOR SELECT TO authenticated USING (public.is_platform_admin());

CREATE POLICY "insert_admin_activity_log" ON admin_activity_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "update_admin_activity_log" ON admin_activity_log
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "delete_admin_activity_log" ON admin_activity_log
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ============================================================
-- 4. risk_settings
-- ============================================================

DROP POLICY IF EXISTS "select_risk_settings" ON risk_settings;
DROP POLICY IF EXISTS "insert_risk_settings" ON risk_settings;
DROP POLICY IF EXISTS "update_risk_settings" ON risk_settings;

CREATE POLICY "select_risk_settings" ON risk_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insert_risk_settings" ON risk_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());

CREATE POLICY "update_risk_settings" ON risk_settings
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ============================================================
-- 5. bot_templates
-- ============================================================

DROP POLICY IF EXISTS "select_bot_templates" ON bot_templates;
DROP POLICY IF EXISTS "insert_bot_templates" ON bot_templates;
DROP POLICY IF EXISTS "update_bot_templates" ON bot_templates;
DROP POLICY IF EXISTS "delete_bot_templates" ON bot_templates;

CREATE POLICY "select_bot_templates" ON bot_templates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insert_bot_templates" ON bot_templates
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());

CREATE POLICY "update_bot_templates" ON bot_templates
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "delete_bot_templates" ON bot_templates
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ============================================================
-- 6. user_funds
-- ============================================================

DROP POLICY IF EXISTS "select_user_funds" ON user_funds;
DROP POLICY IF EXISTS "insert_user_funds" ON user_funds;
DROP POLICY IF EXISTS "update_user_funds" ON user_funds;
DROP POLICY IF EXISTS "delete_user_funds" ON user_funds;

CREATE POLICY "select_user_funds" ON user_funds
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_platform_admin());

CREATE POLICY "insert_user_funds" ON user_funds
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.is_platform_admin());

CREATE POLICY "update_user_funds" ON user_funds
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "delete_user_funds" ON user_funds
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ============================================================
-- 7. licenses
-- ============================================================

DROP POLICY IF EXISTS "select_licenses" ON licenses;
DROP POLICY IF EXISTS "insert_licenses" ON licenses;
DROP POLICY IF EXISTS "update_licenses" ON licenses;
DROP POLICY IF EXISTS "delete_licenses" ON licenses;

CREATE POLICY "select_licenses" ON licenses
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_platform_admin());

CREATE POLICY "insert_licenses" ON licenses
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "update_licenses" ON licenses
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "delete_licenses" ON licenses
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ============================================================
-- 8. trades — remove ALL anon policies, scope to client_id or admin
-- ============================================================

DROP POLICY IF EXISTS "select_trades" ON trades;
DROP POLICY IF EXISTS "insert_trades" ON trades;
DROP POLICY IF EXISTS "update_trades" ON trades;
DROP POLICY IF EXISTS "delete_trades" ON trades;
DROP POLICY IF EXISTS "trades_select_open" ON trades;
DROP POLICY IF EXISTS "trades_insert_open" ON trades;
DROP POLICY IF EXISTS "trades_update_open" ON trades;

CREATE POLICY "select_trades" ON trades
  FOR SELECT TO authenticated
  USING (auth.uid() = client_id OR public.is_platform_admin());

CREATE POLICY "insert_trades" ON trades
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "update_trades" ON trades
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "delete_trades" ON trades
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ============================================================
-- 9. client_updates — remove ALL anon policies, scope to client_id or admin
-- ============================================================

DROP POLICY IF EXISTS "select_client_updates" ON client_updates;
DROP POLICY IF EXISTS "insert_client_updates" ON client_updates;
DROP POLICY IF EXISTS "update_client_updates" ON client_updates;
DROP POLICY IF EXISTS "delete_client_updates" ON client_updates;
DROP POLICY IF EXISTS "client_updates_select_open" ON client_updates;
DROP POLICY IF EXISTS "client_updates_insert_open" ON client_updates;
DROP POLICY IF EXISTS "client_updates_update_open" ON client_updates;

CREATE POLICY "select_client_updates" ON client_updates
  FOR SELECT TO authenticated
  USING (auth.uid() = client_id OR public.is_platform_admin());

CREATE POLICY "insert_client_updates" ON client_updates
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "update_client_updates" ON client_updates
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "delete_client_updates" ON client_updates
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ============================================================
-- 10. transactions — admin-only
-- ============================================================

DROP POLICY IF EXISTS "anon_select_transactions" ON transactions;
DROP POLICY IF EXISTS "anon_insert_transactions" ON transactions;
DROP POLICY IF EXISTS "anon_update_transactions" ON transactions;
DROP POLICY IF EXISTS "anon_delete_transactions" ON transactions;

CREATE POLICY "select_transactions" ON transactions
  FOR SELECT TO authenticated USING (public.is_platform_admin());

CREATE POLICY "insert_transactions" ON transactions
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());

CREATE POLICY "update_transactions" ON transactions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "delete_transactions" ON transactions
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ============================================================
-- 11. api_settings — admin-only (contains API keys)
-- ============================================================

DROP POLICY IF EXISTS "anon_select_api_settings" ON api_settings;
DROP POLICY IF EXISTS "anon_insert_api_settings" ON api_settings;
DROP POLICY IF EXISTS "anon_update_api_settings" ON api_settings;
DROP POLICY IF EXISTS "anon_delete_api_settings" ON api_settings;

CREATE POLICY "select_api_settings" ON api_settings
  FOR SELECT TO authenticated USING (public.is_platform_admin());

CREATE POLICY "insert_api_settings" ON api_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());

CREATE POLICY "update_api_settings" ON api_settings
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "delete_api_settings" ON api_settings
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ============================================================
-- 12. Revoke anon grants on tables that should be authenticated-only
-- ============================================================

REVOKE ALL ON admin_activity_log FROM anon;
REVOKE ALL ON admin_roles FROM anon;
REVOKE ALL ON api_settings FROM anon;
REVOKE ALL ON bot_templates FROM anon;
REVOKE ALL ON client_updates FROM anon;
REVOKE ALL ON licenses FROM anon;
REVOKE ALL ON risk_settings FROM anon;
REVOKE ALL ON trades FROM anon;
REVOKE ALL ON transactions FROM anon;
REVOKE ALL ON user_funds FROM anon;