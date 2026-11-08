/* Phase 2: exchange-adapter now reads broker URLs from broker_settings table
 * Close-Single-Position Edge Function — Manual Square-Off (v6 — reduce-only close + post-order verification, ghost detection removed)
 *
 * Executes a REVERSE MARKET ORDER on CoinDCX first. Only if the exchange
 * confirms the close, the DB is updated to closed_manual.
 *
 * POST body: { position_id: string }
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  decryptBrokerKeys,
  fetchLivePriceUsdt,
  placeCoinDcxInrMFuturesOrder,
  placeCoinDcxReduceOnlyClose,
  verifyPositionClosed,
  verifyOrderFilled,
} from "../_shared/exchange-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function calculatePnl(entryPrice: number, exitPrice: number, quantity: number, direction: "long" | "short", leverage: number): number {
  const priceDiff = direction === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
  return priceDiff * quantity * leverage;
}

type SupabaseClient = ReturnType<typeof createClient>;

// Writes a comprehensive trade_history record and deletes the position row.
// The positions table must ONLY hold open/pending rows.
async function archiveAndDeletePosition(
  adminClient: SupabaseClient,
  pos: PositionRow,
  exitPrice: number,
  realizedPnl: number,
  strategy: string,
  closeStatus: string,
): Promise<void> {
  const closedAt = new Date().toISOString();
  // Guard: if the position row is missing symbol/entry_price/quantity, we
  // cannot archive a meaningful trade_history record. Log and delete only.
  if (!pos || !pos.symbol) {
    await adminClient.from("positions").delete().eq("id", pos?.id ?? "");
    return;
  }
  const coin = pos.symbol.replace("USDT", "");
  const marginUsed = pos.leverage > 0 ? (pos.quantity * pos.entry_price) / pos.leverage * 102 : pos.quantity * pos.entry_price * 102;

  await adminClient.from("trades").update({ status: "closed_manual" })
    .eq("client_id", pos.user_id).eq("coin", coin).eq("status", "open");

  await adminClient.from("trade_history").insert({
    user_id: pos.user_id,
    bot_id: pos.bot_id,
    coin,
    timestamp: closedAt,
    pair: pos.symbol,
    side: pos.side,
    amount: pos.quantity,
    price: exitPrice,
    pnl: realizedPnl,
    leverage: pos.leverage,
    margin_used: marginUsed,
    entry_price: pos.entry_price,
    exit_price: exitPrice,
    realized_pnl: realizedPnl,
    closed_at: closedAt,
    status: closeStatus,
    strategy,
  });

  await adminClient.from("positions").delete().eq("id", pos.id);
}

interface PositionRow {
  id: string;
  bot_id: string | null;
  user_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  entry_price: number;
  quantity: number;
  leverage: number;
  status: string;
  is_paper: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Service-role client for DB operations.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let position_id: string | undefined;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    const { data: userData, error: userError } = await adminClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerUserId = userData.user.id;
    const body = await req.json().catch(() => ({})) as { position_id?: string };
    position_id = body.position_id;

    if (!position_id) {
      return new Response(JSON.stringify({ error: "position_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: posData, error: posErr } = await adminClient
      .from("positions")
      .select("*")
      .eq("id", position_id)
      .maybeSingle();

    if (posErr || !posData) {
      return new Response(JSON.stringify({ error: "Position not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pos = posData as PositionRow;

    // Guard: validate the position row has the minimum fields needed to
    // construct an exchange close order. A missing symbol is the root cause
    // of the "Cannot read properties of undefined (reading 'symbol')" crash.
    if (!pos.symbol || !pos.entry_price || !pos.quantity) {
      return new Response(JSON.stringify({
        error: `Position row is incomplete (symbol=${pos.symbol ?? "null"}, entry_price=${pos.entry_price ?? "null"}, quantity=${pos.quantity ?? "null"}). Cannot square off — please contact support.`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (pos.status !== "open") {
      return new Response(JSON.stringify({ error: "Position is already closed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify ownership (unless admin)
    const { data: profileData } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerUserId)
      .maybeSingle();
    const role = (profileData as { role?: string } | null)?.role;
    const isAdmin = role === "admin" || role === "super_admin";

    if (!isAdmin && pos.user_id !== callerUserId) {
      return new Response(JSON.stringify({ error: "You can only close your own positions" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const direction: "long" | "short" = pos.side === "BUY" ? "long" : "short";
    const closeSide: "BUY" | "SELL" = pos.side === "BUY" ? "SELL" : "BUY";
    const baseCoin = pos.symbol.replace(/USDT$/, "").replace(/^B-/, "");

    // Fetch live price for PnL calculation
    let currentPrice: number = pos.entry_price;
    try {
      const livePrice = await fetchLivePriceUsdt(baseCoin);
      if (livePrice > 0) currentPrice = livePrice;
    } catch { /* fallback to entry price */ }

    // ── Paper positions: simulate close without exchange ──
    if (pos.is_paper) {
      const pnl = calculatePnl(pos.entry_price, currentPrice, pos.quantity, direction, pos.leverage);
      await archiveAndDeletePosition(
        adminClient, pos, currentPrice, pnl, "manual-exit", "closed_manual",
      );
      return new Response(JSON.stringify({
        success: true, position_id: pos.id, action: "CLOSED",
        detail: `Paper square-off @ ${currentPrice}`, pnl,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Live positions: MUST place reverse order on CoinDCX FIRST ──
    const brokerKeys = await decryptBrokerKeys(adminClient, pos.user_id);
    if (!brokerKeys) {
      return new Response(JSON.stringify({
        error: "No connected broker found. Cannot square off — connect an exchange first.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // The close order is fired directly and must be confirmed before any DB update.
    const futuresPair = `B-${baseCoin}_USDT`;

    let exchangeOrderId = "";
    let exchangeDetail = "";

    try {
      // ── REDUCE-ONLY CLOSE ORDER ──
      // Reduce-only so the exchange rejects the order if the position
      // has already been closed, preventing accidental reverse trades.
      let closeResp;
      if (brokerKeys.exchangeName.toLowerCase().includes("coindcx") && currentPrice > 0) {
        closeResp = await placeCoinDcxReduceOnlyClose({
          apiKey: brokerKeys.apiKey,
          apiSecret: brokerKeys.apiSecret,
          base: baseCoin,
          side: closeSide,
          leverage: pos.leverage,
          ethQuantity: pos.quantity,
          livePriceUsdt: currentPrice,
        });
      } else {
        closeResp = await placeCoinDcxInrMFuturesOrder({
          apiKey: brokerKeys.apiKey,
          apiSecret: brokerKeys.apiSecret,
          base: baseCoin,
          side: closeSide,
          leverage: pos.leverage,
          ethQuantity: pos.quantity,
          inrAmount: pos.quantity * currentPrice,
          reduceOnly: false,
        });
      }

      if (closeResp.success) {
        exchangeOrderId = closeResp.orderId;
        if (closeResp.entryPrice > 0) currentPrice = closeResp.entryPrice;
        exchangeDetail = `CoinDCX close order placed. OrderId: ${exchangeOrderId}`;
        await adminClient.from("broker_api_logs").insert({
          user_id: pos.user_id, broker: brokerKeys.exchangeName,
          endpoint: "/square-off", status: "success", latency_ms: 0,
          detail: `SQUARE OFF: ${pos.symbol} ${closeSide} ${pos.quantity} order placed. OrderId: ${exchangeOrderId}`,
        });

        // ── VERIFY: poll order status to confirm the order is actually 'filled' ──
        let actualFillPrice = 0;
        if (exchangeOrderId && exchangeOrderId !== "N/A") {
          const orderVerification = await verifyOrderFilled({
            apiKey: brokerKeys.apiKey,
            apiSecret: brokerKeys.apiSecret,
            orderId: exchangeOrderId,
          });
          if (!orderVerification.confirmed) {
            await adminClient.from("broker_api_logs").insert({
              user_id: pos.user_id, broker: brokerKeys.exchangeName,
              endpoint: "/square-off-verify", status: "error", latency_ms: 0,
              detail: `SQUARE OFF FAILED — order ${exchangeOrderId} status='${orderVerification.status}' (not filled). DB NOT marked closed.`,
            });
            return new Response(JSON.stringify({
              success: false,
              error: `Close order not filled (status=${orderVerification.status}). Position kept open — will retry.`,
            }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          actualFillPrice = orderVerification.fillPrice;
        }

        // ── VERIFY: poll exchange to confirm the position is actually closed ──
        const verification = await verifyPositionClosed({
          apiKey: brokerKeys.apiKey,
          apiSecret: brokerKeys.apiSecret,
          futuresPair,
        });
        if (!verification.confirmed) {
          await adminClient.from("broker_api_logs").insert({
            user_id: pos.user_id, broker: brokerKeys.exchangeName,
            endpoint: "/square-off-verify", status: "error", latency_ms: 0,
            detail: `SQUARE OFF FAILED — ${futuresPair} still live (size ${verification.remainingSize}). DB NOT marked closed.`,
          });
          return new Response(JSON.stringify({
            success: false,
            error: `Position still open on exchange (size ${verification.remainingSize}). Will retry.`,
          }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Use the actual fill price from the order, not the mark price.
        if (actualFillPrice > 0) currentPrice = actualFillPrice;
        else if (closeResp.entryPrice > 0) currentPrice = closeResp.entryPrice;
      } else {
        exchangeDetail = closeResp.errorDetail ?? "Unknown CoinDCX error";
        await adminClient.from("broker_api_logs").insert({
          user_id: pos.user_id, broker: brokerKeys.exchangeName,
          endpoint: "/square-off", status: "error", latency_ms: 0,
          detail: `SQUARE OFF FAILED: ${exchangeDetail}. DB position remains open.`,
        });
        return new Response(JSON.stringify({
          success: false,
          error: `CoinDCX close order failed: ${exchangeDetail}`,
        }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } catch (exchangeErr) {
      exchangeDetail = `Exchange error: ${(exchangeErr as Error).message}`;
      await adminClient.from("broker_api_logs").insert({
        user_id: pos.user_id, broker: brokerKeys.exchangeName,
        endpoint: "/square-off", status: "error", latency_ms: 0,
        detail: `SQUARE OFF network error: ${exchangeDetail}. DB position remains open.`,
      });
      return new Response(JSON.stringify({
        success: false,
        error: `CoinDCX close order failed: ${exchangeDetail}`,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── STEP B: ONLY if CoinDCX confirmed the fill, update the DB ──
    // Recalculate PnL using the actual fill price (currentPrice was updated above).
    const pnl = calculatePnl(pos.entry_price, currentPrice, pos.quantity, direction, pos.leverage);

    // Archive to trade_history and delete the closed position row.
    await archiveAndDeletePosition(
      adminClient, pos, currentPrice, pnl, "manual-exit", "closed_manual",
    );

    // Admin audit log
    if (isAdmin && pos.user_id !== callerUserId) {
      await adminClient.from("admin_activity_log").insert({
        admin_id: callerUserId, admin_email: userData.user.email ?? "admin",
        action_type: "admin_action", severity: "warning",
        message: `Admin squared off position ${pos.symbol} for user ${pos.user_id} | pnl=${pnl}`,
      });
    }

    return new Response(JSON.stringify({
      success: true, position_id: pos.id, action: "CLOSED",
      detail: `Square-off @ ${currentPrice} (orderId: ${exchangeOrderId})`,
      pnl,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
