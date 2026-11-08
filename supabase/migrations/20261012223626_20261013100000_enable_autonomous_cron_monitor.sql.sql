/*
# Enable autonomous cloud cron for position monitoring

## Summary
Enables pg_cron and pg_net extensions, then creates a cron job that
calls the monitor-positions edge function every 1 minute. This detaches
the trading engine from the user's browser — the engine runs 24/7 in the
database layer, independent of whether any client is connected.

## Extensions
- pg_cron: PostgreSQL job scheduler (runs SQL on a schedule)
- pg_net: HTTP client for PostgreSQL (sends outbound HTTP requests)

## Cron Job
- Name: monitor_positions_cron
- Schedule: every 1 minute (* * * * *)
- Action: sends HTTP POST to the monitor-positions edge function
  with the service role key for authorization
- The edge function scans all open positions, fetches live prices,
  evaluates TP/SL/trailing stops, and closes positions when thresholds
  are breached

## Security
- The cron job uses the service role key from the auth schema
- The HTTP request includes the Authorization header with the service role key
- Only the postgres user can create/manage cron jobs

## Important Notes
1. The SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from
   the environment via current_setting() — these are automatically
   available in the Supabase SQL context.
2. The cron job is idempotent — if no open positions exist, the
   edge function returns immediately with "No open positions to monitor".
3. The pg_net request is asynchronous (fire-and-forget) — the cron
   job does not block waiting for the response.
*/

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA net TO postgres;

-- Drop existing job if it exists (idempotent)
DO $$
BEGIN
  -- Remove old cron job if present
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor_positions_cron') THEN
    PERFORM cron.unschedule('monitor_positions_cron');
  END IF;
END $$;

-- Create the cron job to call monitor-positions every minute
-- The edge function URL is constructed from the Supabase project URL
-- The service role key is passed as the Authorization Bearer token
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

-- Note: The app.supabase_url and app.service_role_key settings are
-- set automatically by the Supabase platform. If they are not available,
-- they can be set with:
-- ALTER DATABASE postgres SET app.supabase_url = 'https://<project>.supabase.co';
-- ALTER DATABASE postgres SET app.service_role_key = '<service_role_key>';
