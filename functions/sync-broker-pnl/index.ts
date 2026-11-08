/* Phase 2: exchange-adapter now reads broker URLs from broker_settings table
 * Sync-Broker-PnL Edge Function (v2)
 *
 * Fetches the EXACT unrealized PnL for a user's open positions directly from
 * the CoinDCX broker (POST /exchange/v1/derivatives/futures/positions) and
 * writes it back to the positions table so the UI displays real broker
 * numbers instead of local price math.
 *
 * Returns a map of { [positionId]: brokerUnrealizedPnlInr } for the frontend
 * to use for both display and the HFT failsafe trigger.
 *
 * POST body: { } (uses the authenticated user's session)
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  decryptBrokerKeys,
  fetchCoinDcxOpenPositions,
} from "../_shared/exchange-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PositionRow {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  user_id: string;
  is_paper: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await adminClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    // 1. Fetch the user's open positions from the DB.
    const { data: positionsData, error: posErr } = await adminClient
      .from("positions")
      .select("id, symbol, side, user_id, is_paper")
      .eq("user_id", userId)
      .eq("status", "open");

    if (posErr) {
      return new Response(JSON.stringify({ error: posErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const positions = (positionsData as PositionRow[]) ?? [];
    const pnlMap: Record<string, number> = {};

    // 2. Paper positions: no broker to query — return 0 so the frontend
    //    keeps using its local Binance-price PnL for paper mode.
    const livePositions = positions.filter((p) => !p.is_paper);
    for (const p of positions.filter((p) => p.is_paper)) {
      pnlMap[p.id] = 0;
    }

    if (livePositions.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        pnlMap,
        source: "paper-or-empty",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Decrypt broker keys and fetch real broker positions.
    const brokerKeys = await decryptBrokerKeys(adminClient, userId);
    if (!brokerKeys) {
      // No connected broker — return 0 for all so the frontend falls back
      // to local math instead of showing stale data.
      for (const p of livePositions) pnlMap[p.id] = 0;
      return new Response(JSON.stringify({
        success: true,
        pnlMap,
        source: "no-broker",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const brokerPositions = await fetchCoinDcxOpenPositions({
      apiKey: brokerKeys.apiKey,
      apiSecret: brokerKeys.apiSecret,
    });

    // 4. Match each DB position to its broker position by pair symbol and
    //    extract the broker's unrealized PnL (already in INR for INR-M).
    for (const pos of livePositions) {
      const baseCoin = pos.symbol.replace(/USDT$/, "").replace(/^B-/, "");
      const futuresPair = `B-${baseCoin}_USDT`;
      const match = brokerPositions.find(
        (bp) => bp.pair === futuresPair && bp.size > 0,
      );
      const brokerPnl = match?.unrealized_pnl ?? 0;
      pnlMap[pos.id] = brokerPnl;

      // Persist the real broker PnL back to the DB so other surfaces
      // (dashboard, analytics) reflect exact exchange numbers.
      if (match) {
        await adminClient.from("positions")
          .update({ unrealized_pnl: brokerPnl, updated_at: new Date().toISOString() })
          .eq("id", pos.id);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      pnlMap,
      source: "broker",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
