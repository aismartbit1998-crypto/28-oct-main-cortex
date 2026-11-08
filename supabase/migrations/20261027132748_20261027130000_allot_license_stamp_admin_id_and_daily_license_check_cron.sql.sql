/*
# B2B Freemium Economy: stamp admin_id on allot_license + daily expiry cron

## Changes

### 1. allot_license RPC — stamp admin_id
- The `allot_license` function now stamps `auth.uid()` (the assigning Sub-Admin's
  ID) into the `licenses.admin_id` column on both INSERT and UPDATE paths.
- This permanently links the paid license to the Sub-Admin for B2B tenant
  isolation and ownership tracking.
- The upfront credit deduction logic is unchanged (already enforced: the
  atomic UPDATE ... WHERE credit_balance >= v_cost throws if balance is low).

### 2. daily-license-check cron job
- Schedules a new pg_cron job named `daily_license_check_cron` running at
  UTC midnight (`0 0 * * *`).
- It sends an HTTP POST to the `daily-license-check` edge function which:
  - Finds all licenses where `valid_until < now()` and `is_active = true`.
  - Sets those licenses to `is_active = false`.
  - Pauses all running/paper bots for those users (status = 'paused').
  - This reverts expired clients to the "Locked" state on their next login.

## Security
- The allot_license function remains SECURITY DEFINER with locked search_path.
- The cron job uses the anon key (the edge function uses the service role key
  from its own Deno environment, so verify_jwt=false is safe).
*/

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
    -- Sub-Admin: deduct credits atomically (upfront for the full validity period)
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
    INSERT INTO licenses (user_id, plan_name, bot_limit, is_active, valid_from, valid_until, monthly_fee, allowed_bots, admin_id)
    VALUES (p_target_user_id, v_plan, v_bot_limit, true, now(), now() + make_interval(days => p_validity_days), 0, p_allowed_bots, v_admin_id)
    RETURNING id INTO v_license_id;
  ELSE
    UPDATE licenses
    SET plan_name = v_plan,
    bot_limit = v_bot_limit,
    is_active = true,
    valid_from = now(),
    valid_until = now() + make_interval(days => p_validity_days),
    monthly_fee = 0,
    allowed_bots = p_allowed_bots,
    admin_id = v_admin_id
    WHERE id = v_license_id;
  END IF;

  RETURN QUERY SELECT v_license_id, CASE WHEN v_is_super THEN 0 ELSE v_cost END, v_remaining;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.allot_license(uuid, text, integer, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.allot_license(uuid, text, integer, text[]) TO authenticated;

-- Schedule the daily-license-check cron job at UTC midnight
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_license_check_cron') THEN
    PERFORM cron.unschedule('daily_license_check_cron');
  END IF;

  PERFORM cron.schedule(
    'daily_license_check_cron',
    '0 0 * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://accqqjkbjyojbdptamik.supabase.co/functions/v1/daily-license-check',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjY3FxamtianlvamJkcHRhbWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3OTU1NDMsImV4cCI6MjEwNzM3MTU0M30.WjwyZFAPgxaHC95IAgzX9qEQ4yeFSRn05zUYdVtU8bw'
        ),
        body := '{}'::jsonb
      )
    $cron$
  );
END $$;
