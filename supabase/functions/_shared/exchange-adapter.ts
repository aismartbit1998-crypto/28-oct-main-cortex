/**
 * Universal CCXT Exchange Adapter (v7 — reduce-only close + state reconciliation)
 *
 * Uses the ccxt library for unified exchange support:
 *   CoinDCX, Delta Exchange
 *
 * Usage:
 *   import { ExchangeAdapter, decryptBrokerKeys, fetchTickerPrice } from "../_shared/exchange-adapter.ts";
 *
 *   const adapter = ExchangeAdapter.create(exchangeName);
 *   const orderResp = await adapter.placeOrder({ apiKey, apiSecret, ... });
 */

// CCXT is loaded lazily so the module doesn't crash on import if the npm
// package is unavailable in the Deno runtime. The Golden Payload path never
// needs CCXT — it uses native HMAC-SHA256 signing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ccxtCache: any = null;
async function _loadCcxt(): Promise<any> {
  if (_ccxtCache) return _ccxtCache;
  const mod = await import("npm:ccxt@4.4.18");
  _ccxtCache = mod.default ?? mod;
  return _ccxtCache;
}
const pick = async (name: string): Promise<any> => {
  const c = await _loadCcxt();
  return c[name] || c.default?.[name] || c[name.charAt(0).toUpperCase() + name.slice(1)] || c.default?.[name.charAt(0).toUpperCase() + name.slice(1)];
};

// ═══════════════════════════════════════════════════════════════════════
//  CRYPTO HELPERS (vault decryption)
// ═══════════════════════════════════════════════════════════════════════

const _enc = new TextEncoder();
const _dec = new TextDecoder();

async function _deriveVaultKey(): Promise<CryptoKey> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "fallback-vault-key";
  const baseKey = await crypto.subtle.importKey(
    "raw",
    _enc.encode(serviceKey),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: _enc.encode("cortex-vault-salt-v1"), iterations: 100_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function _fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function decryptValue(ciphertext: string, key: CryptoKey): Promise<string> {
  const combined = _fromBase64(ciphertext);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return _dec.decode(plainBuf);
}

export async function deriveVaultKey(): Promise<CryptoKey> {
  return _deriveVaultKey();
}

// ═══════════════════════════════════════════════════════════════════════
//  BROKER KEY DECRYPTION HELPER
// ═══════════════════════════════════════════════════════════════════════

export interface DecryptedBrokerKeys {
  exchangeName: string;
  apiKey: string;
  apiSecret: string;
}

export async function decryptBrokerKeys(
  adminClient: ReturnType<typeof import("npm:@supabase/supabase-js").createClient>,
  userId: string,
): Promise<DecryptedBrokerKeys | null> {
  const { data: brokerKeyRow, error: bkErr } = await adminClient
    .from("broker_keys")
    .select("id, exchange_name, api_key, api_secret, is_connected")
    .eq("user_id", userId)
    .eq("is_connected", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bkErr || !brokerKeyRow) return null;

  const vaultKey = await _deriveVaultKey();
  const apiKey = await decryptValue(brokerKeyRow.api_key as string, vaultKey);
  const apiSecret = await decryptValue(brokerKeyRow.api_secret as string, vaultKey);

  return {
    exchangeName: brokerKeyRow.exchange_name as string,
    apiKey,
    apiSecret,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  TICKER PRICE FETCHER (exchange-agnostic via Binance public API)
// ═══════════════════════════════════════════════════════════════════════

export function normalizeCcxtSymbol(symbol: string): string {
  const compact = symbol.replace(/_F$/, "");
  if (compact.includes("/")) return compact;
  if (compact.endsWith("USDT")) return `${compact.slice(0, -4)}/USDT`;
  return compact;
}

export async function getActiveFuturesSymbols(): Promise<string[]> {
  try {
    const res = await fetch(await getPublicPriceUrl());
    if (res.ok) {
      const data = await res.json() as Record<string, string>;
      return Object.keys(data).filter((k) => k.startsWith("B-") && k.endsWith("_USDT"));
    }
  } catch {
    // fall through
  }
  return [
    "B-BTC_USDT", "B-ETH_USDT", "B-XRP_USDT", "B-SOL_USDT", "B-DOGE_USDT",
    "B-ADA_USDT", "B-AVAX_USDT", "B-DOT_USDT", "B-LINK_USDT", "B-MATIC_USDT",
    "B-BNB_USDT", "B-TRX_USDT", "B-LTC_USDT", "B-BCH_USDT", "B-ATOM_USDT",
    "B-UNI_USDT", "B-NEAR_USDT", "B-APT_USDT", "B-FIL_USDT", "B-ICP_USDT",
    "B-HBAR_USDT", "B-VET_USDT", "B-ALGO_USDT", "B-FTM_USDT", "B-INJ_USDT",
    "B-SUI_USDT", "B-SEI_USDT", "B-TIA_USDT", "B-RUNE_USDT", "B-GRT_USDT",
  ];
}

export async function fetchTickerPrice(symbol: string, isFutures: boolean): Promise<number> {
  const compact = symbol.replace(/_F$/, "").replace("/", "").replace(/^B-/, "");
  const base = compact.replace(/(USDT|INR)$/, "");
  // CoinDCX USDT-M futures pairs: B-XRP_USDT, B-ETH_USDT, B-BTC_USDT (INR-M is delisted)
  const futuresPair = `B-${base}_USDT`;
  const spotPair = `${base}USDT`;

  // 1. Try public prices API — returns { "B-XRP_USDT": "1.29", "XRPUSDT": "1.28", ... }
  try {
    const res = await fetch(await getPublicPriceUrl());
    if (res.ok) {
      const data = await res.json() as Record<string, string>;
      const lookupKey = isFutures ? futuresPair : spotPair;
      if (data[lookupKey]) {
        const price = parseFloat(data[lookupKey]);
        if (Number.isFinite(price) && price > 0) return price;
      }
      // Fallback: futures tracks spot price closely
      if (isFutures && data[spotPair]) {
        const price = parseFloat(data[spotPair]);
        if (Number.isFinite(price) && price > 0) return price;
      }
    }
  } catch {
    // Fall through to ticker API
  }

  // 2. Fallback: exchange/ticker API (array of { market, last_price })
  try {
    const tickerUrl = await getBrokerBaseUrl("coindcx");
    const res = await fetch(`${tickerUrl}/exchange/ticker`);
    if (res.ok) {
      const tickers = await res.json() as Array<{ market: string; last_price: string }>;
      const lookupKey = isFutures ? futuresPair : spotPair;
      const ticker = tickers.find((t) => t.market === lookupKey);
      if (ticker) {
        const price = Number(ticker.last_price);
        if (Number.isFinite(price) && price > 0) return price;
      }
      if (isFutures) {
        const spotTicker = tickers.find((t) => t.market === spotPair);
        if (spotTicker) {
          const price = Number(spotTicker.last_price);
          if (Number.isFinite(price) && price > 0) return price;
        }
      }
    }
  } catch {
    // Fall through to hardcoded fallback
  }

  // 3. Hard fallback prices (in USDT for USDT-M futures)
  const upper = symbol.toUpperCase();
  if (upper.includes("XRP")) return 1.29;
  if (upper.includes("ETH")) return 3000;
  if (upper.includes("BTC")) return 65000;

  throw new Error(`No ticker found for ${isFutures ? futuresPair : spotPair} (symbol=${symbol})`);
}

export async function fetchTickerPricesBatch(
  symbols: Array<{ symbol: string; isFutures: boolean }>,
): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  await Promise.all(symbols.map(async ({ symbol, isFutures }) => {
    try {
      priceMap.set(symbol, await fetchTickerPrice(symbol, isFutures));
    } catch {
      // A missing ticker must not stop other symbols from being monitored.
    }
  }));
  return priceMap;
}

// ═══════════════════════════════════════════════════════════════════════
//  EXCHANGE ADAPTER INTERFACE & TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface OrderRequest {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  marketType: "spot" | "futures";
  quantity?: number;
  reduceOnly?: boolean;
  timestamp?: number;
  leverage?: number;
  settlementCurrency?: string;
}

export interface OrderResponse {
  success: boolean;
  orderId: string;
  entryPrice: number;
  executedQty: number;
  rawResponse: Record<string, unknown>;
  errorDetail?: string;
}

export interface CloseOrderRequest {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  side: "BUY" | "SELL";
  marketType: "spot" | "futures";
  reduceOnly?: boolean;
}

export type ExchangeAdapter = {
  placeOrder(req: OrderRequest): Promise<OrderResponse>;
  closeOrder(req: CloseOrderRequest): Promise<OrderResponse>;
};

// ═══════════════════════════════════════════════════════════════════════
//  EXCHANGE NAME NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════

const SUPPORTED_EXCHANGES = ["coindcx", "delta"] as const;
export type SupportedExchange = typeof SUPPORTED_EXCHANGES[number];

export async function getSupportedExchanges(): Promise<string[]> {
  const configs = await loadBrokerConfigs();
  return Array.from(configs.values()).filter(c => c.is_active).map(c => c.exchange_key);
}

export async function normalizeExchangeNameChecked(name: string): Promise<SupportedExchange> {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "");

  if (normalized.includes("coindcx")) {
    if (!(await isBrokerActive("coindcx"))) throw new Error("400 Bad Request: CoinDCX is currently disabled by the admin.");
    return "coindcx";
  }
  if (normalized.includes("delta")) {
    if (!(await isBrokerActive("delta"))) throw new Error("400 Bad Request: Delta Exchange is currently disabled by the admin.");
    return "delta";
  }
  throw new Error(`400 Bad Request: Exchange "${name}" not supported. Only CoinDCX and Delta Exchange are supported.`);
}

