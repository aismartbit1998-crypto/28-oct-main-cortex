/*
# Fix: Drop is_platform_admin before recreating with text return type
*/

DROP FUNCTION IF EXISTS public.is_platform_admin() CASCADE;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ar.role
  FROM admin_roles ar
  WHERE ar.is_active = true
  AND (
    ar.user_id = auth.uid()
    OR ar.email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_roles ar
    WHERE ar.is_active = true
    AND ar.role = 'super_admin'
    AND (
      ar.user_id = auth.uid()
      OR ar.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_any_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin() IS NOT NULL
$$;
