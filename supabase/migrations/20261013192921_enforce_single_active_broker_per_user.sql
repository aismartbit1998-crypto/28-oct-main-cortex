/*
# Enforce single active broker connection per user

Adds a partial unique index so that only ONE row per user can have
is_connected = true at any time. The database rejects any attempt to
create a second active connection, providing bulletproof backend
enforcement regardless of how the insert is initiated.
*/

CREATE UNIQUE INDEX IF NOT EXISTS one_active_broker_per_user
  ON broker_keys(user_id)
  WHERE is_connected = true;