-- Phase 1: Deduplicate bot_templates and add required_tier + UNIQUE(name)
-- The table currently has 13 rows (3 old duplicates without strategy_id + 10 seeded).
-- We keep only the 10 canonical strategies (those with strategy_id) and delete the rest.

-- Add required_tier column (defaults to 'enterprise' so new admin-built bots are locked to Enterprise)
ALTER TABLE bot_templates ADD COLUMN IF NOT EXISTS required_tier text NOT NULL DEFAULT 'enterprise';

-- Add take_profit, stop_loss, indicator columns for admin-created custom bots
ALTER TABLE bot_templates ADD COLUMN IF NOT EXISTS take_profit numeric DEFAULT 2.5;
ALTER TABLE bot_templates ADD COLUMN IF NOT EXISTS stop_loss numeric DEFAULT 1.0;
ALTER TABLE bot_templates ADD COLUMN IF NOT EXISTS indicator text DEFAULT 'RSI';

-- Delete the 3 old duplicate rows (those WITHOUT a strategy_id — they're leftovers from the original 3 bots)
DELETE FROM bot_templates WHERE strategy_id IS NULL;

-- Set required_tier for the 10 canonical strategies based on their tier column
UPDATE bot_templates SET required_tier = 'starter' WHERE strategy_id IN ('sideways_sniper', 'smart_dca');
UPDATE bot_templates SET required_tier = 'pro' WHERE strategy_id IN ('infinity_grid', 'bull_scalper');
UPDATE bot_templates SET required_tier = 'enterprise' WHERE strategy_id IN ('smart_martingale', 'whale_copier', 'smc_institutional', 'funding_arbitrage', 'volatility_breakout', 'quantum_hft');

-- Ensure take_profit/stop_loss/indicator are populated for all 10 strategies from existing columns
UPDATE bot_templates SET take_profit = default_tp_pct WHERE take_profit IS NULL OR take_profit = 2.5;
UPDATE bot_templates SET stop_loss = default_sl_pct WHERE stop_loss IS NULL OR stop_loss = 1.0;
UPDATE bot_templates SET indicator = COALESCE(indicator, 'RSI') WHERE indicator IS NULL;

-- Sync the tier column to match required_tier (tier was added in prior migration but may be null for custom bots)
UPDATE bot_templates SET tier = required_tier WHERE tier IS NULL OR tier <> required_tier;

-- Add UNIQUE constraint on name to prevent future duplicates
-- First clean up any remaining dupes (shouldn't be any after the DELETE above)
DELETE FROM bot_templates ct1 USING bot_templates ct2
  WHERE ct1.name = ct2.name AND ct1.id > ct2.id;

ALTER TABLE bot_templates ADD CONSTRAINT bot_templates_name_unique UNIQUE (name);
