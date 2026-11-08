-- Update the SELECT policy on broker_api_logs so users can see system/cron
-- heartbeat logs (which use a placeholder user_id). The OR condition allows
-- any authenticated user to see logs where user_id is the zero-UUID.

DROP POLICY IF EXISTS select_broker_api_logs ON public.broker_api_logs;

CREATE POLICY "select_broker_api_logs" ON public.broker_api_logs FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR is_platform_admin()
    OR user_id = '00000000-0000-0000-0000-000000000000'
  );
