/*
# Add 'daily_limit' status to bots CHECK constraint

1. Modified Tables
- `bots`: adds 'daily_limit' to the allowed status values.
  This status is set by the strategy-runner when a bot hits its
  max_daily_loss, max_daily_profit, or max_trades_per_day limit.
  The bot stays in this status until UTC midnight, at which point
  the strategy-runner automatically reverts it to 'running'.
  Unlike 'paused' (which requires manual restart), 'daily_limit'
  is fully autonomous — the bot wakes up and resumes trading on
  its own the next day.
2. Security
- No RLS or policy changes — this only widens the CHECK constraint.
*/

ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_status_check;
ALTER TABLE bots ADD CONSTRAINT bots_status_check
  CHECK (status = ANY (ARRAY['running'::text, 'paused'::text, 'idle'::text, 'paper'::text, 'inactive'::text, 'cooldown'::text, 'daily_limit'::text]));
