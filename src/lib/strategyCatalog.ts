import type { PlanType } from '@/lib/planRules';
import type { BotTemplate } from '@/lib/supabase';

export type StrategyTier = 'starter' | 'pro' | 'enterprise';

export interface StrategyEntry {
  id: string;
  name: string;
  tier: StrategyTier;
  engine: 'scalper' | 'dca' | 'grid' | 'martingale' | 'copier';
  indicator: string;
  takeProfit: number;
  stopLoss: number;
  winRate: string;
  description: string;
  riskLevel: 'Low' | 'Medium' | 'High';
}

export const STRATEGY_CATALOG: StrategyEntry[] = [
  {
    id: 'sideways_sniper',
    name: 'Sideways Market Sniper',
    tier: 'starter',
    engine: 'scalper',
    indicator: 'RSI',
    takeProfit: 1.5,
    stopLoss: 0.8,
    winRate: 'Calculating...',
    description: 'Capitalizes on range-bound markets by identifying overbought/oversold RSI levels for quick scalping entries.',
    riskLevel: 'Low',
  },
  {
    id: 'smart_dca',
    name: 'AI Smart DCA',
    tier: 'starter',
    engine: 'dca',
    indicator: 'RSI',
    takeProfit: 3.0,
    stopLoss: 2.0,
    winRate: 'Calculating...',
    description: 'AI-driven dollar-cost averaging that times entries using RSI momentum for optimized accumulation.',
    riskLevel: 'Low',
  },
  {
    id: 'infinity_grid',
    name: 'Infinity Grid Matrix',
    tier: 'pro',
    engine: 'grid',
    indicator: 'EMA Crossover',
    takeProfit: 1.2,
    stopLoss: 1.5,
    winRate: 'Calculating...',
    description: 'Infinite-grid trading engine that profits from volatility using EMA crossover-anchored grid levels.',
    riskLevel: 'Medium',
  },
  {
    id: 'bull_scalper',
    name: 'Aggressive Bull Scalper',
    tier: 'pro',
    engine: 'scalper',
    indicator: 'MACD',
    takeProfit: 2.5,
    stopLoss: 1.0,
    winRate: 'Calculating...',
    description: 'High-frequency scalper riding MACD momentum bursts in bullish trends for rapid profit capture.',
    riskLevel: 'Medium',
  },
  {
    id: 'smart_martingale',
    name: 'Smart Martingale Recovery',
    tier: 'enterprise',
    engine: 'martingale',
    indicator: 'RSI',
    takeProfit: 2.0,
    stopLoss: 3.5,
    winRate: 'Calculating...',
    description: 'Intelligent martingale recovery system that multiplies position size after losses with RSI-confirmed re-entry.',
    riskLevel: 'High',
  },
  {
    id: 'whale_copier',
    name: 'Whale Copy-Alpha',
    tier: 'enterprise',
    engine: 'copier',
    indicator: 'None',
    takeProfit: 3.0,
    stopLoss: 1.5,
    winRate: 'Calculating...',
    description: 'Mirror-trades whale wallets and institutional flows for alpha generation from large market moves.',
    riskLevel: 'Medium',
  },
  {
    id: 'smc_institutional',
    name: 'SMC Order-Block Sniper',
    tier: 'enterprise',
    engine: 'scalper',
    indicator: 'SMC Order Blocks',
    takeProfit: 4.0,
    stopLoss: 1.0,
    winRate: 'Calculating...',
    description: 'Institutional-grade Smart Money Concept strategy that hunts order blocks and liquidity zones for high-precision entries.',
    riskLevel: 'High',
  },
  {
    id: 'funding_arbitrage',
    name: 'Delta-Neutral Funding Arb',
    tier: 'enterprise',
    engine: 'grid',
    indicator: 'EMA Crossover',
    takeProfit: 1.8,
    stopLoss: 0.6,
    winRate: 'Calculating...',
    description: 'Delta-neutral funding rate arbitrage that captures perpetual funding premiums with minimal directional risk.',
    riskLevel: 'Low',
  },
  {
    id: 'volatility_breakout',
    name: 'AI Volatility Squeeze',
    tier: 'enterprise',
    engine: 'scalper',
    indicator: 'MACD',
    takeProfit: 3.5,
    stopLoss: 1.2,
    winRate: 'Calculating...',
    description: 'Detects volatility squeeze contractions and trades explosive breakouts using MACD momentum confirmation.',
    riskLevel: 'High',
  },
  {
    id: 'quantum_hft',
    name: 'Quantum Mean-Reversion HFT',
    tier: 'enterprise',
    engine: 'dca',
    indicator: 'SMC Order Blocks',
    takeProfit: 2.2,
    stopLoss: 0.7,
    winRate: 'Calculating...',
    description: 'Ultra-fast mean-reversion engine combining SMC order block detection with high-frequency DCA reversion logic.',
    riskLevel: 'Medium',
  },
];

