/*
# Phase 1 Security: permissions enforcement, api_settings lockdown, append-only activity log

## Summary
Fixes 3 P0 critical security vulnerabilities:
1. is_platform_admin() returns text (role name), not boolean — existing policies use it as
   boolean which is wrong. Sub-admins get same powers as super_admin because the role text
   is truthy. Now using is_super_admin() (boolean) for admin-only writes.
2. api_settings readable by any admin — now restricted to super_admin only.
3. admin_activity_log editable/deletable by any admin — now append-only.

## Changes
- admin_roles INSERT/UPDATE/DELETE: require is_super_admin() (boolean)
- api_settings ALL CRUD: require is_super_admin() (boolean)
- admin_activity_log: UPDATE/DELETE denied to ALL (append-only); INSERT requires is_platform_admin() IS NOT NULL
- risk_settings, bot_templates, licenses, user_funds, trades, client_updates, transactions:
  write policies use new admin_has_permission() which enforces permissions JSONB server-side.
- New admin_has_permission(perm_key) function: returns true for super_admin, checks JSONB for sub_admin.
- New log_admin_action() SECURITY DEFINER function: appends to activity log with real auth.uid().
*/

-- ============================================================
-- 1. admin_has_permission(perm_key) — check permissions JSONB server-side
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_has_permission(perm_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
  OR (
    EXISTS (
      SELECT 1 FROM admin_roles ar
      WHERE ar.is_active = true
      AND ar.role = 'sub_admin'
      AND (
        ar.user_id = auth.uid()
        OR ar.email = (SELECT email FROM auth.users WHERE id = auth.uid())
      )
      AND COALESCE(
        (ar.permissions ->> perm_key)::boolean,
        false
      ) = true
    )
  );
$$;

-- ============================================================
-- 2. log_admin_action() — secure append-only logger
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action_type text,
  p_message text,
  p_severity text DEFAULT 'info',
  p_admin_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  SELECT COALESCE(p_admin_name, name) INTO v_name FROM admin_roles
    WHERE user_id = auth.uid() AND is_active = true LIMIT 1;

  INSERT INTO admin_activity_log (admin_email, admin_name, action_type, message, severity)
  VALUES (
    COALESCE(v_email, 'unknown'),
    COALESCE(v_name, p_admin_name, 'Unknown'),
    p_action_type,
    p_message,
    p_severity
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_admin_action(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_action(text, text, text, text) TO authenticated;

-- ============================================================
-- 3. RLS POLICY UPDATES
-- ============================================================

-- 3a. admin_roles — INSERT/UPDATE/DELETE require super_admin
DROP POLICY IF EXISTS "insert_admin_roles" ON admin_roles;
DROP POLICY IF EXISTS "update_admin_roles" ON admin_roles;
DROP POLICY IF EXISTS "delete_admin_roles" ON admin_roles;

CREATE POLICY "insert_admin_roles" ON admin_roles
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

CREATE POLICY "update_admin_roles" ON admin_roles
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "delete_admin_roles" ON admin_roles
  FOR DELETE TO authenticated USING (public.is_super_admin());

-- 3b. api_settings — ALL CRUD super_admin only
DROP POLICY IF EXISTS "select_api_settings" ON api_settings;
DROP POLICY IF EXISTS "insert_api_settings" ON api_settings;
DROP POLICY IF EXISTS "update_api_settings" ON api_settings;
DROP POLICY IF EXISTS "delete_api_settings" ON api_settings;

CREATE POLICY "select_api_settings" ON api_settings
  FOR SELECT TO authenticated USING (public.is_super_admin());

CREATE POLICY "insert_api_settings" ON api_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

CREATE POLICY "update_api_settings" ON api_settings
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "delete_api_settings" ON api_settings
  FOR DELETE TO authenticated USING (public.is_super_admin());

-- 3c. admin_activity_log — APPEND-ONLY
DROP POLICY IF EXISTS "select_admin_activity_log" ON admin_activity_log;
DROP POLICY IF EXISTS "insert_admin_activity_log" ON admin_activity_log;
DROP POLICY IF EXISTS "update_admin_activity_log" ON admin_activity_log;
DROP POLICY IF EXISTS "delete_admin_activity_log" ON admin_activity_log;

CREATE POLICY "select_admin_activity_log" ON admin_activity_log
  FOR SELECT TO authenticated USING (public.is_platform_admin() IS NOT NULL);

CREATE POLICY "insert_admin_activity_log" ON admin_activity_log
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin() IS NOT NULL);

CREATE POLICY "update_admin_activity_log" ON admin_activity_log
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "delete_admin_activity_log" ON admin_activity_log
  FOR DELETE TO authenticated USING (false);

-- 3d. risk_settings — write requires can_manage_risk permission
DROP POLICY IF EXISTS "insert_risk_settings" ON risk_settings;
DROP POLICY IF EXISTS "update_risk_settings" ON risk_settings;

CREATE POLICY "insert_risk_settings" ON risk_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.admin_has_permission('can_manage_risk'));

CREATE POLICY "update_risk_settings" ON risk_settings
  FOR UPDATE TO authenticated
  USING (public.admin_has_permission('can_manage_risk'))
  WITH CHECK (public.admin_has_permission('can_manage_risk'));

-- 3e. bot_templates — write requires can_edit_bots permission
DROP POLICY IF EXISTS "insert_bot_templates" ON bot_templates;
DROP POLICY IF EXISTS "update_bot_templates" ON bot_templates;
DROP POLICY IF EXISTS "delete_bot_templates" ON bot_templates;

CREATE POLICY "insert_bot_templates" ON bot_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.admin_has_permission('can_edit_bots'));

