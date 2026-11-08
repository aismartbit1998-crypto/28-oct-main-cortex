import { useEffect, useSyncExternalStore } from 'react';
import type { Candle } from '@/lib/indicators';
import { proxyTicker24hr, proxyKlines, proxyDepth } from '@/lib/binanceProxy';

export interface LiveCoin {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  change15m: number;
  volume24h: number;
  quoteVolume24h: number;
  high24h: number;
  low24h: number;
  sparkline: number[];
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export interface OrderBookPressure {
  buyPct: number;
  sellPct: number;
  bidDepth: number;
  askDepth: number;
}

const SYMBOLS: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB',
  XRP: 'Ripple', ADA: 'Cardano', AVAX: 'Avalanche', DOT: 'Polkadot',
  LINK: 'Chainlink', MATIC: 'Polygon', DOGE: 'Dogecoin', TRX: 'TRON',
  LTC: 'Litecoin', BCH: 'Bitcoin Cash', ATOM: 'Cosmos', UNI: 'Uniswap',
  NEAR: 'Near Protocol', APT: 'Aptos', FIL: 'Filecoin', ICP: 'Internet Computer',
  HBAR: 'Hedera', VET: 'VeChain', ALGO: 'Algorand', FTM: 'Fantom',
  INJ: 'Injective', SUI: 'Sui', SEI: 'Sei', TIA: 'Celestia',
  RUNE: 'THORChain', GRT: 'The Graph',
};

const SYMBOL_KEYS = Object.keys(SYMBOLS);

const ORDERBOOK_SYMBOLS = ['BTC', 'ETH'];

// Binance WebSocket endpoints — the frontend still attempts a direct WS
// connection first for lowest latency. When all WS hosts are ISP-blocked,
// the REST fallback kicks in through our edge proxy (binance-proxy), which
// is hosted on our own unblocked domain and rotates through Binance hosts
// server-side.
const BINANCE_WS_URLS = [
  'wss://stream.binance.com:9443',
  'wss://stream.binance.com:443',
  'wss://data-stream.binance.vision',
];

// CoinGecko coin-id map — shared by the 24h and 15m fallbacks.
const COINGECKO_ID_MAP: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot',
  LINK: 'chainlink', MATIC: 'matic-network', DOGE: 'dogecoin', TRX: 'tron',
  LTC: 'litecoin', BCH: 'bitcoin-cash', ATOM: 'cosmos', UNI: 'uniswap',
  NEAR: 'near', APT: 'aptos', FIL: 'filecoin', ICP: 'internet-computer',
  HBAR: 'hedera-hashgraph', VET: 'vechain', ALGO: 'algorand', FTM: 'fantom',
  INJ: 'injective-protocol', SUI: 'sui', SEI: 'sei-network', TIA: 'celestia',
  RUNE: 'thorchain', GRT: 'the-graph',
};

// ─── Singleton Market Data Store ──────────────────────────────────────────

interface MarketDataState {
  coins: LiveCoin[];
  loading: boolean;
  isLiveConnected: boolean;
  connectionStatus: ConnectionStatus;
  orderBooks: Record<string, OrderBookPressure>;
  candlesBySymbol: Record<string, Candle[]>;
}

