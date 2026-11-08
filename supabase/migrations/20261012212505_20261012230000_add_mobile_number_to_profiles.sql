/*
# Add mobile_number column to profiles table

## Purpose
Adds a mobile number field to user profiles for the CRM onboarding flow.

## Changes
1. New column `mobile_number` (text, nullable) on `profiles` table.
   - Nullable so existing profiles are not affected.
2. No RLS changes — existing policies remain intact.

## Notes
1. Uses `IF NOT EXISTS` to be idempotent.
*/

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS mobile_number text;
