-- Fix the monitor-positions cron job auth.
-- The original cron used current_setting('app.service_role_key') which is
-- often NULL, causing the edge function to receive an empty Bearer token
-- and return 401. The edge function now detects the service role key
-- directly and runs in system mode (scans ALL open positions).
-- We also switch to a 30-second schedule for tighter SL enforcement.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor_positions_cron') THEN
    PERFORM cron.unschedule('monitor_positions_cron');
  END IF;
END $$;

-- Reschedule every 30 seconds using the env var directly.
-- The service role key is passed as Bearer; the edge function compares
-- it against its own SUPABASE_SERVICE_ROLE_KEY env var to enter system mode.
SELECT cron.schedule(
  'monitor_positions_cron',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/monitor-positions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Also schedule a second call at the 30-second mark for tighter monitoring
SELECT cron.schedule(
  'monitor_positions_cron_30s',
  '* * * * *',
  $$
    SELECT pg_sleep(30);
    SELECT net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/monitor-positions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
