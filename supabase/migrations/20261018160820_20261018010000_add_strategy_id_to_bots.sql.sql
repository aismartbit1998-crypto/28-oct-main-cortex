-- Add strategy_id to bots table so execute-trade and strategy-runner can validate plan tiers
ALTER TABLE bots ADD COLUMN IF NOT EXISTS strategy_id text;
