/*
# Create copy_relationships table for copy trading persistence

## Purpose
Stores which master traders each user is copying so the copy action persists.

## Changes
1. New table `copy_relationships` with user_id, trader_id, status, created_at.
2. RLS enabled with 4 policies scoped to authenticated users owning their rows.
*/

CREATE TABLE IF NOT EXISTS public.copy_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trader_id uuid NOT NULL REFERENCES public.master_traders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, trader_id)
);

ALTER TABLE public.copy_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_copy_rels" ON public.copy_relationships;
CREATE POLICY "select_own_copy_rels" ON public.copy_relationships
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_copy_rels" ON public.copy_relationships;
CREATE POLICY "insert_own_copy_rels" ON public.copy_relationships
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_copy_rels" ON public.copy_relationships;
CREATE POLICY "update_own_copy_rels" ON public.copy_relationships
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_copy_rels" ON public.copy_relationships;
CREATE POLICY "delete_own_copy_rels" ON public.copy_relationships
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
