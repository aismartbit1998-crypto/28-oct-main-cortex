import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export type PlanType = 'starter' | 'pro' | 'enterprise';

export interface PlanRule {
  label: string;
  creditsPerDay: number;
  botLimit: number | null;
  maxLeverage: number;
  features: string[];
  aiAutoTune: boolean;
  unlockedStrategiesCount: number;
  allowedStrategyIds: string[];
}

// Fallback defaults used while DB loads or if fetch fails.
// These mirror the seeded values in plan_limits table.
const FALLBACK_RULES: Record<PlanType, PlanRule> = {
  starter: {
    label: 'Starter',
    creditsPerDay: 2,
    botLimit: 2,
    maxLeverage: 10,
    features: ['2 AI Bots', '10x Max', 'Spot', 'Email Support', 'Basic Signals', '2 AI Strategies'],
    aiAutoTune: false,
    unlockedStrategiesCount: 2,
    allowedStrategyIds: ['sideways_sniper', 'smart_dca'],
  },
  pro: {
    label: 'Pro',
    creditsPerDay: 4,
    botLimit: 5,
    maxLeverage: 30,
    features: ['5 AI Bots', '30x Max', 'Spot & Futures', 'Priority Support', 'Advanced Signals', 'Copy Trading', 'Custom Strategies', '4 AI Strategies'],
    aiAutoTune: true,
    unlockedStrategiesCount: 4,
    allowedStrategyIds: ['sideways_sniper', 'smart_dca', 'infinity_grid', 'bull_scalper'],
  },
  enterprise: {
    label: 'Enterprise',
    creditsPerDay: 6,
    botLimit: null,
    maxLeverage: 100,
    features: ['Unlimited Bots', '100x Max', 'Unlimited Markets', 'Dedicated Manager', 'API Access', 'Custom Risk Rules', 'Priority Features', 'All 10 AI Strategies'],
    aiAutoTune: true,
    unlockedStrategiesCount: 10,
    allowedStrategyIds: [
      'sideways_sniper', 'smart_dca', 'infinity_grid', 'bull_scalper',
      'smart_martingale', 'whale_copier', 'smc_institutional',
      'funding_arbitrage', 'volatility_breakout', 'quantum_hft',
    ],
  },
};

// In-memory cache populated on first fetch; used by synchronous consumers.
let cachedRules: Record<PlanType, PlanRule> = { ...FALLBACK_RULES };
let fetchPromise: Promise<Record<PlanType, PlanRule>> | null = null;

async function fetchPlanLimits(): Promise<Record<PlanType, PlanRule>> {
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_plan_limits');
      if (error || !data) return cachedRules;

      const rows = data as Array<{
        plan_key: PlanType;
        label: string;
        bot_limit: number | null;
        max_leverage: number;
        credits_per_day: number;
        features: string[];
        ai_auto_tune: boolean;
        unlocked_strategies_count: number;
        allowed_strategy_ids: string[];
        sort_order: number;
      }>;

      const newRules: Record<PlanType, PlanRule> = { ...FALLBACK_RULES };
      for (const row of rows) {
        if (row.plan_key === 'starter' || row.plan_key === 'pro' || row.plan_key === 'enterprise') {
          newRules[row.plan_key] = {
            label: row.label,
            creditsPerDay: row.credits_per_day,
            botLimit: row.bot_limit,
            maxLeverage: row.max_leverage,
            features: row.features ?? [],
            aiAutoTune: row.ai_auto_tune,
            unlockedStrategiesCount: row.unlocked_strategies_count,
            allowedStrategyIds: row.allowed_strategy_ids ?? [],
          };
        }
      }
      cachedRules = newRules;
      return newRules;
    } catch {
      return cachedRules;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/**
 * Returns the current cached plan rules (synchronous).
 * On first call, triggers an async fetch from the DB.
 * Use usePlanRules() hook for reactive updates.
 */
export const PLAN_RULES: Record<PlanType, PlanRule> = new Proxy({ ...FALLBACK_RULES }, {
  get(target, prop: string) {
    return cachedRules[prop as PlanType] ?? target[prop as PlanType] ?? FALLBACK_RULES[prop as PlanType];
  },
});

/**
 * React hook that fetches plan limits from the DB and provides reactive updates.
 * Returns { rules, loading } where rules defaults to fallback while loading.
 */
export function usePlanRules() {
  const [rules, setRules] = useState<Record<PlanType, PlanRule>>(cachedRules);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchPlanLimits().then((fetched) => {
      if (active) {
        setRules(fetched);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  return { rules, loading };
}

/** Force a re-fetch of plan limits from the DB (e.g. after admin edits). */
export async function refreshPlanLimits(): Promise<Record<PlanType, PlanRule>> {
  fetchPromise = null;
  const fresh = await fetchPlanLimits();
  cachedRules = fresh;
  return fresh;
}

export function normalizePlan(value: string | null | undefined): PlanType {
  const plan = value?.toLowerCase();
  return plan === 'pro' || plan === 'enterprise' ? plan : 'starter';
}

export function isStrategyUnlocked(
  planName: PlanType,
  strategyId: string,
  strategies?: import('@/lib/strategyCatalog').StrategyEntry[],
): boolean {
  const rules = cachedRules;
  const list = strategies ?? [];
  const strategy = list.find(s => s.id === strategyId);
  if (!strategy) {
    return rules[planName].allowedStrategyIds.includes(strategyId);
  }
  const TIER_RANK: Record<string, number> = { starter: 0, pro: 1, enterprise: 2 };
  const PLAN_RANK: Record<PlanType, number> = { starter: 0, pro: 1, enterprise: 2 };
  return PLAN_RANK[planName] >= TIER_RANK[strategy.tier];
}

export function getPlanStrategySummary(planName: PlanType): string {
  const unlocked = cachedRules[planName].unlockedStrategiesCount;
  const locked = 10 - unlocked;
  return `${unlocked} Unlocked | ${locked} Locked`;
}
