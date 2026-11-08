/*
# Add USD/INR Currency Rate Columns to risk_settings

1. Modified Tables
- `risk_settings`
  - `live_usd_inr_rate` (numeric, default 83.5) — stores the live market USD→INR exchange rate fetched from public API
  - `manual_usd_inr_rate` (numeric, nullable) — when set, overrides the live rate across the entire platform
  - `rate_updated_at` (timestamptz, nullable) — timestamp of the last live rate fetch

2. Notes
- The admin panel reads/writes `manual_usd_inr_rate` to override the live rate.
- The frontend CurrencyContext reads `manual_usd_inr_rate` first; if null, uses `live_usd_inr_rate`.
- No RLS changes needed — existing risk_settings policies already cover these columns.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_settings' AND column_name = 'live_usd_inr_rate') THEN
    ALTER TABLE risk_settings ADD COLUMN live_usd_inr_rate numeric NOT NULL DEFAULT 83.5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_settings' AND column_name = 'manual_usd_inr_rate') THEN
    ALTER TABLE risk_settings ADD COLUMN manual_usd_inr_rate numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_settings' AND column_name = 'rate_updated_at') THEN
    ALTER TABLE risk_settings ADD COLUMN rate_updated_at timestamptz;
  END IF;
END $$;
