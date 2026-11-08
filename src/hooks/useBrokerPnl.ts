import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Position } from '@/lib/supabase';

/**
 * useBrokerPnl — polls the sync-broker-pnl edge function every few seconds
 * to fetch the EXACT unrealized PnL reported by the CoinDCX broker for each
 * open position. The returned map (keyed by position id) holds INR-denominated
 * PnL straight from the exchange — not local price math.
 *
 * For paper positions or when no broker is connected, the map value is 0 and
 * the caller should fall back to the local Binance-price PnL.
 */
const POLL_INTERVAL_MS = 5000;

export function useBrokerPnl(positions: Position[]) {
  const [brokerPnlMap, setBrokerPnlMap] = useState<Map<string, number>>(new Map());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const positionsRef = useRef<Position[]>(positions);
  positionsRef.current = positions;

  const fetchBrokerPnl = useCallback(async () => {
    const currentPositions = positionsRef.current;
    if (currentPositions.length === 0) {
      setBrokerPnlMap(new Map());
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-broker-pnl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({}),
      });
      if (!resp.ok) return;
      const result = await resp.json();
      if (result && result.pnlMap) {
        const map = new Map<string, number>();
        for (const [id, pnl] of Object.entries(result.pnlMap)) {
          map.set(id, Number(pnl));
        }
        setBrokerPnlMap(map);
        setLastSync(new Date());
      }
    } catch {
      // Network errors are non-fatal — the caller falls back to local PnL.
    }
  }, []);

  useEffect(() => {
    fetchBrokerPnl();
    const timer = setInterval(fetchBrokerPnl, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchBrokerPnl]);

  return { brokerPnlMap, lastSync, refreshBrokerPnl: fetchBrokerPnl };
}
