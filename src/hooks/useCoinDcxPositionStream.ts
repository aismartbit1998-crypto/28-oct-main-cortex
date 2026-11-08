import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export type PositionUpdateEvent = {
  pair: string;
  size: number;
  side: 'BUY' | 'SELL';
  status: 'open' | 'closed';
  realizedPnl: number;
  timestamp: number;
};

export type WsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface WsAuthResponse {
  socketEndpoint: string;
  channelName: string;
  apiKey: string;
  authSignature: string;
}

/**
 * useCoinDcxPositionStream — Connects directly to CoinDCX's authenticated
 * Socket.IO user-data stream to receive real-time position updates.
 *
 * When a position is modified or closed on the exchange, CoinDCX pushes a
 * "df-position-update" event. We receive it instantly and trigger the
 * sync-exchange-positions edge function to reconcile the Supabase database.
 * Supabase Realtime then pushes the DB change to all subscribed UI views.
 *
 * This achieves 0-second latency from exchange event to UI update, with the
 * hourly cron job as a backup auditor for anything the stream misses.
 */
export function useCoinDcxPositionStream() {
  const { effectiveUserId } = useAuth();
  const [wsState, setWsStateRaw] = useState<WsConnectionState>('disconnected');
  const [lastPositionEvent, setLastPositionEvent] = useState<PositionUpdateEvent | null>(null);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const lastReconcileRef = useRef(0);
  const wsStateRef = useRef<WsConnectionState>('disconnected');

  // Wrapped setter that keeps the ref in sync so the reconciliation
  // callback can read the current state without re-creating the callback.
  const setWsState = useCallback((s: WsConnectionState) => {
    wsStateRef.current = s;
    setWsStateRaw(s);
  }, []);

  const triggerReconciliation = useCallback(async () => {
    // Debounce: don't reconcile more than once every 5 seconds, even if
    // the exchange sends a rapid burst of position/balance events.
    const now = Date.now();
    if (now - lastReconcileRef.current < 5000) return;
    // SAFEGUARD: Do not trigger reconciliation if the WebSocket is in an
    // error or disconnected state — the exchange connection is unhealthy
    // and reconciliation would corrupt positions with false ghost closes.
    if (wsStateRef.current === 'error' || wsStateRef.current === 'disconnected') return;
    lastReconcileRef.current = now;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-exchange-positions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({}),
      });
      // SAFEGUARD: If the edge function returns a non-200 status, the
      // exchange API is likely unhealthy. Log but do NOT retry — the cron
      // job and next healthy WS event will handle it.
      if (!resp.ok) {
        console.warn('useCoinDcxPositionStream: reconciliation skipped — edge function returned', resp.status);
      }
    } catch (err) {
      console.error('useCoinDcxPositionStream: reconciliation fetch failed:', (err as Error).message);
    }
  }, []);

  const connect = useCallback(async () => {
    if (!effectiveUserId || !mountedRef.current) return;

    setWsState('connecting');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setWsState('error');
        return;
      }

      const authResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/coindcx-ws-auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });

      if (!authResp.ok) {
        setWsState('error');
        return;
      }

      const auth = await authResp.json() as WsAuthResponse;

      const socket = io(auth.socketEndpoint, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
        timeout: 10000,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        if (!mountedRef.current) return;
        socket.emit('join', {
          channelName: auth.channelName,
          authSignature: auth.authSignature,
          apiKey: auth.apiKey,
        });
        setWsState('connected');
      });

      socket.on('df-position-update', (response: { data?: Record<string, unknown> }) => {
        if (!mountedRef.current) return;
        try {
          const d = response.data ?? response;
          const event: PositionUpdateEvent = {
            pair: (d.pair as string) ?? (d.p as string) ?? '',
            size: Number(d.size ?? d.s ?? d.position_size ?? 0),
            side: ((d.side as string) ?? (d.sd as string) ?? '').toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
            status: Number(d.size ?? d.s ?? 0) > 0 ? 'open' : 'closed',
            realizedPnl: Number(d.realized_pnl ?? d.rp ?? 0),
            timestamp: Date.now(),
          };
          setLastPositionEvent(event);
          // Trigger immediate DB reconciliation so Supabase Realtime
          // pushes the updated position to all subscribed UI views.
          triggerReconciliation();
        } catch {
          // Malformed event — ignore, cron will catch up
        }
      });

      socket.on('balance-update', () => {
        if (!mountedRef.current) return;
        // Balance changes may indicate a position close — reconcile.
        triggerReconciliation();
      });

      socket.on('disconnect', () => {
        if (!mountedRef.current) return;
        setWsState('connecting');
      });

      socket.on('connect_error', () => {
        if (!mountedRef.current) return;
        setWsState('error');
      });

      socket.on('reconnect', () => {
        if (!mountedRef.current) return;
        socket.emit('join', {
          channelName: auth.channelName,
          authSignature: auth.authSignature,
          apiKey: auth.apiKey,
        });
        setWsState('connected');
      });
    } catch {
      if (!mountedRef.current) return;
      setWsState('error');
      // Retry connection after 10s
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => connect(), 10000);
    }
  }, [effectiveUserId, triggerReconciliation]);

  useEffect(() => {
    if (!effectiveUserId) return;
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        try { socketRef.current.disconnect(); } catch { /* noop */ }
        socketRef.current = null;
      }
    };
  }, [effectiveUserId, connect]);

  return { wsState, lastPositionEvent, triggerReconciliation };
}
