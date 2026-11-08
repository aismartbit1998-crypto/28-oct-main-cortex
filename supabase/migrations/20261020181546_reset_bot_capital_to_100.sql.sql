-- Reset all bot capital/margin values to Rs 100 default
-- Prevents 400 Insufficient Funds errors from dummy/testing data
UPDATE bots SET capital = 100 WHERE capital IS NULL OR capital != 100;

-- Ensure future bots default to 100 if not specified
ALTER TABLE bots ALTER COLUMN capital SET DEFAULT 100;
