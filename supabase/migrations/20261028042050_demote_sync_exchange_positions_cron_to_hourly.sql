-- Demote sync-exchange-positions cron from every 2 minutes to every 1 hour.
-- The WebSocket position stream is now the primary sync mechanism; this cron
-- is a backup auditor that catches anything the real-time stream missed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-exchange-positions') THEN
    PERFORM cron.unschedule('sync-exchange-positions');
  END IF;
END $$;

SELECT cron.schedule(
  'sync-exchange-positions',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/sync-exchange-positions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