class MarketDataStore {
  private state: MarketDataState = {
    coins: [],
    loading: true,
    isLiveConnected: false,
    connectionStatus: 'reconnecting',
    orderBooks: {},
    candlesBySymbol: {},
  };
  private listeners = new Set<() => void>();
  private sparklineRef: Record<string, number[]> = {};
  private ws: WebSocket | null = null;
  private restTimer: ReturnType<typeof setInterval> | null = null;
  private kline15mTimer: ReturnType<typeof setInterval> | null = null;
  private candleTimer: ReturnType<typeof setInterval> | null = null;
  private orderBookTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private wsUrlIndex = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private refCount = 0;
  private restFailCount = 0;
  private wsFailCount = 0;
  private klineFailCount = 0;
  private lastSuccessfulDataTs = 0;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): MarketDataState => this.state;

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private setCoinData(sym: string, data: Partial<LiveCoin>) {
    const hist = this.sparklineRef[sym] ?? [];
    if (data.price !== undefined && data.price > 0) {
      hist.push(data.price);
      if (hist.length > 40) hist.shift();
      this.sparklineRef[sym] = hist;
    }
    this.state = (() => {
      const map = new Map(this.state.coins.map((c) => [c.symbol, c]));
      const existing = map.get(sym);
      if (existing) {
        map.set(sym, {
          ...existing,
          ...data,
          sparkline: hist.length > 0 ? [...hist] : existing.sparkline,
        });
      } else {
        map.set(sym, {
          symbol: sym,
          name: SYMBOLS[sym] ?? sym,
          price: data.price ?? 0,
          change24h: data.change24h ?? 0,
          change15m: data.change15m ?? 0,
          volume24h: data.volume24h ?? 0,
          quoteVolume24h: data.quoteVolume24h ?? 0,
          high24h: data.high24h ?? 0,
          low24h: data.low24h ?? 0,
          sparkline: [...hist],
        });
      }
      return {
        ...this.state,
        coins: Array.from(map.values()).sort(
          (a, b) => SYMBOL_KEYS.indexOf(a.symbol) - SYMBOL_KEYS.indexOf(b.symbol),
        ),
      };
    })();
    this.emit();
  }

  private setConnected(connected: boolean) {
    if (this.state.isLiveConnected === connected) return;
    this.state = { ...this.state, isLiveConnected: connected };
    this.emit();
  }

  private setLoading(loading: boolean) {
    if (this.state.loading === loading) return;
    this.state = { ...this.state, loading };
    this.emit();
  }

  private setConnectionStatus(status: ConnectionStatus) {
    if (this.state.connectionStatus === status) return;
    this.state = { ...this.state, connectionStatus: status };
    this.emit();
  }

  private setOrderBook(sym: string, ob: OrderBookPressure) {
    this.state = {
      ...this.state,
      orderBooks: { ...this.state.orderBooks, [sym]: ob },
    };
    this.emit();
  }

  private setCandles(sym: string, candles: Candle[]) {
    this.state = {
      ...this.state,
      candlesBySymbol: { ...this.state.candlesBySymbol, [sym]: candles },
    };
    this.emit();
  }

  incrementRef() {
    this.refCount++;
    if (this.refCount === 1) this.start();
  }

  decrementRef() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) this.stop();
  }

  private start() {
    this.reconnectAttempts = 0;
    this.restFailCount = 0;
    this.wsFailCount = 0;
    this.klineFailCount = 0;
    this.fetchRest();
    this.fetch15mChanges();
    this.fetchOrderBooks();
    this.fetchCandles();
    this.kline15mTimer = setInterval(() => this.fetch15mChanges(), 60_000);
    this.candleTimer = setInterval(() => this.fetchCandles(), 60_000);
    this.orderBookTimer = setInterval(() => this.fetchOrderBooks(), 5_000);
    this.healthTimer = setInterval(() => this.evaluateConnectionHealth(), 5_000);
    this.connectWs();
  }

  private stop() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.restTimer) {
      clearInterval(this.restTimer);
      this.restTimer = null;
    }
    if (this.kline15mTimer) {
      clearInterval(this.kline15mTimer);
      this.kline15mTimer = null;
    }
    if (this.candleTimer) {
      clearInterval(this.candleTimer);
      this.candleTimer = null;
    }
    if (this.orderBookTimer) {
      clearInterval(this.orderBookTimer);
      this.orderBookTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private markDataReceived() {
    this.lastSuccessfulDataTs = Date.now();
    this.setConnectionStatus('connected');
  }

  private evaluateConnectionHealth() {
    const stale = Date.now() - this.lastSuccessfulDataTs;
    if (this.lastSuccessfulDataTs === 0 || stale > 45_000) {
      this.setConnectionStatus('offline');
    } else if (stale > 15_000) {
      this.setConnectionStatus('reconnecting');
    } else {
      this.setConnectionStatus('connected');
    }
  }

  // ── REST: Binance (primary) → CoinGecko (fallback) ──────────────────────

  private async fetchRest() {
    const gotData = await this.fetchBinanceRest();
    if (!gotData) {
      await this.fetchCoinGeckoRest();
    }
    this.evaluateConnectionHealth();
  }

  private async fetchBinanceRest(): Promise<boolean> {
    const results = await Promise.allSettled(
      SYMBOL_KEYS.map((sym) => proxyTicker24hr(sym + 'USDT')),
    );

    let count = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled') continue;
      const base = SYMBOL_KEYS[i];
      const t = r.value;
      const price = parseFloat(t.lastPrice);
      const change = parseFloat(t.priceChangePercent);
      if (!Number.isFinite(price) || price <= 0) continue;
      this.setCoinData(base, {
        price,
        change24h: Number.isFinite(change) ? change : 0,
        volume24h: parseFloat(t.volume) || 0,
        quoteVolume24h: parseFloat(t.quoteVolume) || 0,
        high24h: parseFloat(t.highPrice) || 0,
        low24h: parseFloat(t.lowPrice) || 0,
      });
      count++;
    }

    if (count > 0) {
      this.restFailCount = 0;
      this.setLoading(false);
      this.setConnected(true);
      this.markDataReceived();
      return true;
    }

    this.restFailCount++;
    this.setLoading(false);
    return false;
  }

  private async fetchCoinGeckoRest(): Promise<boolean> {
    try {
      const ids = Object.values(COINGECKO_ID_MAP).join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const data = await res.json() as Record<string, {
        usd: number; usd_24h_change: number; usd_24h_vol: number;
      }>;

      let count = 0;
      for (const [sym, id] of Object.entries(COINGECKO_ID_MAP)) {
        const coin = data[id];
        if (!coin || !Number.isFinite(coin.usd) || coin.usd <= 0) continue;
        this.setCoinData(sym, {
          price: coin.usd,
          change24h: Number.isFinite(coin.usd_24h_change) ? coin.usd_24h_change : 0,
          volume24h: 0,
          quoteVolume24h: Number.isFinite(coin.usd_24h_vol) ? coin.usd_24h_vol : 0,
          high24h: 0,
          low24h: 0,
        });
        count++;
      }

      if (count > 0) {
        this.restFailCount = 0;
        this.setLoading(false);
        this.setConnected(true);
        this.markDataReceived();
        return true;
      }
    } catch (err) {
      console.error('[useLivePrices] CoinGecko fallback failed:', err);
    }
    this.restFailCount++;
    this.setLoading(false);
    this.setConnected(false);
    this.setConnectionStatus('offline');
    return false;
  }

  // ── 15m change: Binance primary → api1.binance.com mirror → CoinGecko ────
  //
  // CoinGecko's /simple/price endpoint exposes only 24h change, so for the
  // 15m fallback we derive change15m from the 24h change scaled by a 1/96
  // factor (24h ≈ 96 × 15m bars). This is an approximation, not a real 15m
  // candle — but it keeps the Grid Meter and AI Predictor from freezing on
  // 0% when Binance is fully geo-blocked. The first successful source wins.

  private async fetch15mChanges(): Promise<void> {
    const results = await Promise.allSettled(
      SYMBOL_KEYS.map((sym) => proxyKlines(sym + 'USDT', '15m', 1)),
    );

    let count = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled' || !r.value || r.value.length === 0) continue;
      const base = SYMBOL_KEYS[i];
      const candle = r.value[0];
      const open = parseFloat(candle[1] as string);
      const close = parseFloat(candle[4] as string);
      if (open <= 0) continue;
      const change15m = ((close - open) / open) * 100;
      this.setCoinData(base, { change15m: Number.isFinite(change15m) ? change15m : 0 });
      count++;
    }

    if (count > 0) {
      this.klineFailCount = 0;
    } else {
      this.klineFailCount++;
      await this.fetch15mCoinGecko();
    }
    this.evaluateConnectionHealth();
  }

  private async fetch15mCoinGecko(): Promise<boolean> {
    try {
      const ids = Object.values(COINGECKO_ID_MAP).join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CoinGecko 15m fallback ${res.status}`);
      const data = await res.json() as Record<string, { usd: number; usd_24h_change: number }>;

      let count = 0;
      for (const [sym, id] of Object.entries(COINGECKO_ID_MAP)) {
        const coin = data[id];
        if (!coin || !Number.isFinite(coin.usd_24h_change)) continue;
        // Approximate 15m change from the 24h change (96 × 15m bars in 24h).
        // Keeps the dashboard from freezing on 0% when Binance is unreachable.
        const change15m = coin.usd_24h_change / 96;
        this.setCoinData(sym, { change15m: Number.isFinite(change15m) ? change15m : 0 });
        count++;
      }

      if (count > 0) {
        console.warn('[useLivePrices] Using CoinGecko 24h-scaled fallback for 15m change (Binance blocked).');
        this.klineFailCount = 0;
        return true;
      }
    } catch (err) {
      console.error('[useLivePrices] CoinGecko 15m fallback failed:', err);
    }
    this.klineFailCount++;
    this.setConnectionStatus('offline');
    return false;
  }

  // ── Candle history (50 × 15m) for pro indicators — same mirror fallback ──

  private async fetchCandles(): Promise<void> {
    await Promise.allSettled(ORDERBOOK_SYMBOLS.map((sym) => this.fetchCandlesForSymbol(sym)));
  }

  private async fetchCandlesForSymbol(sym: string): Promise<void> {
    try {
      const rows = await proxyKlines(sym + 'USDT', '15m', 60);
      const candles: Candle[] = rows
        .map((row) => ({
          open: parseFloat(row[1] as string),
          high: parseFloat(row[2] as string),
          low: parseFloat(row[3] as string),
          close: parseFloat(row[4] as string),
          volume: parseFloat(row[5] as string),
        }))
        .filter(
          (c) =>
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close) &&
            Number.isFinite(c.volume) &&
            c.open > 0,
        );
      if (candles.length >= 21) {
        this.setCandles(sym, candles);
      }
    } catch (err) {
      console.error(`[useLivePrices] Proxy candle fetch ${sym} failed:`, err);
    }
  }

  // ── Order Book: real bid/ask depth (Binance primary, Bybit fallback) ─────

  private async fetchOrderBooks(): Promise<void> {
    await Promise.allSettled(ORDERBOOK_SYMBOLS.map((sym) => this.fetchOrderBook(sym)));
  }

  private async fetchOrderBook(sym: string): Promise<void> {
    const binanceOk = await this.fetchOrderBookBinance(sym);
    if (!binanceOk) {
      await this.fetchOrderBookBybit(sym);
    }
  }

  private async fetchOrderBookBinance(sym: string): Promise<boolean> {
    try {
      const data = await proxyDepth(sym + 'USDT', 20);
      const ob = computeOrderBookPressure(data.bids, data.asks);
      this.setOrderBook(sym, ob);
      return true;
    } catch (err) {
      console.error(`[useLivePrices] Proxy order book ${sym} failed:`, err);
      return false;
    }
  }

  private async fetchOrderBookBybit(sym: string): Promise<boolean> {
    try {
      const res = await fetch(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${sym}USDT&limit=20`);
      if (!res.ok) throw new Error(`Bybit orderbook ${res.status}`);
      const data = await res.json() as { result: { b: string[][]; a: string[][] } };
      const ob = computeOrderBookPressure(data.result.b, data.result.a);
      this.setOrderBook(sym, ob);
      console.warn(`[useLivePrices] Using Bybit fallback for ${sym} order book.`);
      return true;
    } catch (err) {
      console.error(`[useLivePrices] Bybit order book ${sym} fallback failed:`, err);
      return false;
    }
  }

  // ── WebSocket: Binance combined stream ───────────────────────────────────

  private connectWs() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      const streams = SYMBOL_KEYS.map((s) => s.toLowerCase() + 'usdt@ticker').join('/');
      const wsBase = BINANCE_WS_URLS[this.wsUrlIndex % BINANCE_WS_URLS.length];
      this.ws = new WebSocket(`${wsBase}/stream?streams=${streams}`);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.wsFailCount = 0;
        this.wsUrlIndex = 0;
        // Clear the REST fallback timer once the WS is live again — avoids
        // duplicate phantom polling intervals accumulating across reconnects.
        if (this.restTimer) {
          clearInterval(this.restTimer);
          this.restTimer = null;
        }
        this.setConnectionStatus('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const t = msg.data ?? msg;
          if (!t || !t.s) return;

          const base = (t.s as string).replace(/USDT$/, '');
          if (!SYMBOLS[base]) return;

          const price = parseFloat(t.c);
          if (!Number.isFinite(price) || price <= 0) return;

          this.setCoinData(base, {
            price,
            change24h: parseFloat(t.P) || 0,
            volume24h: parseFloat(t.v) || 0,
            quoteVolume24h: parseFloat(t.q) || 0,
            high24h: parseFloat(t.h) || 0,
            low24h: parseFloat(t.l) || 0,
          });
          this.setLoading(false);
          this.setConnected(true);
          this.markDataReceived();
        } catch (err) {
          console.error('[useLivePrices] WS message parse error:', err);
        }
      };

      this.ws.onerror = (ev) => {
        this.wsFailCount++;
        console.error('[useLivePrices] Binance WebSocket error — will trigger reconnect via onclose.', ev);
        // Closing here fires onclose, which schedules the next reconnect.
        this.ws?.close();
      };

      this.ws.onclose = () => {
        // Immediately fall back to REST polling so data keeps flowing while
        // we attempt to re-establish the socket.
        if (!this.restTimer) {
          this.fetchRest();
          this.restTimer = setInterval(() => this.fetchRest(), 5_000);
        }
        this.setConnectionStatus('reconnecting');

        // Rotate to the next WebSocket endpoint to bypass ISP-level blocks.
        this.wsUrlIndex = (this.wsUrlIndex + 1) % BINANCE_WS_URLS.length;

        // CEO DIRECTIVE: NEVER stop trying to reconnect while the store is
        // alive. The old code gave up after 10 failures (wsFailCount < 10),
        // which permanently killed the dashboard. Now we always retry with
        // exponential backoff: 1s → 3s → 5s → 10s → 20s → 30s (cap).
        if (this.refCount > 0) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(1.8, this.reconnectAttempts - 1), 30000);
          this.reconnectTimer = setTimeout(() => this.connectWs(), Math.round(delay));
        }
      };
    } catch (err) {
      console.error('[useLivePrices] WS construction failed — relying on REST polling.', err);
      if (!this.restTimer) {
        this.fetchRest();
        this.restTimer = setInterval(() => this.fetchRest(), 15000);
      }
    }
  }
}

