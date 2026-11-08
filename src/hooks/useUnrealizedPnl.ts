import { useMemo } from 'react';
import { useLivePrices } from '@/hooks/useLivePrices';
import type { Trade } from '@/lib/supabase';

/**
 * useUnrealizedPnl — calculates live unrealized PnL for open trades
 * using real-time Binance prices via the useLivePrices WebSocket hook.
 *
 * LONG:  (livePrice - entryPrice) * quantity * leverage
 * SHORT: (entryPrice - livePrice) * quantity * leverage
 *
 * No fake data — if no live price is available for a coin, PnL is 0.
 *
 * CEO DIRECTIVE: The raw formula produces USDT PnL (prices are in USDT). The
 * UI displays values in INR with the ₹ symbol, so we multiply by the platform
 * USD→INR conversion rate (102) before returning. This prevents the 0.21 USDT
 * → ₹0.21 desync that made live PnL look 84x smaller than the exchange.
 */
const USD_INR_RATE = 102;

export function useUnrealizedPnl(trades: Trade[]) {
  const { coins } = useLivePrices();

  const priceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of coins) {
      map.set(c.symbol.toUpperCase(), c.price);
    }
    return map;
  }, [coins]);

  const unrealizedPnlMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of trades) {
      if (t.status !== 'open') {
        map.set(t.id, 0);
        continue;
      }
      const livePrice = priceMap.get(t.coin.toUpperCase());
      if (!livePrice || livePrice <= 0) {
        map.set(t.id, 0);
        continue;
      }
      const entry = Number(t.entry_price);
      const qty = Number(t.quantity);
      const pnl =
        t.direction === 'long'
          ? (livePrice - entry) * qty * USD_INR_RATE
          : (entry - livePrice) * qty * USD_INR_RATE;
      map.set(t.id, pnl);
    }
    return map;
  }, [trades, priceMap]);

  const totalUnrealized = useMemo(() => {
    let sum = 0;
    for (const t of trades) {
      if (t.status === 'open') {
        sum += unrealizedPnlMap.get(t.id) ?? 0;
      }
    }
    return sum;
  }, [trades, unrealizedPnlMap]);

  return {
    unrealizedPnlMap,
    totalUnrealized,
    livePrices: priceMap,
  };
}
