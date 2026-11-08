/*
# Create transfer_credits RPC

## Purpose
Allows Super Admin / Master email to transfer credits to a sub-admin account.
Sub-admins use these credits to allot licenses to their own clients.

## Security
- SECURITY DEFINER, search_path locked to 'public'
- Only super_admin role or the master email (vinodbardev@gmail.com) can call this
- Target must be an active sub_admin
- Credit amount must be positive (1 to 1,000,000)
- For super_admin / master email, credits are created from thin air (no deduction from caller)
*/

CREATE OR REPLACE FUNCTION public.transfer_credits(
  p_target_email text,
  p_credits integer
)
RETURNS TABLE(success boolean, new_balance integer, target_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_admin_email text;
  v_is_super boolean;
  v_target_row record;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_credits IS NULL OR p_credits < 1 OR p_credits > 1000000 THEN
    RAISE EXCEPTION 'Credit amount must be between 1 and 1,000,000';
  END IF;

  -- Get caller's email
  SELECT email INTO v_admin_email FROM auth.users WHERE id = v_admin_id;

  -- Check if caller is super_admin or master email
  SELECT role = 'super_admin' INTO v_is_super
  FROM admin_roles
  WHERE user_id = v_admin_id
  AND is_active = true
  AND role = 'super_admin'
  LIMIT 1;

  IF v_admin_email = 'vinodbardev@gmail.com' THEN
    v_is_super := true;
  END IF;

  IF v_is_super IS NOT TRUE THEN
    RAISE EXCEPTION 'Only Super Admins can transfer credits';
  END IF;

  -- Find the target sub-admin by email
  SELECT id, email, name, credit_balance
  INTO v_target_row
  FROM admin_roles
  WHERE lower(trim(email)) = lower(trim(p_target_email))
  AND is_active = true
  AND role = 'sub_admin'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active sub-admin found with that email';
  END IF;

  -- Add credits to the sub-admin (super admin has unlimited, so no deduction)
  UPDATE admin_roles
  SET credit_balance = credit_balance + p_credits
  WHERE id = v_target_row.id;

  RETURN QUERY SELECT true, (v_target_row.credit_balance + p_credits)::integer, COALESCE(v_target_row.name, v_target_row.email);
END;
$function$;
