/*
# Extend wallet sync metadata

1. Modified table
- `user_funds.breakdown` stores the exchange wallet rows returned during the latest read-only sync.
- `user_funds.source` records whether the displayed balance came from the futures or spot wallet.

2. Data safety
- Existing rows are preserved.
- Both new columns are nullable so earlier wallet records remain valid.
- The existing unique index on `(user_id, exchange_name)` remains in place for safe upserts.

3. Security
- No RLS policies or grants are changed.
- Wallet data remains protected by the existing authenticated user policies.

4. Important notes
- This metadata is informational only and does not enable deposits, withdrawals, transfers, or order actions.
*/

ALTER TABLE public.user_funds
  ADD COLUMN IF NOT EXISTS breakdown jsonb,
  ADD COLUMN IF NOT EXISTS source text;

CREATE UNIQUE INDEX IF NOT EXISTS user_funds_user_exchange_unique
  ON public.user_funds (user_id, exchange_name);