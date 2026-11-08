/* Phase 2: exchange-adapter now reads broker URLs from broker_settings table
 * Monitor-Positions Edge Function — Automated Price & Risk Worker (v5 — reduce-only close + post-order verification)
 *
 * This is the "Eyes" of the trading platform. It runs the evaluation loop
 * that autonomously closes positions when risk thresholds are breached.
 *
 * Flow:
 *   1. Fetches all open positions from the positions table
 *   2. Fetches live ticker prices from Binance for each unique symbol
 *   3. For each position, evaluates:
 *      a. Fixed Take Profit — price hit the TP target
 *      b. Fixed Stop Loss — price hit the SL floor
 *      c. Trailing Stop — dynamically moving stop (uses TrailingStopEngine math)
 *   4. Updates trailing stop state (highest_price, lowest_price, current_stop_loss) in DB
 *   5. If any threshold is breached, closes the position via the exchange API
 *      (paper mode: simulates the close; live mode: sends signed SELL/BUY order)
 *   6. Logs exit reason to broker_api_logs and updates position status to closed
 *
 * Called periodically by the frontend usePositionMonitor hook (every 10s)
 * or by an external cron/scheduler.
 *
 * POST body: { } (uses the authenticated user's session)
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  decryptBrokerKeys,
  fetchLivePriceUsdt,
  placeCoinDcxInrMFuturesOrder,
  verifyPositionClosed,
  verifyOrderFilled,
  placeCoinDcxReduceOnlyClose,
} from "../_shared/exchange-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Decimal math (inline copies of RiskCalculator primitives) ───

function normalizeDecimal(str: string): string {
  if (!str || str === "0" || str === "0.0" || str === "0.00") return "0";
  const negative = str.startsWith("-");
  let s = negative ? str.slice(1) : str;
  if (!s.includes(".")) s = s + ".0";
  s = s.replace(/0+$/, "");
  s = s.replace(/\.$/, "");
  if (s === "" || s === "0") return "0";
  return (negative ? "-" : "") + s;
}

function getDecimalPlaces(str: string): number {
  const parts = str.split(".");
  return parts.length > 1 ? parts[1].length : 0;
}

function shiftRight(str: string, places: number): string {
  if (str === "0") return "0";
  const negative = str.startsWith("-");
  let s = negative ? str.slice(1) : str;
  const dotIndex = s.indexOf(".");
  if (dotIndex === -1) {
    s = s + "0".repeat(places);
  } else {
    const intPart = s.slice(0, dotIndex);
    const decPart = s.slice(dotIndex + 1);
    if (decPart.length >= places) {
      s = intPart + decPart.slice(0, places) + "." + decPart.slice(places);
    } else {
      s = intPart + decPart + "0".repeat(places - decPart.length);
    }
  }
  return (negative ? "-" : "") + normalizeDecimal(s);
}

function shiftLeft(str: string, places: number): string {
  if (str === "0") return "0";
  const negative = str.startsWith("-");
  let s = negative ? str.slice(1) : str;
  s = s.replace(".", "");
  while (s.length <= places) s = "0" + s;
  const insertPos = s.length - places;
  s = s.slice(0, insertPos) + "." + s.slice(insertPos);
  return (negative ? "-" : "") + normalizeDecimal(s);
}

function addDecimals(a: string, b: string): string {
  const maxPlaces = Math.max(getDecimalPlaces(a), getDecimalPlaces(b));
  const ai = shiftRight(a, maxPlaces);
  const bi = shiftRight(b, maxPlaces);
  const result = BigInt(ai) + BigInt(bi);
  return normalizeDecimal(shiftLeft(result.toString(), maxPlaces));
}

function subtractDecimals(a: string, b: string): string {
  const maxPlaces = Math.max(getDecimalPlaces(a), getDecimalPlaces(b));
  const ai = shiftRight(a, maxPlaces);
  const bi = shiftRight(b, maxPlaces);
  const result = BigInt(ai) - BigInt(bi);
  return normalizeDecimal(shiftLeft(result.toString(), maxPlaces));
}

function multiplyDecimals(a: string, b: string): string {
  const aPlaces = getDecimalPlaces(a);
  const bPlaces = getDecimalPlaces(b);
  const totalPlaces = aPlaces + bPlaces;
  const ai = a.replace(".", "").replace("-", "");
  const bi = b.replace(".", "").replace("-", "");
  const negative = (a.startsWith("-") || b.startsWith("-")) && !(a.startsWith("-") && b.startsWith("-"));
  const result = BigInt(ai) * BigInt(bi);
  const raw = shiftLeft(result.toString(), totalPlaces);
  return negative ? normalizeDecimal("-" + raw) : normalizeDecimal(raw);
}

function divideDecimals(a: string, b: string, precision: number = 18): string {
  if (b === "0") throw new Error("Division by zero");
  const aPlaces = getDecimalPlaces(a);
  const bPlaces = getDecimalPlaces(b);
  const shift = bPlaces - aPlaces + precision;
  const ai = a.replace(".", "").replace("-", "");
  const bi = b.replace(".", "").replace("-", "");
  const negative = (a.startsWith("-") || b.startsWith("-")) && !(a.startsWith("-") && b.startsWith("-"));
  let dividend = BigInt(ai);
  if (shift > 0) dividend = dividend * BigInt(10 ** shift);
  else if (shift < 0) {
    const divisor = BigInt(10 ** Math.abs(shift));
    dividend = dividend / divisor;
  }
  const result = dividend / BigInt(bi);
  const raw = shiftLeft(result.toString(), precision);
  return negative ? normalizeDecimal("-" + raw) : normalizeDecimal(raw);
}

function compareDecimals(a: string, b: string): number {
  const maxPlaces = Math.max(getDecimalPlaces(a), getDecimalPlaces(b));
  const ai = BigInt(shiftRight(a, maxPlaces));
  const bi = BigInt(shiftRight(b, maxPlaces));
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

// ─── P&L calculation ───
// CEO DIRECTIVE (PNL-BASED SQUARE OFF): All PnL used for TP/SL trigger
// comparisons must be denominated in INR, because user-configured fixed
// targets/losses (fixed_profit / fixed_loss / tp_fixed / sl_fixed) are INR
// amounts. Prices and quantities are USDT/base-asset units, so the raw
// priceDiff * qty * leverage produces a USDT figure. We multiply by the
// PNL USD→INR rate (102) to convert to INR — matches the CoinDCX INR-M
// synthetic settlement rate used for both margin AND PnL.
const PNL_USD_INR_RATE = "102";

function calculatePnlUsdt(
  entryPrice: string,
  exitPrice: string,
  quantity: string,
  direction: "long" | "short",
  leverage: number,
): string {
  const priceDiff = direction === "long"
    ? subtractDecimals(exitPrice, entryPrice)
    : subtractDecimals(entryPrice, exitPrice);
  const grossPnl = multiplyDecimals(priceDiff, quantity);
  return multiplyDecimals(grossPnl, leverage.toString());
}

// INR-denominated PnL — the single source of truth for TP/SL trigger logic.
function calculatePnlInr(
  entryPrice: string,
  exitPrice: string,
  quantity: string,
  direction: "long" | "short",
  leverage: number,
): string {
  const usdtPnl = calculatePnlUsdt(entryPrice, exitPrice, quantity, direction, leverage);
  return multiplyDecimals(usdtPnl, PNL_USD_INR_RATE);
}

// Back-compat alias: existing callers that stored USDT PnL into
// unrealized_pnl / close_pnl continue to use the USDT figure so historical
// dashboard math is unchanged. Trigger logic uses calculatePnlInr.
function calculatePnl(
  entryPrice: string,
  exitPrice: string,
  quantity: string,
  direction: "long" | "short",
  leverage: number,
): string {
  return calculatePnlUsdt(entryPrice, exitPrice, quantity, direction, leverage);
}

// ─── Types ───

interface PositionRow {
  id: string;
  bot_id: string | null;
  user_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  entry_price: number;
  quantity: number;
  leverage: number;
  take_profit_pct: number | null;
  stop_loss_pct: number | null;
  trailing_enabled: boolean;
  trailing_distance_pct: number | null;
  current_stop_loss: number | null;
  highest_price: number | null;
  lowest_price: number | null;
  take_profit_amount: number | null;
  unrealized_pnl: number;
  status: string;
  is_paper: boolean;
  exchange_order_id: string | null;
  fixed_profit: number | null;
  fixed_loss: number | null;
  max_trades_per_day: number | null;
  max_daily_loss: number | null;
  max_daily_profit: number | null;
  trailing_stop_loss_pct: number | null;
}

interface BotRow {
  id: string;
  user_id: string;
  market_type: "spot" | "futures";
  coin: string;
  trade_direction: "long" | "short" | "auto" | null;
  order_type: "market" | "limit" | null;
  status: string;
  max_daily_loss: number | null;
  max_daily_profit: number | null;
  cooldown_minutes: number | null;
}

// ─── Price Oracle (uses SSOT fetchLivePriceUsdt from exchange-adapter) ───

async function fetchTickerPrices(symbols: string[]): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  if (symbols.length === 0) return priceMap;

  await Promise.all(symbols.map(async (symbol) => {
    const cleanSymbol = symbol.replace(/_F$/, "");
    const baseCoin = cleanSymbol.replace(/(USDT|INR)$/, "").replace(/^B-/, "");
    try {
      const price = await fetchLivePriceUsdt(baseCoin);
      if (Number.isFinite(price) && price > 0) {
        priceMap.set(symbol, price);
      }
    } catch {
      // A missing ticker is retried during the next monitoring cycle.
    }
  }));
  return priceMap;
}

// ─── Trailing Stop Evaluation ───

interface TrailingUpdate {
  newStopLoss: string;
  newHighest: string;
  newLowest: string;
  newTakeProfit: string | null;
  wasMoved: boolean;
  shouldTrigger: boolean;
  reason: string;
}

function evaluateTrailingStop(
  direction: "long" | "short",
  currentPriceStr: string,
  highestPriceStr: string,
  lowestPriceStr: string,
  currentStopLossStr: string,
  trailingDistancePctStr: string,
  entryPriceStr: string,
  originalTpStr: string,
  currentTpStr: string | null,
): TrailingUpdate {
  const distPct = divideDecimals(trailingDistancePctStr, "100", 18);

  if (direction === "long") {
    const newHighest = compareDecimals(currentPriceStr, highestPriceStr) > 0
      ? currentPriceStr
      : highestPriceStr;

    const trailingAmount = multiplyDecimals(newHighest, distPct);
    const proposedStop = subtractDecimals(newHighest, trailingAmount);

    const wasMoved = compareDecimals(proposedStop, currentStopLossStr) > 0;
    const newStopLoss = wasMoved ? proposedStop : currentStopLossStr;
    const shouldTrigger = compareDecimals(currentPriceStr, newStopLoss) <= 0;

    // ── GOLDEN LOGIC: Trail the Take Profit by the same favorable distance ──
    // favorable distance = newHighest - entryPrice (how far price has moved up)
    // new TP = original TP + favorable distance
    let newTakeProfit: string | null = currentTpStr;
    if (compareDecimals(newHighest, entryPriceStr) > 0) {
      const favorableDist = subtractDecimals(newHighest, entryPriceStr);
      const goldenTp = addDecimals(originalTpStr, favorableDist);
      if (currentTpStr === null || compareDecimals(goldenTp, currentTpStr) > 0) {
        newTakeProfit = goldenTp;
      }
    }

    return {
      newStopLoss: normalizeDecimal(newStopLoss),
      newHighest,
      newLowest: lowestPriceStr,
      newTakeProfit,
      wasMoved,
      shouldTrigger,
      reason: wasMoved
        ? `Trailing stop moved up to ${newStopLoss} (high: ${newHighest}), TP trailed to ${newTakeProfit}`
        : shouldTrigger
        ? `Price ${currentPriceStr} hit trailing stop ${newStopLoss}`
        : "No movement",
    };
  } else {
    const newLowest = compareDecimals(currentPriceStr, lowestPriceStr) < 0
      ? currentPriceStr
      : lowestPriceStr;

    const trailingAmount = multiplyDecimals(newLowest, distPct);
    const proposedStop = addDecimals(newLowest, trailingAmount);

    const wasMoved = compareDecimals(proposedStop, currentStopLossStr) < 0;
    const newStopLoss = wasMoved ? proposedStop : currentStopLossStr;
    const shouldTrigger = compareDecimals(currentPriceStr, newStopLoss) >= 0;

    // ── GOLDEN LOGIC: Trail the Take Profit by the same favorable distance ──
    // favorable distance = entryPrice - newLowest (how far price has moved down)
    // new TP = original TP - favorable distance
    let newTakeProfit: string | null = currentTpStr;
    if (compareDecimals(entryPriceStr, newLowest) > 0) {
      const favorableDist = subtractDecimals(entryPriceStr, newLowest);
      const goldenTp = subtractDecimals(originalTpStr, favorableDist);
      if (currentTpStr === null || compareDecimals(goldenTp, currentTpStr) < 0) {
        newTakeProfit = goldenTp;
      }
    }

    return {
      newStopLoss: normalizeDecimal(newStopLoss),
      newHighest: highestPriceStr,
      newLowest,
      newTakeProfit,
      wasMoved,
      shouldTrigger,
      reason: wasMoved
        ? `Trailing stop moved down to ${newStopLoss} (low: ${newLowest}), TP trailed to ${newTakeProfit}`
        : shouldTrigger
        ? `Price ${currentPriceStr} hit trailing stop ${newStopLoss}`
        : "No movement",
    };
  }
}

// ─── Close Position via Exchange ───

async function closePositionOnExchange(
  adminClient: ReturnType<typeof createClient>,
  position: PositionRow,
  _bot: BotRow | null,
  exitPrice: number,
  exitReason: string,
): Promise<{ success: boolean; detail: string }> {
  const userId = position.user_id;

  // Paper mode — simulate close
  if (position.is_paper) {
    const pnl = calculatePnl(
      position.entry_price.toString(),
      exitPrice.toString(),
      position.quantity.toString(),
      position.side === "BUY" ? "long" : "short",
      position.leverage,
    );

    const closeStatus = exitReason.includes("PROFIT") ? "closed_tp" : exitReason.includes("STOP_LOSS") || exitReason.includes("TRAILING_STOP_LOSS") ? "closed_sl" : "closed_manual";

    await adminClient.from("positions").update({
      status: closeStatus,
      close_price: exitPrice,
      close_pnl: parseFloat(pnl),
      closed_at: new Date().toISOString(),
      unrealized_pnl: parseFloat(pnl),
    }).eq("id", position.id);

    // Sync the matching trade row to closed status
    const coinFromSymbol = position.symbol.replace(/USDT$/, "");
    await adminClient.from("trades").update({
      status: closeStatus,
    }).eq("client_id", userId).eq("coin", coinFromSymbol).eq("status", "open").limit(1);

    await adminClient.from("broker_api_logs").insert({
      user_id: userId,
      broker: "PAPER",
      endpoint: "/simulated-close",
      status: "success",
      latency_ms: 0,
      detail: `PAPER CLOSE: ${position.symbol} @ ${exitPrice} | reason=${exitReason} | pnl=${pnl}`,
    });

    return { success: true, detail: `Paper position closed: ${exitReason}` };
  }

  // Live mode — fetch and decrypt broker keys via shared adapter
  const brokerKeys = await decryptBrokerKeys(adminClient, userId);
  if (!brokerKeys) {
    return { success: false, detail: "No connected broker found for close order" };
  }

  const closeSide = position.side === "BUY" ? "SELL" : "BUY";
  const baseCoin = position.symbol.replace(/USDT$/, "").replace(/^B-/, "");
  const futuresPair = `B-${baseCoin}_USDT`;


  const startTime = Date.now();

  try {
    // ── REDUCE-ONLY CLOSE ORDER ──
    // Reduce-only so the exchange rejects the order if the position
    // has already been closed, preventing accidental reverse trades.
    let closeResp;
    if (brokerKeys.exchangeName.toLowerCase().includes("coindcx") && exitPrice > 0) {
      closeResp = await placeCoinDcxReduceOnlyClose({
        apiKey: brokerKeys.apiKey,
        apiSecret: brokerKeys.apiSecret,
        base: baseCoin,
        side: closeSide,
        leverage: position.leverage,
        ethQuantity: position.quantity,
        livePriceUsdt: exitPrice,
      });
    } else {
      // Non-CoinDCX fallback: use standard market close (existing behavior).
      closeResp = await placeCoinDcxInrMFuturesOrder({
        apiKey: brokerKeys.apiKey,
        apiSecret: brokerKeys.apiSecret,
        base: baseCoin,
        side: closeSide,
        leverage: position.leverage,
        ethQuantity: position.quantity,
        inrAmount: position.quantity * exitPrice,
      });
    }

    const latencyMs = Date.now() - startTime;
    const closeStatusLog = closeResp.success ? "success" : "error";
    const closeDetail = closeResp.success
      ? `Close order ${closeSide} ${position.quantity} ${position.symbol} filled. OrderId: ${closeResp.orderId}`
      : `Close order failed: ${closeResp.errorDetail ?? "unknown error"}`;

    await adminClient.from("broker_api_logs").insert({
      user_id: userId,
      broker: brokerKeys.exchangeName,
      endpoint: "/auto-close",
      status: closeStatusLog,
      latency_ms: latencyMs,
      detail: `${closeDetail} | reason=${exitReason}`,
    });

    if (!closeResp.success) {
      return { success: false, detail: closeDetail };
    }

    // ── VERIFY: poll order status to confirm the close order is actually 'filled' ──
    let actualFillPrice = 0;
    if (closeResp.orderId && closeResp.orderId !== "N/A") {
      const orderVerification = await verifyOrderFilled({
        apiKey: brokerKeys.apiKey,
        apiSecret: brokerKeys.apiSecret,
        orderId: closeResp.orderId,
      });
      if (!orderVerification.confirmed) {
        await adminClient.from("broker_api_logs").insert({
          user_id: userId,
          broker: brokerKeys.exchangeName,
          endpoint: "/auto-close-verify",
          status: "error",
          latency_ms: 0,
          detail: `CLOSE FAILED — order ${closeResp.orderId} status='${orderVerification.status}' (not filled). DB NOT marked closed. reason=${exitReason}`,
        });
        return {
          success: false,
          detail: `Close order not filled (status=${orderVerification.status}). Will retry next cycle.`,
        };
      }
      actualFillPrice = orderVerification.fillPrice;
    }

    // ── VERIFY: poll the exchange to confirm the position is actually closed ──
    const verification = await verifyPositionClosed({
      apiKey: brokerKeys.apiKey,
      apiSecret: brokerKeys.apiSecret,
      futuresPair,
    });

    if (!verification.confirmed) {
      await adminClient.from("broker_api_logs").insert({
        user_id: userId,
        broker: brokerKeys.exchangeName,
        endpoint: "/auto-close-verify",
        status: "error",
        latency_ms: 0,
        detail: `CLOSE FAILED — Position still live on exchange (${futuresPair} remaining size: ${verification.remainingSize}). DB NOT marked closed. reason=${exitReason}`,
      });
      return {
        success: false,
        detail: `Close order accepted but position still open on exchange (remaining size ${verification.remainingSize}). Will retry next cycle.`,
      };
    }

    // Use the actual fill price from the order status, not the mark price.
    const finalExitPrice = actualFillPrice > 0 ? actualFillPrice
      : (closeResp.entryPrice > 0 ? closeResp.entryPrice : exitPrice);

    // Prefer the exchange's realized PnL when available; fall back to local
    // calc using the ACTUAL fill price (not the mark price snapshot).
    const localPnl = calculatePnl(
      position.entry_price.toString(),
      finalExitPrice.toString(),
      position.quantity.toString(),
      position.side === "BUY" ? "long" : "short",
      position.leverage,
    );
    const realizedPnl = verification.realizedPnl !== 0 ? verification.realizedPnl : parseFloat(localPnl);

    const closeStatusValue = exitReason.includes("PROFIT") ? "closed_tp" : exitReason.includes("STOP_LOSS") || exitReason.includes("TRAILING_STOP_LOSS") ? "closed_sl" : "closed_manual";

    // Margin in INR = (quantity * entry_price) / leverage, converted via USD_INR.
    // entry_price is in USDT (CoinDCX futures are USDT-denominated), so multiply
    // by the 102 rate to get the INR margin the user actually posted.
    const marginUsedInr = (position.quantity * position.entry_price) / position.leverage * 102;

    await adminClient.from("positions").update({
      status: closeStatusValue,
      close_price: finalExitPrice,
      close_pnl: realizedPnl,
      closed_at: new Date().toISOString(),
      unrealized_pnl: realizedPnl,
    }).eq("id", position.id);

    const coinFromSymbol = position.symbol.replace(/USDT$/, "");
    await adminClient.from("trades").update({
      status: closeStatusValue,
    }).eq("client_id", userId).eq("coin", coinFromSymbol).eq("status", "open").limit(1);

    // UPDATE the existing "open" trade_history row (created at entry time)
    // with exit data — do NOT insert a new row, which was causing duplicate
    // entries with null entry_price/margin_used/leverage.
    await adminClient.from("trade_history").update({
      exit_price: finalExitPrice,
      realized_pnl: realizedPnl,
      pnl: realizedPnl,
      closed_at: new Date().toISOString(),
      status: closeStatusValue,
    }).eq("user_id", userId).eq("pair", position.symbol).eq("status", "open").order("timestamp", { ascending: false }).limit(1);

    await adminClient.from("broker_api_logs").insert({
      user_id: userId,
      broker: brokerKeys.exchangeName,
      endpoint: "/auto-close-verify",
      status: "success",
      latency_ms: 0,
      detail: `CLOSE VERIFIED — ${futuresPair} position confirmed closed on exchange. realized_pnl=${realizedPnl} | reason=${exitReason}`,
    });

    return { success: true, detail: closeDetail };
  } catch (fetchErr) {
    const latencyMs = Date.now() - startTime;
    const closeDetail = `Network error on close: ${(fetchErr as Error).message}`;
    await adminClient.from("broker_api_logs").insert({
      user_id: userId,
      broker: brokerKeys.exchangeName,
      endpoint: "/auto-close",
      status: "error",
      latency_ms: latencyMs,
      detail: `${closeDetail} | reason=${exitReason}`,
    });
    return { success: false, detail: closeDetail };
  }
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
    const bearerToken = authHeader.replace("Bearer ", "");

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Dual-mode auth: service role key (cron) vs user JWT (frontend).
    // The cron job sends the service role key as the Bearer token — that
    // is NOT a user JWT, so auth.getUser() rejects it with 401. We detect
    // system calls by comparing the token to the service role key and run
    // in system mode (scan ALL users' open positions). Frontend calls
    // pass a real user JWT and run scoped to that user.
    const isSystemCall = bearerToken === serviceRoleKey;
    let targetUserId: string | null = null;

    if (!isSystemCall) {
      const { data: userData, error: userError } = await adminClient.auth.getUser(bearerToken);
      if (userError || !userData.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetUserId = userData.user.id;
    }

    // 1. Fetch open positions — all users in system mode, one user otherwise
    let positionsQuery = adminClient
      .from("positions")
      .select("*")
      .eq("status", "open");

    if (!isSystemCall && targetUserId) {
      positionsQuery = positionsQuery.eq("user_id", targetUserId);
    }

    const { data: positionsData, error: posErr } = await positionsQuery;

    if (posErr) {
      return new Response(JSON.stringify({ error: posErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const positions = (positionsData as PositionRow[]) ?? [];
    if (positions.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        monitored: 0,
        closed: 0,
        trailingUpdates: 0,
        message: "No open positions to monitor",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch bot configs for all positions (need market_type, trade_direction, risk limits)
    const botIds = [...new Set(positions.map((p) => p.bot_id).filter(Boolean))] as string[];
    const { data: botsData } = await adminClient
      .from("bots")
      .select("id, user_id, market_type, coin, trade_direction, order_type, status, max_daily_loss, max_daily_profit, cooldown_minutes")
      .in("id", botIds);

    const botMap = new Map<string, BotRow>();
    for (const b of (botsData as BotRow[]) ?? []) {
      botMap.set(b.id, b);
    }

    // 3. Fetch live prices for all unique symbols
    // For futures positions, we append _F to the symbol to distinguish the price source
    const symbolSet = new Set<string>();
    for (const pos of positions) {
      const bot = pos.bot_id ? botMap.get(pos.bot_id) : null;
      const isFutures = bot?.market_type === "futures";
      symbolSet.add(isFutures ? pos.symbol + "_F" : pos.symbol);
    }
    const priceMap = await fetchTickerPrices([...symbolSet]);

    // 4. Evaluate each position
    let closedCount = 0;
    let trailingUpdateCount = 0;
    const results: Array<{ positionId: string; symbol: string; action: string; detail: string }> = [];

    for (const pos of positions) {
      const bot = pos.bot_id ? botMap.get(pos.bot_id) : null;
      const isFutures = bot?.market_type === "futures";
      const priceKey = isFutures ? pos.symbol + "_F" : pos.symbol;
      const currentPrice = priceMap.get(priceKey);

      if (currentPrice === undefined) {
        results.push({
          positionId: pos.id,
          symbol: pos.symbol,
          action: "SKIP",
          detail: "No live price available",
        });
        continue;
      }

      const currentPriceStr = currentPrice.toString();
      const entryPriceStr = pos.entry_price.toString();
      const direction: "long" | "short" = pos.side === "BUY" ? "long" : "short";

      // ── Evaluate Fixed Take Profit ──
      let shouldClose = false;
      let exitReason = "";
      let exitPrice = currentPrice;

      if (pos.take_profit_pct && pos.take_profit_pct > 0) {
        // Margin-based TP: user's percentage is ROE on margin, not asset price.
        // PriceMove% = tpPct / (leverage * 100)
        const tpPctStr = pos.take_profit_pct.toString();
        const levStr = pos.leverage.toString();
        const tpPctLev = divideDecimals(tpPctStr, levStr, 18);
        const tpDecimal = divideDecimals(tpPctLev, "100", 18);
        const tpTarget = direction === "long"
          ? addDecimals(entryPriceStr, multiplyDecimals(entryPriceStr, tpDecimal))
          : subtractDecimals(entryPriceStr, multiplyDecimals(entryPriceStr, tpDecimal));

        if (direction === "long" && compareDecimals(currentPriceStr, tpTarget) >= 0) {
          shouldClose = true;
          exitReason = "TAKE_PROFIT_HIT";
        } else if (direction === "short" && compareDecimals(currentPriceStr, tpTarget) <= 0) {
          shouldClose = true;
          exitReason = "TAKE_PROFIT_HIT";
        }
      }

      // ── Evaluate Fixed Stop Loss ──
      if (!shouldClose && pos.stop_loss_pct && pos.stop_loss_pct > 0) {
        // Margin-based SL: user's percentage is ROE on margin, not asset price.
        const slPctStr = pos.stop_loss_pct.toString();
        const levStr = pos.leverage.toString();
        const slPctLev = divideDecimals(slPctStr, levStr, 18);
        const slDecimal = divideDecimals(slPctLev, "100", 18);
        const slFloor = direction === "long"
          ? subtractDecimals(entryPriceStr, multiplyDecimals(entryPriceStr, slDecimal))
          : addDecimals(entryPriceStr, multiplyDecimals(entryPriceStr, slDecimal));

        if (direction === "long" && compareDecimals(currentPriceStr, slFloor) <= 0) {
          shouldClose = true;
          exitReason = "STOP_LOSS_HIT";
        } else if (direction === "short" && compareDecimals(currentPriceStr, slFloor) >= 0) {
          shouldClose = true;
          exitReason = "STOP_LOSS_HIT";
        }
      }

      // ── Evaluate Trailing Stop (Golden Logic: TP trails alongside SL) ──
      if (!shouldClose && pos.trailing_enabled && pos.trailing_distance_pct && pos.trailing_distance_pct > 0) {
        const highestStr = (pos.highest_price ?? pos.entry_price).toString();
        const lowestStr = (pos.lowest_price ?? pos.entry_price).toString();
        const currentStopStr = (pos.current_stop_loss ?? pos.entry_price).toString();
        const trailingDistStr = pos.trailing_distance_pct.toString();

        // Compute original TP price for Golden Logic
        // When tp_sl_mode='fixed', take_profit_amount holds the absolute TP price.
        // When tp_sl_mode='percentage', take_profit_pct holds the percentage.
        let originalTpStr = "0";
        if (pos.take_profit_amount !== null && pos.take_profit_amount > 0) {
          originalTpStr = pos.take_profit_amount.toString();
        } else if (pos.take_profit_pct && pos.take_profit_pct > 0) {
          const tpPctLev = divideDecimals(pos.take_profit_pct.toString(), pos.leverage.toString(), 18);
          const tpDecimal = divideDecimals(tpPctLev, "100", 18);
          originalTpStr = direction === "long"
            ? addDecimals(entryPriceStr, multiplyDecimals(entryPriceStr, tpDecimal))
            : subtractDecimals(entryPriceStr, multiplyDecimals(entryPriceStr, tpDecimal));
        }
        const currentTpStr = pos.take_profit_amount !== null ? pos.take_profit_amount.toString() : null;

        const trailingResult = evaluateTrailingStop(
          direction,
          currentPriceStr,
          highestStr,
          lowestStr,
          currentStopStr,
          trailingDistStr,
          entryPriceStr,
          originalTpStr,
          currentTpStr,
        );

        // Update trailing stop state AND take_profit_amount in DB if moved
        if (trailingResult.wasMoved || trailingResult.shouldTrigger) {
          const updateFields: Record<string, number | string> = {
            current_stop_loss: parseFloat(trailingResult.newStopLoss),
            highest_price: parseFloat(trailingResult.newHighest),
            lowest_price: parseFloat(trailingResult.newLowest),
            updated_at: new Date().toISOString(),
          };
          if (trailingResult.newTakeProfit !== null) {
            updateFields.take_profit_amount = parseFloat(trailingResult.newTakeProfit);
          }
          await adminClient.from("positions").update(updateFields).eq("id", pos.id);

          trailingUpdateCount++;
        }

        // Golden Logic: check if price hit the trailed TP target
        if (!trailingResult.shouldTrigger && trailingResult.newTakeProfit !== null) {
          const goldenTp = trailingResult.newTakeProfit;
          if (direction === "long" && compareDecimals(currentPriceStr, goldenTp) >= 0) {
            shouldClose = true;
            exitReason = "GOLDEN_TP_TRAILED_HIT";
          } else if (direction === "short" && compareDecimals(currentPriceStr, goldenTp) <= 0) {
            shouldClose = true;
            exitReason = "GOLDEN_TP_TRAILED_HIT";
          }
        }

        if (trailingResult.shouldTrigger) {
          shouldClose = true;
          exitReason = "TRAILING_STOP_HIT";
        }
      }

      // ── Evaluate Trailing Stop Loss (absolute % from peak) with Golden Logic ──
      // This is the advanced risk control from the trades table — it works
      // identically to trailing_distance_pct but uses the separate
      // trailing_stop_loss_pct column for compatibility with manual trades.
      // Golden Logic: TP also trails by the same favorable distance.
      if (!shouldClose && pos.trailing_stop_loss_pct && pos.trailing_stop_loss_pct > 0) {
        const tslPctStr = pos.trailing_stop_loss_pct.toString();
        const tslDecimal = divideDecimals(tslPctStr, "100", 18);
        const highestStr = (pos.highest_price ?? pos.entry_price).toString();
        const lowestStr = (pos.lowest_price ?? pos.entry_price).toString();
        const currentStopStr = (pos.current_stop_loss ?? pos.entry_price).toString();

        // Compute original TP price for Golden Logic
        // Use take_profit_amount (fixed mode) or take_profit_pct (percentage mode)
        let originalTslTpStr = "0";
        if (pos.take_profit_amount !== null && pos.take_profit_amount > 0) {
          originalTslTpStr = pos.take_profit_amount.toString();
        } else if (pos.take_profit_pct && pos.take_profit_pct > 0) {
          const tpPctLev = divideDecimals(pos.take_profit_pct.toString(), pos.leverage.toString(), 18);
          const tpDecimal = divideDecimals(tpPctLev, "100", 18);
          originalTslTpStr = direction === "long"
            ? addDecimals(entryPriceStr, multiplyDecimals(entryPriceStr, tpDecimal))
            : subtractDecimals(entryPriceStr, multiplyDecimals(entryPriceStr, tpDecimal));
        }

        if (direction === "long") {
          const newHighest = compareDecimals(currentPriceStr, highestStr) > 0 ? currentPriceStr : highestStr;
          const tslAmount = multiplyDecimals(newHighest, tslDecimal);
          const proposedStop = subtractDecimals(newHighest, tslAmount);
          const wasMoved = compareDecimals(proposedStop, currentStopStr) > 0;
          const newStopLoss = wasMoved ? proposedStop : currentStopStr;
          const shouldTrigger = compareDecimals(currentPriceStr, newStopLoss) <= 0;

          // Golden Logic: trail TP by favorable distance
          let newTakeProfit: number | null = pos.take_profit_amount;
          if (compareDecimals(newHighest, entryPriceStr) > 0) {
            const favorableDist = subtractDecimals(newHighest, entryPriceStr);
            const goldenTp = addDecimals(originalTslTpStr, favorableDist);
            if (pos.take_profit_amount === null || compareDecimals(goldenTp, pos.take_profit_amount.toString()) > 0) {
              newTakeProfit = parseFloat(goldenTp);
            }
          }

          if (wasMoved || shouldTrigger) {
            const updateFields: Record<string, number | string> = {
              current_stop_loss: parseFloat(newStopLoss),
              highest_price: parseFloat(newHighest),
              updated_at: new Date().toISOString(),
            };
            if (newTakeProfit !== null) updateFields.take_profit_amount = newTakeProfit;
            await adminClient.from("positions").update(updateFields).eq("id", pos.id);
            trailingUpdateCount++;
          }

          if (shouldTrigger) {
            shouldClose = true;
            exitReason = "TRAILING_STOP_LOSS_HIT";
          }
        } else {
          const newLowest = compareDecimals(currentPriceStr, lowestStr) < 0 ? currentPriceStr : lowestStr;
          const tslAmount = multiplyDecimals(newLowest, tslDecimal);
          const proposedStop = addDecimals(newLowest, tslAmount);
          const wasMoved = compareDecimals(proposedStop, currentStopStr) < 0;
          const newStopLoss = wasMoved ? proposedStop : currentStopStr;
          const shouldTrigger = compareDecimals(currentPriceStr, newStopLoss) >= 0;

          // Golden Logic: trail TP by favorable distance
          let newTakeProfit: number | null = pos.take_profit_amount;
          if (compareDecimals(entryPriceStr, newLowest) > 0) {
            const favorableDist = subtractDecimals(entryPriceStr, newLowest);
            const goldenTp = subtractDecimals(originalTslTpStr, favorableDist);
            if (pos.take_profit_amount === null || compareDecimals(goldenTp, pos.take_profit_amount.toString()) < 0) {
              newTakeProfit = parseFloat(goldenTp);
            }
          }

          if (wasMoved || shouldTrigger) {
            const updateFields: Record<string, number | string> = {
              current_stop_loss: parseFloat(newStopLoss),
              lowest_price: parseFloat(newLowest),
              updated_at: new Date().toISOString(),
            };
            if (newTakeProfit !== null) updateFields.take_profit_amount = newTakeProfit;
            await adminClient.from("positions").update(updateFields).eq("id", pos.id);
            trailingUpdateCount++;
          }

          if (shouldTrigger) {
            shouldClose = true;
            exitReason = "TRAILING_STOP_LOSS_HIT";
          }
        }
      }

      // ── Evaluate Fixed Profit Target (absolute INR amount) ──
      // CEO DIRECTIVE: Trigger on live INR PnL, not USDT. fixed_profit is the
      // user's INR profit goal. Live PnL = (priceDiff * qty * lev) * 102.
      if (!shouldClose && pos.fixed_profit && pos.fixed_profit > 0) {
        const currentPnlInr = calculatePnlInr(
          entryPriceStr,
          currentPriceStr,
          pos.quantity.toString(),
          direction,
          pos.leverage,
        );
        if (compareDecimals(currentPnlInr, pos.fixed_profit.toString()) >= 0) {
          shouldClose = true;
          exitReason = "FIXED_PROFIT_TARGET_HIT";
        }
      }

      // ── Evaluate Fixed Loss Stop (absolute INR amount) ──
      if (!shouldClose && pos.fixed_loss && pos.fixed_loss > 0) {
        const currentPnlInr = calculatePnlInr(
          entryPriceStr,
          currentPriceStr,
          pos.quantity.toString(),
          direction,
          pos.leverage,
        );
        if (compareDecimals(currentPnlInr, "-" + pos.fixed_loss.toString()) <= 0) {
          shouldClose = true;
          exitReason = "FIXED_LOSS_STOP_HIT";
        }
      }

      // ── Phase 2: Real-Time Daily PnL Cooldown Check ──
      // Calculate total daily PnL = closed trades today + live unrealized PnL
      if (!shouldClose && bot && pos.bot_id) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { data: todayClosed } = await adminClient
          .from("positions")
          .select("close_pnl")
          .eq("user_id", pos.user_id)
          .in("status", ["closed_tp", "closed_sl", "closed_manual"])
          .gte("closed_at", todayStart.toISOString());

        const todayRealized = ((todayClosed as { close_pnl: number | null }[]) ?? [])
          .reduce((sum, r) => sum + (r.close_pnl ?? 0), 0);

        const livePnl = parseFloat(calculatePnl(
          entryPriceStr,
          currentPriceStr,
          pos.quantity.toString(),
          direction,
          pos.leverage,
        ));

        const totalDailyPnl = todayRealized + livePnl;
        const maxLoss = bot.max_daily_loss;
        const maxProfit = bot.max_daily_profit;

        if ((maxLoss && totalDailyPnl <= -maxLoss) || (maxProfit && totalDailyPnl >= maxProfit)) {
          shouldClose = true;
          exitReason = maxProfit && totalDailyPnl >= maxProfit
            ? "DAILY_PROFIT_COOLDOWN_SQUAREOFF"
            : "DAILY_LOSS_COOLDOWN_SQUAREOFF";
        }
      }

      // ── Update unrealized P&L for open positions ──
      if (!shouldClose) {
        const pnl = calculatePnl(
          entryPriceStr,
          currentPriceStr,
          pos.quantity.toString(),
          direction,
          pos.leverage,
        );
        await adminClient.from("positions").update({
          unrealized_pnl: parseFloat(pnl),
          updated_at: new Date().toISOString(),
        }).eq("id", pos.id);
      }

      // ── Close position if threshold breached ──
      if (shouldClose) {
        const closeResult = await closePositionOnExchange(
          adminClient,
          pos,
          bot,
          exitPrice,
          exitReason,
        );

        if (closeResult.success) {
          closedCount++;
          results.push({
            positionId: pos.id,
            symbol: pos.symbol,
            action: "CLOSED",
            detail: `${exitReason} @ ${exitPrice} — ${closeResult.detail}`,
          });

          // Phase 2: Set bot to 'cooldown' after square-off on daily limit breach
          if (bot && pos.bot_id && (exitReason === "DAILY_LOSS_COOLDOWN_SQUAREOFF" || exitReason === "DAILY_PROFIT_COOLDOWN_SQUAREOFF")) {
            await adminClient.from("bots").update({
              status: "cooldown",
              updated_at: new Date().toISOString(),
            }).eq("id", pos.bot_id);
            results.push({
              positionId: pos.id,
              symbol: pos.symbol,
              action: "COOLDOWN",
              detail: `Bot ${pos.bot_id} set to cooldown after ${exitReason}`,
            });
          }
        } else {
          results.push({
            positionId: pos.id,
            symbol: pos.symbol,
            action: "CLOSE_FAILED",
            detail: closeResult.detail,
          });
        }
      } else if (!shouldClose) {
        results.push({
          positionId: pos.id,
          symbol: pos.symbol,
          action: "MONITORED",
          detail: `Price: ${currentPrice} — within limits`,
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      monitored: positions.length,
      closed: closedCount,
      trailingUpdates: trailingUpdateCount,
      results,
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