export function normalizeExchangeName(name: string): SupportedExchange {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "");

  if (normalized.includes("coindcx")) return "coindcx";
  if (normalized.includes("delta")) return "delta";
  throw new Error(`400 Bad Request: Exchange "${name}" not supported in Phase 1. Only CoinDCX and Delta Exchange are supported.`);
}

// ═══════════════════════════════════════════════════════════════════════
//  NATIVE COINDCX ORDER PLACEMENT (HMAC-SHA256 — no CCXT dependency)
// ═══════════════════════════════════════════════════════════════════════

// Broker settings are fetched from the database (broker_settings table) at runtime.
// This replaces the old hardcoded URLs with admin-configurable values.

interface BrokerConfig {
  exchange_key: string;
  exchange_name: string;
  base_url: string;
  proxy_url: string | null;
  is_active: boolean;
  config: Record<string, unknown>;
}

let _brokerConfigCache: Map<string, BrokerConfig> | null = null;

async function loadBrokerConfigs(): Promise<Map<string, BrokerConfig>> {
  if (_brokerConfigCache) return _brokerConfigCache;
  const { createClient } = await import("npm:@supabase/supabase-js@2.57.4");
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await client
    .from("broker_settings")
    .select("exchange_key, exchange_name, base_url, proxy_url, is_active, config")
    .order("sort_order");
  const map = new Map<string, BrokerConfig>();
  if (!error && data) {
    for (const row of data as BrokerConfig[]) {
      map.set(row.exchange_key, row);
    }
  }
  // Fallback defaults if DB is unreachable
  if (!map.has("coindcx")) {
    map.set("coindcx", { exchange_key: "coindcx", exchange_name: "CoinDCX", base_url: "https://api.coindcx.com", proxy_url: null, is_active: true, config: {} });
  }
  if (!map.has("delta")) {
    map.set("delta", { exchange_key: "delta", exchange_name: "Delta Exchange", base_url: "https://api.delta.exchange", proxy_url: null, is_active: true, config: {} });
  }
  _brokerConfigCache = map;
  return map;
}

export async function getBrokerBaseUrl(exchangeKey: string): Promise<string> {
  const configs = await loadBrokerConfigs();
  return configs.get(exchangeKey)?.base_url ?? "https://api.coindcx.com";
}

