import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export type FeatureKey =
  | 'signals' | 'copy_trading' | 'ai_market_predictor' | 'backtesting'
  | 'performance_analytics' | 'position_monitor' | 'crypto_view'
  | 'wallet' | 'trade_history';

export interface FeatureFlagRow {
  id: string;
  feature_key: FeatureKey;
  label: string;
  description: string;
  is_enabled: boolean;
  sort_order: number;
}

let cachedFlags: Partial<Record<FeatureKey, boolean>> = {};
let fetchPromise: Promise<Partial<Record<FeatureKey, boolean>>> | null = null;

async function fetchFlags(): Promise<Partial<Record<FeatureKey, boolean>>> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_feature_flags');
      if (error || !data) return cachedFlags;
      cachedFlags = data as Partial<Record<FeatureKey, boolean>>;
      return cachedFlags;
    } catch {
      return cachedFlags;
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

export function isFeatureEnabled(key: FeatureKey): boolean {
  return cachedFlags[key] ?? true;
}

export function useFeatureFlags() {
  const [flags, setFlags] = useState<Partial<Record<FeatureKey, boolean>>>(cachedFlags);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchFlags().then((fetched) => {
      if (active) {
        setFlags(fetched);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  const isFeatureOn = useCallback((key: FeatureKey): boolean => {
    return flags[key] ?? true;
  }, [flags]);

  return { flags, isFeatureOn, loading };
}

export async function refreshFeatureFlags(): Promise<Partial<Record<FeatureKey, boolean>>> {
  fetchPromise = null;
  const fresh = await fetchFlags();
  cachedFlags = fresh;
  return fresh;
}

export async function fetchAllFlagRows(): Promise<FeatureFlagRow[]> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('*')
    .order('sort_order');
  if (error || !data) return [];
  return data as FeatureFlagRow[];
}

export async function updateFeatureFlag(featureKey: string, isEnabled: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('feature_flags')
    .update({ is_enabled: isEnabled, updated_at: new Date().toISOString() })
    .eq('feature_key', featureKey);
  if (error) return false;
  await refreshFeatureFlags();
  return true;
}