const TIER_RANK: Record<StrategyTier, number> = { starter: 0, pro: 1, enterprise: 2 };
const PLAN_RANK: Record<PlanType, number> = { starter: 0, pro: 1, enterprise: 2 };

export function isStrategyUnlocked(planName: PlanType, strategyId: string): boolean {
  const strategy = STRATEGY_CATALOG.find(s => s.id === strategyId);
  if (!strategy) return false;
  return PLAN_RANK[planName] >= TIER_RANK[strategy.tier];
}

export function getPlanStrategySummary(planName: PlanType): string {
  const unlocked = STRATEGY_CATALOG.filter(s => PLAN_RANK[planName] >= TIER_RANK[s.tier]).length;
  const locked = STRATEGY_CATALOG.length - unlocked;
  return `${unlocked} Unlocked | ${locked} Locked`;
}

export function getUnlockedStrategyIds(planName: PlanType): string[] {
  return STRATEGY_CATALOG
    .filter(s => PLAN_RANK[planName] >= TIER_RANK[s.tier])
    .map(s => s.id);
}

export function getLockedCount(planName: PlanType): number {
  return STRATEGY_CATALOG.length - getUnlockedStrategyIds(planName).length;
}

export function getUpgradePlanForStrategy(strategyId: string): PlanType | null {
  const strategy = STRATEGY_CATALOG.find(s => s.id === strategyId);
  if (!strategy) return null;
  if (strategy.tier === 'pro') return 'pro';
  if (strategy.tier === 'enterprise') return 'enterprise';
  return null;
}

const ENGINE_MAP: Record<string, 'scalper' | 'dca' | 'grid' | 'martingale' | 'copier'> = {
  scalper: 'scalper',
  dca: 'dca',
  grid: 'grid',
  martingale: 'martingale',
  copier: 'copier',
  custom: 'scalper',
};

export function mergeTemplatesWithCatalog(dbTemplates: BotTemplate[]): StrategyEntry[] {
  const result: StrategyEntry[] = [];
  const seen = new Set<string>();

  for (const row of dbTemplates) {
    if (row.status === 'paused') continue;
    const id = row.strategy_id ?? row.id;

    if (seen.has(id)) continue;
    seen.add(id);

    const catalogMatch = STRATEGY_CATALOG.find(s => s.id === row.strategy_id);
    const tier: StrategyTier = (row.required_tier ?? row.tier ?? 'enterprise') as StrategyTier;
    const engine = ENGINE_MAP[row.bot_type ?? 'scalper'] ?? 'scalper';

    if (catalogMatch) {
      result.push({
        ...catalogMatch,
        tier,
        takeProfit: row.take_profit ?? row.default_tp_pct ?? catalogMatch.takeProfit,
        stopLoss: row.stop_loss ?? row.default_sl_pct ?? catalogMatch.stopLoss,
        indicator: row.indicator ?? catalogMatch.indicator,
        winRate: row.win_rate != null ? `${row.win_rate}%` : catalogMatch.winRate,
        description: row.description ?? catalogMatch.description,
      });
    } else {
      result.push({
        id,
        name: row.name,
        tier,
        engine,
        indicator: row.indicator ?? (row.indicators?.[0] ?? 'RSI'),
        takeProfit: row.take_profit ?? row.default_tp_pct ?? 2.5,
        stopLoss: row.stop_loss ?? row.default_sl_pct ?? 1.0,
        winRate: row.win_rate != null ? `${row.win_rate}%` : 'Calculating...',
        description: row.description ?? 'Admin-created custom strategy.',
        riskLevel: row.risk_level ?? 'Medium',
      });
    }
  }

  return result;
}
