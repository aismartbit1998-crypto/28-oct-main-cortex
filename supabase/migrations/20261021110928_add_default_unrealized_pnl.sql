/*
# Add default 0 to positions.unrealized_pnl

The `unrealized_pnl` column is NOT NULL but had no default.
This caused silent insert failures when the edge function
didn't explicitly set the value. Adding DEFAULT 0 ensures
inserts that omit the column still succeed.

1. Modified columns:
   - `positions.unrealized_pnl` — added DEFAULT 0
*/

ALTER TABLE positions ALTER COLUMN unrealized_pnl SET DEFAULT 0;
