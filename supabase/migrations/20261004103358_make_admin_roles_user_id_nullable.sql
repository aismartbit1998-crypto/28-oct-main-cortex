/*
# Make admin_roles.user_id nullable

## Overview
The admin_roles table was created with user_id as NOT NULL with a default
of auth.uid(). However, when seeding demo admin rows (e.g. via execute_sql
with a service role), there is no authenticated session so auth.uid() is null,
causing NOT NULL constraint violations. This migration makes user_id nullable
to allow admin role records to exist independently of an auth session.

## Modified Table: admin_roles
- `user_id` changed from NOT NULL to nullable (DROP NOT NULL)

## Important Notes
1. Existing rows are unaffected — they already have valid user_id values.
2. New rows inserted without user_id will have NULL, which is valid.
3. The DEFAULT auth.uid() remains, so frontend inserts by authenticated
   users still automatically populate user_id.
*/

ALTER TABLE admin_roles ALTER COLUMN user_id DROP NOT NULL;
