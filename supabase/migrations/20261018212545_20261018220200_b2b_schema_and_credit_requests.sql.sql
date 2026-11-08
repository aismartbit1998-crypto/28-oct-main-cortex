/*
# B2B Schema: admin_id columns, credit_requests, RPCs
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'admin_id') THEN
    ALTER TABLE profiles ADD COLUMN admin_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_funds' AND column_name = 'admin_id') THEN
    ALTER TABLE user_funds ADD COLUMN admin_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'licenses' AND column_name = 'admin_id') THEN
    ALTER TABLE licenses ADD COLUMN admin_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_settings' AND column_name = 'admin_id') THEN
    ALTER TABLE system_settings ADD COLUMN admin_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'admin_id') THEN
    ALTER TABLE transactions ADD COLUMN admin_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'user_id') THEN
    ALTER TABLE transactions ADD COLUMN user_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'type') THEN
    ALTER TABLE transactions ADD COLUMN type text DEFAULT 'subscription';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'utr_number') THEN
    ALTER TABLE transactions ADD COLUMN utr_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'credits_requested') THEN
    ALTER TABLE transactions ADD COLUMN credits_requested integer;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS credit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_requested integer NOT NULL CHECK (credits_requested > 0),
  amount_paid numeric NOT NULL DEFAULT 0,
  utr_number text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_credit_requests" ON credit_requests;
CREATE POLICY "select_credit_requests" ON credit_requests
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR sub_admin_id = auth.uid());

DROP POLICY IF EXISTS "insert_credit_requests" ON credit_requests;
CREATE POLICY "insert_credit_requests" ON credit_requests
  FOR INSERT TO authenticated
  WITH CHECK (sub_admin_id = auth.uid());

DROP POLICY IF EXISTS "update_credit_requests" ON credit_requests;
CREATE POLICY "update_credit_requests" ON credit_requests
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "delete_credit_requests" ON credit_requests;
CREATE POLICY "delete_credit_requests" ON credit_requests
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE INDEX IF NOT EXISTS idx_credit_requests_status ON credit_requests(status);
CREATE INDEX IF NOT EXISTS idx_credit_requests_sub_admin ON credit_requests(sub_admin_id);

-- get_master_settings() — plpgsql with variable
CREATE OR REPLACE FUNCTION public.get_master_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sa_id uuid;
BEGIN
  SELECT user_id INTO sa_id FROM admin_roles WHERE role = 'super_admin' AND is_active = true LIMIT 1;
  RETURN jsonb_build_object(
    'upi_id', (SELECT value FROM system_settings WHERE key = 'manual_upi_id' AND admin_id = sa_id LIMIT 1),
    'bank_name', (SELECT value FROM system_settings WHERE key = 'manual_bank_name' AND admin_id = sa_id LIMIT 1),
    'account_number', (SELECT value FROM system_settings WHERE key = 'manual_account_number' AND admin_id = sa_id LIMIT 1),
    'ifsc_code', (SELECT value FROM system_settings WHERE key = 'manual_ifsc_code' AND admin_id = sa_id LIMIT 1),
    'qr_code_url', (SELECT value FROM system_settings WHERE key = 'manual_qr_code_url' AND admin_id = sa_id LIMIT 1)
  );
END;
$$;

-- approve_credit_request()
CREATE OR REPLACE FUNCTION public.approve_credit_request(req_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  req_record RECORD;
BEGIN
  caller_role := public.is_platform_admin();
  IF caller_role IS NULL OR caller_role != 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only super admin can approve credit requests');
  END IF;

  SELECT * INTO req_record FROM credit_requests WHERE id = req_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Credit request not found or already processed');
  END IF;

  UPDATE credit_requests
    SET status = 'approved', approved_by = auth.uid(), approved_at = now()
    WHERE id = req_id;

  UPDATE admin_roles
    SET credit_balance = credit_balance + req_record.credits_requested
    WHERE user_id = req_record.sub_admin_id AND is_active = true;

  RETURN jsonb_build_object('success', true, 'credits_added', req_record.credits_requested);
END;
$$;
