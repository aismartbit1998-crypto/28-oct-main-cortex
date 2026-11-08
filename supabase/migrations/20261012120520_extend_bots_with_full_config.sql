/*
# Extend bots table with full bot configuration columns

## Summary
The AI Smart Bot Builder currently only persists name, market_type, coin, strategy, status, and profit_loss.
All other configuration (leverage, trade direction, TP/SL, indicators, daily limits, trailing stop, etc.)
is lost on page reload. This migration adds columns to store the complete bot configuration so it survives
across sessions and can be loaded back into the builder.

## New Columns on `bots` table
1. `trade_direction` (text, nullable) — 'long' or 'short'
2. `bot_type` (text, nullable) — 'scalper', 'dca', 'grid', 'copier'
3. `order_type` (text, nullable) — 'market' or 'limit'
4. `leverage` (integer, nullable, default 1) — leverage multiplier (1–100)
5. `capital` (numeric, nullable, default 5000) — total allocated capital
6. `indicators_enabled` (boolean, default false) — whether TA indicators trigger entries
7. `indicator` (text, nullable) — which indicator: RSI, MACD, EMA Crossover, SMC Order Blocks, None
8. `quantity_mode` (text, nullable) — 'fixed' or 'percent'
9. `quantity_value` (numeric, nullable, default 5000) — fixed trade amount
10. `percent_value` (numeric, nullable, default 10) — percentage of wallet per trade
11. `max_trades_per_day` (integer, nullable, default 20) — daily trade cap
12. `rr_ratio` (numeric, nullable, default 2) — risk:reward ratio
13. `tp_sl_mode` (text, nullable) — 'percentage' or 'fixed'
14. `take_profit` (numeric, nullable, default 5) — TP percentage
15. `stop_loss` (numeric, nullable, default 2) — SL percentage
16. `tp_fixed` (numeric, nullable, default 100) — TP fixed amount
17. `sl_fixed` (numeric, nullable, default 50) — SL fixed amount
18. `trailing_enabled` (boolean, default false) — trailing stop loss on/off
19. `trailing_distance` (numeric, nullable, default 1.5) — trailing distance %
20. `max_daily_loss` (numeric, nullable, default 500) — daily loss cap
21. `max_daily_profit` (numeric, nullable, default 1000) — daily profit cap
22. `cooldown_minutes` (integer, nullable, default 15) — cooldown after SL hit

## Security
- No RLS changes — existing policies on `bots` already scope by user_id.
- All new columns are nullable or have safe defaults so existing rows are unaffected.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'trade_direction') THEN
    ALTER TABLE bots ADD COLUMN trade_direction text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'bot_type') THEN
    ALTER TABLE bots ADD COLUMN bot_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'order_type') THEN
    ALTER TABLE bots ADD COLUMN order_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'leverage') THEN
    ALTER TABLE bots ADD COLUMN leverage integer DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'capital') THEN
    ALTER TABLE bots ADD COLUMN capital numeric DEFAULT 5000;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'indicators_enabled') THEN
    ALTER TABLE bots ADD COLUMN indicators_enabled boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'indicator') THEN
    ALTER TABLE bots ADD COLUMN indicator text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'quantity_mode') THEN
    ALTER TABLE bots ADD COLUMN quantity_mode text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'quantity_value') THEN
    ALTER TABLE bots ADD COLUMN quantity_value numeric DEFAULT 5000;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'percent_value') THEN
    ALTER TABLE bots ADD COLUMN percent_value numeric DEFAULT 10;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'max_trades_per_day') THEN
    ALTER TABLE bots ADD COLUMN max_trades_per_day integer DEFAULT 20;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'rr_ratio') THEN
    ALTER TABLE bots ADD COLUMN rr_ratio numeric DEFAULT 2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'tp_sl_mode') THEN
    ALTER TABLE bots ADD COLUMN tp_sl_mode text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'take_profit') THEN
    ALTER TABLE bots ADD COLUMN take_profit numeric DEFAULT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'stop_loss') THEN
    ALTER TABLE bots ADD COLUMN stop_loss numeric DEFAULT 2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'tp_fixed') THEN
    ALTER TABLE bots ADD COLUMN tp_fixed numeric DEFAULT 100;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'sl_fixed') THEN
    ALTER TABLE bots ADD COLUMN sl_fixed numeric DEFAULT 50;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'trailing_enabled') THEN
    ALTER TABLE bots ADD COLUMN trailing_enabled boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'trailing_distance') THEN
    ALTER TABLE bots ADD COLUMN trailing_distance numeric DEFAULT 1.5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'max_daily_loss') THEN
    ALTER TABLE bots ADD COLUMN max_daily_loss numeric DEFAULT 500;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'max_daily_profit') THEN
    ALTER TABLE bots ADD COLUMN max_daily_profit numeric DEFAULT 1000;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'cooldown_minutes') THEN
    ALTER TABLE bots ADD COLUMN cooldown_minutes integer DEFAULT 15;
  END IF;
END $$;
