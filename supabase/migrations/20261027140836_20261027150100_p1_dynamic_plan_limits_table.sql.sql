/*
# Phase 1: Dynamic plan_limits table — kill the hardcoded plan constants

## Summary
Creates a `plan_limits` table to store plan tier limits (bot_limit, max_leverage,
credits_per_day, features, strategy config) dynamically in the database. Seeds with
the current hardcoded defaults from planRules.ts. Creates an RPC to fetch all plan
limits in a single call. Replaces the hardcoded enforce_bot_plan_limits() SQL function
with one that reads from this table.

## New Tables
- `plan_limits`: One row per plan tier (starter, pro, enterprise).
  Columns: plan_key, label, bot_limit (null = unlimited), max_leverage,
  credits_per_day, features (text[]), ai_auto_tune, unlocked_strategies_count,
  allowed_strategy_ids (text[]), is_active, sort_order, updated_at.

## New Functions
- `get_plan_limits()`: Returns all active plan limits as a JSON array, ordered by sort_order.
  Callable by authenticated users (needed by frontend to render plans).
- `get_plan_limit(p_plan text)`: Returns a single plan's limits as JSON.
- `enforce_bot_plan_limits()`: REPLACED to read bot_limit and max_leverage from plan_limits
  table instead of hardcoded CASE statements.

## Security
- RLS enabled on plan_limits.
- SELECT: open to authenticated (users need to see plan options).
- INSERT/UPDATE/DELETE: super_admin only (master admin manages plans).
- GRANT SELECT to authenticated; GRANT CRUD to authenticated (RLS gates the writes).

## Seeded Data
- starter: 2 bots, 10x leverage, 2 credits/day, 2 strategies
- pro: 5 bots, 30x leverage, 4 credits/day, 4 strategies
- enterprise: unlimited bots, 100x leverage, 6 credits/day, 10 strategies
*/

CREATE TABLE IF NOT EXISTS plan_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL UNIQUE CHECK (plan_key IN ('starter', 'pro', 'enterprise')),
  label text NOT NULL,
  bot_limit integer,
  max_leverage integer NOT NULL DEFAULT 10,
  credits_per_day integer NOT NULL DEFAULT 1,
  features text[] NOT NULL DEFAULT '{}',
  ai_auto_tune boolean NOT NULL DEFAULT false,
  unlocked_strategies_count integer NOT NULL DEFAULT 2,
  allowed_strategy_ids text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;

-- Seed current defaults
INSERT INTO plan_limits (plan_key, label, bot_limit, max_leverage, credits_per_day, features, ai_auto_tune, unlocked_strategies_count, allowed_strategy_ids, is_active, sort_order)
VALUES
  (
    'starter', 'Starter', 2, 10, 2,
    ARRAY['2 AI Bots', '10x Max', 'Spot', 'Email Support', 'Basic Signals', '2 AI Strategies'],
    false, 2,
    ARRAY['sideways_sniper', 'smart_dca'],
    true, 0
  ),
  (
    'pro', 'Pro', 5, 30, 4,
    ARRAY['5 AI Bots', '30x Max', 'Spot & Futures', 'Priority Support', 'Advanced Signals', 'Copy Trading', 'Custom Strategies', '4 AI Strategies'],
    true, 4,
    ARRAY['sideways_sniper', 'smart_dca', 'infinity_grid', 'bull_scalper'],
    true, 1
  ),
  (
    'enterprise', 'Enterprise', NULL, 100, 6,
    ARRAY['Unlimited Bots', '100x Max', 'Unlimited Markets', 'Dedicated Manager', 'API Access', 'Custom Risk Rules', 'Priority Features', 'All 10 AI Strategies'],
    true, 10,
    ARRAY['sideways_sniper', 'smart_dca', 'infinity_grid', 'bull_scalper', 'smart_martingale', 'whale_copier', 'smc_institutional', 'funding_arbitrage', 'volatility_breakout', 'quantum_hft'],
    true, 2
  )