function computeOrderBookPressure(
  bids: string[][],
  asks: string[][],
): OrderBookPressure {
  let bidDepth = 0;
  let askDepth = 0;
  for (const b of bids) {
    const qty = parseFloat(b[1]);
    if (Number.isFinite(qty)) bidDepth += qty;
  }
  for (const a of asks) {
    const qty = parseFloat(a[1]);
    if (Number.isFinite(qty)) askDepth += qty;
  }
  const total = bidDepth + askDepth;
  if (total <= 0) {
    return { buyPct: 50, sellPct: 50, bidDepth: 0, askDepth: 0 };
  }
  const buyPct = Math.round((bidDepth / total) * 100);
  return {
    buyPct,
    sellPct: 100 - buyPct,
    bidDepth,
    askDepth,
  };
}

const store = new MarketDataStore();

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useLivePrices(): {
  coins: LiveCoin[];
  loading: boolean;
  isLiveConnected: boolean;
  connectionStatus: ConnectionStatus;
  orderBooks: Record<string, OrderBookPressure>;
  candlesBySymbol: Record<string, Candle[]>;
} {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    store.incrementRef();
    return () => store.decrementRef();
  }, []);

  return {
    coins: state.coins,
    loading: state.loading,
    isLiveConnected: state.isLiveConnected,
    connectionStatus: state.connectionStatus,
    orderBooks: state.orderBooks,
    candlesBySymbol: state.candlesBySymbol,
  };
}
