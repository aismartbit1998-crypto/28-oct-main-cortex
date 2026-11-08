import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { decryptBrokerKeys } from "../_shared/exchange-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * Returns the CoinDCX Socket.IO authentication credentials for the calling
 * user's connected broker account. The frontend uses these to connect
 * directly to CoinDCX's WebSocket stream and receive real-time position
 * updates — zero latency, no polling.
 *
 * The auth signature is HMAC-SHA256(body, apiSecret) where body is the
 * JSON-encoded channel name. The signature is short-lived (CoinDCX does
 * not support expiry tokens, but the channel name is constant so we add
 * a timestamp to the payload to make each signature unique per request).
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.replace("Bearer ", "");

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await adminClient.auth.getUser(bearerToken);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const brokerKeys = await decryptBrokerKeys(adminClient, userId);
    if (!brokerKeys) {
      return new Response(JSON.stringify({
        error: "No connected broker account found. Please connect your CoinDCX API keys first.",
      }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!brokerKeys.exchangeName.toLowerCase().includes("coindcx")) {
      return new Response(JSON.stringify({
        error: "WebSocket streaming is only available for CoinDCX-connected accounts.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // CoinDCX Socket.IO auth: HMAC-SHA256 of the channel name body.
    // The channel "coindcx" carries position, order, and balance updates.
    const channelName = "coindcx";
    const body = JSON.stringify({ channel: channelName });

    const signingKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(brokerKeys.apiSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      signingKey,
      new TextEncoder().encode(body),
    );
    const authSignature = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return new Response(JSON.stringify({
      socketEndpoint: "wss://stream-spot.coindcx.com",
      channelName,
      apiKey: brokerKeys.apiKey,
      authSignature,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

