export interface ConnectedExchange {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  apiKeyMasked?: string;
}

export interface AdminClient {
  id: string;
  email: string;
  name: string;
  plan: string;
  status: 'active' | 'suspended' | 'banned';
  totalFunds: number;
  unrealizedPnl: number;
  realizedPnl: number;
  activeBots: number;
  manualTrading: boolean;
  joinedDate: string;
  lastActive: string;
  country: string;
  licenseValidUntil: string;
  licenseCycle: 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';
  botLimit: number;
  unlockedStrategies: string[];
  unlockedIndicators: string[];
  connectedExchanges: ConnectedExchange[];
  createdByAdminId?: string | null;
}

export const indianExchanges = ['CoinDCX'] as const;
export type IndianExchange = typeof indianExchanges[number];

export const allStrategies = [
  'Sideways Market Sniper', 'AI Smart DCA', 'Infinity Grid Matrix', 'Aggressive Bull Scalper',
  'Smart Martingale Recovery', 'Whale Copy-Alpha', 'SMC Order-Block Sniper',
  'Delta-Neutral Funding Arb', 'AI Volatility Squeeze', 'Quantum Mean-Reversion HFT',
];

export const allIndicators = [
  'RSI Pro', 'MACD Divergence', 'Bollinger Bands Pro', 'Volume Profile',
  'Ichimoku Cloud', 'Fibonacci Auto', 'Order Blocks', 'Liquidity Zones',
  'VWAP Anchored', 'Market Structure', 'Smart Money Index', 'CVD Pro',
];

export type LicenseCycle = 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';

export const licenseCycleConfig: Record<LicenseCycle, { label: string; multiplier: number; badge: string }> = {
  monthly: { label: 'Monthly', multiplier: 1, badge: 'bg-neon-cyan/15 text-neon-cyan' },
  quarterly: { label: 'Quarterly', multiplier: 2.7, badge: 'bg-neon-green/15 text-neon-green' },
  'half-yearly': { label: 'Half-Yearly', multiplier: 5.2, badge: 'bg-neon-amber/15 text-neon-amber' },
  yearly: { label: 'Yearly', multiplier: 9.6, badge: 'bg-neon-amber/20 text-neon-amber' },
};

export interface LicensePlanConfig {
  id: 'starter' | 'pro' | 'enterprise';
  label: string;
  creditsPerDay: number;
  botLimit: number;
  maxLeverage: number;
  features: string[];
  color: 'cyan' | 'green' | 'amber';
  unlockedStrategiesCount: number;
}

import { PLAN_RULES, type PlanType } from '@/lib/planRules';

const planColorMap: Record<PlanType, 'cyan' | 'green' | 'amber'> = {
  starter: 'cyan',
  pro: 'green',
  enterprise: 'amber',
};

export const licensePlanConfigs: LicensePlanConfig[] = (Object.keys(PLAN_RULES) as PlanType[]).map(id => {
  const rule = PLAN_RULES[id];
  return {
    id,
    label: rule.label,
    creditsPerDay: rule.creditsPerDay,
    botLimit: rule.botLimit ?? 999,
    maxLeverage: rule.maxLeverage,
    features: rule.features,
    color: planColorMap[id],
    unlockedStrategiesCount: rule.unlockedStrategiesCount,
  };
});

export const licenseDurationOptions = [
  { days: 7, label: '7 Days' },
  { days: 30, label: '30 Days' },
  { days: 90, label: '90 Days' },
  { days: 180, label: '180 Days' },
  { days: 365, label: '1 Year' },
];