CREATE POLICY "update_bot_templates" ON bot_templates
  FOR UPDATE TO authenticated
  USING (public.admin_has_permission('can_edit_bots'))
  WITH CHECK (public.admin_has_permission('can_edit_bots'));

CREATE POLICY "delete_bot_templates" ON bot_templates
  FOR DELETE TO authenticated
  USING (public.admin_has_permission('can_edit_bots'));

-- 3f. licenses — write requires can_manage_licenses permission
DROP POLICY IF EXISTS "insert_licenses" ON licenses;
DROP POLICY IF EXISTS "update_licenses" ON licenses;
DROP POLICY IF EXISTS "delete_licenses" ON licenses;

CREATE POLICY "insert_licenses" ON licenses
  FOR INSERT TO authenticated
  WITH CHECK (public.admin_has_permission('can_manage_licenses'));

CREATE POLICY "update_licenses" ON licenses
  FOR UPDATE TO authenticated
  USING (public.admin_has_permission('can_manage_licenses'))
  WITH CHECK (public.admin_has_permission('can_manage_licenses'));

CREATE POLICY "delete_licenses" ON licenses
  FOR DELETE TO authenticated
  USING (public.admin_has_permission('can_manage_licenses'));

-- 3g. user_funds — UPDATE/DELETE requires can_manage_clients permission
DROP POLICY IF EXISTS "update_user_funds" ON user_funds;
DROP POLICY IF EXISTS "delete_user_funds" ON user_funds;

CREATE POLICY "update_user_funds" ON user_funds
  FOR UPDATE TO authenticated
  USING (public.admin_has_permission('can_manage_clients'))
  WITH CHECK (public.admin_has_permission('can_manage_clients'));

CREATE POLICY "delete_user_funds" ON user_funds
  FOR DELETE TO authenticated
  USING (public.admin_has_permission('can_manage_clients'));

-- 3h. trades — write requires can_edit_bots permission
DROP POLICY IF EXISTS "insert_trades" ON trades;
DROP POLICY IF EXISTS "update_trades" ON trades;
DROP POLICY IF EXISTS "delete_trades" ON trades;

CREATE POLICY "insert_trades" ON trades
  FOR INSERT TO authenticated
  WITH CHECK (public.admin_has_permission('can_edit_bots'));

CREATE POLICY "update_trades" ON trades
  FOR UPDATE TO authenticated
  USING (public.admin_has_permission('can_edit_bots'))
  WITH CHECK (public.admin_has_permission('can_edit_bots'));

CREATE POLICY "delete_trades" ON trades
  FOR DELETE TO authenticated
  USING (public.admin_has_permission('can_edit_bots'));

-- 3i. client_updates — write requires can_manage_clients permission
DROP POLICY IF EXISTS "insert_client_updates" ON client_updates;
DROP POLICY IF EXISTS "update_client_updates" ON client_updates;
DROP POLICY IF EXISTS "delete_client_updates" ON client_updates;

CREATE POLICY "insert_client_updates" ON client_updates
  FOR INSERT TO authenticated
  WITH CHECK (public.admin_has_permission('can_manage_clients'));

CREATE POLICY "update_client_updates" ON client_updates
  FOR UPDATE TO authenticated
  USING (public.admin_has_permission('can_manage_clients'))
  WITH CHECK (public.admin_has_permission('can_manage_clients'));

CREATE POLICY "delete_client_updates" ON client_updates
  FOR DELETE TO authenticated
  USING (public.admin_has_permission('can_manage_clients'));

-- 3j. transactions — write requires can_manage_licenses permission
DROP POLICY IF EXISTS "select_transactions" ON transactions;
DROP POLICY IF EXISTS "insert_transactions" ON transactions;
DROP POLICY IF EXISTS "update_transactions" ON transactions;
DROP POLICY IF EXISTS "delete_transactions" ON transactions;

CREATE POLICY "select_transactions" ON transactions
  FOR SELECT TO authenticated USING (public.admin_has_permission('can_manage_licenses'));

CREATE POLICY "insert_transactions" ON transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.admin_has_permission('can_manage_licenses'));

CREATE POLICY "update_transactions" ON transactions
  FOR UPDATE TO authenticated
  USING (public.admin_has_permission('can_manage_licenses'))
  WITH CHECK (public.admin_has_permission('can_manage_licenses'));

CREATE POLICY "delete_transactions" ON transactions
  FOR DELETE TO authenticated
  USING (public.admin_has_permission('can_manage_licenses'));
