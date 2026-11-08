-- Expand bot_type check to include martingale and custom (matching the 10-strategy catalog)
ALTER TABLE bot_templates DROP CONSTRAINT IF EXISTS bot_templates_bot_type_check;
ALTER TABLE bot_templates ADD CONSTRAINT bot_templates_bot_type_check
  CHECK (bot_type IS NULL OR bot_type = ANY (ARRAY['scalper','dca','grid','copier','martingale','custom']));

-- Expand strategy_type check to include martingale and copier engines
ALTER TABLE bot_templates DROP CONSTRAINT IF EXISTS bot_templates_strategy_type_check;
ALTER TABLE bot_templates ADD CONSTRAINT bot_templates_strategy_type_check
  CHECK (strategy_type = ANY (ARRAY['scalping','grid','trailing','dca','martingale','copier']));

-- Add columns for admin-controlled strategy sync
ALTER TABLE bot_templates ADD COLUMN IF NOT EXISTS strategy_id text UNIQUE;
ALTER TABLE bot_templates ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE bot_templates ADD COLUMN IF NOT EXISTS indicator text;

-- Seed all 10 institutional AI strategies (idempotent upsert via strategy_id)
INSERT INTO bot_templates (strategy_id, name, description, bot_type, tier, indicator, default_tp_pct, default_sl_pct, risk_level, win_rate, strategy_type, market_type, status, is_public, strategies, indicators)
VALUES
  ('sideways_sniper', 'Sideways Market Sniper', 'Capitalizes on range-bound markets by identifying overbought/oversold RSI levels for quick scalping entries.', 'scalper', 'starter', 'RSI', 1.5, 0.8, 'Low', 78, 'scalping', 'spot', 'active', true, '["scalping"]'::jsonb, '["RSI"]'::jsonb),
  ('smart_dca', 'AI Smart DCA', 'AI-driven dollar-cost averaging that times entries using RSI momentum for optimized accumulation.', 'dca', 'starter', 'RSI', 3.0, 2.0, 'Low', 84, 'dca', 'spot', 'active', true, '["dca"]'::jsonb, '["RSI"]'::jsonb),
  ('infinity_grid', 'Infinity Grid Matrix', 'Infinite-grid trading engine that profits from volatility using EMA crossover-anchored grid levels.', 'grid', 'pro', 'EMA Crossover', 1.2, 1.5, 'Medium', 81, 'grid', 'spot', 'active', true, '["grid"]'::jsonb, '["EMA Crossover"]'::jsonb),
  ('bull_scalper', 'Aggressive Bull Scalper', 'High-frequency scalper riding MACD momentum bursts in bullish trends for rapid profit capture.', 'scalper', 'pro', 'MACD', 2.5, 1.0, 'Medium', 76, 'scalping', 'futures', 'active', true, '["scalping"]'::jsonb, '["MACD"]'::jsonb),
  ('smart_martingale', 'Smart Martingale Recovery', 'Intelligent martingale recovery system that multiplies position size after losses with RSI-confirmed re-entry.', 'martingale', 'enterprise', 'RSI', 2.0, 3.5, 'High', 88, 'martingale', 'futures', 'active', true, '["martingale"]'::jsonb, '["RSI"]'::jsonb),
  ('whale_copier', 'Whale Copy-Alpha', 'Mirror-trades whale wallets and institutional flows for alpha generation from large market moves.', 'copier', 'enterprise', 'None', 3.0, 1.5, 'Medium', 74, 'copier', 'spot', 'active', true, '["copier"]'::jsonb, '[]'::jsonb),
  ('smc_institutional', 'SMC Order-Block Sniper', 'Institutional-grade Smart Money Concept strategy that hunts order blocks and liquidity zones for high-precision entries.', 'scalper', 'enterprise', 'SMC Order Blocks', 4.0, 1.0, 'High', 86, 'scalping', 'futures', 'active', true, '["scalping","smc"]'::jsonb, '["SMC Order Blocks"]'::jsonb),
  ('funding_arbitrage', 'Delta-Neutral Funding Arb', 'Delta-neutral funding rate arbitrage that captures perpetual funding premiums with minimal directional risk.', 'grid', 'enterprise', 'EMA Crossover', 1.8, 0.6, 'Low', 91, 'grid', 'futures', 'active', true, '["grid","arbitrage"]'::jsonb, '["EMA Crossover"]'::jsonb),
  ('volatility_breakout', 'AI Volatility Squeeze', 'Detects volatility squeeze contractions and trades explosive breakouts using MACD momentum confirmation.', 'scalper', 'enterprise', 'MACD', 3.5, 1.2, 'High', 79, 'scalping', 'futures', 'active', true, '["scalping","breakout"]'::jsonb, '["MACD"]'::jsonb),
  ('quantum_hft', 'Quantum Mean-Reversion HFT', 'Ultra-fast mean-reversion engine combining SMC order block detection with high-frequency DCA reversion logic.', 'dca', 'enterprise', 'SMC Order Blocks', 2.2, 0.7, 'Medium', 89, 'dca', 'futures', 'active', true, '["dca","hft"]'::jsonb, '["SMC Order Blocks"]'::jsonb)
ON CONFLICT (strategy_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  bot_type = EXCLUDED.bot_type,
  tier = EXCLUDED.tier,
  indicator = EXCLUDED.indicator,
  default_tp_pct = EXCLUDED.default_tp_pct,
  default_sl_pct = EXCLUDED.default_sl_pct,
  risk_level = EXCLUDED.risk_level,
  win_rate = EXCLUDED.win_rate;
