-- Add 'inactive' as a valid status for bots (used when individual bot is closed/terminated)
ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_status_check;
ALTER TABLE bots ADD CONSTRAINT bots_status_check
  CHECK (status IN ('running', 'paused', 'idle', 'paper', 'inactive'));