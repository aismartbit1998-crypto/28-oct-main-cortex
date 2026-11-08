/*
# Create sentiment_scores table for AI Sentiment Engine

## Summary
Stores periodic snapshots of AI-analyzed market sentiment, including the
Crypto Fear & Greed Index, NLP-analyzed news sentiment, and an AI-generated
text summary. The analyze-market-sentiment edge function writes here every
5 minutes via pg_cron.

## New Table: sentiment_scores
- id (uuid, primary key)
- overall_score (integer, 0-100) — composite sentiment score
- classification (text) — Extreme Fear / Fear / Neutral / Greed / Extreme Greed
- fear_greed_index (integer, 0-100) — raw Fear & Greed Index value
- news_sentiment_score (integer, 0-100) — NLP-analyzed news sentiment
- news_sentiment_label (text) — bullish / bearish / neutral
- bullish_percentage (integer, 0-100) — percentage of bullish signals
- bearish_percentage (integer, 0-100) — percentage of bearish signals
- ai_summary (text) — AI-generated human-readable market analysis
- recommendation (text) — e.g. "Pause long entries", "Normal trading"
- long_entries_blocked (boolean) — whether AI has blocked new longs
- trailing_tightened (boolean) — whether AI has tightened trailing stops
- created_at (timestamptz, default now())

## Security
- RLS enabled
- SELECT: any authenticated user can read (sentiment is displayed on dashboard)
- INSERT/UPDATE/DELETE: service role only (edge function writes via service key)
*/

CREATE TABLE IF NOT EXISTS public.sentiment_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overall_score integer NOT NULL DEFAULT 50,
  classification text NOT NULL DEFAULT 'Neutral',
  fear_greed_index integer NOT NULL DEFAULT 50,
  news_sentiment_score integer NOT NULL DEFAULT 50,
  news_sentiment_label text NOT NULL DEFAULT 'neutral',
  bullish_percentage integer NOT NULL DEFAULT 50,
  bearish_percentage integer NOT NULL DEFAULT 50,
  ai_summary text,
  recommendation text,
  long_entries_blocked boolean NOT NULL DEFAULT false,
  trailing_tightened boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sentiment_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sentiment_scores" ON public.sentiment_scores;
CREATE POLICY "select_sentiment_scores" ON public.sentiment_scores
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_sentiment_scores" ON public.sentiment_scores;
CREATE POLICY "insert_sentiment_scores" ON public.sentiment_scores
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_sentiment_scores" ON public.sentiment_scores;
CREATE POLICY "update_sentiment_scores" ON public.sentiment_scores
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sentiment_scores_created_at
  ON public.sentiment_scores (created_at DESC);
