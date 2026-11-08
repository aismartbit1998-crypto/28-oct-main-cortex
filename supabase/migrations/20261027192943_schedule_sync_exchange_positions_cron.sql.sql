/*
# Schedule Sync-Exchange-Positions Cron Job

1. Purpose
   - Creates a pg_cron schedule to invoke the `sync-exchange-positions` edge
     function every 2 minutes. This is Safeguard #3 against Ghost Positions:
     it reconciles the local positions table against the live state on the
     CoinDCX exchange, marking any locally-open positions that are no longer
     on the exchange as closed_manual.
2. Changes
   - Conditionally drops any existing cron job named `sync-exchange-positions`.
   - Schedules a new cron job to POST to the edge function every 2 minutes
     using the service role key for system-mode authentication.
3. Security
   - No RLS or policy changes.
   - The cron uses the service role key (system mode) to scan ALL users'
     positions — consistent with monitor-positions and strategy-runner crons.
4. Notes
   - The edge function URL is constructed from the project's SUPABASE_URL.
   - Idempotent: safe to re-run.
*/

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-exchange-positions') THEN
    PERFORM cron.unschedule('sync-exchange-positions');
  END IF;
END $$;

SELECT cron.schedule(
  'sync-exchange-positions',
  '*/2 * * * *',
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
