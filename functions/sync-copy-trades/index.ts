/*
 * Sync-Copy-Trades Edge Function — Cross-Exchange Copy Trading Worker (v2)
 *
 * When a Master trader opens or closes a position, this function replicates
 * the trade across all active followers using the CCXT ExchangeAdapter for
 * cross-exchange support (Binance, Bybit, OKX, CoinDCX, Delta, WazirX).
 *
 * Proportional sizing: Follower Qty = Master Qty * (Follower Capital / Master Capital)
 * Risk guards: max leverage cap, daily loss limit, kill switch.
 *
 * POST body:
 *   { masterUserId: string, masterPositionId: string, action: "open" | "close" }
 *
 * Can also be invoked without a body to scan all master traders for pending sync.
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  ExchangeAdapter,
  decryptBrokerKeys,
  deriveVaultKey,
  decryptValue,
} from "../_shared/exchange-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Types ───

interface MasterPosition {
  id: string;
  user_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  entry_price: number;
  quantity: number;
  leverage: number;
  is_paper: boolean;
  bot_id: string | null;
}

interface CopyRelationship {
  id: string;
  user_id: string;
  trader_id: string;
  status: string;
}

interface MasterTraderRow {
  id: string;
  user_id: string | null;
  exchange: string | null;
  market: string | null;
}

interface FollowerBot {
  id: string;
  market_type: "spot" | "futures";
  leverage: number | null;
  is_paper_mode: boolean | null;
  capital: number | null;
  max_daily_loss: number | null;
  take_profit: number | null;
  stop_loss: number | null;
}

interface RiskSettingsRow {
  global_kill_switch: boolean;
  max_leverage: number;
  max_daily_loss_pct: number;
  auto_disable_on_breach: boolean;
}

// ─── Log helper ───

async function logApiCall(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  broker: string,
  endpoint: string,
  status: "success" | "error" | "pending",
  latencyMs: number,
  detail: string,
): Promise<void> {
  await adminClient.from("broker_api_logs").insert({
    user_id: userId,
    broker,
    endpoint,
    status,
    latency_ms: latencyMs,
    detail,
  });
}

// ─── Proportional Position Sizing ───
// Follower Order Size = Master Order Size * (Follower Capital / Master Capital)

function computeProportionalQuantity(
  masterQuantity: number,
  masterCapital: number,
  followerCapital: number,
): number {
  if (masterCapital <= 0) return 0;
  const ratio = followerCapital / masterCapital;
  return masterQuantity * ratio;
}

// ─── Daily Loss Check ───

async function getTodayRealizedPnl(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data } = await adminClient
    .from("positions")
    .select("close_pnl")
    .eq("user_id", userId)
    .in("status", ["closed_tp", "closed_sl", "closed_manual"])
    .gte("closed_at", todayStart.toISOString());
  const rows = (data as { close_pnl: number | null }[]) ?? [];
  return rows.reduce((sum, r) => sum + (r.close_pnl ?? 0), 0);
}

// ─── Sync a single master position to all followers ───

async function syncMasterPosition(
  adminClient: ReturnType<typeof createClient>,
  masterPos: MasterPosition,
  action: "open" | "close",
): Promise<{ synced: number; results: Array<{ followerId: string; status: string; detail: string }> }> {
  const results: Array<{ followerId: string; status: string; detail: string }> = [];
  let syncedCount = 0;

  // Find the master_trader record
  const { data: masterTraderData } = await adminClient
    .from("master_traders")
    .select("id, user_id, exchange, market")
    .eq("user_id", masterPos.user_id)
    .maybeSingle();

  if (!masterTraderData) {
    return { synced: 0, results: [] };
  }
  const masterTrader = masterTraderData as MasterTraderRow;

  // Fetch all active copy relationships
  const { data: copyRelsData } = await adminClient
    .from("copy_relationships")
    .select("id, user_id, trader_id, status")
    .eq("trader_id", masterTrader.id)
    .eq("status", "active");

  const copyRels = (copyRelsData as CopyRelationship[]) ?? [];
  if (copyRels.length === 0) {
    return { synced: 0, results: [] };
  }

  // Fetch global risk settings
  const { data: riskData } = await adminClient
    .from("risk_settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  const risk = (riskData as RiskSettingsRow | null) ?? {
    global_kill_switch: false,
    max_leverage: 125,
    max_daily_loss_pct: 10,
    auto_disable_on_breach: true,
  };

  if (risk.global_kill_switch) {
    for (const rel of copyRels) {
      results.push({ followerId: rel.user_id, status: "SKIPPED", detail: "Global kill switch active" });
    }
    return { synced: 0, results };
  }

  // Fetch master's capital (from bot or user_funds)
  const { data: masterBotData } = await adminClient
    .from("bots")
    .select("capital")
    .eq("user_id", masterPos.user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const masterCapital = (masterBotData as { capital: number | null } | null)?.capital ?? 0;

  // Process each follower
  for (const rel of copyRels) {
    const followerUserId = rel.user_id;

    try {
      // Fetch follower's bot config
      const { data: followerBotData } = await adminClient
        .from("bots")
        .select("id, market_type, leverage, is_paper_mode, capital, max_daily_loss, take_profit, stop_loss")
        .eq("user_id", followerUserId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const followerBot = followerBotData as FollowerBot | null;

      if (!followerBot) {
        results.push({ followerId: followerUserId, status: "SKIPPED", detail: "No bot found" });
        continue;
      }

      const isFutures = followerBot.market_type === "futures";
      const followerLeverage = Math.min(followerBot.leverage ?? 1, risk.max_leverage);
      const isPaperMode = followerBot.is_paper_mode ?? false;
      const followerCapital = followerBot.capital ?? 0;

      // ── Daily loss guard ──
      const todayPnl = await getTodayRealizedPnl(adminClient, followerUserId);
      const dailyLossLimit = followerBot.max_daily_loss ?? 500;
      if (todayPnl < 0 && Math.abs(todayPnl) >= dailyLossLimit) {
        results.push({ followerId: followerUserId, status: "SKIPPED", detail: `Daily loss limit reached (${todayPnl} vs limit ${dailyLossLimit})` });
        continue;
      }

      if (action === "open") {
        // ── Proportional position sizing ──
        const followerQuantity = computeProportionalQuantity(
          masterPos.quantity,
          masterCapital,
          followerCapital,
        );

        if (followerQuantity <= 0) {
          results.push({ followerId: followerUserId, status: "SKIPPED", detail: "Computed quantity is zero" });
          continue;
        }

        // Paper mode — simulate
        if (isPaperMode) {
          await adminClient.from("positions").insert({
            bot_id: followerBot.id,
            user_id: followerUserId,
            symbol: masterPos.symbol,
            side: masterPos.side,
            entry_price: masterPos.entry_price,
            quantity: followerQuantity,
            leverage: followerLeverage,
            status: "open",
            is_paper: true,
          });

          await logApiCall(adminClient, followerUserId, "PAPER", "/copy-trade", "success", 0,
            `PAPER COPY: ${masterPos.side} ${masterPos.symbol} qty=${followerQuantity.toFixed(6)} (master: ${masterPos.quantity})`);

          results.push({ followerId: followerUserId, status: "COPIED_PAPER", detail: `Paper copy: ${followerQuantity.toFixed(6)} ${masterPos.symbol}` });
          syncedCount++;
          continue;
        }

        // Live mode — decrypt keys and route through ExchangeAdapter (CCXT)
        const decrypted = await decryptBrokerKeys(adminClient, followerUserId);
        if (!decrypted) {
          results.push({ followerId: followerUserId, status: "SKIPPED", detail: "No connected broker" });
          continue;
        }

        const adapter = ExchangeAdapter.create(decrypted.exchangeName);
        const orderResp = await adapter.placeOrder({
          apiKey: decrypted.apiKey,
          apiSecret: decrypted.apiSecret,
          symbol: masterPos.symbol,
          side: masterPos.side,
          orderType: "MARKET",
          marketType: isFutures ? "futures" : "spot",
          quantity: followerQuantity,
        });

        await logApiCall(adminClient, followerUserId, decrypted.exchangeName, "/copy-trade",
          orderResp.success ? "success" : "error", 0,
          `COPY OPEN: ${masterPos.side} ${masterPos.symbol} qty=${followerQuantity.toFixed(6)} — ${orderResp.success ? orderResp.orderId : orderResp.errorDetail}`);

        if (orderResp.success) {
          await adminClient.from("positions").insert({
            bot_id: followerBot.id,
            user_id: followerUserId,
            symbol: masterPos.symbol,
            side: masterPos.side,
            entry_price: orderResp.entryPrice || masterPos.entry_price,
            quantity: followerQuantity,
            leverage: followerLeverage,
            status: "open",
            is_paper: false,
            exchange_order_id: orderResp.orderId,
          });
          results.push({ followerId: followerUserId, status: "COPIED", detail: orderResp.orderId });
          syncedCount++;
        } else {
          results.push({ followerId: followerUserId, status: "FAILED", detail: orderResp.errorDetail ?? "Unknown error" });
        }
      } else if (action === "close") {
        // Close action — find follower's open position for this symbol
        const { data: followerPosData } = await adminClient
          .from("positions")
          .select("*")
          .eq("user_id", followerUserId)
          .eq("symbol", masterPos.symbol)
          .eq("status", "open")
          .maybeSingle();

        if (!followerPosData) {
          results.push({ followerId: followerUserId, status: "SKIPPED", detail: "No open position to close" });
          continue;
        }

        const followerPos = followerPosData as MasterPosition;
        const closeSide = followerPos.side === "BUY" ? "SELL" : "BUY";

        if (isPaperMode) {
          await adminClient.from("positions").update({
            status: "closed_manual",
            closed_at: new Date().toISOString(),
            close_price: masterPos.entry_price,
          }).eq("id", followerPos.id);

          await logApiCall(adminClient, followerUserId, "PAPER", "/copy-close", "success", 0,
            `PAPER COPY CLOSE: ${masterPos.symbol}`);

          results.push({ followerId: followerUserId, status: "CLOSED_PAPER", detail: "Paper position closed" });
          syncedCount++;
          continue;
        }

        const decrypted = await decryptBrokerKeys(adminClient, followerUserId);
        if (!decrypted) {
          results.push({ followerId: followerUserId, status: "SKIPPED", detail: "No connected broker" });
          continue;
        }

        const adapter = ExchangeAdapter.create(decrypted.exchangeName);
        const closeResp = await adapter.closeOrder({
          apiKey: decrypted.apiKey,
          apiSecret: decrypted.apiSecret,
          symbol: masterPos.symbol,
          side: closeSide,
          marketType: isFutures ? "futures" : "spot",
          reduceOnly: true,
        });

        await logApiCall(adminClient, followerUserId, decrypted.exchangeName, "/copy-close",
          closeResp.success ? "success" : "error", 0,
          `COPY CLOSE: ${closeSide} ${masterPos.symbol} — ${closeResp.success ? closeResp.orderId : closeResp.errorDetail}`);

        if (closeResp.success) {
          await adminClient.from("positions").update({
            status: "closed_manual",
            closed_at: new Date().toISOString(),
          }).eq("id", followerPos.id);
          results.push({ followerId: followerUserId, status: "CLOSED", detail: closeResp.orderId });
          syncedCount++;
        } else {
          results.push({ followerId: followerUserId, status: "CLOSE_FAILED", detail: closeResp.errorDetail ?? "Unknown error" });
        }
      }
    } catch (err) {
      results.push({ followerId: followerUserId, status: "ERROR", detail: (err as Error).message });
    }
  }

  return { synced: syncedCount, results };
}

// ─── Main Handler ───

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

    // If POST with body — sync a specific master position
    let body: { masterUserId?: string; masterPositionId?: string; action?: "open" | "close" } | null = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    if (body?.masterPositionId && body?.action) {
      // Verify caller is authorized
      const { data: userData, error: userError } = await adminClient.auth.getUser(authHeader.replace("Bearer ", ""));
      if (userError || !userData.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch the master position
      const { data: masterPosData, error: posErr } = await adminClient
        .from("positions")
        .select("*")
        .eq("id", body.masterPositionId)
        .maybeSingle();

      if (posErr || !masterPosData) {
        return new Response(JSON.stringify({ error: "Master position not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const masterPos = masterPosData as MasterPosition;
      const { synced, results } = await syncMasterPosition(adminClient, masterPos, body.action);

      return new Response(JSON.stringify({
        success: true,
        masterPositionId: body.masterPositionId,
        action: body.action,
        synced,
        results,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Scan mode (no body) — find all copier bots and sync with their masters ──
    // This is called by strategy-runner on each cron tick.
    const allResults: Array<{ masterUserId: string; synced: number; detail: string }> = [];
    let totalSynced = 0;

    // Find all running copier bots
    const { data: copierBots } = await adminClient
      .from("bots")
      .select("id, user_id, bot_type, status")
      .eq("bot_type", "copier")
      .eq("status", "running");

    const copiers = (copierBots as Array<{ id: string; user_id: string; bot_type: string; status: string }>) ?? [];

    // For each copier bot, find the copy relationship and check if master has new positions
    for (const copier of copiers) {
      // Find this follower's copy relationships
      const { data: rels } = await adminClient
        .from("copy_relationships")
        .select("trader_id")
        .eq("user_id", copier.user_id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (!rels) continue;

      // Get the master trader
      const { data: masterTrader } = await adminClient
        .from("master_traders")
        .select("id, user_id")
        .eq("id", (rels as { trader_id: string }).trader_id)
        .maybeSingle();

      if (!masterTrader) continue;
      const masterUserId = (masterTrader as { user_id: string | null }).user_id;
      if (!masterUserId) continue;

      // Find master's open positions that don't have a corresponding follower position
      const { data: masterOpenPositions } = await adminClient
        .from("positions")
        .select("*")
        .eq("user_id", masterUserId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(5);

      const masterPositions = (masterOpenPositions as MasterPosition[]) ?? [];

      // Check which master positions the follower hasn't copied yet
      for (const masterPos of masterPositions) {
        const { data: existingCopy } = await adminClient
          .from("positions")
          .select("id")
          .eq("user_id", copier.user_id)
          .eq("symbol", masterPos.symbol)
          .eq("status", "open")
          .maybeSingle();

        if (existingCopy) continue; // Already has an open position for this symbol

        const { synced, results } = await syncMasterPosition(adminClient, masterPos, "open");
        totalSynced += synced;
        allResults.push({
          masterUserId,
          synced,
          detail: results.map(r => `${r.status}: ${r.detail}`).join("; ") || "No followers",
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      mode: "scan",
      copierBotsEvaluated: copiers.length,
      totalSynced,
      results: allResults,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
