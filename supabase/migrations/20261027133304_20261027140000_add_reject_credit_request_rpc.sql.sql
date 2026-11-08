/*
# Add reject_credit_request RPC

1. New Function
- `reject_credit_request(req_id uuid)` — allows super_admin to reject a pending
  credit request. Sets status to 'rejected' with approved_by and approved_at.
  No credits are added to the sub-admin's balance.

2. Security
- SECURITY DEFINER, locked search_path.
- Only callable by super_admin (checked via is_platform_admin).
- REVOKE EXECUTE from anon; GRANT to authenticated.
*/

CREATE OR REPLACE FUNCTION public.reject_credit_request(req_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
BEGIN
  caller_role := public.is_platform_admin();
  IF caller_role IS NULL OR caller_role != 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only super admin can reject credit requests');
  END IF;

  UPDATE credit_requests
    SET status = 'rejected', approved_by = auth.uid(), approved_at = now()
    WHERE id = req_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Credit request not found or already processed');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_credit_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_credit_request(uuid) TO authenticated;
