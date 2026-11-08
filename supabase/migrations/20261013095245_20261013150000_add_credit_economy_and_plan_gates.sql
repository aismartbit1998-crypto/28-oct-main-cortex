/*
# Add credit economy, secure license allotment, and plan enforcement

1. Purpose
- Replace fiat plan pricing with an integer credit economy.
- Give each administrator a server-controlled credit balance.
- Allow authorized administrators to allot time-based plans through one atomic function.
- Enforce bot-count and leverage limits in the database so browser requests cannot bypass plan rules.

2. Modified tables
- `admin_roles.credit_balance` (integer, non-negative): credits available to the administrator.
- `licenses.plan_name`: normalized to `starter`, `pro`, or `enterprise` with a strict check constraint.
- `licenses.bot_limit`: synchronized to the fixed plan limits.
- `licenses.monthly_fee`: retained for data compatibility but reset to zero and no longer used by the application.
- `bots`: a trigger enforces the active plan's bot count and leverage caps on inserts and updates.

3. Credit rules
- Starter costs 2 credits per day and allows 2 bots with 10x leverage.
- Pro costs 4 credits per day and allows 5 bots with 30x leverage.
- Enterprise costs 6 credits per day and allows unlimited bots with 100x leverage.

4. Secure function
- `allot_license(target_user_id, plan_type, validity_days)` derives the caller from `auth.uid()`.
- It validates the plan and duration, checks the caller's active admin role and credit balance, deducts credits atomically, and upserts the target user's active license.
- Direct client updates to credit balances and protected license fields are revoked so allotments cannot be forged from the browser.

5. Security notes
- The allotment function is `SECURITY DEFINER` with a fixed search path and is callable only by authenticated users.
- The bot trigger re-checks the target user's active license at write time.
- Existing plan values are normalized to the supported plan names before the constraint is added.
*/

ALTER TABLE admin_roles
  ADD COLUMN IF NOT EXISTS credit_balance integer NOT NULL DEFAULT 0;

UPDATE licenses
SET plan_name = CASE lower(plan_name)
  WHEN 'pro' THEN 'pro'
  WHEN 'enterprise' THEN 'enterprise'
  ELSE 'starter'
END,
  bot_limit = CASE lower(plan_name)
    WHEN 'pro' THEN 5
    WHEN 'enterprise' THEN 2147483647
    ELSE 2
  END,
  monthly_fee = 0;

ALTER TABLE licenses
  ALTER COLUMN plan_name SET DEFAULT 'starter',
  ALTER COLUMN monthly_fee SET DEFAULT 0;

ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_plan_name_check;
ALTER TABLE licenses ADD CONSTRAINT licenses_plan_name_check
  CHECK (plan_name IN ('starter', 'pro', 'enterprise'));

ALTER TABLE admin_roles DROP CONSTRAINT IF EXISTS admin_roles_credit_balance_check;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_credit_balance_check
  CHECK (credit_balance >= 0);

REVOKE UPDATE (credit_balance) ON admin_roles FROM authenticated;
REVOKE UPDATE (plan_name, bot_limit, is_active, valid_from, valid_until, monthly_fee) ON licenses FROM authenticated;
REVOKE INSERT ON licenses FROM authenticated;

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

  UPDATE admin_roles
  SET credit_balance = credit_balance - v_cost
  WHERE user_id = v_admin_id
    AND is_active = true
    AND role IN ('super_admin', 'sub_admin')
    AND credit_balance >= v_cost
  RETURNING credit_balance INTO v_remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient credits or unauthorized';
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

  RETURN QUERY SELECT v_license_id, v_cost, v_remaining;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allot_license(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.allot_license(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_bot_plan_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_limit integer;
  v_leverage_limit integer;
  v_existing integer;
BEGIN
  SELECT lower(plan_name) INTO v_plan
  FROM licenses
  WHERE user_id = NEW.user_id
    AND is_active = true
    AND (valid_until IS NULL OR valid_until > now())
  ORDER BY created_at DESC
  LIMIT 1;

  v_plan := COALESCE(v_plan, 'starter');
  v_limit := CASE v_plan WHEN 'starter' THEN 2 WHEN 'pro' THEN 5 ELSE 2147483647 END;
  v_leverage_limit := CASE v_plan WHEN 'starter' THEN 10 WHEN 'pro' THEN 30 ELSE 100 END;

  IF COALESCE(NEW.leverage, 1) > v_leverage_limit THEN
    RAISE EXCEPTION 'Plan limit reached: maximum leverage is %x', v_leverage_limit;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status IN ('running', 'paper', 'idle') THEN
    SELECT count(*) INTO v_existing
    FROM bots
    WHERE user_id = NEW.user_id
      AND status IN ('running', 'paper', 'idle');
    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Plan limit reached: maximum active bots is %', CASE WHEN v_limit = 2147483647 THEN 'unlimited' ELSE v_limit::text END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_bot_plan_limits_trigger ON bots;
CREATE TRIGGER enforce_bot_plan_limits_trigger
  BEFORE INSERT OR UPDATE OF leverage, status ON bots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bot_plan_limits();

REVOKE EXECUTE ON FUNCTION public.enforce_bot_plan_limits() FROM anon, authenticated;
