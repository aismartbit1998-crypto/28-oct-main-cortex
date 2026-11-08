-- Fix: the cron jobs were failing because app.supabase_url and app.service_role_key
-- GUC settings don't exist. Every run errored with:
--   "unrecognized configuration parameter app.supabase_url"
--
-- Solution: hardcode the project URL and anon key directly in the cron schedule.
-- strategy-runner has verify_jwt=false, so the anon key is sufficient.
-- The edge function reads the real service role key from its own Deno environment.

DO $$
BEGIN
  -- Reschedule strategy-runner cron with hardcoded URL
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'strategy_runner_cron') THEN
    PERFORM cron.unschedule('strategy_runner_cron');
  END IF;

  PERFORM cron.schedule(
    'strategy_runner_cron',
    '* * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://accqqjkbjyojbdptamik.supabase.co/functions/v1/strategy-runner',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjY3FxamtianlvamJkcHRhbWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3OTU1NDMsImV4cCI6MjEwNzM3MTU0M30.WjwyZFAPgxaHC95IAgzX9qEQ4yeFSRn05zUYdVtU8bw'
        ),
        body := '{}'::jsonb
      )
    $cron$
  );

  -- Fix monitor-positions cron
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor_positions_cron') THEN
    PERFORM cron.unschedule('monitor_positions_cron');
  END IF;

  PERFORM cron.schedule(
    'monitor_positions_cron',
    '* * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://accqqjkbjyojbdptamik.supabase.co/functions/v1/monitor-positions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjY3FxamtianlvamJkcHRhbWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3OTU1NDMsImV4cCI6MjEwNzM3MTU0M30.WjwyZFAPgxaHC95IAgzX9qEQ4yeFSRn05zUYdVtU8bw'
        ),
        body := '{}'::jsonb
      )
    $cron$
  );

  -- Fix sentiment cron
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'analyze_sentiment_cron') THEN
    PERFORM cron.unschedule('analyze_sentiment_cron');
  END IF;

  PERFORM cron.schedule(
    'analyze_sentiment_cron',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://accqqjkbjyojbdptamik.supabase.co/functions/v1/analyze-market-sentiment',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjY3FxamtianlvamJkcHRhbWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3OTU1NDMsImV4cCI6MjEwNzM3MTU0M30.WjwyZFAPgxaHC95IAgzX9qEQ4yeFSRn05zUYdVtU8bw'
        ),
        body := '{}'::jsonb
      )
    $cron$
  );
END $$;
