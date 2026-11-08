-- Super Admin God Mode: bypass credit deduction for super_admin role in allot_license

CREATE OR REPLACE FUNCTION public.allot_license(
  p_target_user_id uuid,
  p_plan_type text,
  p_validity_days integer
)
RETURNS TABLE (license_id uuid, credits_spent integer, remaining_credits integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text := lower(trim(p_plan_type));
  v_daily_cost integer;
  v_bot_limit integer;
  v_cost integer;
  v_admin_id uuid := auth.uid();
  v_remaining integer;
  v_license_id uuid;
  v_is_super boolean;
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

  -- Check if caller is a super_admin (God Mode — no credit deduction)
  SELECT role = 'super_admin' INTO v_is_super
  FROM admin_roles
  WHERE user_id = v_admin_id
    AND is_active = true
    AND role IN ('super_admin', 'sub_admin')
  LIMIT 1;

  IF v_is_super IS NULL THEN
    RAISE EXCEPTION 'Insufficient credits or unauthorized';
  END IF;

  IF v_is_super THEN
    -- Super Admin: bypass credit deduction entirely
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
    INSERT INTO licenses (user_id, plan_name, bot_limit, is_active, valid_from, valid_until, monthly_fee)
    VALUES (p_target_user_id, v_plan, v_bot_limit, true, now(), now() + make_interval(days => p_validity_days), 0)
    RETURNING id INTO v_license_id;
  ELSE
    UPDATE licenses
    SET plan_name = v_plan,
        bot_limit = v_bot_limit,
        is_active = true,
        valid_from = now(),
        valid_until = now() + make_interval(days => p_validity_days),
        monthly_fee = 0
    WHERE id = v_license_id;
  END IF;

  RETURN QUERY SELECT v_license_id, CASE WHEN v_is_super THEN 0 ELSE v_cost END, v_remaining;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allot_license(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.allot_license(uuid, text, integer) TO authenticated;
