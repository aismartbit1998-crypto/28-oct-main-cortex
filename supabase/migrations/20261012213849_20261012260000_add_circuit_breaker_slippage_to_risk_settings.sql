/*
# Add circuit_breaker and max_slippage_pct to risk_settings

## Purpose
Persist AI Volatility Circuit Breaker and Max Slippage Protection Guard
so they survive page reloads instead of being local-only state.

## Changes
1. Add `ai_circuit_breaker` boolean (default true) to risk_settings.
2. Add `max_slippage_pct` numeric (default 1.5) to risk_settings.
3. No RLS changes — existing policies remain intact.
*/

ALTER TABLE public.risk_settings
ADD COLUMN IF NOT EXISTS ai_circuit_breaker boolean NOT NULL DEFAULT true;

ALTER TABLE public.risk_settings
ADD COLUMN IF NOT EXISTS max_slippage_pct numeric NOT NULL DEFAULT 1.5;
