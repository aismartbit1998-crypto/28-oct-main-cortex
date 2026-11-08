import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    // 1. Find all licenses that have expired but are still marked active
    const { data: expiredLicenses, error: fetchErr } = await adminClient
      .from("licenses")
      .select("id, user_id, plan_name, valid_until")
      .eq("is_active", true)
      .lt("valid_until", new Date().toISOString());

    if (fetchErr) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch expired licenses: ${fetchErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!expiredLicenses || expiredLicenses.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, expired: 0, botsPaused: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const expiredUserIds = expiredLicenses.map((l) => l.user_id).filter(Boolean);
    const licenseIds = expiredLicenses.map((l) => l.id);

    // 2. Deactivate all expired licenses
    const { error: deactivateErr } = await adminClient
      .from("licenses")
      .update({ is_active: false })
      .in("id", licenseIds);

    if (deactivateErr) {
      console.error("Failed to deactivate licenses:", deactivateErr.message);
    }

    // 3. Pause all running/paper bots for expired users
    let botsPaused = 0;
    if (expiredUserIds.length > 0) {
      const { data: pausedBots, error: pauseErr } = await adminClient
        .from("bots")
        .update({ status: "paused" })
        .in("user_id", expiredUserIds)
        .in("status", ["running", "paper"])
        .select("id");

      if (pauseErr) {
        console.error("Failed to pause bots:", pauseErr.message);
      } else {
        botsPaused = pausedBots?.length ?? 0;
      }
    }

    // 4. Log each expiry as a client update
    for (const lic of expiredLicenses) {
      if (!lic.user_id) continue;
      await adminClient.from("client_updates").insert({
        client_id: lic.user_id,
        update_type: "license_update",
        title: "License Expired — Account Locked",
        message: `Your ${lic.plan_name} plan has expired. Trading features are now locked. Please ask your admin to renew your license.`,
        severity: "critical",
        executed_by: "System (Daily License Check)",
      });
    }

    // 5. Log to broker_api_logs for audit
    await adminClient.from("broker_api_logs").insert({
      user_id: null,
      broker: "SYSTEM",
      endpoint: "/daily-license-check",
      status: "success",
      latency_ms: 0,
      detail: `Expired ${expiredLicenses.length} license(s), paused ${botsPaused} bot(s). User IDs: ${expiredUserIds.join(", ")}`,
    });

    return new Response(
      JSON.stringify({
        processed: expiredLicenses.length,
        expired: expiredLicenses.length,
        botsPaused,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
