-- Allow authenticated users to read their own broker API logs
CREATE POLICY "select_own_broker_api_logs"
  ON broker_api_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow service role to insert (already bypasses RLS, but make it explicit for cron/system logs)
CREATE POLICY "insert_broker_api_logs"
  ON broker_api_logs
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);
