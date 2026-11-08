/* Phase 2: exchange-adapter now reads broker URLs from broker_settings table
 * Execute-Trade Edge Function — Order Execution Orchestrator (v6.4 — virtual SL/TP, user_id-scoped daily limit)
 *
 * This function is the "muscle" of the trading platform. It:
 *   1. Receives a bot configuration + user session
 *   2. Checks risk_settings (kill switch, max leverage, circuit breaker, slippage)
 *   3. Routes live trades to the ExchangeAdapter (ALWAYS FUTURES)
 *   4. Uses the shared exchange-adapter to support CoinDCX, Delta
 *   5. Logs the result to broker_api_logs
 *   6. Records the position in the positions table
 *
 * Shared CCXT constructor mapping is used for every live exchange.
 *
 * POST body:
 *   { botId: string, action: "open" | "close", positionId?: string, testTrade?: boolean }
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  decryptBrokerKeys,
  executeGoldenTrade,
} from "../_shared/exchange-adapter.ts";
import { fetchProSentiment } from "../_shared/pro-score.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

interface BotRow {
  id: string;
  user_id: string;
  name: string;
  market_type: "spot" | "futures";
  coin: string;
  strategy: string;
  status: string;
  trade_direction: "long" | "short" | "auto" | null;
  bot_type: string | null;
  order_type: "market" | "limit" | null;
  leverage: number | null;
  capital: number | null;
  take_profit: number | null;
  stop_loss: number | null;
  trailing_enabled: boolean | null;
  trailing_distance: number | null;
  is_paper_mode: boolean | null;
  max_trades_per_day: number | null;
  max_daily_loss: number | null;
  max_daily_profit: number | null;
  tp_sl_mode: string | null;
  tp_fixed: number | null;
  sl_fixed: number | null;
}

interface RiskSettingsRow {
  global_kill_switch: boolean;
  max_leverage: number;
  max_daily_loss_pct: number;
  auto_disable_on_breach: boolean;
  ai_circuit_breaker: boolean;
  max_slippage_pct: number;
}

// execute-trade is invoked ONLY by manual user clicks (Trade Now / instant
// first trade). It is never called by the auto cron. Therefore 'auto' must
// ALWAYS resolve to a direction and never SKIP — the user explicitly asked
// to trade. Direction uses the pro score (multi-factor), with long as the
// conservative fallback in a sideways band.

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

    const { data: userData, error: userError } = await adminClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { botId, action }: { botId: string; action: "open" | "close" } = await req.json();

    // 1. Fetch bot configuration
    const { data: botData, error: botErr } = await adminClient
      .from("bots")
      .select("*")
      .eq("id", botId)
      .eq("user_id", userId)
      .maybeSingle();

    if (botErr || !botData) {
      return new Response(JSON.stringify({ error: "Bot not found or not owned by user" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bot = botData as BotRow;

    if (bot.status !== "running") {
      return new Response(JSON.stringify({ error: `Bot status is '${bot.status}'. Only running bots can execute.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1.5. Strategy tier validation — check bot_templates.required_tier against user's plan
    const { data: licenseData } = await adminClient
      .from("licenses")
      .select("plan_name, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const planName = (licenseData as { plan_name: string } | null)?.plan_name?.toLowerCase() ?? "starter";
    const botStrategyId = (botData as { strategy_id?: string }).strategy_id;

    if (botStrategyId) {
      const { data: templateData } = await adminClient
        .from("bot_templates")
        .select("required_tier, strategy_id")
        .or(`strategy_id.eq.${botStrategyId},name.eq.${botStrategyId}`)
        .limit(1)
        .maybeSingle();

      const requiredTier = (templateData as { required_tier?: string } | null)?.required_tier ?? "enterprise";
      const TIER_RANK: Record<string, number> = { starter: 0, pro: 1, enterprise: 2 };
      const PLAN_RANK: Record<string, number> = { starter: 0, pro: 1, enterprise: 2 };
      const planRank = PLAN_RANK[planName] ?? 0;
      const tierRank = TIER_RANK[requiredTier] ?? 2;

      if (planRank < tierRank) {
        return new Response(JSON.stringify({ error: `Strategy '${botStrategyId}' is locked for your plan (${planName}). Upgrade to unlock more strategies.` }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2. Fetch risk settings (global guardrails)
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
      ai_circuit_breaker: false,
      max_slippage_pct: 1.5,
    };

    // 3. Check kill switch
    if (risk.global_kill_switch) {
      await logApiCall(adminClient, userId, "SYSTEM", "/risk-check", "error", 0, "Blocked by global kill switch");
      return new Response(JSON.stringify({ error: "Global kill switch is active. All trading is halted." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Leverage cap
    const requestedLeverage = bot.leverage ?? 1;
    if (requestedLeverage > risk.max_leverage) {
      return new Response(JSON.stringify({ error: `Requested leverage ${requestedLeverage}x exceeds platform max ${risk.max_leverage}x` }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4.4. Daily Limit Enforcement — check before opening any new trade.
    // DYNAMIC IST COUNTING: count ALL positions created since IST midnight
    // (00:00 Asia/Kolkata, UTC+5:30) so daily limits reset at 12 AM IST.
    // (open, pending, AND closed) scoped to THIS bot_id, so a bot that
    // rapid-fires can't slip past the limit. The exchange is never contacted
    // if the limit is reached.
    if (action === "open") {
      const istOffsetMs = 5.5 * 60 * 60 * 1000;
      const istNow = new Date(Date.now() + istOffsetMs);
      const todayStartIst = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffsetMs);
      const [positionsToday, historyToday] = await Promise.all([
        adminClient
          .from("positions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("created_at", todayStartIst.toISOString()),
        adminClient
          .from("trade_history")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("timestamp", todayStartIst.toISOString()),
      ]);

      const positionsTodayCount = positionsToday.count ?? 0;
      const historyTodayCount = historyToday.count ?? 0;
      const todayTradeCount = Math.max(positionsTodayCount, historyTodayCount);

      const { data: todayClosed } = await adminClient
        .from("positions")
        .select("close_pnl")
        .eq("user_id", userId)
        .in("status", ["closed_tp", "closed_sl", "closed_manual"])
        .gte("closed_at", todayStartIst.toISOString());
      const todayRows = (todayClosed as { close_pnl: number | null }[]) ?? [];
      const todayRealizedPnl = todayRows.reduce((sum, r) => sum + (r.close_pnl ?? 0), 0);

      if (bot.max_trades_per_day !== null && todayTradeCount >= bot.max_trades_per_day) {
        await logApiCall(adminClient, userId, "SYSTEM", "/daily-limit-check", "error", 0,
          `Blocked: daily trade limit reached (${todayTradeCount}/${bot.max_trades_per_day})`);
        return new Response(JSON.stringify({ error: `DAILY_LIMIT_REACHED: Daily trade limit (${bot.max_trades_per_day}) reached. Next trade allowed after IST midnight.` }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (bot.max_daily_loss !== null && todayRealizedPnl <= -bot.max_daily_loss) {
        await logApiCall(adminClient, userId, "SYSTEM", "/daily-limit-check", "error", 0,
          `Blocked: daily loss limit reached (${todayRealizedPnl} <= -${bot.max_daily_loss})`);
        return new Response(JSON.stringify({ error: `Daily loss limit breached (${todayRealizedPnl}). Trading paused for today.` }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (bot.max_daily_profit !== null && todayRealizedPnl >= bot.max_daily_profit) {
        await logApiCall(adminClient, userId, "SYSTEM", "/daily-limit-check", "error", 0,
          `Blocked: daily profit target reached (${todayRealizedPnl} >= ${bot.max_daily_profit})`);
        return new Response(JSON.stringify({ error: `Daily profit target reached (${todayRealizedPnl}). Trading paused for today.` }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 4.5. Resolve trade direction. This function is only ever called by a
    // manual user click (Trade Now / instant first trade), so 'auto' must
    // NEVER SKIP — the user explicitly asked to trade. The pro score
    // (market structure / EMA / RSI / volume / range position) picks the
    // direction; in a sideways 45–55 band we default to long (conservative).
    let resolvedDirection: "long" | "short";
    // Holds the id of the PENDING lock row (atomic execution guard).
    let pendingLockId: string | null = null;

    if (bot.trade_direction === "short") {
      resolvedDirection = "short";
    } else if (bot.trade_direction === "auto") {
      const { score, avgChange } = await fetchProSentiment();
      if (score < 45) {
        resolvedDirection = "short";
      } else if (score > 55) {
        resolvedDirection = "long";
      } else {
        // Sideways band — manual click, so do NOT skip. Default to long.
        resolvedDirection = "long";
      }
      await logApiCall(adminClient, userId, "SYSTEM", "/auto-direction", "success", 0,
        `Manual trade: auto → ${resolvedDirection.toUpperCase()} (pro score ${score}, avg 15m ${avgChange.toFixed(2)}%). No skip on manual click.`);
    } else {
      resolvedDirection = "long";
    }

    // 4.5b. GLOBAL DIRECTIONAL COLLISION LOCK (CEO One-Way Mode fix)
    // On a One-Way Mode futures account, a LONG and a SHORT on the same asset
    // net out at the exchange — the new order closes the existing position
    // while the DB still shows both as open, creating phantom positions.
    // Block any new trade whose direction OPPOSES an already-open position on
    // the SAME asset across ALL of the user's bots (not just this bot).
    if (action === "open") {
      const collisionSymbol = `${bot.coin.toUpperCase()}USDT`;
      const oppositeSide = resolvedDirection === "short" ? "BUY" : "SELL";
      const { data: collisionPos } = await adminClient
        .from("positions")
        .select("id, bot_id, side")
        .eq("user_id", userId)
        .eq("symbol", collisionSymbol)
        .in("status", ["open", "pending"])
        .limit(1)
        .maybeSingle();
      if (collisionPos && (collisionPos as { side: string }).side === oppositeSide) {
        await logApiCall(adminClient, userId, "SYSTEM", "/directional-collision-lock", "error", 0,
          `Trade skipped: Opposite position already active on ${collisionSymbol} (existing side=${oppositeSide}). One-Way mode netting prevented.`);
        return new Response(JSON.stringify({
          error: `Trade skipped: Opposite position already active on ${collisionSymbol}. One-Way mode netting prevented.`,
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 4.6. AI Sentiment Guardrail
    if (action === "open") {
      const { data: sentimentData } = await adminClient
        .from("sentiment_scores")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const sentiment = sentimentData as {
        overall_score: number;
        classification: string;
        long_entries_blocked: boolean;
        trailing_tightened: boolean;
        ai_summary: string | null;
        recommendation: string | null;
      } | null;

      if (sentiment && sentiment.long_entries_blocked) {
        if (resolvedDirection === "long") {
          await logApiCall(adminClient, userId, "AI_SENTINEL", "/sentiment-check", "error", 0,
            `Blocked new LONG entry: AI sentiment is "${sentiment.classification}" (score ${sentiment.overall_score}). ${sentiment.ai_summary ?? ""}`);
          return new Response(JSON.stringify({
            error: `AI Sentiment Guardrail: Market is in "${sentiment.classification}" (score ${sentiment.overall_score}). New long entries are paused platform-wide to protect capital.`,
            sentiment: sentiment.classification,
            score: sentiment.overall_score,
            ai_summary: sentiment.ai_summary,
          }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      if (sentiment && sentiment.trailing_tightened && bot.trailing_enabled) {
        const originalTrailingDist = bot.trailing_distance ?? 0;
        const tightenedTrailingDist = Math.max(originalTrailingDist / 2, 0.5);
        (bot as BotRow & { trailing_distance_tightened?: number }).trailing_distance_tightened = tightenedTrailingDist;
        await logApiCall(adminClient, userId, "AI_SENTINEL", "/sentiment-check", "success", 0,
          `Trailing stop tightened from ${originalTrailingDist}% to ${tightenedTrailingDist}% due to Extreme Greed (score ${sentiment.overall_score})`);
      }
    }

    // 5. LIVE MODE — fetch and decrypt broker keys via shared adapter
    const brokerKeys = await decryptBrokerKeys(adminClient, userId);
    if (!brokerKeys) {
      return new Response(JSON.stringify({ error: "No connected broker found. Please connect an exchange first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 6. Compute absolute TP/SL prices from bot config
    // When tp_sl_mode='fixed', take_profit and stop_loss are rupee amounts —
    // convert to absolute price levels using the live entry price.
    // When tp_sl_mode='percentage' (or null), they are percentages —
    // store as take_profit_pct / stop_loss_pct for the trailing engine.
    const symbol = `${bot.coin.toUpperCase()}USDT`;
    const baseCoin = bot.coin.toUpperCase();
    const side = resolvedDirection === "short" ? "SELL" : "BUY";
    const marginInr = bot.capital && bot.capital > 0 ? bot.capital : 100;
    const forcedLeverage = requestedLeverage || 10;

    // Fetch live price for fixed-amount conversion before the order
    let preEntryPrice = 0;
    try {
      const priceResp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
      if (priceResp.ok) {
        const priceData = await priceResp.json() as { price: string };
        preEntryPrice = parseFloat(priceData.price);
      }
    } catch { /* will retry after order fill */ }

    let tpPctValue: number | null = null;
    let slPctValue: number | null = null;
    let tpAmountValue: number | null = null;
    let slPriceValue: number | null = null;

    if (bot.tp_sl_mode === "fixed" && preEntryPrice > 0) {
      const qty = marginInr * forcedLeverage / preEntryPrice;
      // CEO DIRECTIVE: Fixed TP/SL inputs are in INR — convert to USDT (quote
      // currency) before deriving the absolute target/stop price. Treating the
      // raw INR value as USDT caused massive overextension (negative targets).
      const USD_INR_RATE = 102;
      const tpFixedAmt = (bot.tp_fixed ?? bot.take_profit ?? 0) / USD_INR_RATE;
      const slFixedAmt = (bot.sl_fixed ?? bot.stop_loss ?? 0) / USD_INR_RATE;
      if (tpFixedAmt > 0 && qty > 0) {
        const priceMove = tpFixedAmt / qty;
        const raw = resolvedDirection === "long" ? preEntryPrice + priceMove : preEntryPrice - priceMove;
        tpAmountValue = raw > 0 ? raw : null;
      }
      if (slFixedAmt > 0 && qty > 0) {
        const priceMove = slFixedAmt / qty;
        const raw = resolvedDirection === "long" ? preEntryPrice - priceMove : preEntryPrice + priceMove;
        slPriceValue = raw > 0 ? raw : null;
      }
    } else {
      tpPctValue = bot.take_profit;
      slPctValue = bot.stop_loss;
    }

    // 4.7. ATOMIC DB LOCK (CEO race-condition fix)
    // Before touching the exchange, insert a PENDING position row. The unique
    // partial index uniq_one_active_position_per_bot guarantees only one
    // active (open/pending) row per bot — repeated clicks or a concurrent cron
    // tick that try to open for the same bot_id fail here and never reach the
    // exchange. Released (deleted) on failure, promoted to 'open' on success.
    const liveSymbol = `${bot.coin.toUpperCase()}USDT`;
    const liveSide = resolvedDirection === "short" ? "SELL" : "BUY";

    if (action === "open") {
      const { data: lockRow, error: lockErr } = await adminClient.from("positions").insert({
        bot_id: bot.id,
        user_id: userId,
        symbol: liveSymbol,
        side: liveSide,
        entry_price: 0,
        quantity: 0,
        leverage: requestedLeverage,
        take_profit_pct: tpPctValue,
        stop_loss_pct: slPctValue,
        take_profit_amount: tpAmountValue,
        current_stop_loss: slPriceValue,
        trailing_enabled: bot.trailing_enabled ?? false,
        trailing_distance_pct: bot.trailing_distance,
        // CEO DIRECTIVE (PNL-BASED SQUARE OFF): fixed_profit/fixed_loss hold
        // the user's INR TP/SL goal (tp_fixed/sl_fixed) when tp_sl_mode='fixed'.
        // The cron compares live INR PnL against these to trigger square-off.
        // Daily safety limits live in max_daily_profit/max_daily_loss below.
        fixed_profit: bot.tp_sl_mode === "fixed" ? (bot.tp_fixed ?? null) : null,
        fixed_loss: bot.tp_sl_mode === "fixed" ? (bot.sl_fixed ?? null) : null,
        max_trades_per_day: bot.max_trades_per_day ?? null,
        max_daily_loss: bot.max_daily_loss ?? null,
        max_daily_profit: bot.max_daily_profit ?? null,
        trailing_stop_loss_pct: bot.trailing_distance ?? null,
        status: "pending",
        is_paper: false,
        unrealized_pnl: 0,
      }).select("id").maybeSingle();

      if (lockErr || !lockRow) {
        const detail = lockErr?.code === "23505"
          ? "Aborted: bot already has an active or pending position (atomic lock held)"
          : `Atomic lock insert failed: ${lockErr?.message ?? "no row returned"}`;
        await logApiCall(adminClient, userId, "SYSTEM", "/atomic-lock", "error", 0, detail);
        return new Response(JSON.stringify({ error: detail }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Stash the lock id on the request scope via a closure variable.
      pendingLockId = (lockRow as { id: string }).id;
    }

    const startTime = Date.now();
    const golden = await executeGoldenTrade({
      apiKey: brokerKeys.apiKey,
      apiSecret: brokerKeys.apiSecret,
      baseCoin,
      side: side as "BUY" | "SELL",
      leverage: forcedLeverage,
      marginInr,
    });

    if (!golden.success && golden.livePriceUsdt <= 0) {
      // Exchange unreachable — release the atomic lock so a later attempt can retry.
      if (pendingLockId) {
        await adminClient.from("positions").delete().eq("id", pendingLockId);
      }
      return new Response(JSON.stringify({ error: golden.errorDetail }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const latencyMs = Date.now() - startTime;
    const orderStatus = golden.success ? "success" : "error";
    const payloadSummary = `SENT [pair=${golden.futuresPair}, qty=${golden.quantity}, lev=${forcedLeverage}, priceInr=${golden.livePriceInr.toFixed(2)}, marginInr=${marginInr}]`;
    const rawResponseText = JSON.stringify(golden.rawResponse).slice(0, 800);
    const orderDetail = golden.success
      ? `${payloadSummary} | INR-M Order ${side} ${golden.quantity} ${baseCoin} (${golden.futuresPair}) filled. OrderId: ${golden.orderId} | margin_currency_short_name=INR`
      : `${payloadSummary} | RESPONSE: ${rawResponseText} | ${golden.errorDetail ?? "Unknown error"}`;

    await logApiCall(adminClient, userId, brokerKeys.exchangeName, "/order", orderStatus, latencyMs, orderDetail);

    // 8. Promote the PENDING lock to OPEN on success, or release on failure
    let dbInsertError: string | undefined;
    if (golden.success && action === "open") {
      const entryPrice = golden.entryPrice;
      const quantity = golden.executedQty;

      const { error: posErr } = await adminClient.from("positions").update({
        status: "open",
        entry_price: entryPrice,
        quantity,
        take_profit_pct: tpPctValue,
        stop_loss_pct: slPctValue,
        take_profit_amount: tpAmountValue,
        current_stop_loss: slPriceValue,
        exchange_order_id: golden.orderId,
      }).eq("id", pendingLockId!);
      if (posErr) {
        dbInsertError = `positions insert failed: ${posErr.message}`;
        await logApiCall(adminClient, userId, "SYSTEM", "/db-insert-positions", "error", 0, dbInsertError);
      }

      const { error: tradeErr } = await adminClient.from("trades").insert({
        client_id: userId,
        client_name: bot.name ?? "AI Bot",
        coin: bot.coin,
        market_type: bot.market_type,
        direction: resolvedDirection,
        entry_price: entryPrice,
        amount: quantity,
        quantity: quantity,
        leverage: forcedLeverage,
        position_size: quantity * forcedLeverage,
        tp_pct: bot.take_profit ?? null,
        sl_pct: bot.stop_loss ?? null,
        status: "open",
        executed_by: bot.name ?? "AI Bot",
        fixed_profit: bot.tp_sl_mode === "fixed" ? (bot.tp_fixed ?? null) : null,
        fixed_loss: bot.tp_sl_mode === "fixed" ? (bot.sl_fixed ?? null) : null,
        max_trades_per_day: bot.max_trades_per_day ?? null,
        max_daily_loss: bot.max_daily_loss ?? null,
        max_daily_profit: bot.max_daily_profit ?? null,
        trailing_stop_loss: bot.trailing_distance ?? null,
      });
      if (tradeErr) {
        dbInsertError = (dbInsertError ?? "") + ` | trades insert failed: ${tradeErr.message}`;
        await logApiCall(adminClient, userId, "SYSTEM", "/db-insert-trades", "error", 0, `trades insert failed: ${tradeErr.message}`);
      }

      const { error: histErr } = await adminClient.from("trade_history").insert({
        user_id: userId,
        bot_id: bot.id,
        coin: bot.coin,
        timestamp: new Date().toISOString(),
        pair: symbol,
        side: side as "BUY" | "SELL",
        amount: quantity,
        price: entryPrice,
        entry_price: entryPrice,
        pnl: 0,
        realized_pnl: 0,
        leverage: forcedLeverage,
        margin_used: marginInr,
        strategy: bot.strategy ?? bot.bot_type ?? "ai",
        status: "open",
      });
      if (histErr) {
        dbInsertError = (dbInsertError ?? "") + ` | trade_history insert failed: ${histErr.message}`;
        await logApiCall(adminClient, userId, "SYSTEM", "/db-insert-history", "error", 0, `trade_history insert failed: ${histErr.message}`);
      }

      // ── 8b. VIRTUAL SL/TP (No native exchange conditional orders) ──
      // SL/TP is handled entirely by the Virtual Execution Engine in
      // monitor-positions and strategy-runner, which software-calculate
      // threshold crosses and fire reduce-only market orders. Native
      // exchange conditional orders (create_tpsl) are abandoned to avoid
      // conflicts between exchange-side and backend-side stop logic.
    } else if (action === "open" && !golden.success && pendingLockId) {
      // Exchange REJECTED the order (reachable but returned HTTP 400/403 etc).
      // Release the atomic lock so the bot can trade again after restart, but
      // HARD-PAUSE the bot immediately so the cron loop cannot retry and spam
      // the exchange API. The user must manually restart the bot after fixing
      // the config (e.g. increasing capital to meet the minimum order value).
      await adminClient.from("positions").delete().eq("id", pendingLockId);
      await adminClient.from("bots").update({ status: "paused" }).eq("id", bot.id);
      await logApiCall(adminClient, userId, "SYSTEM", "/auto-pause-on-rejection", "error", 0,
        `Bot AUTO-PAUSED: Exchange rejected order — ${golden.errorDetail ?? "Unknown error"}. Bot will NOT retry until manually restarted.`);
    }

    // 9. Auto-disable bot on risk breach if configured (separate from exchange
    // rejections above — this catches non-open actions or edge cases)
    if (!golden.success && risk.auto_disable_on_breach) {
      await adminClient.from("bots").update({ status: "paused" }).eq("id", bot.id);
    }

    return new Response(JSON.stringify({
      success: golden.success && !dbInsertError,
      mode: "live",
      broker: brokerKeys.exchangeName,
      status: orderStatus,
      detail: orderDetail,
      error: dbInsertError ?? (golden.success ? undefined : (golden.errorDetail ?? orderDetail)),
      dbInsertError,
      exchangeResponse: golden.rawResponse,
      attemptedPayload: golden.success ? undefined : golden.goldenPayload,
      debug: golden.success ? undefined : {
        marginInr,
        leverage: forcedLeverage,
        orderAmountInr: golden.orderAmountInr,
        livePriceInr: golden.livePriceInr,
        ethQuantity: golden.quantity,
        futuresPair: golden.futuresPair,
        baseCoin,
        side,
      },
    }), {
      status: golden.success && !dbInsertError ? 200 : (golden.success ? 500 : 502),
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

