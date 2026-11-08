import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export interface Profile {
  id: string;
  email: string;
  disclaimer_accepted: boolean;
  disclaimer_accepted_at: string | null;
  created_at: string;
}

export interface LicenseInfo {
  id: string;
  plan_name: 'starter' | 'pro' | 'enterprise';
  is_active: boolean;
  valid_until: string | null;
  bot_limit: number;
}

export interface Bot {
  id: string;
  user_id: string;
  name: string;
  market_type: 'spot' | 'futures';
  coin: string;
  strategy: 'scalping' | 'grid' | 'trailing' | 'scalper' | 'dca' | 'copier' | 'martingale' | 'custom';
  status: 'running' | 'paused' | 'idle' | 'paper' | 'inactive' | 'daily_limit';
  profit_loss: number;
  created_at: string;
  trade_direction: 'long' | 'short' | 'auto' | null;
  bot_type: 'scalper' | 'dca' | 'grid' | 'copier' | 'martingale' | null;
  martingale_multiplier: number | null;
  max_martingale_steps: number | null;
  order_type: 'market' | 'limit' | null;
  leverage: number | null;
  capital: number | null;
  indicators_enabled: boolean | null;
  indicator: string | null;
  quantity_mode: 'fixed' | 'percent' | null;
  quantity_value: number | null;
  percent_value: number | null;
  max_trades_per_day: number | null;
  rr_ratio: number | null;
  tp_sl_mode: 'percentage' | 'fixed' | null;
  take_profit: number | null;
  stop_loss: number | null;
  tp_fixed: number | null;
  sl_fixed: number | null;
  trailing_enabled: boolean | null;
  trailing_distance: number | null;
  max_daily_loss: number | null;
  max_daily_profit: number | null;
  cooldown_minutes: number | null;
  is_paper_mode: boolean | null;
  strategy_id: string | null;
}

export interface TradeHistory {
  id: string;
  user_id: string;
  bot_id: string | null;
  coin: string | null;
  timestamp: string;
  pair: string;
  side: 'BUY' | 'SELL';
  amount: number;
  price: number;
  pnl: number;
  leverage: number | null;
  margin_used: number | null;
  entry_price: number | null;
  exit_price: number | null;
  realized_pnl: number | null;
  closed_at: string | null;
  status: string | null;
  strategy: string | null;
}

export interface BrokerKey {
  id: string;
  user_id: string;
  exchange_name: string;
  api_key: string;
  is_connected: boolean;
  created_at: string;
}

export interface Signal {
  id: string;
  coin: string;
  type: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  entry: number;
  target: number;
  stop_loss: number;
  timeframe: string;
  source: string;
  created_at: string;
}

export interface BrokerApiLog {
  id: string;
  user_id: string;
  broker: string;
  endpoint: string;
  status: 'success' | 'error' | 'pending';
  latency_ms: number;
  detail: string | null;
  created_at: string;
}

// Admin panel types

export interface License {
  id: string;
  user_id: string | null;
  plan_name: 'starter' | 'pro' | 'enterprise';
  bot_limit: number;
  is_active: boolean;
  valid_from: string;
  valid_until: string | null;
  monthly_fee: number;
  license_key: string | null;
  allowed_bots: string[] | null;
  payment_reference: string | null;
  payment_screenshot_url: string | null;
  created_at: string;
}

export interface AdminRole {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  role: 'super_admin' | 'sub_admin';
  permissions: Record<string, boolean>;
  is_active: boolean;
  credit_balance: number;
  last_login: string | null;
  created_at: string;
}

export interface AdminActivityLog {
  id: string;
  admin_email: string;
  admin_name: string | null;
  action_type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  created_at: string;
}

