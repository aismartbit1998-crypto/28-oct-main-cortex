/*
# Add 'closed_manual' to trades status check constraint

## Problem
The `trades_status_check` constraint only allows: 'open', 'closed_tp', 'closed_sl', 'cancelled'.
The close-single-position edge function and frontend both update status to 'closed_manual',
which violates this constraint and crashes with:
  "new row for relation trades violates check constraint trades_status_check"

## Fix
Drop the old constraint and recreate it with 'closed_manual' added to the allowed values.

## No data loss
This only modifies a CHECK constraint, not any data.
*/

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_status_check;
ALTER TABLE trades ADD CONSTRAINT trades_status_check
  CHECK (status = ANY (ARRAY['open'::text, 'closed_tp'::text, 'closed_sl'::text, 'closed_manual'::text, 'cancelled'::text]));
