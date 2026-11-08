/*
# Ensure one wallet balance row per user and exchange

1. Change
- Add a unique index on `user_funds(user_id, exchange_name)`.
- This allows the wallet sync Edge Function to update an existing exchange balance instead of creating duplicates.

2. Data safety
- No rows are deleted or modified.
- Existing duplicate rows were checked before this change and none were found.

3. Security
- No RLS policies or grants are changed.

4. Important notes
- The index supports the existing wallet sync upsert operation.
- A user can still connect different exchanges; only duplicate rows for the same user and exchange are prevented.
*/

CREATE UNIQUE INDEX IF NOT EXISTS user_funds_user_exchange_unique
  ON public.user_funds (user_id, exchange_name);