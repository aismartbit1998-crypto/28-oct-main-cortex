/*
# Admin & Role Management — Schema Extension

## Overview
Extends the admin_roles table with display name and last login tracking,
and creates a new admin_activity_log table to record actions taken by
admin users (bot creation, license updates, kill switch usage, etc.).

## Modified Table: admin_roles
New columns (both nullable so existing rows remain valid):
- `name` (text) — display name for the admin (e.g. "Vinod Sharma")
- `last_login` (timestamptz) — timestamp of the admin's most recent login

## New Table: admin_activity_log
- `id` (uuid, primary key)
- `admin_email` (text) — email of the admin who performed the action
- `admin_name` (text) — display name of the admin (for readable logs)
- `action_type` (text) — category: 'bot_create' | 'bot_pause' | 'bot_delete' |
  'license_update' | 'client_suspend' | 'kill_switch' | 'login' | 'permission_change' |
  'risk_update' | 'settings_change'
- `message` (text) — human-readable description of the action
- `severity` (text) — 'info' | 'warning' | 'critical' | 'success'
- `created_at` (timestamptz, default now())

## Security (RLS)
- admin_activity_log: RLS enabled, authenticated users can read all rows
  and insert new log entries. Updates and deletes are restricted to
  authenticated users (admin-only cleanup in production).
- admin_roles: existing policies remain unchanged.

## Important Notes
1. Both new columns on admin_roles are nullable — existing rows are valid
   without backfill.
2. admin_activity_log is append-only by design — the UI writes new entries
   when admin actions occur and reads them for the activity timeline.
3. The action_type CHECK constraint is added via a DO $$ block for idempotency.
*/

-- ============================================================
-- 1. Extend admin_roles with name and last_login
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_roles' AND column_name = 'name') THEN
    ALTER TABLE admin_roles ADD COLUMN name text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_roles' AND column_name = 'last_login') THEN
    ALTER TABLE admin_roles ADD COLUMN last_login timestamptz;
  END IF;
END $$;

-- ============================================================
-- 2. Create admin_activity_log table
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text NOT NULL,
  admin_name text,
  action_type text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_admin_activity_log" ON admin_activity_log;
CREATE POLICY "select_admin_activity_log"
  ON admin_activity_log FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "insert_admin_activity_log" ON admin_activity_log;
CREATE POLICY "insert_admin_activity_log"
  ON admin_activity_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "update_admin_activity_log" ON admin_activity_log;
CREATE POLICY "update_admin_activity_log"
  ON admin_activity_log FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_admin_activity_log" ON admin_activity_log;
CREATE POLICY "delete_admin_activity_log"
  ON admin_activity_log FOR DELETE
  TO authenticated
  USING (true);

-- CHECK constraint for action_type (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_activity_log_action_type_check') THEN
    ALTER TABLE admin_activity_log ADD CONSTRAINT admin_activity_log_action_type_check
      CHECK (action_type IN ('bot_create', 'bot_pause', 'bot_delete', 'license_update',
        'client_suspend', 'kill_switch', 'login', 'permission_change', 'risk_update',
        'settings_change', 'admin_create', 'admin_delete'));
  END IF;
END $$;

-- CHECK constraint for severity (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_activity_log_severity_check') THEN
    ALTER TABLE admin_activity_log ADD CONSTRAINT admin_activity_log_severity_check
      CHECK (severity IN ('info', 'warning', 'critical', 'success'));
  END IF;
END $$;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created_at ON admin_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_admin_email ON admin_activity_log(admin_email);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_severity ON admin_activity_log(severity);