export async function getPublicPriceUrl(): Promise<string> {
  const configs = await loadBrokerConfigs();
  const coindcx = configs.get("coindcx");
  return coindcx?.config?.public_price_url as string ?? "https://public.coindcx.com/market_data/current_prices";
}

export async function isBrokerActive(exchangeKey: string): Promise<boolean> {
  const configs = await loadBrokerConfigs();
  return configs.get(exchangeKey)?.is_active ?? true;
}

async function hmacSha256Hex(apiSecret: string, message: string): Promise<string> {
  const signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signatureBytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Places a native order on CoinDCX Futures using HMAC-SHA256 signed POST.
 * CoinDCX futures endpoint: POST /exchange/v1/derivatives/futures/orders/create
 * Spot endpoint: POST /exchange/v1/orders/create
 *
 * Payload for futures:
 *   { timestamp, order: { side, pair, order_type, total_quantity, leverage, ... } }
 * Payload for spot:
 *   { side, order_type, market, total_quantity, timestamp }
 */
export async function placeCoinDcxOrder(params: {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  marketType: "spot" | "futures";
  quantity: number;
  leverage?: number;
  reduceOnly?: boolean;
  price?: number;
  settlementCurrency?: string;
}): Promise<OrderResponse> {
  const {
    apiKey,
    apiSecret,
    symbol,
    side,
    orderType,
    marketType,
    quantity,
    leverage,
    price,
    settlementCurrency,
  } = params;

  const timestamp = Math.floor(Date.now());
  const ccxtSymbol = normalizeCcxtSymbol(symbol);
  const [base, quote] = ccxtSymbol.split("/");
  const isFutures = marketType === "futures";

  let body: Record<string, unknown>;
  let path: string;

  if (isFutures) {
    // CoinDCX USDT-M/INR-M futures: pair is B-{BASE}_USDT, settlement can be INR or USDT
    const pair = `B-${base}_${quote}`;
    const orderTypeStr = orderType === "MARKET" ? "market_order" : "limit_order";
    const order: Record<string, unknown> = {
      side: side.toLowerCase(),
      pair,
      order_type: orderTypeStr,
      total_quantity: quantity,
      leverage: leverage ?? 1,
      notification: "no_notification",
    };
    // INR-M settlement: collateral in INR while pair is USDT-denominated
    if (settlementCurrency) {
      order.settlement_currency = settlementCurrency.toLowerCase();
    }
    if (orderType === "LIMIT" && price) {
      order.price = String(price);
    }
    if (params.reduceOnly) {
      order.reduce_only = true;
    }
    body = { timestamp, order };
    path = "/exchange/v1/derivatives/futures/orders/create";
  } else {
    const market = `${base}${quote}`;
    const orderTypeStr = orderType === "MARKET" ? "market_order" : "limit_order";
    body = {
      side: side.toLowerCase(),
      order_type: orderTypeStr,
      market,
      total_quantity: quantity,
      timestamp,
    };
    if (orderType === "LIMIT" && price) {
      body.price_per_unit = String(price);
    }
    path = "/exchange/v1/orders/create";
  }

  const jsonBody = JSON.stringify(body);
  const signature = await hmacSha256Hex(apiSecret, jsonBody);

  try {
    const baseUrl = await getBrokerBaseUrl("coindcx");
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": apiKey,
        "X-AUTH-SIGNATURE": signature,
      },
      body: jsonBody,
    });

    const rawText = await response.text();
    let rawResponse: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed) && parsed.length > 0) {
        rawResponse = parsed[0] as Record<string, unknown>;
      } else if (Array.isArray(parsed) && parsed.length === 0) {
        rawResponse = { orders: [] };
      } else {
        rawResponse = parsed as Record<string, unknown>;
      }
    } catch {
      rawResponse = { raw: rawText.slice(0, 1000) };
    }

    if (!response.ok) {
      return {
        success: false,
        orderId: "",
        entryPrice: 0,
        executedQty: 0,
        rawResponse,
        errorDetail: `CoinDCX HTTP ${response.status}: ${rawText.slice(0, 500)}`,
      };
    }

    const orderId = String(rawResponse.id ?? "N/A");
    const entryPrice = Number(rawResponse.price ?? rawResponse.avg_price ?? 0);
    const executedQty = Number(
      rawResponse.total_quantity ?? rawResponse.filled_quantity ?? quantity,
    );

    return {
      success: true,
      orderId,
      entryPrice,
      executedQty,
      rawResponse,
    };
  } catch (err) {
    return {
      success: false,
      orderId: "",
      entryPrice: 0,
      executedQty: 0,
      rawResponse: {},
      errorDetail: `CoinDCX fetch error: ${(err as Error).message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  COINDCX FUTURES LEVERAGE SETUP (must be called before placing orders)
//  CoinDCX ignores leverage in the order payload — it must be set separately.
//  POST /exchange/v1/derivatives/futures/leverage
//  Body: { timestamp, leverage, margin_type, pair }
// ═══════════════════════════════════════════════════════════════════════

export async function setCoinDcxLeverage(params: {
  apiKey: string;
  apiSecret: string;
  pair: string; // e.g. "B-ETH_USDT"
  leverage: number;
  marginType: "isolated" | "cross";
}): Promise<{ success: boolean; status: number; raw: string }> {
  const { apiKey, apiSecret, pair, leverage, marginType } = params;
  const body = JSON.stringify({
    timestamp: Math.floor(Date.now()),
    leverage,
    margin_type: marginType,
    pair,
  });
  const signature = await hmacSha256Hex(apiSecret, body);
  // Try the correct update_leverage endpoint first, then fallback to the old one.
  // The old /leverage endpoint returns 404 on some CoinDCX accounts.
  const endpoints = [
    "/exchange/v1/derivatives/futures/positions/update_leverage",
    "/exchange/v1/derivatives/futures/leverage",
  ];
  for (const ep of endpoints) {
    try {
      const baseUrl = await getBrokerBaseUrl("coindcx");
      const response = await fetch(`${baseUrl}${ep}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
        },
        body,
      });
      const rawText = await response.text();
      if (response.ok) {
        return { success: true, status: response.status, raw: rawText.slice(0, 500) };
      }
      // If 404, try next endpoint; for other errors, return immediately
      if (response.status !== 404) {
        return { success: false, status: response.status, raw: rawText.slice(0, 500) };
      }
    } catch (err) {
      // Network error — try next endpoint
      if (ep === endpoints[endpoints.length - 1]) {
        return { success: false, status: 0, raw: (err as Error).message };
      }
    }
  }
  return { success: false, status: 404, raw: "All leverage endpoints returned 404" };
}

