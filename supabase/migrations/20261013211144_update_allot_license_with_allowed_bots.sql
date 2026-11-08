-- Update allot_license RPC to accept allowed_bots parameter
-- so admin can assign specific bot types to a client's license.
CREATE OR REPLACE FUNCTION public.allot_license(
  p_target_user_id uuid,
  p_plan_type text,
  p_validity_days integer,
  p_allowed_bots text[] DEFAULT '{}'
)
RETURNS TABLE(license_id uuid, credits_spent integer, remaining_credits integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan text := lower(trim(p_plan_type));
  v_daily_cost integer;
  v_bot_limit integer;
  v_cost integer;
  v_admin_id uuid := auth.uid();
  v_remaining integer;
  v_license_id uuid;
  v_is_super boolean;
  v_admin_email text;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_plan NOT IN ('starter', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'Invalid plan';
  END IF;

  IF p_validity_days IS NULL OR p_validity_days < 1 OR p_validity_days > 3650 THEN
    RAISE EXCEPTION 'Invalid validity';
  END IF;

  v_daily_cost := CASE v_plan WHEN 'starter' THEN 2 WHEN 'pro' THEN 4 ELSE 6 END;
  v_bot_limit := CASE v_plan WHEN 'starter' THEN 2 WHEN 'pro' THEN 5 ELSE 2147483647 END;
  v_cost := v_daily_cost * p_validity_days;

  -- Get caller's email for master email check
  SELECT email INTO v_admin_email FROM auth.users WHERE id = v_admin_id;

  -- Check if caller is super_admin or the master email (God Mode — no credit deduction)
  SELECT role = 'super_admin' INTO v_is_super
  FROM admin_roles
  WHERE user_id = v_admin_id
  AND is_active = true
  AND role IN ('super_admin', 'sub_admin')
  LIMIT 1;

  -- Master email bypass: treat as super admin
  IF v_admin_email = 'vinodbardev@gmail.com' THEN
    v_is_super := true;
  END IF;

  IF v_is_super IS NULL THEN
    RAISE EXCEPTION 'Insufficient credits or unauthorized';
  END IF;

  IF v_is_super THEN
    -- Super Admin / Master Email: bypass credit deduction entirely
    v_remaining := 2147483647;
  ELSE
    -- Sub-Admin: deduct credits atomically
    UPDATE admin_roles
    SET credit_balance = credit_balance - v_cost
    WHERE user_id = v_admin_id
    AND is_active = true
    AND role = 'sub_admin'
    AND credit_balance >= v_cost
    RETURNING credit_balance INTO v_remaining;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient credits or unauthorized';
    END IF;
  END IF;

  SELECT id INTO v_license_id
  FROM licenses
  WHERE user_id = p_target_user_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_license_id IS NULL THEN
    INSERT INTO licenses (user_id, plan_name, bot_limit, is_active, valid_from, valid_until, monthly_fee, allowed_bots)
    VALUES (p_target_user_id, v_plan, v_bot_limit, true, now(), now() + make_interval(days => p_validity_days), 0, p_allowed_bots)
    RETURNING id INTO v_license_id;
  ELSE
    UPDATE licenses
    SET plan_name = v_plan,
    bot_limit = v_bot_limit,
    is_active = true,
    valid_from = now(),
    valid_until = now() + make_interval(days => p_validity_days),
    monthly_fee = 0,
    allowed_bots = p_allowed_bots
    WHERE id = v_license_id;
  END IF;

  RETURN QUERY SELECT v_license_id, CASE WHEN v_is_super THEN 0 ELSE v_cost END, v_remaining;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.allot_license(uuid, text, integer, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.allot_license(uuid, text, integer, text[]) TO authenticated;
