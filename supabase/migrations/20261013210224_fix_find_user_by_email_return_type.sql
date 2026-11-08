-- Fix find_user_by_email: cast auth.users.email from varchar to text
-- to match the RETURNS TABLE(id uuid, email text) signature.
CREATE OR REPLACE FUNCTION public.find_user_by_email(p_email text)
RETURNS TABLE (id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleaned text;
  v_found boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_cleaned := lower(trim(p_email));

  -- Search auth.users first (authoritative source).
  -- Cast email from varchar to text to match the return type signature.
  RETURN QUERY
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE lower(trim(u.email)) = v_cleaned
  LIMIT 1;

  GET DIAGNOSTICS v_found = ROW_COUNT;

  -- If not found in auth.users, fall back to profiles table.
  IF NOT v_found THEN
    RETURN QUERY
    SELECT p.id, p.email::text
    FROM profiles p
    WHERE lower(trim(p.email)) = v_cleaned
    LIMIT 1;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_user_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;
