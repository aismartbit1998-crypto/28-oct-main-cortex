import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CreateClientRequest {
  email: string;
  password: string;
  fullName: string;
  mobile: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { email, password, fullName, mobile }: CreateClientRequest = await req.json();

    // Verify caller is an authorized admin before proceeding
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace("Bearer ", "");
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(callerToken);
    if (callerError || !callerData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized — authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerRole } = await adminClient
      .from("admin_roles")
      .select("role, is_active, name, email")
      .eq("user_id", callerData.user.id)
      .maybeSingle();
    const callerRoleRow = callerRole as { role: string; is_active: boolean; name: string | null; email: string | null } | null;
    const isMasterEmail = callerData.user.email === "vinodbardev@gmail.com";
    const isSuperAdmin =
      isMasterEmail ||
      (callerRoleRow &&
        callerRoleRow.is_active &&
        callerRoleRow.role === "super_admin");
    const isSubAdmin =
      callerRoleRow &&
      callerRoleRow.is_active &&
      callerRoleRow.role === "sub_admin";
    if (!isSuperAdmin && !isSubAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden — only admin users can create client accounts" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // B2B tenancy: sub-admins own the clients they create (admin_id = their
    // auth uid). Super-admins create global clients (admin_id = NULL, visible
    // to all). The B2B RLS policies gate sub-admin visibility on
    // admin_id = auth.uid(), so this must be set at write time.
    const creatorAdminId = isSubAdmin ? callerData.user.id : null;
    const creatorLabel = callerRoleRow?.name || callerRoleRow?.email || callerData.user.email || "Admin";

    if (!email || !password || !fullName) {
      return new Response(JSON.stringify({ error: "Missing required fields: email, password, fullName" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, mobile_number: mobile },
    });

    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = authData.user.id;

    // Insert profile (upsert in case a trigger already created one)
    const { error: profileError } = await adminClient.from("profiles").upsert({
      id: userId,
      email,
      mobile_number: mobile,
      admin_id: creatorAdminId,
    }, { onConflict: "id" });

    if (profileError) {
      console.error("Profile insert error:", profileError.message);
    }

    // Initialize user funds at zero (upsert to avoid duplicate-key errors)
    const { error: fundError } = await adminClient.from("user_funds").upsert({
      user_id: userId,
      exchange_name: "manual",
      balance: 0,
      unrealized_pnl: 0,
      realized_pnl: 0,
      manual_trading_enabled: false,
      admin_id: creatorAdminId,
    }, { onConflict: "user_id" });

    if (fundError) {
      console.error("Fund insert error:", fundError.message);
    }

    // Freemium model: no license is auto-granted. The client account is
    // created at zero cost to the Sub-Admin. The client starts in a "Locked"
    // state and must be assigned a plan via allot_license to unlock trading.
    await adminClient.from("client_updates").insert({
      client_id: userId,
      update_type: "license_update",
      title: "Account Created — Locked",
      message: `Your account has been created. It is currently locked. Please ask your admin to assign you a Starter, Pro, or Enterprise plan to unlock trading features.`,
      severity: "warning",
      executed_by: creatorLabel,
    });

    return new Response(JSON.stringify({ success: true, userId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
