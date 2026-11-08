/* Read-only wallet adapter. This module never places orders or transfers funds. */

export interface WalletRow {
  currency: string;
  balance: number;
  locked_balance: number;
  margin: number;
  total: number;
}

export interface WalletSnapshot {
  totalInr: number;
  source: "futures" | "spot";
  wallets: WalletRow[];
}

const COINDCX_BASE_URL = "https://api.coindcx.com";
const FALLBACK_USDT_INR_RATE = 102;

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function hmacSha256Hex(
  apiSecret: string,
  message: string,
): Promise<string> {
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

async function signedPost(
  path: string,
  apiKey: string,
  apiSecret: string,
): Promise<{ response: Response; body: string }> {
  const body = JSON.stringify({ timestamp: Date.now() });
  const signature = await hmacSha256Hex(apiSecret, body);
  const response = await fetch(`${COINDCX_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": apiKey,
      "X-AUTH-SIGNATURE": signature,
    },
    body,
  });
  return { response, body: await response.text() };
}

async function signedGet(
  path: string,
  apiKey: string,
  apiSecret: string,
): Promise<{ response: Response; body: string }> {
  const timestamp = Date.now();
  const url = `${COINDCX_BASE_URL}${path}?timestamp=${timestamp}`;
  const signature = await hmacSha256Hex(apiSecret, "");
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-AUTH-APIKEY": apiKey,
      "X-AUTH-SIGNATURE": signature,
    },
  });
  return { response, body: await response.text() };
}

function isNotFound(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    return parsed?.status === "error" && (parsed?.code === 404 || parsed?.message === "not_found");
  } catch {
    return false;
  }
}

function parseWalletRows(payload: unknown): WalletRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((wallet) => {
    const record = wallet as {
      currency_short_name?: unknown;
      currency?: unknown;
      balance?: unknown;
      locked_balance?: unknown;
      cross_order_margin?: unknown;
      cross_user_margin?: unknown;
    };
    const balance = toNumber(record.balance);
    const lockedBalance = toNumber(record.locked_balance);
    const margin = toNumber(record.cross_order_margin) + toNumber(record.cross_user_margin);
    return {
      currency: String(record.currency_short_name ?? record.currency ?? "UNKNOWN").toUpperCase(),
      balance,
      locked_balance: lockedBalance,
      margin,
      total: balance + lockedBalance + margin,
    };
  });
}

async function fetchUsdtInrRate(apiKey: string, apiSecret: string): Promise<number> {
  try {
    const path = "/exchange/v1/derivatives/futures/data/conversions";
    const result = await signedPost(path, apiKey, apiSecret);
    if (!result.response.ok) return FALLBACK_USDT_INR_RATE;
    const data = JSON.parse(result.body);
    const rate = toNumber(data?.USDTINR ?? data?.usdt_inr ?? data?.rate);
    return rate > 0 ? rate : FALLBACK_USDT_INR_RATE;
  } catch {
    return FALLBACK_USDT_INR_RATE;
  }
}

export async function fetchCoinDcxAllBalances(
  apiKey: string,
  apiSecret: string,
): Promise<{
  futuresWallets: WalletRow[];
  spotWallets: WalletRow[];
  futuresRaw: string;
  spotRaw: string;
  futuresStatus: number;
  spotStatus: number;
}> {
  // Fetch futures wallets
  const futuresPath = "/exchange/v1/derivatives/futures/wallets";
  const futPost = await signedPost(futuresPath, apiKey, apiSecret);
  let futuresRaw = futPost.body;
  let futuresStatus = futPost.response.status;
  if (futPost.response.status === 404 || isNotFound(futPost.body)) {
    const futGet = await signedGet(futuresPath, apiKey, apiSecret);
    futuresRaw = futGet.body;
    futuresStatus = futGet.response.status;
  }

  // Fetch spot/exchange wallets
  const spotPath = "/exchange/v1/wallets";
  const spotPost = await signedPost(spotPath, apiKey, apiSecret);
  let spotRaw = spotPost.body;
  let spotStatus = spotPost.response.status;
  if (spotPost.response.status === 404 || isNotFound(spotPost.body)) {
    const spotGet = await signedGet(spotPath, apiKey, apiSecret);
    spotRaw = spotGet.body;
    spotStatus = spotGet.response.status;
  }

  let futuresWallets: WalletRow[] = [];
  let spotWallets: WalletRow[] = [];
  try {
    const futParsed = JSON.parse(futuresRaw);
    futuresWallets = Array.isArray(futParsed) ? parseWalletRows(futParsed) : [];
  } catch { /* non-JSON */ }
  try {
    const spotParsed = JSON.parse(spotRaw);
    spotWallets = Array.isArray(spotParsed) ? parseWalletRows(spotParsed) : [];
  } catch { /* non-JSON */ }

  return { futuresWallets, spotWallets, futuresRaw, spotRaw, futuresStatus, spotStatus };
}

export async function fetchCoinDcxWallet(
  apiKey: string,
  apiSecret: string,
): Promise<WalletSnapshot> {
  const futuresPath = "/exchange/v1/derivatives/futures/wallets";
  const spotPath = "/exchange/v1/wallets";

  const postResult = await signedPost(futuresPath, apiKey, apiSecret);

  let response = postResult.response;
  let body = postResult.body;
  let source: "futures" | "spot" = "futures";

  if (response.status === 404 || isNotFound(body)) {
    const getResult = await signedGet(futuresPath, apiKey, apiSecret);
    response = getResult.response;
    body = getResult.body;
  }

  if (!response.ok) {
    const spotPost = await signedPost(spotPath, apiKey, apiSecret);
    response = spotPost.response;
    body = spotPost.body;
    source = "spot";

    if (response.status === 404 || isNotFound(body)) {
      const spotGet = await signedGet(spotPath, apiKey, apiSecret);
      response = spotGet.response;
      body = spotGet.body;
    }
  }

  if (!response.ok) {
    throw new Error(`CoinDCX wallet sync failed (HTTP ${response.status}): ${body.slice(0, 300)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`CoinDCX returned non-JSON response: ${body.slice(0, 300)}`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`CoinDCX returned unexpected shape: ${body.slice(0, 300)}`);
  }

  const wallets = parseWalletRows(data);

  // INR wallet: sum balance + locked + margin — NO currency conversion.
  const inrWallet = wallets.find((w) => w.currency === "INR");
  let totalInr = inrWallet ? inrWallet.total : 0;

  // USDT wallet: convert to INR using the live conversion rate.
  const usdtWallet = wallets.find((w) => w.currency === "USDT");
  if (usdtWallet && usdtWallet.total > 0) {
    const usdtInrRate = await fetchUsdtInrRate(apiKey, apiSecret);
    totalInr += usdtWallet.total * usdtInrRate;
  }

  if (totalInr <= 0) {
    throw new Error(`No INR or USDT wallet found in CoinDCX ${source} response: ${body.slice(0, 300)}`);
  }

  return { totalInr, source, wallets };
}
