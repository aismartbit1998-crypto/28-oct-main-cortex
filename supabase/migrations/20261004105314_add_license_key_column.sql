/*
# Add license_key to licenses table

## Overview
Adds a license_key column to the existing licenses table to support the
License Generator feature in the admin panel. Generated keys follow the
format CORTEX-<TIER>-<XXXX> (e.g. CORTEX-PRO-A7F2).

## Modified Table: licenses
- `license_key` (text, nullable, unique) — human-readable license key

## Security
- No new tables. Existing RLS policies remain unchanged.
- A unique index is added to prevent duplicate keys.

## Important Notes
1. Column is nullable so existing rows remain valid without backfill.
2. Unique constraint prevents duplicate keys from being generated.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'licenses' AND column_name = 'license_key') THEN
    ALTER TABLE licenses ADD COLUMN license_key text;
  END IF;
END $$;

-- Unique constraint (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licenses_license_key_key') THEN
    ALTER TABLE licenses ADD CONSTRAINT licenses_license_key_key UNIQUE (license_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_licenses_license_key ON licenses(license_key) WHERE license_key IS NOT NULL;
