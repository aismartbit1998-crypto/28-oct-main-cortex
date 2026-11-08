/*
# Add find_user_by_email RPC for admin license allotment

Allows admins to look up a user's ID by email so they can allot a license.
Returns only id and email — no secrets or metadata.
*/

CREATE OR REPLACE FUNCTION public.find_user_by_email(p_email text)
RETURNS TABLE (id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_user_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;
