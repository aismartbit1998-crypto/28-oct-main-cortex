/*
# Add 'pending' status and enforce one active position per bot (atomic lock)

## Why
The trading engine was sending duplicate MARKET orders to the connected
exchange within minutes. Root cause: between the moment the engine
decides to trade and the moment it writes the resulting position row to
Supabase, the next cron minute (or a repeated user click) re-evaluated
`positions = 0` for the bot and fired ANOTHER real order — draining the
live exchange account while the DB/UI still reported "SKIP / FAILED".

## Fix
This migration guarantees that a bot can hold AT MOST ONE position in an
active state ('open' or 'pending') at any time, enforced atomically by
the database itself — not by application code that races.

1. New constraint
   - `positions_status_check`: allows 'open', 'pending', 'closed_tp',
     'closed_sl', 'closed_manual'. (The table previously had no status
     CHECK constraint, so 'pending' already inserts fine, but adding the
     check makes the allowed set explicit and prevents typos.)
2. New unique partial index
   - `uniq_one_active_position_per_bot`: UNIQUE (bot_id) WHERE status IN
     ('open', 'pending'). This is the atomic lock: the FIRST insert of a
     pending/open row for a bot succeeds; every concurrent/late second
     insert for the same bot raises a unique-violation and is aborted
     BEFORE any exchange API call. (NULL bot_id rows are ignored by
     Postgres unique semantics, so manual/admin positions are unaffected.)
3. Performance
   - The partial index is tiny (only active rows) and also serves the
     hot lookup `WHERE bot_id = X AND status IN ('open','pending')`.
*/

ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_status_check;
ALTER TABLE positions ADD CONSTRAINT positions_status_check
  CHECK (status = ANY (ARRAY['open'::text, 'pending'::text, 'closed_tp'::text, 'closed_sl'::text, 'closed_manual'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_active_position_per_bot
  ON positions (bot_id)
  WHERE status IN ('open', 'pending') AND bot_id IS NOT NULL;
