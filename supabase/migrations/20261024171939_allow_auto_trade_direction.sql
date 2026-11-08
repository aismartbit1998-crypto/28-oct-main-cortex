/*
# Allow 'auto' as a valid trade_direction value

1. Changes
- Adds a CHECK constraint on `bots.trade_direction` allowing 'long', 'short', 'auto', or NULL.
- Supports the new "Auto (AI Sensing)" direction in the bot builder UI.
2. Security
- No RLS or policy changes.
*/

ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_trade_direction_check;

ALTER TABLE bots ADD CONSTRAINT bots_trade_direction_check
  CHECK (trade_direction IS NULL OR trade_direction IN ('long', 'short', 'auto'));
