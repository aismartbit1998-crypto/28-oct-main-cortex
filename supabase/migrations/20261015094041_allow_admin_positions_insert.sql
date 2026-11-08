/*
# Allow platform admins to insert/update positions for any user

## Problem
The `positions` table INSERT/UPDATE/DELETE policies require `auth.uid() = user_id`,
which blocks admins from creating manual trades on behalf of clients. The `trades`
table already has `is_platform_admin()` carve-outs; positions does not.

## Changes
- DROP and recreate the INSERT, UPDATE, and DELETE policies on `positions`
  to add `OR public.is_platform_admin()` alongside the existing ownership check.
- SELECT policy unchanged (already owner-only, which is correct).

## Security
- `is_platform_admin()` checks `admin_roles` table for the caller's role.
- Non-admin users are still restricted to their own rows.
*/

DROP POLICY IF EXISTS "insert_own_positions" ON positions;
CREATE POLICY "insert_own_positions"
ON positions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR public.is_platform_admin());

DROP POLICY IF EXISTS "update_own_positions" ON positions;
CREATE POLICY "update_own_positions"
ON positions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id OR public.is_platform_admin())
WITH CHECK (auth.uid() = user_id OR public.is_platform_admin());

DROP POLICY IF EXISTS "delete_own_positions" ON positions;
CREATE POLICY "delete_own_positions"
ON positions FOR DELETE
TO authenticated
USING (auth.uid() = user_id OR public.is_platform_admin());
