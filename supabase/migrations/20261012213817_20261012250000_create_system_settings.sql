/*
# Create system_settings table for persistent platform configuration

## Purpose
Stores admin-configurable platform settings (branding, support email, toggles)
so they persist across sessions instead of being lost on reload.

## Changes
1. New table `system_settings` with a single-row pattern (key/value).
2. RLS enabled — only authenticated users can read; only authenticated can write
   (admin gating is enforced by the admin UI, RLS prevents anon access).
*/

CREATE TABLE IF NOT EXISTS public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_settings" ON public.system_settings;
CREATE POLICY "select_settings" ON public.system_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "upsert_settings" ON public.system_settings;
CREATE POLICY "upsert_settings" ON public.system_settings
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_settings" ON public.system_settings;
CREATE POLICY "update_settings" ON public.system_settings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