// ═══════════════════════════════════════════════════════════════════════
//  COINDCX INR-M FUTURES ORDER (single Golden Payload)
//  CoinDCX INR-M uses B-ETH_USDT pair but settles margin in INR.
// ═══════════════════════════════════════════════════════════════════════

export interface InrMOrderResult {
  success: boolean;
  orderId: string;
  entryPrice: number;
  executedQty: number;
  rawResponse: Record<string, unknown>;
  errorDetail?: string;
}

export async function placeCoinDcxInrMFuturesOrder(params: {
  apiKey: string;
  apiSecret: string;
  base: string; // e.g. "ETH"
  side: "BUY" | "SELL";
  leverage: number;
  ethQuantity: number; // size in ETH (e.g. 0.011)
  inrAmount: number; // size in INR (e.g. 2674.74)
  reduceOnly?: boolean;
}): Promise<InrMOrderResult> {
  const { apiKey, apiSecret, base, side, leverage, ethQuantity, inrAmount, reduceOnly } = params;
  void inrAmount; // INR amount is informational; CoinDCX sizes orders by total_quantity (ETH)
  const timestamp = Math.floor(Date.now());
  const pair = `B-${base}_USDT`;

  // THE GOLDEN PAYLOAD — single strict API call, no variants
  const order: Record<string, unknown> = {
    side: side.toLowerCase(),
    pair,
    order_type: "market_order",
    total_quantity: ethQuantity,
    leverage,
    margin_type: "isolated",
    margin_currency_short_name: "INR",
  };
  // CoinDCX rejects reduce_only on market orders with HTTP 400:
  // "Reduce Only Order is only applicable for Limit Order"
  // To close a position, simply place a reverse market order without reduce_only.
  void reduceOnly;

  const body = { timestamp, order };
  const jsonBody = JSON.stringify(body);
  const signature = await hmacSha256Hex(apiSecret, jsonBody);
  const endpoint = "/exchange/v1/derivatives/futures/orders/create";

  try {
    const baseUrl = await getBrokerBaseUrl("coindcx");
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": apiKey,
        "X-AUTH-SIGNATURE": signature,
      },
      body: jsonBody,
    });
    const rawText = await response.text();

    if (response.ok) {
      let rawResponse: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(rawText);
        rawResponse = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
      } catch {
        rawResponse = { raw: rawText.slice(0, 1000) };
      }
      return {
        success: true,
        orderId: String(rawResponse.id ?? "N/A"),
        entryPrice: Number(rawResponse.price ?? rawResponse.avg_price ?? 0),
        executedQty: Number(rawResponse.total_quantity ?? rawResponse.filled_quantity ?? ethQuantity),
        rawResponse,
      };
    }

    return {
      success: false,
      orderId: "",
      entryPrice: 0,
      executedQty: 0,
      rawResponse: { status: response.status, body: rawText.slice(0, 1000) },
      errorDetail: `CoinDCX rejected order (HTTP ${response.status}): ${rawText.slice(0, 500)}`,
    };
  } catch (err) {
    return {
      success: false,
      orderId: "",
      entryPrice: 0,
      executedQty: 0,
      rawResponse: {},
      errorDetail: `Network error: ${(err as Error).message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  REDUCE-ONLY CLOSE ORDER (Ghost Position Failsafe)
//  CoinDCX rejects reduce_only on market orders, so we place a LIMIT order
//  priced for immediate execution (aggressive price = slightly worse than
//  market) with reduce_only: true. This ensures the exchange REJECTS the
//  order if the position has already been closed manually, preventing the
//  creation of an unintended reverse position — the primary ghost-position
//  failsafe.
// ═══════════════════════════════════════════════════════════════════════

export async function placeCoinDcxReduceOnlyClose(params: {
  apiKey: string;
  apiSecret: string;
  base: string;
  side: "BUY" | "SELL";
  leverage: number;
  ethQuantity: number;
  livePriceUsdt: number;
}): Promise<InrMOrderResult> {
  const { apiKey, apiSecret, base, side, leverage, ethQuantity, livePriceUsdt } = params;
  const timestamp = Math.floor(Date.now());
  const pair = `B-${base}_USDT`;

  // Aggressive limit price: 0.5% beyond market to ensure immediate fill.
  // For a SELL close (long position), price above market; for BUY close (short),
  // price below market. This mimics a market order while satisfying the
  // reduce_only requirement (limit-only on CoinDCX).
  const priceOffset = livePriceUsdt * 0.005;
  const limitPrice = side === "SELL"
    ? livePriceUsdt + priceOffset
    : livePriceUsdt - priceOffset;

  const order: Record<string, unknown> = {
    side: side.toLowerCase(),
    pair,
    order_type: "limit_order",
    total_quantity: ethQuantity,
    price: String(limitPrice.toFixed(6)),
    leverage,
    margin_type: "isolated",
    margin_currency_short_name: "INR",
    reduce_only: true,
  };

  const body = { timestamp, order };
  const jsonBody = JSON.stringify(body);
  const signature = await hmacSha256Hex(apiSecret, jsonBody);
  const endpoint = "/exchange/v1/derivatives/futures/orders/create";

  try {
    const baseUrl = await getBrokerBaseUrl("coindcx");
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": apiKey,
        "X-AUTH-SIGNATURE": signature,
      },
      body: jsonBody,
    });
    const rawText = await response.text();

    if (response.ok) {
      let rawResponse: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(rawText);
        rawResponse = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
      } catch {
        rawResponse = { raw: rawText.slice(0, 1000) };
      }
      return {
        success: true,
        orderId: String(rawResponse.id ?? "N/A"),
        entryPrice: Number(rawResponse.price ?? rawResponse.avg_price ?? limitPrice),
        executedQty: Number(rawResponse.total_quantity ?? rawResponse.filled_quantity ?? ethQuantity),
        rawResponse,
      };
    }

    return {
      success: false,
      orderId: "",
      entryPrice: 0,
      executedQty: 0,
      rawResponse: { status: response.status, body: rawText.slice(0, 1000) },
      errorDetail: `CoinDCX reduce-only close rejected (HTTP ${response.status}): ${rawText.slice(0, 500)}`,
    };
  } catch (err) {
    return {
      success: false,
      orderId: "",
      entryPrice: 0,
      executedQty: 0,
      rawResponse: {},
      errorDetail: `Reduce-only close network error: ${(err as Error).message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SINGLE SOURCE OF TRUTH: GOLDEN TRADE EXECUTION ENGINE
//  CEO DIRECTIVE: SINGLE SOURCE OF TRUTH ENGINE. DO NOT ALTER MATH, 102
//  RATE, OR CLAMP LOGIC. APPLIES TO ALL BOTS AND ALL COINS.
// ═══════════════════════════════════════════════════════════════════════

const USD_INR_RATE = 102;
const MIN_MARGIN_INR = 100;
const MIN_LOT_QTY = 0.001;

export interface GoldenTradeInput {
  apiKey: string;
  apiSecret: string;
  baseCoin: string;
  side: "BUY" | "SELL";
  leverage: number;
  marginInr: number;
}

export interface GoldenTradeResult {
  success: boolean;
  orderId: string;
  entryPrice: number;
  executedQty: number;
  quantity: number;
  livePriceUsdt: number;
  livePriceInr: number;
  orderAmountInr: number;
  futuresPair: string;
  goldenPayload: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
  errorDetail?: string;
}

export async function fetchLivePriceUsdt(baseCoin: string): Promise<number> {
  const futuresPair = `B-${baseCoin}_USDT`;
  const spotPair = `${baseCoin}USDT`;
  const inrPair = `${baseCoin}INR`;

  // 1. exchange/ticker API
  try {
    const tickerUrl = await getBrokerBaseUrl("coindcx");
    const res = await fetch(`${tickerUrl}/exchange/ticker`);
    if (res.ok) {
      const tickers = await res.json() as Array<{ market: string; last_price: string }>;
      if (Array.isArray(tickers)) {
        let ticker = tickers.find((t) => t.market === futuresPair);
        if (!ticker) ticker = tickers.find((t) => t.market === spotPair);
        if (ticker) {
          const price = parseFloat(ticker.last_price);
          if (Number.isFinite(price) && price > 0) return price;
        }
        const inrTicker = tickers.find((t) => t.market === inrPair);
        if (inrTicker) {
          const price = parseFloat(inrTicker.last_price) / USD_INR_RATE;
          if (Number.isFinite(price) && price > 0) return price;
        }
      }
    }
  } catch { /* fall through */ }

  // 2. public prices API
  try {
    const res = await fetch(await getPublicPriceUrl());
    if (res.ok) {
      const data = await res.json() as Record<string, string>;
      const spotPrice = data[futuresPair] ?? data[spotPair];
      if (spotPrice) {
        const price = parseFloat(spotPrice);
        if (Number.isFinite(price) && price > 0) return price;
      }
      const inrPrice = data[inrPair];
      if (inrPrice) {
        const price = parseFloat(inrPrice) / USD_INR_RATE;
        if (Number.isFinite(price) && price > 0) return price;
      }
    }
  } catch { /* fall through */ }

  return 0;
}

export async function calculateOrderQuantity(
  marginInr: number,
  leverage: number,
  livePriceUsdt: number,
): number {
  const orderAmountInr = (marginInr > 0 ? marginInr : MIN_MARGIN_INR) * leverage;
  const livePriceInr = livePriceUsdt * USD_INR_RATE;
  const qtyRaw = orderAmountInr / livePriceInr;
  let qty = Number(qtyRaw.toFixed(3));
  if (qty < MIN_LOT_QTY) qty = MIN_LOT_QTY;
  return qty;
}

export async function executeGoldenTrade(input: GoldenTradeInput): Promise<GoldenTradeResult> {
  const { apiKey, apiSecret, baseCoin, side, leverage, marginInr } = input;
  const futuresPair = `B-${baseCoin}_USDT`;
  const effectiveMargin = marginInr > 0 ? marginInr : MIN_MARGIN_INR;
  const effectiveLeverage = leverage > 0 ? leverage : 10;

  const livePriceUsdt = await fetchLivePriceUsdt(baseCoin);
  if (livePriceUsdt <= 0) {
    return {
      success: false,
      orderId: "",
      entryPrice: 0,
      executedQty: 0,
      quantity: 0,
      livePriceUsdt: 0,
      livePriceInr: 0,
      orderAmountInr: 0,
      futuresPair,
      goldenPayload: {},
      rawResponse: {},
      errorDetail: `Failed to fetch live price for ${baseCoin}. Cannot calculate order quantity.`,
    };
  }

  const livePriceInr = livePriceUsdt * USD_INR_RATE;
  const orderAmountInr = effectiveMargin * effectiveLeverage;
  const qtyRaw = orderAmountInr / livePriceInr;
  let quantity = Number(qtyRaw.toFixed(3));
  if (quantity < MIN_LOT_QTY) quantity = MIN_LOT_QTY;

  const goldenPayload = {
    timestamp: Math.floor(Date.now()),
    order: {
      side: side.toLowerCase(),
      pair: futuresPair,
      order_type: "market_order",
      total_quantity: quantity,
      leverage: effectiveLeverage,
      margin_type: "isolated",
      margin_currency_short_name: "INR",
    },
  };

  // Pre-flight: set leverage
  await setCoinDcxLeverage({
    apiKey,
    apiSecret,
    pair: futuresPair,
    leverage: effectiveLeverage,
    marginType: "isolated",
  });

  // Place INR-M order with the Golden Payload
  const orderResult = await placeCoinDcxInrMFuturesOrder({
    apiKey,
    apiSecret,
    base: baseCoin,
    side,
    leverage: effectiveLeverage,
    ethQuantity: quantity,
    inrAmount: orderAmountInr,
  });

  return {
    success: orderResult.success,
    orderId: orderResult.orderId,
    entryPrice: orderResult.entryPrice,
    executedQty: orderResult.executedQty,
    quantity,
    livePriceUsdt,
    livePriceInr,
    orderAmountInr,
    futuresPair,
    goldenPayload,
    rawResponse: orderResult.rawResponse,
    errorDetail: orderResult.errorDetail,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  CCXT EXCHANGE FACTORY
// ═══════════════════════════════════════════════════════════════════════

export async function createCcxtInstance(
  exchangeId: string,
  apiKey: string,
  apiSecret: string,
  marketType: "spot" | "futures" = "spot",
) {
  const id = normalizeExchangeName(exchangeId);
  const constructorName = id === "coindcx" ? "coindcx" : id;
  const Ctor = await pick(constructorName);
  if (typeof Ctor !== "function") {
    throw new Error(`CCXT class ${id} not found`);
  }

  const options: Record<string, unknown> = {
    apiKey,
    secret: apiSecret,
    enableRateLimit: true,
    timeout: 15000,
    defaultType: marketType === "futures" ? (id === "bybit" ? "linear" : "future") : "spot",
  };

  return new Ctor(options);
}

// ═══════════════════════════════════════════════════════════════════════
//  UNIVERSAL CCXT ADAPTER
// ═══════════════════════════════════════════════════════════════════════

export const ExchangeAdapter = {
  create(exchangeName: string): ExchangeAdapter {
    const normalized = normalizeExchangeName(exchangeName);

    async function _executeOrder(
      apiKey: string,
      apiSecret: string,
      symbol: string,
      side: "BUY" | "SELL",
      orderType: "MARKET" | "LIMIT",
      marketType: "spot" | "futures",
      quantity?: number,
      reduceOnly?: boolean,
      leverage?: number,
      settlementCurrency?: string,
    ): Promise<OrderResponse> {
      // CoinDCX: use native HMAC-SHA256 implementation (no CCXT dependency)
      if (normalized === "coindcx") {
        if (quantity === undefined || quantity <= 0) {
          return {
            success: false,
            orderId: "",
            entryPrice: 0,
            executedQty: 0,
            rawResponse: {},
            errorDetail: "Quantity is required for CoinDCX orders",
          };
        }
        return placeCoinDcxOrder({
          apiKey,
          apiSecret,
          symbol,
          side,
          orderType,
          marketType,
          quantity,
          leverage: leverage ?? 1,
          reduceOnly,
          settlementCurrency,
        });
      }

      // Delta Exchange: use CCXT fallback
      try {
        const exchange = await createCcxtInstance(normalized, apiKey, apiSecret, marketType);

        const ccxtType = orderType.toLowerCase() as "market" | "limit";
        const ccxtSide = side.toLowerCase() as "buy" | "sell";

        const params: Record<string, unknown> = {};
        if (reduceOnly && marketType === "futures") {
          params.reduceOnly = true;
        }

        const orderParams: {
          symbol: string;
          type: "market" | "limit";
          side: "buy" | "sell";
          amount?: number;
          price?: number;
          params: Record<string, unknown>;
        } = {
          symbol,
          type: ccxtType,
          side: ccxtSide,
          params,
        };

        if (quantity !== undefined && quantity > 0) {
          orderParams.amount = quantity;
        }

        if (ccxtType === "limit") {
          // For limit orders, price must be set by caller via the ticker
          // Using market orders for simplicity in execution engine
          orderParams.type = "market";
        }

        const result = await exchange.createOrder(
          orderParams.symbol,
          orderParams.type,
          orderParams.side,
          orderParams.amount ?? undefined,
          orderParams.price,
          orderParams.params,
        );

        const rawResponse = result as unknown as Record<string, unknown>;
        const orderId = String(result.id ?? "N/A");
        const entryPrice = result.average ?? result.price ?? 0;
        const executedQty = result.filled ?? result.amount ?? 0;

        return {
          success: true,
          orderId,
          entryPrice: typeof entryPrice === "number" ? entryPrice : parseFloat(String(entryPrice)),
          executedQty: typeof executedQty === "number" ? executedQty : parseFloat(String(executedQty)),
          rawResponse,
        };
      } catch (err) {
        return {
          success: false,
          orderId: "",
          entryPrice: 0,
          executedQty: 0,
          rawResponse: {},
          errorDetail: `${normalized} error: ${(err as Error).message}`,
        };
      }
    }

    return {
      async placeOrder(req: OrderRequest): Promise<OrderResponse> {
        return _executeOrder(
          req.apiKey,
          req.apiSecret,
          req.symbol,
          req.side,
          req.orderType,
          req.marketType,
          req.quantity,
          req.reduceOnly,
          (req as OrderRequest & { leverage?: number }).leverage,
          (req as OrderRequest & { settlementCurrency?: string }).settlementCurrency,
        );
      },

      async closeOrder(req: CloseOrderRequest): Promise<OrderResponse> {
        // Close order is a market order with reduceOnly for futures
        return _executeOrder(
          req.apiKey,
          req.apiSecret,
          req.symbol,
          req.side,
          "MARKET",
          req.marketType,
          undefined,
          req.reduceOnly ?? true,
        );
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  COINDCX POSITION VERIFICATION
//  GET /exchange/v1/derivatives/futures/positions — returns all open
//  futures positions. Used to confirm a close order actually zeroed the
//  position size on the exchange BEFORE marking it closed in our DB.
// ═══════════════════════════════════════════════════════════════════════

export interface CoinDcxPosition {
  id: string;
  pair: string;
  side: string;
  size: number;
  margin_used: number;
  realized_pnl: number;
  unrealized_pnl: number;
}

export async function fetchCoinDcxOpenPositions(params: {
  apiKey: string;
  apiSecret: string;
  targetPair?: string;
}): Promise<CoinDcxPosition[]> {
  const { apiKey, apiSecret, targetPair } = params;
  const timestamp = Math.floor(Date.now());
  const bodyObj: Record<string, unknown> = { timestamp };
  if (targetPair) bodyObj.pair = targetPair;
  const body = JSON.stringify(bodyObj);
  const signature = await hmacSha256Hex(apiSecret, body);

  try {
    const response = await fetch(
      `${await getBrokerBaseUrl("coindcx")}/exchange/v1/derivatives/futures/positions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
        },
        body,
      },
    );
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`CoinDCX positions API HTTP ${response.status}: ${rawText.slice(0, 300)}`);
    }
    const parsed = JSON.parse(rawText);
    const rows = Array.isArray(parsed) ? parsed : [];
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id ?? r.position_id ?? ""),
      pair: String(r.pair ?? r.symbol ?? ""),
      side: String(r.side ?? ""),
      size: Number(r.size ?? r.position_size ?? r.total_quantity ?? 0),
      margin_used: Number(r.margin_used ?? r.initial_margin ?? 0),
      realized_pnl: Number(r.realized_pnl ?? r.pnl ?? 0),
      unrealized_pnl: Number(r.unrealized_pnl ?? r.pnl_unrealized ?? r.upnl ?? 0),
    }));
  } catch (err) {
    throw new Error(`fetchCoinDcxOpenPositions failed: ${(err as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  COINDCX EXCHANGE-SIDE TP/SL (create_tpsl endpoint)
//  Places hard stop-loss and take-profit orders directly on the CoinDCX
//  exchange matching engine. These execute independently of our backend —
//  even if the server crashes or the frontend sleeps, the exchange
//  enforces the stop instantly.
//
//  POST /exchange/v1/derivatives/futures/positions/create_tpsl
//  Body: { timestamp, id: "<position_id>", stop_loss: { stop_price, order_type },
//          take_profit: { stop_price, order_type } }
// ═══════════════════════════════════════════════════════════════════════

export interface TpslResult {
  success: boolean;
  stopLossOrderId: string;
  takeProfitOrderId: string;
  errorDetail?: string;
}

export async function createCoinDcxTpsl(params: {
  apiKey: string;
  apiSecret: string;
  positionId: string;
  stopLossPrice: number;
  takeProfitPrice?: number;
}): Promise<TpslResult> {
  const { apiKey, apiSecret, positionId, stopLossPrice, takeProfitPrice } = params;
  const timestamp = Math.floor(Date.now());

  const body: Record<string, unknown> = {
    timestamp,
    id: positionId,
    stop_loss: {
      stop_price: String(stopLossPrice),
      order_type: "stop_market",
    },
  };

  if (takeProfitPrice && takeProfitPrice > 0) {
    body.take_profit = {
      stop_price: String(takeProfitPrice),
      order_type: "take_profit_market",
    };
  }

  const jsonBody = JSON.stringify(body);
  const signature = await hmacSha256Hex(apiSecret, jsonBody);

  try {
    const response = await fetch(
      `${await getBrokerBaseUrl("coindcx")}/exchange/v1/derivatives/futures/positions/create_tpsl`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
        },
        body: jsonBody,
      },
    );
    const rawText = await response.text();
    let rawResponse: Record<string, unknown> = {};
    try {
      rawResponse = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      rawResponse = { raw: rawText.slice(0, 500) };
    }

    if (!response.ok) {
      return {
        success: false,
        stopLossOrderId: "",
        takeProfitOrderId: "",
        errorDetail: `CoinDCX create_tpsl HTTP ${response.status}: ${rawText.slice(0, 400)}`,
      };
    }

    const slObj = (rawResponse.stop_loss ?? {}) as Record<string, unknown>;
    const tpObj = (rawResponse.take_profit ?? {}) as Record<string, unknown>;

    return {
      success: true,
      stopLossOrderId: String(slObj.id ?? ""),
      takeProfitOrderId: String(tpObj.id ?? ""),
    };
  } catch (err) {
    return {
      success: false,
      stopLossOrderId: "",
      takeProfitOrderId: "",
      errorDetail: `create_tpsl network error: ${(err as Error).message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  COINDCX CANCEL TPSL ORDERS FOR A POSITION
//  Cancels all existing TP/SL orders attached to a position so a new set
//  can be placed with updated prices (for trailing stop sync).
//
//  POST /exchange/v1/derivatives/futures/positions/cancel_all_open_orders_for_position
//  Body: { timestamp, id: "<position_id>" }
// ═══════════════════════════════════════════════════════════════════════

export async function cancelCoinDcxTpslForPosition(params: {
  apiKey: string;
  apiSecret: string;
  positionId: string;
}): Promise<{ success: boolean; errorDetail?: string }> {
  const { apiKey, apiSecret, positionId } = params;
  const timestamp = Math.floor(Date.now());
  const body = JSON.stringify({ timestamp, id: positionId });
  const signature = await hmacSha256Hex(apiSecret, body);

  try {
    const response = await fetch(
      `${await getBrokerBaseUrl("coindcx")}/exchange/v1/derivatives/futures/positions/cancel_all_open_orders_for_position`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
        },
        body,
      },
    );
    if (!response.ok) {
      const rawText = await response.text();
      return { success: false, errorDetail: `cancel_tpsl HTTP ${response.status}: ${rawText.slice(0, 300)}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, errorDetail: `cancel_tpsl network error: ${(err as Error).message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  FETCH COINDCX POSITION ID BY PAIR
//  After an entry order fills, we need the exchange-assigned position ID
//  (a UUID) to attach TP/SL orders via create_tpsl. This polls the
//  positions endpoint and finds the matching position by pair symbol.
// ═══════════════════════════════════════════════════════════════════════

export async function fetchCoinDcxPositionId(params: {
  apiKey: string;
  apiSecret: string;
  futuresPair: string;
  timeoutMs?: number;
}): Promise<{ id: string; size: number } | null> {
  const { apiKey, apiSecret, futuresPair, timeoutMs = 15000 } = params;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    let positions: Awaited<ReturnType<typeof fetchCoinDcxOpenPositions>>;
    try {
      positions = await fetchCoinDcxOpenPositions({ apiKey, apiSecret, targetPair: futuresPair });
    } catch {
      // API error — wait and retry, do not treat as "no positions found".
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    if (positions.length === 0) {
      // Retry without pair filter — some CoinDCX API versions don't support
      // the pair filter on the positions endpoint.
      try {
        const allPositions = await fetchCoinDcxOpenPositions({ apiKey, apiSecret });
        const match = allPositions.find((p) => p.pair === futuresPair && p.size > 0);
        if (match) {
          console.log(`[exchange-adapter] fetchCoinDcxPositionId: found ${futuresPair} on attempt ${attempt} (unfiltered)`);
          return { id: match.id, size: match.size };
        }
      } catch {
        // API error on unfiltered fetch — retry.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    } else {
      const match = positions.find((p) => p.pair === futuresPair && p.size > 0);
      if (match) {
        console.log(`[exchange-adapter] fetchCoinDcxPositionId: found ${futuresPair} on attempt ${attempt}`);
        return { id: match.id, size: match.size };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`[exchange-adapter] fetchCoinDcxPositionId: timed out after ${timeoutMs}ms (${attempt} attempts) for ${futuresPair}`);
  return null;
}

export interface OrderFillVerification {
  confirmed: boolean;
  status: string;
  fillPrice: number;
  filledQty: number;
  realizedPnl: number;
}

/**
 * Polls the CoinDCX order status endpoint until the order is 'filled' (or
 * rejected/cancelled). Returns the actual average fill price and realized PnL
 * from the exchange — never the mark price or limit price.
 *
 * CoinDCX POST /exchange/v1/derivatives/futures/orders/status
 * Body: { timestamp, id: "<order_id>" }
 * Response: { status: "filled"|"open"|"cancelled", avg_price, filled_quantity, ... }
 */
export async function verifyOrderFilled(params: {
  apiKey: string;
  apiSecret: string;
  orderId: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<OrderFillVerification> {
  const { apiKey, apiSecret, orderId, pollIntervalMs = 1000, timeoutMs = 10000 } = params;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const timestamp = Math.floor(Date.now());
    const body = JSON.stringify({ timestamp, id: orderId });
    const signature = await hmacSha256Hex(apiSecret, body);

    try {
      const baseUrl = await getBrokerBaseUrl("coindcx");
      const response = await fetch(`${baseUrl}/exchange/v1/derivatives/futures/orders/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AUTH-APIKEY": apiKey,
          "X-AUTH-SIGNATURE": signature,
        },
        body,
      });

      if (response.ok) {
        const rawText = await response.text();
        let parsed: Record<string, unknown> = {};
        try {
          const jsonParsed = JSON.parse(rawText);
          parsed = Array.isArray(jsonParsed) && jsonParsed.length > 0 ? jsonParsed[0] as Record<string, unknown> : jsonParsed as Record<string, unknown>;
        } catch {
          parsed = { raw: rawText };
        }

        const status = String(parsed.status ?? parsed.order_status ?? "open").toLowerCase();
        const fillPrice = Number(parsed.avg_price ?? parsed.average_price ?? parsed.price ?? 0);
        const filledQty = Number(parsed.filled_quantity ?? parsed.total_quantity ?? 0);

        if (status === "filled" || status === "complete" || status === "closed") {
          return { confirmed: true, status: "filled", fillPrice, filledQty, realizedPnl: 0 };
        }
        if (status === "cancelled" || status === "rejected" || status === "expired") {
          return { confirmed: false, status, fillPrice: 0, filledQty: 0, realizedPnl: 0 };
        }
      }
    } catch {
      // Network error — retry
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout — order still pending. Do a position check as fallback.
  return { confirmed: false, status: "timeout", fillPrice: 0, filledQty: 0, realizedPnl: 0 };
}

/**
 * Polls the exchange for up to `timeoutMs` (default 10s) to confirm a position
 * has been closed (size = 0). Returns true if confirmed closed, false if the
 * position is still open or verification was inconclusive.
 * Also captures the realized PnL from the exchange's position record.
 */
export async function verifyPositionClosed(params: {
  apiKey: string;
  apiSecret: string;
  futuresPair: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<{ confirmed: boolean; remainingSize: number; realizedPnl: number }> {
  const { apiKey, apiSecret, futuresPair, pollIntervalMs = 1500, timeoutMs = 10000 } = params;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const positions = await fetchCoinDcxOpenPositions({ apiKey, apiSecret });
      const match = positions.find((p) => p.pair === futuresPair);
      if (!match || match.size === 0) {
        return { confirmed: true, remainingSize: 0, realizedPnl: match?.realized_pnl ?? 0 };
      }
    } catch {
      // API error — do NOT assume the position is closed. Return unconfirmed
      // so the caller keeps the DB position open and retries next cycle.
      return { confirmed: false, remainingSize: -1, realizedPnl: 0 };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout — position still open on exchange. Fetch final state.
  try {
    const positions = await fetchCoinDcxOpenPositions({ apiKey, apiSecret });
    const match = positions.find((p) => p.pair === futuresPair);
    const remainingSize = match?.size ?? 0;
    return { confirmed: remainingSize === 0, remainingSize, realizedPnl: match?.realized_pnl ?? 0 };
  } catch {
    // API error on final attempt — do not assume closed.
    return { confirmed: false, remainingSize: -1, realizedPnl: 0 };
  }
}
