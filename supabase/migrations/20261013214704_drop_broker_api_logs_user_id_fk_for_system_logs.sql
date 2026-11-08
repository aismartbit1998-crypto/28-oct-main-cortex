-- Drop the foreign key constraint on broker_api_logs.user_id so that
-- system/cron heartbeat logs can use a placeholder zero-UUID.
-- The FK to auth.users was preventing the startup heartbeat insert from
-- succeeding silently (the service role client doesn't throw on error).

ALTER TABLE public.broker_api_logs DROP CONSTRAINT broker_api_logs_user_id_fkey;
