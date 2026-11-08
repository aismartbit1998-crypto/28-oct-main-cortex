/* Read-only wallet sync. It never places orders, withdraws, or transfers funds. */
/* USD-INR fallback rate synced to 102 to match exchange-adapter.ts */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { decryptBrokerKeys, normalizeExchangeName, createCcxtInstance } from "../_shared/exchange-adapter.ts";
import { fetchCoinDcxWallet } from "../_shared/wallet-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function balanceTotal(balance: { total?: Record<string, number> }): number {
  return Object.values(balance.total ?? {}).reduce((sum, value) => {
    const amount = Number(value);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: userData, error: userError } = await adminClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !userData.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const userId = userData.user.id;
    const keys = await decryptBrokerKeys(adminClient, userId);
    if (!keys) return jsonResponse({ error: "No connected exchange API keys found. Connect your exchange first." }, 404);

    const exchangeId = normalizeExchangeName(keys.exchangeName);
    let totalBalance = 0;
    let source: "futures" | "spot" = "futures";
    let breakdown: unknown[] = [];

    if (exchangeId === "coindcx") {
      const snapshot = await fetchCoinDcxWallet(keys.apiKey, keys.apiSecret);
      totalBalance = snapshot.totalInr;
      source = snapshot.source;
      breakdown = snapshot.wallets;
    } else if (exchangeId === "delta") {
      const exchange = await createCcxtInstance("delta", keys.apiKey, keys.apiSecret, "futures");
      const balance = await exchange.fetchBalance();
      totalBalance = balanceTotal(balance as { total?: Record<string, number> });
    } else {
      return jsonResponse({ error: `Exchange "${keys.exchangeName}" is not supported in Phase 1. Only CoinDCX and Delta Exchange are supported.` }, 400);
    }

    if (!Number.isFinite(totalBalance) || totalBalance < 0) {
      return jsonResponse({ error: "Exchange returned an invalid wallet balance." }, 502);
    }

    const nowIso = new Date().toISOString();

    // Wipe ghost rows for this exchange (case-insensitive) before upsert
    // Use broad pattern to catch all casing variants (CoinDCX, coindcx, COINDCX, etc.)
    const exchangePattern = `%${exchangeId}%`;
    await adminClient.from("user_funds")
      .delete()
      .eq("user_id", userId)
      .ilike("exchange_name", exchangePattern);

    const { error: upsertError } = await adminClient.from("user_funds").upsert({
      user_id: userId,
      exchange_name: keys.exchangeName,
      balance: totalBalance,
      breakdown,
      source,
      last_synced_at: nowIso,
    }, { onConflict: "user_id,exchange_name" });

    if (upsertError) return jsonResponse({ error: "Balance fetched but wallet sync could not be saved." }, 500);

    return jsonResponse({
      balance: totalBalance,
      exchange: keys.exchangeName,
      account_type: source,
      source,
      breakdown,
      last_synced_at: nowIso,
    });
  } catch (error) {
    return jsonResponse({ error: `Failed to sync wallet: ${(error as Error).message}` }, 502);
  }
});
