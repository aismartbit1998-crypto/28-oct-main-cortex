/*
 * Schedule the strategy-runner edge function via pg_cron.
 *
 * The strategy-runner is the autonomous trading brain that evaluates
 * all active bots against live market data every 1 minute.
 * It uses the engine/src math (RiskCalculator, TrailingStopEngine,
 * martingale) to compute indicators, validate risk, and trigger trades.
 *
 * pg_cron sends an HTTP POST to the edge function using pg_net,
 * authenticated with the service role key.
 */

DO $$
BEGIN
  -- Ensure pg_cron and pg_net extensions are enabled
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  END IF;

  -- Drop existing job if it exists (idempotent)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'strategy_runner_cron') THEN
    PERFORM cron.unschedule('strategy_runner_cron');
  END IF;

  -- Schedule the strategy-runner to run every 1 minute
  -- It sends a POST with an empty body and the service role key as Authorization
  PERFORM cron.schedule(
    'strategy_runner_cron',
    '* * * * *',
    $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/strategy-runner',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := '{}'::jsonb
      )
    $cron$
  );
END $$;
