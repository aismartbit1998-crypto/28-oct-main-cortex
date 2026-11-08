import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CreateSubAdminRequest {
  email: string;
  password: string;
  fullName: string;
  mobile: string | null;
  permissions: Record<string, boolean>;
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

    const { email, password, fullName, mobile, permissions }: CreateSubAdminRequest = await req.json();

    // Verify caller is a super_admin before allowing sub-admin creation
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace("Bearer ", "");
    if (!callerToken || callerToken === serviceRoleKey) {
      // System/cron calls bypass auth — but we still need to verify via JWT
    }
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(callerToken);
    if (callerError || !callerData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized — authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller has super_admin role in admin_roles
    const { data: callerRole } = await adminClient
      .from("admin_roles")
      .select("role, is_active")
      .eq("user_id", callerData.user.id)
      .maybeSingle();
    const callerRoleRow = callerRole as { role: string; is_active: boolean } | null;
    const isMasterEmail = callerData.user.email === "vinodbardev@gmail.com";
    if (!isMasterEmail && (!callerRoleRow || callerRoleRow.role !== "super_admin" || !callerRoleRow.is_active)) {
      return new Response(JSON.stringify({ error: "Forbidden — only super admin can create sub-admin accounts" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!email || !password || !fullName) {
      return new Response(JSON.stringify({ error: "Missing required fields: email, password, fullName" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (password.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Create the auth user
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

    // 2. Insert profile
    const { error: profileError } = await adminClient.from("profiles").insert({
      id: userId,
      email,
      mobile_number: mobile,
    });

    if (profileError) {
      console.error("Profile insert error:", profileError.message);
    }

    // 3. Insert admin_roles row — role is HARDCODED to 'sub_admin', never super_admin
    const { error: roleError } = await adminClient.from("admin_roles").insert({
      user_id: userId,
      email: email.trim().toLowerCase(),
      name: fullName.trim(),
      role: "sub_admin",
      permissions,
      is_active: true,
      credit_balance: 0,
    });

    if (roleError) {
      console.error("admin_roles insert error:", roleError.message);
      return new Response(JSON.stringify({ error: `Failed to assign sub-admin role: ${roleError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Initialize user funds at zero
    const { error: fundError } = await adminClient.from("user_funds").insert({
      user_id: userId,
      exchange_name: "manual",
      balance: 0,
      unrealized_pnl: 0,
      realized_pnl: 0,
      manual_trading_enabled: false,
    });

    if (fundError) {
      console.error("Fund insert error:", fundError.message);
    }

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
