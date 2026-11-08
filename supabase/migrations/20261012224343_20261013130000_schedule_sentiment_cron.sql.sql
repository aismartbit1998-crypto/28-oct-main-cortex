-- Add cron job for autonomous sentiment analysis every 5 minutes

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'analyze_sentiment_cron') THEN
    PERFORM cron.unschedule('analyze_sentiment_cron');
  END IF;
END $$;

SELECT cron.schedule(
  'analyze_sentiment_cron',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/analyze-market-sentiment',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
