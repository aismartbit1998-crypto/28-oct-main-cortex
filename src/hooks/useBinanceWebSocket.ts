import { useState, useEffect, useRef, useCallback } from 'react';
import { proxyKlines, proxyTickers24hr } from '@/lib/binanceProxy';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickerData {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
}

// Binance WebSocket base URLs — rotated on every reconnect to bypass
// ISP-level blocks. data-stream.binance.vision is Binance's public market-data
// mirror and is often reachable when stream.binance.com is geo-blocked.
const WS_BASES = [
  'wss://stream.binance.com:9443',
  'wss://stream.binance.com:443',
  'wss://data-stream.binance.vision',
];

// Exponential backoff schedule: 1s → 2s → 3.6s → 6.5s → 11.7s → 21s (cap 30s).
function backoffDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(1.8, attempt - 1), 30000);
}

/**
 * Fetches historical candlestick data from Binance's free REST API (no API key needed).
 * Endpoint: api.binance.com/api/v3/klines
 */
export async function fetchKlines(symbol: string, interval: string = '15m', limit: number = 200): Promise<Candle[]> {
  const raw = await proxyKlines(symbol, interval, limit);
  return raw.map((k) => ({
    time: Math.floor((k[0] as number) / 1000),
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

/**
 * Connects to Binance's public WebSocket for real-time candlestick updates.
 * Stream: <symbol>@kline_<interval>
 * Zero cost, no API key, no rate limits.
 *
 * Auto-reconnects with exponential backoff on drop — the old version died
 * permanently after a single error.
 */
export function useBinanceKlineStream(symbol: string | null, interval: string = '15m') {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const wsUrlIndexRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!symbol) return;
    mountedRef.current = true;
    setLoading(true);
    candleMapRef.current.clear();

    // 1. Fetch historical candles for immediate display
    fetchKlines(symbol, interval, 200)
      .then((history) => {
        if (!mountedRef.current) return;
        const map = new Map<number, Candle>();
        for (const c of history) map.set(c.time, c);
        candleMapRef.current = map;
        setCandles(history);
        setLoading(false);
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });

    // 2. Connect WebSocket for live updates with robust reconnect
    const streamSymbol = symbol.toLowerCase();
    const wsBase = WS_BASES[wsUrlIndexRef.current % WS_BASES.length];
    const wsUrl = `${wsBase}/ws/${streamSymbol}@kline_${interval}`;

    const connect = () => {
      if (!mountedRef.current) return;

      // Clean up any existing socket before spawning a new one.
      if (wsRef.current) {
        try { wsRef.current.onclose = null; } catch { /* noop */ }
        try { wsRef.current.onerror = null; } catch { /* noop */ }
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        wsUrlIndexRef.current = 0;
        if (mountedRef.current) setConnected(true);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          const k = msg.k;
          if (!k) return;

          const candle: Candle = {
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };

          candleMapRef.current.set(candle.time, candle);
          setCandles(Array.from(candleMapRef.current.values()).sort((a, b) => a.time - b.time));
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        // Closing here triggers onclose, which schedules the reconnect.
        try { ws.close(); } catch { /* noop */ }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (!mountedRef.current) return;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsUrlIndexRef.current = (wsUrlIndexRef.current + 1) % WS_BASES.length;
      reconnectAttemptsRef.current++;
      const delay = backoffDelay(reconnectAttemptsRef.current);
      reconnectTimerRef.current = setTimeout(() => connect(), Math.round(delay));
    };

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.onclose = null; } catch { /* noop */ }
        try { wsRef.current.onerror = null; } catch { /* noop */ }
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
    };
  }, [symbol, interval]);

  return { candles, loading, connected };
}

/**
 * Subscribes to real-time ticker updates for a set of symbols via Binance WebSocket.
 * Zero cost, no API key. Uses the combined stream endpoint for multiple symbols.
 *
 * Auto-reconnects with exponential backoff on drop — the old version died
 * permanently after a single error.
 */
export function useBinanceTickerStream(symbols: string[]) {
  const [tickers, setTickers] = useState<Map<string, TickerData>>(new Map());
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const wsUrlIndexRef = useRef(0);
  const symbolsKey = symbols.join(',');
  const mountedRef = useRef(true);

  const subscribe = useCallback((syms: string[]) => {
    if (syms.length === 0) return;

    const streams = syms.map((s) => `${s.toLowerCase()}@ticker`).join('/');
    const wsBase = WS_BASES[wsUrlIndexRef.current % WS_BASES.length];
    const wsUrl = `${wsBase}/stream?streams=${streams}`;

    const connect = () => {
      if (!mountedRef.current) return;

      // Clean up any existing socket before spawning a new one.
      if (wsRef.current) {
        try { wsRef.current.onclose = null; } catch { /* noop */ }
        try { wsRef.current.onerror = null; } catch { /* noop */ }
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        wsUrlIndexRef.current = 0;
        if (mountedRef.current) setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const d = msg.data;
          if (!d || !d.s) return;
          const symbol = d.s as string;
          setTickers((prev) => {
            const next = new Map(prev);
            next.set(symbol, {
              symbol,
              price: parseFloat(d.c) || 0,
              change24h: parseFloat(d.P) || 0,
              high24h: parseFloat(d.h) || 0,
              low24h: parseFloat(d.l) || 0,
              volume24h: parseFloat(d.v) || 0,
              quoteVolume24h: parseFloat(d.q) || 0,
            });
            return next;
          });
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* noop */ }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (!mountedRef.current) return;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsUrlIndexRef.current = (wsUrlIndexRef.current + 1) % WS_BASES.length;
      reconnectAttemptsRef.current++;
      const delay = backoffDelay(reconnectAttemptsRef.current);
      reconnectTimerRef.current = setTimeout(() => connect(), Math.round(delay));
    };

    connect();
  }, []);

  useEffect(() => {
    if (symbols.length === 0) return;
    mountedRef.current = true;

    // Initial REST fetch for immediate data via edge proxy
    (async () => {
      try {
        const raw = await proxyTickers24hr(symbols);
        if (!mountedRef.current || !Array.isArray(raw)) return;
        const map = new Map<string, TickerData>();
        for (const t of raw) {
          map.set(t.symbol, {
            symbol: t.symbol,
            price: parseFloat(t.lastPrice) || 0,
            change24h: parseFloat(t.priceChangePercent) || 0,
            high24h: parseFloat(t.highPrice) || 0,
            low24h: parseFloat(t.lowPrice) || 0,
            volume24h: parseFloat(t.volume) || 0,
            quoteVolume24h: parseFloat(t.quoteVolume) || 0,
          });
        }
        if (mountedRef.current) setTickers(map);
      } catch {
        // fallback — websocket will populate
      }
    })();

    subscribe(symbols);

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        try { ws.onclose = null; } catch { /* noop */ }
        try { ws.onerror = null; } catch { /* noop */ }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        wsRef.current = null;
      }
    };
  }, [symbolsKey, subscribe]);

  return { tickers, connected };
}
