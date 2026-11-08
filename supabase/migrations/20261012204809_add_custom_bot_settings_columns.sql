/*
# Add strategy_settings and risk_settings JSONB columns to bot_templates

1. New Columns
- `strategy_settings` (jsonb, nullable): Stores custom bot strategy configuration
  including strategy_mode, trade_sizing, sizing_value, trailing_enabled, trailing_distance.
- `risk_settings` (jsonb, nullable): Stores custom bot risk configuration including
  max_trades_per_day, max_daily_loss_threshold.

2. Modified Tables
- `bot_templates`: Added two nullable JSONB columns for custom bot configuration.
  Existing pre-packaged bots (Scalper, DCA, Grid, etc.) are unaffected — these
  columns are nullable and only populated for custom-built bots.

3. Security
- No RLS changes. Existing policies remain intact.

4. Important Notes
- These columns are additive only. No data is lost.
- The `bot_type` column now also accepts 'custom' for bots created via the
  Custom Mathematical Bot Builder.
- Pre-packaged bots continue to use their existing bot_type values.
*/

ALTER TABLE bot_templates
  ADD COLUMN IF NOT EXISTS strategy_settings jsonb DEFAULT NULL;

ALTER TABLE bot_templates
  ADD COLUMN IF NOT EXISTS risk_settings jsonb DEFAULT NULL;