export interface UserFund {
  id: string;
  user_id: string;
  exchange_name: string;
  balance: number;
  unrealized_pnl: number;
  realized_pnl: number;
  manual_trading_enabled: boolean;
  breakdown: Array<{ currency: string; balance: number; locked_balance: number; total: number }> | null;
  source: 'futures' | 'spot' | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface RiskSettings {
  id: string;
  global_kill_switch: boolean;
  max_leverage: number;
  max_daily_loss_pct: number;
  api_health_alerts: boolean;
  auto_disable_on_breach: boolean;
  updated_at: string;
  live_usd_inr_rate: number;
  manual_usd_inr_rate: number | null;
  rate_updated_at: string | null;
  ai_circuit_breaker: boolean;
  max_slippage_pct: number;
}

export interface BotTemplate {
  id: string;
  name: string;
  description: string | null;
  strategy_type: 'scalping' | 'grid' | 'trailing' | 'dca' | 'martingale' | 'copier';
  market_type: 'spot' | 'futures';
  default_tp_pct: number;
  default_sl_pct: number;
  risk_level: 'Low' | 'Medium' | 'High';
  is_public: boolean;
  total_copies: number;
  created_at: string;
  bot_type: 'scalper' | 'dca' | 'grid' | 'copier' | 'martingale' | 'custom' | null;
  strategy_id: string | null;
  tier: 'starter' | 'pro' | 'enterprise' | null;
  required_tier: 'starter' | 'pro' | 'enterprise';
  indicator: string | null;
  take_profit: number | null;
  stop_loss: number | null;
  martingale_multiplier: number | null;
  max_martingale_steps: number | null;
  execution_mode: 'auto' | 'manual' | null;
  strategies: string[] | null;
  indicators: string[] | null;
  max_drawdown_pct: number | null;
  tp_sl_ratio: number | null;
  max_leverage: number | null;
  source_exchanges: string[] | null;
  overall_pnl: number | null;
  active_users: number | null;
  status: 'active' | 'paused' | null;
  win_rate: number | null;
  expected_return: string | null;
  strategy_settings: {
    strategy_mode: 'rule_based' | 'manual_signal' | 'ai_strategy';
    trade_sizing: 'fixed_quote' | 'percent_balance' | 'risk_based';
    sizing_value: number;
    risk_per_trade_pct: number;
    max_notional: number;
    trailing_enabled: boolean;
    trailing_distance_pct: number;
    exchange: string;
    trading_pairs: string[];
  } | null;
  risk_settings: {
    max_trades_per_day: number;
    max_daily_loss_threshold: number;
  } | null;
}

export interface ApiSettings {
  id: string;
  openai_api_key: string | null;
  anthropic_api_key: string | null;
  deepseek_api_key: string | null;
  gemini_api_key: string | null;
  coingecko_api_key: string | null;
  coinmarketcap_api_key: string | null;
  tradingview_license_key: string | null;
  binance_api_key: string | null;
  binance_api_secret: string | null;
  coindcx_api_key: string | null;
  coindcx_api_secret: string | null;
  delta_api_key: string | null;
  delta_api_secret: string | null;
  wazirx_api_key: string | null;
  wazirx_api_secret: string | null;
  pi42_api_key: string | null;
  pi42_api_secret: string | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  client_name: string;
  client_email: string | null;
  plan_name: string;
  amount: number;
  currency: string;
  status: 'completed' | 'pending' | 'failed' | 'refunded';
  payment_method: string | null;
  created_at: string;
}

export interface Trade {
  id: string;
  client_id: string | null;
  client_name: string | null;
  coin: string;
  market_type: 'spot' | 'futures';
  direction: 'long' | 'short';
  entry_price: number;
  amount: number;
  quantity: number;
  leverage: number;
  position_size: number;
  tp_pct: number | null;
  sl_pct: number | null;
  status: 'open' | 'closed_tp' | 'closed_sl' | 'cancelled';
  executed_by: string;
  created_at: string;
}

export interface ClientUpdate {
  id: string;
  client_id: string | null;
  update_type: 'plan_change' | 'status_change' | 'license_update' | 'risk_action';
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  executed_by: string;
  created_at: string;
}

export interface MasterTrader {
  id: string;
  name: string;
  bio: string | null;
  exchange: string | null;
  strategy: string | null;
  market: string | null;
  roi_percentage: number;
  win_rate: number;
  active_copiers: number;
  risk_level: 'Low' | 'Medium' | 'High';
  max_drawdown: number | null;
  commission_pct: number;
  status: 'active' | 'paused';
  created_at: string;
}

export interface SentimentScore {
  id: string;
  overall_score: number;
  classification: string;
  fear_greed_index: number;
  news_sentiment_score: number;
  news_sentiment_label: string;
  bullish_percentage: number;
  bearish_percentage: number;
  ai_summary: string | null;
  recommendation: string | null;
  long_entries_blocked: boolean;
  trailing_tightened: boolean;
  created_at: string;
}

export interface Position {
  id: string;
  bot_id: string | null;
  user_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entry_price: number;
  quantity: number;
  leverage: number;
  take_profit_pct: number | null;
  stop_loss_pct: number | null;
  trailing_enabled: boolean;
  trailing_distance_pct: number | null;
  current_stop_loss: number | null;
  take_profit_amount: number | null;
  fixed_profit: number | null;
  fixed_loss: number | null;
  highest_price: number | null;
  lowest_price: number | null;
  unrealized_pnl: number;
  status: 'open' | 'closed_tp' | 'closed_sl' | 'closed_manual';
  is_paper: boolean;
  exchange_order_id: string | null;
  exchange_position_id: string | null;
  exchange_sl_order_id: string | null;
  exchange_tp_order_id: string | null;
  max_daily_loss: number | null;
  max_daily_profit: number | null;
  closed_at: string | null;
  close_price: number | null;
  close_pnl: number | null;
  created_at: string;
  updated_at: string;
}
