/*
# B2B Multi-Tenant RLS Policies
# Updates all admin tables to enforce admin_id-based isolation.
# super_admin: unconditional bypass. sub_admin: only own admin_id rows.
*/

-- system_settings
DROP POLICY IF EXISTS "select_system_settings" ON system_settings;
DROP POLICY IF EXISTS "insert_system_settings" ON system_settings;
DROP POLICY IF EXISTS "update_system_settings" ON system_settings;
DROP POLICY IF EXISTS "delete_system_settings" ON system_settings;

CREATE POLICY "select_system_settings" ON system_settings
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR admin_id = auth.uid() OR admin_id IS NULL);

CREATE POLICY "insert_system_settings" ON system_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR admin_id = auth.uid());

CREATE POLICY "update_system_settings" ON system_settings
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR admin_id = auth.uid())
  WITH CHECK (public.is_super_admin() OR admin_id = auth.uid());

CREATE POLICY "delete_system_settings" ON system_settings
  FOR DELETE TO authenticated
  USING (public.is_super_admin() OR admin_id = auth.uid());

-- user_funds
DROP POLICY IF EXISTS "select_user_funds" ON user_funds;
DROP POLICY IF EXISTS "insert_user_funds" ON user_funds;
DROP POLICY IF EXISTS "update_user_funds" ON user_funds;
DROP POLICY IF EXISTS "delete_user_funds" ON user_funds;

CREATE POLICY "select_user_funds" ON user_funds
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR auth.uid() = user_id OR admin_id = auth.uid());

CREATE POLICY "insert_user_funds" ON user_funds
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR auth.uid() = user_id OR admin_id = auth.uid());

CREATE POLICY "update_user_funds" ON user_funds
  FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY "delete_user_funds" ON user_funds
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- licenses
DROP POLICY IF EXISTS "select_licenses" ON licenses;
DROP POLICY IF EXISTS "insert_licenses" ON licenses;
DROP POLICY IF EXISTS "update_licenses" ON licenses;
DROP POLICY IF EXISTS "delete_licenses" ON licenses;

CREATE POLICY "select_licenses" ON licenses
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR auth.uid() = user_id OR admin_id = auth.uid());

CREATE POLICY "insert_licenses" ON licenses
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR admin_id = auth.uid());

CREATE POLICY "update_licenses" ON licenses
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR admin_id = auth.uid())
  WITH CHECK (public.is_super_admin() OR admin_id = auth.uid());

CREATE POLICY "delete_licenses" ON licenses
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- profiles
DROP POLICY IF EXISTS "select_profiles" ON profiles;
DROP POLICY IF EXISTS "update_profiles" ON profiles;

CREATE POLICY "select_profiles" ON profiles
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR auth.uid() = id OR admin_id = auth.uid());

CREATE POLICY "update_profiles" ON profiles
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR auth.uid() = id OR admin_id = auth.uid())
  WITH CHECK (public.is_super_admin() OR auth.uid() = id OR admin_id = auth.uid());

-- transactions
DROP POLICY IF EXISTS "select_transactions" ON transactions;
DROP POLICY IF EXISTS "insert_transactions" ON transactions;
DROP POLICY IF EXISTS "update_transactions" ON transactions;
DROP POLICY IF EXISTS "delete_transactions" ON transactions;

CREATE POLICY "select_transactions" ON transactions
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR admin_id = auth.uid());

CREATE POLICY "insert_transactions" ON transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR admin_id = auth.uid());

CREATE POLICY "update_transactions" ON transactions
  FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY "delete_transactions" ON transactions
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- admin_roles: only super_admin can insert/update/delete
DROP POLICY IF EXISTS "insert_admin_roles" ON admin_roles;
DROP POLICY IF EXISTS "update_admin_roles" ON admin_roles;
DROP POLICY IF EXISTS "delete_admin_roles" ON admin_roles;

CREATE POLICY "insert_admin_roles" ON admin_roles
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

CREATE POLICY "update_admin_roles" ON admin_roles
  FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY "delete_admin_roles" ON admin_roles
  FOR DELETE TO authenticated USING (public.is_super_admin());

-- risk_settings: only super_admin can modify
DROP POLICY IF EXISTS "insert_risk_settings" ON risk_settings;
DROP POLICY IF EXISTS "update_risk_settings" ON risk_settings;

CREATE POLICY "insert_risk_settings" ON risk_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

CREATE POLICY "update_risk_settings" ON risk_settings
  FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- bot_templates: only super_admin can modify
DROP POLICY IF EXISTS "insert_bot_templates" ON bot_templates;
DROP POLICY IF EXISTS "update_bot_templates" ON bot_templates;
DROP POLICY IF EXISTS "delete_bot_templates" ON bot_templates;

CREATE POLICY "insert_bot_templates" ON bot_templates
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

CREATE POLICY "update_bot_templates" ON bot_templates
  FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY "delete_bot_templates" ON bot_templates
  FOR DELETE TO authenticated USING (public.is_super_admin());
