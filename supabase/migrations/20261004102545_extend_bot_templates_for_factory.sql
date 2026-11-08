/*
# Extend bot_templates for Advanced Bot Factory

## Overview
Adds new columns to the existing bot_templates table to support the advanced
"AI Smart Bot Builder & Manager" in the admin panel. The new columns capture
bot type (Scalper/DCA/Grid/Copier), execution mode (auto/manual), injected
strategies and indicators as arrays, risk parameters (max drawdown, leverage),
PnL tracking, active user count, source exchange accounts for copier bots,
and a status field for pause/resume.

## Modified Table: bot_templates
New columns added (all nullable / defaulted so existing rows remain valid):
- `bot_type` (text) — 'scalper' | 'dca' | 'grid' | 'copier' — high-level bot archetype
- `execution_mode` (text) — 'auto' | 'manual' — fully auto-trade or manual signal approval
- `strategies` (jsonb) — array of strategy names injected into bot logic (e.g. ["Order Blocks","SMC","Arbitrage"])
- `indicators` (jsonb) — array of indicator names injected into bot logic (e.g. ["RSI Pro","MACD"])
- `max_drawdown_pct` (numeric) — maximum allowed drawdown percentage
- `tp_sl_ratio` (numeric) — take-profit to stop-loss ratio (e.g. 2.5 means TP is 2.5x SL)
- `max_leverage` (int) — leverage limit for this bot
- `source_exchanges` (jsonb) — array of source exchange account names for copier bots
- `overall_pnl` (numeric) — aggregate PnL across all users running this bot
- `active_users` (int) — count of users currently running this bot
- `status` (text) — 'active' | 'paused' — bot availability state

## Security
- No new tables. Existing RLS policies on bot_templates remain in effect
  (authenticated CRUD, all rows visible to authenticated users).

## Important Notes
1. All new columns are nullable or have defaults so existing seed rows
   remain valid without backfill.
2. The CHECK constraints on bot_type, execution_mode, and status are added
   via DO $$ blocks to be idempotent.
3. strategies, indicators, and source_exchanges use jsonb arrays for
   flexible multi-select storage.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'bot_type') THEN
    ALTER TABLE bot_templates ADD COLUMN bot_type text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'execution_mode') THEN
    ALTER TABLE bot_templates ADD COLUMN execution_mode text DEFAULT 'auto';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'strategies') THEN
    ALTER TABLE bot_templates ADD COLUMN strategies jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'indicators') THEN
    ALTER TABLE bot_templates ADD COLUMN indicators jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'max_drawdown_pct') THEN
    ALTER TABLE bot_templates ADD COLUMN max_drawdown_pct numeric DEFAULT 15;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'tp_sl_ratio') THEN
    ALTER TABLE bot_templates ADD COLUMN tp_sl_ratio numeric DEFAULT 2;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'max_leverage') THEN
    ALTER TABLE bot_templates ADD COLUMN max_leverage integer DEFAULT 20;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'source_exchanges') THEN
    ALTER TABLE bot_templates ADD COLUMN source_exchanges jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'overall_pnl') THEN
    ALTER TABLE bot_templates ADD COLUMN overall_pnl numeric DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'active_users') THEN
    ALTER TABLE bot_templates ADD COLUMN active_users integer DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'status') THEN
    ALTER TABLE bot_templates ADD COLUMN status text DEFAULT 'active';
  END IF;
END $$;

-- Backfill existing rows with sensible defaults for new columns
UPDATE bot_templates SET bot_type = CASE
    WHEN strategy_type = 'scalping' THEN 'scalper'
    WHEN strategy_type = 'dca' THEN 'dca'
    WHEN strategy_type = 'grid' THEN 'grid'
    ELSE 'scalper'
  END
  WHERE bot_type IS NULL;

UPDATE bot_templates SET execution_mode = 'auto' WHERE execution_mode IS NULL;
UPDATE bot_templates SET strategies = '[]'::jsonb WHERE strategies IS NULL;
UPDATE bot_templates SET indicators = '[]'::jsonb WHERE indicators IS NULL;
UPDATE bot_templates SET source_exchanges = '[]'::jsonb WHERE source_exchanges IS NULL;
UPDATE bot_templates SET status = 'active' WHERE status IS NULL;
UPDATE bot_templates SET overall_pnl = 0 WHERE overall_pnl IS NULL;
UPDATE bot_templates SET active_users = total_copies WHERE active_users IS NULL;

-- Add CHECK constraints idempotently
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_templates_bot_type_check') THEN
    ALTER TABLE bot_templates ADD CONSTRAINT bot_templates_bot_type_check
      CHECK (bot_type IS NULL OR bot_type IN ('scalper', 'dca', 'grid', 'copier'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_templates_execution_mode_check') THEN
    ALTER TABLE bot_templates ADD CONSTRAINT bot_templates_execution_mode_check
      CHECK (execution_mode IS NULL OR execution_mode IN ('auto', 'manual'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_templates_status_check') THEN
    ALTER TABLE bot_templates ADD CONSTRAINT bot_templates_status_check
      CHECK (status IS NULL OR status IN ('active', 'paused'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bot_templates_bot_type ON bot_templates(bot_type);
CREATE INDEX IF NOT EXISTS idx_bot_templates_status ON bot_templates(status);
