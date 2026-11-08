-- Expand bots_strategy_check to include all bot types used by the UI.
-- The old constraint only allowed 'scalping', 'grid', 'trailing' but the
-- frontend sends 'scalper', 'dca', 'grid', 'copier', 'martingale'.
ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_strategy_check;
ALTER TABLE bots ADD CONSTRAINT bots_strategy_check
  CHECK (strategy = ANY (ARRAY['scalper'::text, 'scalping'::text, 'dca'::text, 'grid'::text, 'copier'::text, 'martingale'::text, 'trailing'::text, 'custom'::text]));