ON CONFLICT (plan_key) DO UPDATE SET
  label = EXCLUDED.label,
  bot_limit = EXCLUDED.bot_limit,
  max_leverage = EXCLUDED.max_leverage,
  credits_per_day = EXCLUDED.credits_per_day,
  features = EXCLUDED.features,
  ai_auto_tune = EXCLUDED.ai_auto_tune,
  unlocked_strategies_count = EXCLUDED.unlocked_strategies_count,
  allowed_strategy_ids = EXCLUDED.allowed_strategy_ids,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- ============================================================
-- RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_plan_limits()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_agg(
    jsonb_build_object(
      'plan_key', plan_key,
      'label', label,
      'bot_limit', bot_limit,
      'max_leverage', max_leverage,
      'credits_per_day', credits_per_day,
      'features', features,
      'ai_auto_tune', ai_auto_tune,
      'unlocked_strategies_count', unlocked_strategies_count,
      'allowed_strategy_ids', allowed_strategy_ids,
      'sort_order', sort_order
    )
    ORDER BY sort_order
  )
  FROM plan_limits
  WHERE is_active = true;
$$;

REVOKE EXECUTE ON FUNCTION public.get_plan_limits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_limits() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_plan_limit(p_plan text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'plan_key', plan_key,
    'label', label,
    'bot_limit', bot_limit,
    'max_leverage', max_leverage,
    'credits_per_day', credits_per_day,
    'features', features,
    'ai_auto_tune', ai_auto_tune,
    'unlocked_strategies_count', unlocked_strategies_count,
    'allowed_strategy_ids', allowed_strategy_ids,
    'sort_order', sort_order
  )
  FROM plan_limits
  WHERE plan_key = p_plan AND is_active = true;
$$;

REVOKE EXECUTE ON FUNCTION public.get_plan_limit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_limit(text) TO authenticated;

-- ============================================================
-- RLS Policies for plan_limits
-- ============================================================

DROP POLICY IF EXISTS "select_plan_limits" ON plan_limits;
DROP POLICY IF EXISTS "insert_plan_limits" ON plan_limits;
DROP POLICY IF EXISTS "update_plan_limits" ON plan_limits;
DROP POLICY IF EXISTS "delete_plan_limits" ON plan_limits;

CREATE POLICY "select_plan_limits" ON plan_limits
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insert_plan_limits" ON plan_limits
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

CREATE POLICY "update_plan_limits" ON plan_limits
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "delete_plan_limits" ON plan_limits
  FOR DELETE TO authenticated USING (public.is_super_admin());

GRANT SELECT ON plan_limits TO authenticated;
GRANT INSERT, UPDATE, DELETE ON plan_limits TO authenticated;

-- ============================================================
-- Replace enforce_bot_plan_limits() to read from plan_limits table
-- ============================================================

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
  v_bot_count integer;
  v_user_id uuid;
  v_license_row RECORD;
BEGIN
  -- Get the user_id from the bot
  SELECT user_id INTO v_user_id FROM bots WHERE id = NEW.id;
  IF v_user_id IS NULL THEN
    v_user_id := NEW.user_id;
  END IF;

  -- Find the user's active license
  SELECT plan_name INTO v_plan
  FROM licenses
  WHERE user_id = v_user_id AND is_active = true
  ORDER BY created_at DESC LIMIT 1;

  v_plan := COALESCE(LOWER(v_plan), 'starter');

  -- Read limits from plan_limits table (dynamic, no hardcode)
  SELECT bot_limit, max_leverage INTO v_limit, v_leverage_limit
  FROM plan_limits
  WHERE plan_key = v_plan AND is_active = true;

  IF NOT FOUND THEN
    -- Fallback if plan not found: use starter defaults
    SELECT bot_limit, max_leverage INTO v_limit, v_leverage_limit
    FROM plan_limits WHERE plan_key = 'starter';
  END IF;

  -- Enforce leverage limit
  IF NEW.leverage > v_leverage_limit THEN
    RAISE EXCEPTION 'Leverage % exceeds plan limit % for plan %', NEW.leverage, v_leverage_limit, v_plan;
  END IF;

  -- Enforce bot count limit (NULL = unlimited)
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_bot_count
    FROM bots
    WHERE user_id = v_user_id AND id != NEW.id AND status IN ('running', 'paused', 'idle');

    IF v_bot_count >= v_limit THEN
      RAISE EXCEPTION 'Bot limit (%) reached for plan %', v_limit, v_plan;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
