-- Make find_user_by_email more robust: search both auth.users and profiles,
-- use ILIKE for case-insensitivity, and trim whitespace.
CREATE OR REPLACE FUNCTION public.find_user_by_email(p_email text)
RETURNS TABLE (id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleaned text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_cleaned := lower(trim(p_email));

  -- Search auth.users first (authoritative source)
  RETURN QUERY
  SELECT u.id, u.email
  FROM auth.users u
  WHERE lower(trim(u.email)) = v_cleaned
  LIMIT 1;

  -- If not found in auth.users, fall back to profiles table
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT p.id, p.email
    FROM profiles p
    WHERE lower(trim(p.email)) = v_cleaned
    LIMIT 1;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_user_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;
