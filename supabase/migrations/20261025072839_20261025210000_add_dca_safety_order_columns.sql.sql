/*
# Strategy-aware atomic locks — DCA support

## Why
The previous migration enforced "max 1 active position per bot" via a unique
partial index on (bot_id) WHERE status IN ('open','pending'). This is correct
for Scalping/Custom/Martingale/Grid bots, but it breaks the AI Smart DCA
strategy: DCA must place safety orders (average down) WHILE the primary
position is still OPEN. DCA never opens a second position row — it updates the
existing OPEN row's entry_price (weighted average) and quantity.

## What this adds
1. `bots.dca_price_deviation_pct` — required price drop (%) from the last
   safety/entry price before a DCA safety order may fire. Default 1.0%.
2. `bots.dca_max_safety_orders` — maximum safety orders per DCA cycle.
   Default 5. After this, no more averaging down until the position closes.
3. `bots.dca_safety_order_multiplier` — size multiplier for each safety order
   relative to the base order (e.g. 1.5 = each safety order is 1.5x base).
   Default 1.0.
4. `positions.dca_safety_orders_count` — running count of safety orders
   filled for this position. 0 = base order only.
5. `positions.dca_last_safety_price` — price at which the last safety order
   (or the base order) filled. The next safety order requires the live price
   to have fallen by `dca_price_deviation_pct` from this value.
6. `positions.dca_last_safety_at` — timestamp of the last safety/base fill.
   Used as a same-millisecond spam guard: a safety order is only allowed if
   at least 30s have elapsed since the last fill.

No change to the unique partial index is required: DCA safety orders UPDATE
the existing OPEN position row; they never INSERT a second row, so the
"one active position per bot" guarantee still holds and still prevents
duplicate API spam.
*/

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS dca_price_deviation_pct numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS dca_max_safety_orders integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS dca_safety_order_multiplier numeric DEFAULT 1.0;

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS dca_safety_orders_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dca_last_safety_price numeric,
  ADD COLUMN IF NOT EXISTS dca_last_safety_at timestamptz;
