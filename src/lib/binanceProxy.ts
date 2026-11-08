const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/binance-proxy`;

export async function proxyTicker24hr(symbol: string): Promise<{
  lastPrice: string; priceChangePercent: string; volume: string;
  quoteVolume: string; highPrice: string; lowPrice: string;
}> {
  const qs = new URLSearchParams({ action: 'ticker24hr', symbol }).toString();
  const res = await fetch(`${PROXY_URL}?${qs}`);
  if (!res.ok) throw new Error(`Proxy ticker24hr ${res.status}`);
  return res.json();
}

export async function proxyTickers24hr(symbols: string[]): Promise<Array<{
  symbol: string; lastPrice: string; priceChangePercent: string;
  volume: string; quoteVolume: string; highPrice: string; lowPrice: string;
}>> {
  const qs = new URLSearchParams({
    action: 'tickers24hr',
    symbols: JSON.stringify(symbols),
  }).toString();
  const res = await fetch(`${PROXY_URL}?${qs}`);
  if (!res.ok) throw new Error(`Proxy tickers24hr ${res.status}`);
  return res.json();
}

export async function proxyKlines(symbol: string, interval: string = '15m', limit: number = 200): Promise<unknown[][]> {
  const qs = new URLSearchParams({
    action: 'klines',
    symbol,
    interval,
    limit: String(limit),
  }).toString();
  const res = await fetch(`${PROXY_URL}?${qs}`);
  if (!res.ok) throw new Error(`Proxy klines ${res.status}`);
  return res.json();
}

export async function proxyDepth(symbol: string, limit: number = 20): Promise<{
  bids: string[][]; asks: string[][];
}> {
  const qs = new URLSearchParams({
    action: 'depth',
    symbol,
    limit: String(limit),
  }).toString();
  const res = await fetch(`${PROXY_URL}?${qs}`);
  if (!res.ok) throw new Error(`Proxy depth ${res.status}`);
  return res.json();
}
