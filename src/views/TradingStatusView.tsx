import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Play, Pause, Square, TrendingUp, Zap, Loader2, Bot as BotIcon, AlertOctagon, Crosshair, ArrowUp, ArrowDown, Radio, XCircle, CheckSquare, Square as UncheckSquare, AlertTriangle, LogOut, Trash2, Clock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { supabase, type Bot, type RiskSettings, type Trade } from '@/lib/supabase';
import { usePositionMonitor } from '@/hooks/usePositionMonitor';
import { useUnrealizedPnl } from '@/hooks/useUnrealizedPnl';
import { useBrokerPnl } from '@/hooks/useBrokerPnl';
import { useLivePrices } from '@/hooks/useLivePrices';
import { SkeletonCard, SkeletonStat } from '@/components/Skeleton';

const statusConfig = {
  running: { color: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/30', label: 'RUNNING' },
  paused: { color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/30', label: 'PAUSED' },
  idle: { color: 'text-slate-500', bg: 'bg-white/[0.03]', border: 'border-white/[0.06]', label: 'IDLE' },
  paper: { color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/30', label: 'PAPER' },
  inactive: { color: 'text-slate-600', bg: 'bg-white/[0.02]', border: 'border-white/[0.04]', label: 'CLOSED' },
  daily_limit: { color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/30', label: 'LIMIT REACHED (SLEEPING)' },
};

export default function TradingStatusView() {
  const { formatInr } = useApp();
  const { session, effectiveUserId, impersonating, stopImpersonation } = useAuth();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [realizedPnlByBot, setRealizedPnlByBot] = useState<Map<string, number>>(new Map());
  const { positions, lastUpdate } = usePositionMonitor();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActioning, setBulkActioning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [todayStats, setTodayStats] = useState<{ realizedPnl: number; tradeCount: number }>({ realizedPnl: 0, tradeCount: 0 });
  const [squaringOffId, setSquaringOffId] = useState<string | null>(null);
  const [forceDeletingId, setForceDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bot | null>(null);
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);
  const [tradeNowId, setTradeNowId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const userId = effectiveUserId ?? '';

    Promise.all([
      supabase.from('bots').select('*').eq('user_id', userId).neq('status', 'inactive').order('created_at', { ascending: false }),
      supabase.from('risk_settings').select('*').limit(1).maybeSingle(),
      supabase.from('trades').select('*').eq('client_id', userId).order('created_at', { ascending: false }),
      supabase.from('positions').select('bot_id, close_pnl').eq('user_id', userId).neq('status', 'open'),
      supabase.from('trade_history')
        .select('realized_pnl, closed_at')
        .eq('user_id', userId)
        .gte('closed_at', (() => { const o = 5.5 * 60 * 60 * 1000; const n = new Date(Date.now() + o); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - o).toISOString(); })()),
    ]).then(([botsRes, riskRes, tradesRes, closedPosRes, todayRes]) => {
      if (!mounted) return;
      setBots((botsRes.data as Bot[]) ?? []);
      setKillSwitch((riskRes.data as RiskSettings | null)?.global_kill_switch ?? false);
      const allTrades = (tradesRes.data as Trade[]) ?? [];
      setOpenTrades(allTrades.filter(t => t.status === 'open'));
      const closedPositions = (closedPosRes.data as { bot_id: string | null; close_pnl: number | null }[]) ?? [];
      const byBot = new Map<string, number>();
      for (const p of closedPositions) {
        if (!p.bot_id) continue;
        byBot.set(p.bot_id, (byBot.get(p.bot_id) ?? 0) + Number(p.close_pnl ?? 0));
      }
      setRealizedPnlByBot(byBot);
      const todayRows = (todayRes.data as { realized_pnl: number | null }[]) ?? [];
      setTodayStats({
        realizedPnl: todayRows.reduce((sum, r) => sum + Number(r.realized_pnl ?? 0), 0),
        tradeCount: todayRows.length,
      });
      setLoading(false);
    });

    const channel = supabase
      .channel('trading-status-trades')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: `client_id=eq.${userId}` },
        (payload) => {
          const newTrade = payload.new as Trade;
          if (newTrade.status === 'open') {
            setOpenTrades(prev => [newTrade, ...prev]);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trades', filter: `client_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as Trade;
          setOpenTrades(prev => {
            if (updated.status === 'open') {
              return prev.map(t => t.id === updated.id ? updated : t);
            }
            return prev.filter(t => t.id !== updated.id);
          });
        },
      )
      .subscribe();

    const botsChannel = supabase
      .channel('trading-status-bots')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bots', filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as Bot;
          setBots(prev => {
            if (updated.status === 'inactive') {
              setSelectedIds(prevSel => {
                const next = new Set(prevSel);
                next.delete(updated.id);
                return next;
              });
              return prev.filter(b => b.id !== updated.id);
            }
            return prev.map(b => b.id === updated.id ? updated : b);
          });
        },
      )
      .subscribe();

    // Only refetch aggregate stats when a position CLOSES (open→closed).
    // Frequent unrealized_pnl updates from the cron must NOT trigger refetches —
    // usePositionMonitor already handles those surgically via its own channel.
    const istMidnightFor = () => { const o = 5.5 * 60 * 60 * 1000; const n = new Date(Date.now() + o); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - o).toISOString(); };

    const refreshAggregates = () => {
      const utcMidnight = utcMidnightFor();
      Promise.all([
        supabase.from('positions').select('bot_id, close_pnl').eq('user_id', userId).neq('status', 'open'),
        supabase.from('trade_history').select('realized_pnl').eq('user_id', userId).gte('closed_at', utcMidnight),
      ]).then(([closedPosRes, todayRes]) => {
        if (!mounted) return;
        const closedPositions = (closedPosRes.data as { bot_id: string | null; close_pnl: number | null }[]) ?? [];
        const byBot = new Map<string, number>();
        for (const p of closedPositions) {
          if (!p.bot_id) continue;
          byBot.set(p.bot_id, (byBot.get(p.bot_id) ?? 0) + Number(p.close_pnl ?? 0));
        }
        setRealizedPnlByBot(byBot);
        const todayRows = (todayRes.data as { realized_pnl: number | null }[]) ?? [];
        setTodayStats({
          realizedPnl: todayRows.reduce((sum, r) => sum + Number(r.realized_pnl ?? 0), 0),
          tradeCount: todayRows.length,
        });
      });
    };

    const positionsChannel = supabase
      .channel('trading-status-positions')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'positions', filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as { status: string; bot_id: string | null; close_pnl: number | null };
          // Only act when a position transitions to closed — skip unrealized_pnl ticks
          if (updated.status === 'open') return;
          refreshAggregates();
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'positions', filter: `user_id=eq.${userId}` },
        () => { if (mounted) refreshAggregates(); },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
      supabase.removeChannel(positionsChannel);
      supabase.removeChannel(botsChannel);
    };
  }, [effectiveUserId]);

  const { unrealizedPnlMap, totalUnrealized } = useUnrealizedPnl(openTrades);

  // ── Broker PnL Sync: polls CoinDCX every 5s for the EXACT unrealized PnL.
  // For live positions, broker PnL (INR) replaces local math. For paper
  // positions or when no broker is connected, the map returns 0 and we fall
  // back to the local Binance-price PnL from useUnrealizedPnl.
  const { brokerPnlMap } = useBrokerPnl(positions);

  // Live price feed for TSL breach detection — the same store that powers the
  // dashboard ticker. Used by the HFT failsafe to compare live price against
  // the dynamically-ratcheted current_stop_loss written by the edge engine.
  const { coins: liveCoins } = useLivePrices();

  // Merge: prefer broker PnL when available (>0 or a real negative number);
  // otherwise keep the local Binance-price PnL as the display value.
  const mergedPnlMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of openTrades) {
      const local = unrealizedPnlMap.get(t.id) ?? 0;
      // Match trade to position by coin to look up broker PnL.
      const pos = positions.find(p => p?.symbol && p.symbol.replace('USDT', '') === t.coin && p.status === 'open');
      const broker = pos ? brokerPnlMap.get(pos.id) : undefined;
      // Use broker PnL only when it's a real nonzero number (positive or
      // negative). A 0 from the broker means "no data / paper" → fall back.
      map.set(t.id, broker !== undefined && broker !== 0 ? broker : local);
    }
    return map;
  }, [openTrades, unrealizedPnlMap, positions, brokerPnlMap]);

  const mergedTotalUnrealized = useMemo(() => {
    let sum = 0;
    for (const t of openTrades) {
      if (t.status === 'open') sum += mergedPnlMap.get(t.id) ?? 0;
    }
    return sum;
  }, [openTrades, mergedPnlMap]);

  // ── HFT FRONTEND FAILSAFE TRIGGER ──
  // Monitors the live (broker-preferred) PnL of every open position against
  // its fixed_profit (TP) and fixed_loss (SL) INR thresholds. When the
  // threshold is breached, the frontend immediately fires the
  // close-single-position edge function — no waiting for the 1-minute cron.
  // A per-position lock prevents duplicate close calls.
  const hftTriggeredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const pos of positions) {
      if (pos.status !== 'open') continue;
      if (hftTriggeredRef.current.has(pos.id)) continue;

      const trade = openTrades.find(t => t.coin === pos.symbol.replace('USDT', '') && t.status === 'open');
      if (!trade) continue;

      const livePnlInr = mergedPnlMap.get(trade.id) ?? 0;
      const tpFixed = Number(pos.fixed_profit ?? 0);
      const slFixed = Number(pos.fixed_loss ?? 0);

      let breached = false;
      if (tpFixed > 0 && livePnlInr >= tpFixed) breached = true;
      if (slFixed > 0 && livePnlInr <= -slFixed) breached = true;

      // ── Trailing SL price breach ──
      // The edge engine ratchets current_stop_loss in real-time (margin-based).
      // If the live price breaches that dynamic threshold, fire immediately.
      if (!breached && pos.trailing_enabled && pos.current_stop_loss && pos.current_stop_loss > 0) {
        const baseCoin = pos.symbol.replace('USDT', '');
        const liveCoin = liveCoins.find(c => c.symbol === baseCoin);
        if (liveCoin && liveCoin.price > 0) {
          if (pos.side === 'BUY' && liveCoin.price <= pos.current_stop_loss) breached = true;
          if (pos.side === 'SELL' && liveCoin.price >= pos.current_stop_loss) breached = true;
        }
      }

      if (breached) {
        hftTriggeredRef.current.add(pos.id);
        // Fire autonomously — the edge function places the real CoinDCX
        // reverse order and archives the position.
        (async () => {
          try {
            const { data: { session: currentSession } } = await supabase.auth.getSession();
            const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/close-single-position`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession?.access_token ?? ''}`,
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({ position_id: pos.id }),
            });
            const result = await resp.json();
            if (resp.ok && result.success) {
              setOpenTrades(prev => prev.filter(t => t.id !== trade.id));
              showToast(`HFT auto-close: ${trade.coin} TP/SL hit — P&L: ${formatInr(result.pnl ?? 0)}`);
            } else {
              // Release the lock so a future cycle can retry.
              hftTriggeredRef.current.delete(pos.id);
              const errMsg = result.error ?? result.detail ?? `HTTP ${resp.status}`;
              showToast(`HFT auto-close FAILED for ${trade.coin} — ${errMsg}`);
            }
          } catch {
            hftTriggeredRef.current.delete(pos.id);
            showToast(`HFT auto-close network error for ${trade.coin}`);
          }
        })();
      }
    }
  }, [positions, openTrades, mergedPnlMap, liveCoins, formatInr]);

  // Per-bot unrealized PnL, keyed strictly by bot_id using the open positions
  // from the cloud monitor (positions carry bot_id; trades do not).
  const unrealizedPnlByBot = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of positions) {
      if (p.status !== 'open' || !p.bot_id) continue;
      // DB unrealized_pnl includes leverage (calculatePnl multiplies by it).
      // Display PnL = price_diff * qty * 102 (no leverage), so divide it out.
      const lev = Number(p.leverage) || 1;
      map.set(p.bot_id, (map.get(p.bot_id) ?? 0) + (Number(p.unrealized_pnl ?? 0) / lev) * 102);
    }
    return map;
  }, [positions]);

  const realizedPnl = useMemo(() => {
    let sum = 0;
    for (const v of realizedPnlByBot.values()) sum += v;
    return sum;
  }, [realizedPnlByBot]);

  const activeCount = bots.filter(b => b.status === 'running').length;
  const openPositionsCount = openTrades.length;
  const totalPnl = realizedPnl + mergedTotalUnrealized;

  const sleepingBots = bots.filter(b => b.status === 'daily_limit');

  const aggregateDailyLimit = useMemo(() => {
    const limits = bots.filter(b => b.max_daily_loss || b.max_daily_profit || b.max_trades_per_day);
    const maxLoss = Math.max(...limits.map(b => b.max_daily_loss ?? 0), 0);
    const maxProfit = Math.max(...limits.map(b => b.max_daily_profit ?? 0), 0);
    const maxTrades = Math.max(...limits.map(b => b.max_trades_per_day ?? 0), 0);
    return { maxLoss, maxProfit, maxTrades };
  }, [bots]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // ── Square Off: call edge function, only remove from UI on strict success ──
  const handleSquareOff = async (tradeId: string, coin: string) => {
    if (!coin) {
      showToast('Square off failed: missing coin information');
      return;
    }
    const matchingPos = positions.find(p => p?.symbol && p.symbol.replace('USDT', '') === coin && p.status === 'open');
    const positionId = matchingPos?.id;
    setSquaringOffId(tradeId);

    // GHOST TRADE CLEARANCE (frontend): If the trade appears in openTrades but
    // has no matching open position row in the DB, it's a local ghost — the
    // backend has nothing to close. Remove it from the UI immediately instead
    // of showing a dead-end "no open position found" toast.
    if (!positionId) {
      setOpenTrades(prev => prev.filter(t => t.id !== tradeId));
      showToast(`${coin} position already closed — cleared from view.`);
      setSquaringOffId(null);
      return;
    }

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/close-single-position`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession?.access_token ?? ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ position_id: positionId }),
      });
      const result = await resp.json();
      if (resp.ok && result.success) {
        setOpenTrades(prev => prev.filter(t => t.id !== tradeId));
        showToast(`${coin} squared off — P&L: ${formatInr(result.pnl ?? 0)}`);
      } else {
        const errMsg = result.error ?? result.detail ?? `HTTP ${resp.status}`;
        showToast(`Square off FAILED — ${errMsg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'network error';
      showToast(`Square off FAILED — ${msg}`);
    } finally {
      setSquaringOffId(null);
    }
  };

  // ── Force Delete: hard-delete a stuck position row directly from the DB.
  // This is the failsafe for ghost trades that can't be squared off because of
  // network/API failures. It does NOT send a close order to the broker — it
  // only wipes the local database record so the UI is never blocked.
  const handleForceDeletePosition = async (tradeId: string, coin: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to forcefully delete this ${coin} position from the database? This will NOT close the trade on the broker.`
    );
    if (!confirmed) return;
    setForceDeletingId(tradeId);
    try {
      const matchingPos = positions.find(p => p?.symbol && p.symbol.replace('USDT', '') === coin && p.status === 'open');
      if (matchingPos) {
        const { error: posErr } = await supabase.from('positions').delete().eq('id', matchingPos.id);
        if (posErr) {
          showToast(`Force delete FAILED — ${posErr.message}`);
          return;
        }
      }
      const { error: tradeErr } = await supabase.from('trades').delete().eq('id', tradeId);
      if (tradeErr) {
        showToast(`Force delete FAILED — ${tradeErr.message}`);
        return;
      }
      setOpenTrades(prev => prev.filter(t => t.id !== tradeId));
      showToast(`${coin} position force-deleted from the database.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'network error';
      showToast(`Force delete FAILED — ${msg}`);
    } finally {
      setForceDeletingId(null);
    }
  };

  const handleTradeNow = async (botId: string, botName: string) => {
    setTradeNowId(botId);
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/execute-trade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession?.access_token ?? ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ botId, action: 'open' }),
      });
      const result = await resp.json();
      if (resp.ok && result.success) {
        showToast(`${botName}: Trade executed & position opened!`);
      } else {
        const rawError = result.dbInsertError ?? result.error ?? result.detail ?? (resp.ok ? 'Trade failed — no error returned' : `HTTP ${resp.status}`);
        if (rawError.startsWith('DAILY_LIMIT_REACHED')) {
          showToast(`SIGNAL REJECTED: ${rawError.replace('DAILY_LIMIT_REACHED: ', '')}`);
        } else {
          showToast(`${botName}: FAILED — ${rawError}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'network error';
      showToast(`${botName}: FAILED — ${msg}`);
    } finally {
      setTradeNowId(null);
    }
  };

  const updateStatus = async (id: string, status: Bot['status']) => {
    const prevBots = bots;
    setBots(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    const { error } = await supabase.from('bots').update({ status }).eq('id', id);
    if (error) {
      setBots(prevBots);
      showToast(`Failed to update bot status: ${error.message}`);
      return;
    }
    // When STOPPING a bot (status 'idle'), any live exchange position must be
    // force-closed BEFORE the bot goes idle — otherwise the position becomes
    // an orphaned ghost trade on the exchange with no bot managing it.
    if (status === 'idle') {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-panic-sell`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession?.access_token ?? ''}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ mode: 'user', bot_id: id }),
        });
      } catch {
        // non-fatal — the DB status update already succeeded
      }
    }
  };

  // ── Bulk selection helpers ──
  const allSelected = bots.length > 0 && bots.every(b => selectedIds.has(b.id));
  const someSelected = bots.some(b => selectedIds.has(b.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(bots.map(b => b.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Bulk actions ──
  const handleBulkStatus = async (status: Bot['status']) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkActioning(true);
    const prevBots = bots;
    setBots(prev => prev.map(b => selectedIds.has(b.id) ? { ...b, status } : b));
    const results = await Promise.allSettled(
      ids.map(id => supabase.from('bots').update({ status }).eq('id', id))
    );
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error)).length;
    if (failed > 0) {
      setBots(prevBots);
      showToast(`${failed} bot${failed !== 1 ? 's' : ''} failed to update — reverted`);
    } else {
      // When bulk-stopping bots, square off any live exchange positions first
      // so no orphaned ghost trades are left on the exchange.
      if (status === 'idle') {
        try {
          const { data: { session: currentSession } } = await supabase.auth.getSession();
          await Promise.allSettled(
            ids.map(id =>
              fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-panic-sell`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${currentSession?.access_token ?? ''}`,
                  'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({ mode: 'user', bot_id: id }),
              })
            )
          );
        } catch {
          // non-fatal — DB status already updated
        }
      }
      showToast(`${ids.length} bot${ids.length !== 1 ? 's' : ''} ${status === 'running' ? 'started' : status === 'paused' ? 'paused' : 'stopped'}`);
      setSelectedIds(new Set());
    }
    setBulkActioning(false);
  };

  const handleBulkClose = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkActioning(true);
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const results = await Promise.allSettled(
        ids.map(id =>
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-panic-sell`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentSession?.access_token ?? ''}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ mode: 'user', bot_id: id }),
          })
        )
      );
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.length - succeeded;
      showToast(`Bulk close: ${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ''}`);
      setBots(prev => prev.filter(b => !selectedIds.has(b.id)));
      setSelectedIds(new Set());
    } catch {
      showToast('Bulk close network error');
    } finally {
      setBulkActioning(false);
    }
  };

  // ── Hard Delete a single bot (and its open positions) ──
  // The bot's live exchange position MUST be squared off BEFORE the bot row
  // is deleted. The previous code only did a DB update on the positions
  // table, leaving the real exchange position running as an orphaned ghost
  // trade. We now call trigger-panic-sell (which sends a real reverse market
  // order to the exchange, archives to trade_history, and deletes the
  // position row) and only delete the bot after it confirms.
  const handleDeleteBot = async (botId: string) => {
    setDeletingBotId(botId);
    const userId = effectiveUserId ?? '';
    try {
      const bot = bots.find(b => b.id === botId);
      if (bot) {
        // Step 1: Force-close any live/paper position on the exchange.
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        const closeResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-panic-sell`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession?.access_token ?? ''}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ mode: 'user', bot_id: botId }),
        });
        const closeResult = await closeResp.json().catch(() => ({}));
        if (!closeResp.ok) {
          showToast(`Cannot delete bot: failed to close exchange position — ${closeResult.error ?? 'unknown error'}`);
          setDeletingBotId(null);
          setDeleteTarget(null);
          return;
        }
        // Step 2: Mirror the trades table status for any residual rows.
        const { error: tradeErr } = await supabase.from('trades').update({ status: 'closed_manual' })
          .eq('client_id', userId).eq('coin', bot.coin).eq('status', 'open');
        if (tradeErr) console.error('Delete bot: trades mirror update failed:', tradeErr.message);
      }
      // Step 3: Only now delete the bot row from the database.
      const { error: delErr } = await supabase.from('bots').delete().eq('id', botId);
      if (delErr) {
        showToast(`Failed to delete bot: ${delErr.message}`);
        setDeletingBotId(null);
        setDeleteTarget(null);
        return;
      }
      setBots(prev => prev.filter(b => b.id !== botId));
      setOpenTrades(prev => prev.filter(t => t.coin !== bot?.coin));
      setSelectedIds(prev => { const n = new Set(prev); n.delete(botId); return n; });
      showToast(`Bot deleted — exchange position squared off & PnL archived`);
    } catch {
      showToast('Failed to delete bot. Please try again.');
    } finally {
      setDeletingBotId(null);
      setDeleteTarget(null);
    }
  };

  // ── Bulk hard delete selected bots ──
  // Each bot's exchange position is squared off via trigger-panic-sell
  // BEFORE the bot row is deleted. No ghost trades left on the exchange.
  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkActioning(true);
    const userId = effectiveUserId ?? '';
    let failedCount = 0;
    const deletedIds: string[] = [];
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      for (const id of ids) {
        const bot = bots.find(b => b.id === id);
        if (bot) {
          // Step 1: square off the live exchange position first.
          try {
            const closeResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-panic-sell`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession?.access_token ?? ''}`,
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({ mode: 'user', bot_id: id }),
            });
            if (!closeResp.ok) {
              const closeResult = await closeResp.json().catch(() => ({}));
              console.error(`Bulk delete: exchange close failed for bot ${id}:`, closeResult.error ?? 'unknown');
              failedCount++;
              continue;
            }
          } catch (closeErr) {
            console.error(`Bulk delete: exchange close network error for bot ${id}:`, (closeErr as Error).message);
            failedCount++;
            continue;
          }
          // Step 2: mirror trades table status for residual rows.
          const { error: tradeErr } = await supabase.from('trades').update({ status: 'closed_manual' })
            .eq('client_id', userId).eq('coin', bot.coin).eq('status', 'open');
          if (tradeErr) console.error('Bulk delete: trades mirror update failed:', tradeErr.message);
        }
        // Step 3: delete the bot row.
        const { error: delErr } = await supabase.from('bots').delete().eq('id', id);
        if (delErr) {
          failedCount++;
        } else {
          deletedIds.push(id);
        }
      }
      if (deletedIds.length > 0) {
        const deletedSet = new Set(deletedIds);
        setBots(prev => prev.filter(b => !deletedSet.has(b.id)));
        setOpenTrades(prev => prev.filter(t => !deletedIds.some(id => t.coin === bots.find(b => b.id === id)?.coin)));
        setSelectedIds(new Set());
      }
      if (failedCount > 0) {
        showToast(`${deletedIds.length} deleted, ${failedCount} failed — exchange close may have failed`);
      } else {
        showToast(`${deletedIds.length} bot${deletedIds.length !== 1 ? 's' : ''} deleted — positions squared off on exchange`);
      }
    } catch {
      showToast('Some bots could not be deleted.');
    } finally {
      setBulkActioning(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5 animate-slide-up">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <SkeletonStat key={i} />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Admin impersonation indicator — only visible to the admin, not to the real user */}
      {impersonating && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-neon-amber/10 border border-neon-amber/30 animate-slide-up">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-neon-amber/15 border border-neon-amber/30 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-neon-amber" />
            </div>
            <div>
              <p className="text-sm font-bold text-neon-amber">Viewing as {impersonating.email}</p>
              <p className="text-xs text-slate-400">Admin oversight mode — all actions are logged to admin_activity_log</p>
            </div>
          </div>
          <button onClick={stopImpersonation} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.06] text-slate-200 border border-white/[0.1] hover:bg-white/[0.1] transition-all">
            <LogOut className="w-3.5 h-3.5" /> Exit
          </button>
        </div>
      )}

      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-neon-cyan" />
          Trading Status
        </h2>
        <p className="text-sm text-slate-400">Monitor all active and idle trading bots in real-time</p>
      </div>

      {/* Kill Switch Banner */}
      {killSwitch && (
        <div className="rounded-2xl bg-neon-red/10 border border-neon-red/30 p-4 flex items-center gap-3 animate-slide-up">
          <div className="w-10 h-10 rounded-xl bg-neon-red/15 border border-neon-red/30 flex items-center justify-center flex-shrink-0">
            <AlertOctagon className="w-5 h-5 text-neon-red" />
          </div>
          <div>
            <p className="text-sm font-bold text-neon-red">Platform Execution Paused by Master Admin</p>
            <p className="text-xs text-slate-400 mt-0.5">All bot start and launch operations are temporarily disabled. You can still pause or stop existing bots.</p>
          </div>
        </div>
      )}

      {/* Cloud Engine Status Bar */}
      {openPositionsCount > 0 && (
        <div className="glass-card p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-neon-green" />
            <span className="text-xs text-slate-400">
              Cloud engine monitoring {openPositionsCount} open position{openPositionsCount > 1 ? 's' : ''} autonomously (cron every 1 min)
            </span>
          </div>
          {lastUpdate && (
            <span className="text-[10px] text-slate-500">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Daily Limits Summary Card */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-neon-cyan" />
            Today's Activity (IST)
          </h3>
          {sleepingBots.length > 0 && (
            <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-neon-amber/10 text-neon-amber border border-neon-amber/30 flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-amber opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neon-amber" />
              </span>
              {sleepingBots.length} sleeping
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <DailyLimitStat
            label="Realized P&L"
            current={todayStats.realizedPnl}
            limit={aggregateDailyLimit.maxProfit}
            type="profit"
            formatInr={formatInr}
          />
          <DailyLimitStat
            label="Daily Loss Used"
            current={Math.min(todayStats.realizedPnl, 0)}
            limit={aggregateDailyLimit.maxLoss}
            type="loss"
            formatInr={formatInr}
          />
          <DailyLimitStat
            label="Trades Today"
            current={todayStats.tradeCount}
            limit={aggregateDailyLimit.maxTrades}
            type="trades"
          />
        </div>
        <p className="text-[10px] text-slate-500 mt-3">
          Resets automatically at midnight (IST). Limits shown are the highest configured across all your bots.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniStat label="Active Bots" value={`${activeCount}/${bots.length}`} icon={Zap} color="text-neon-green" />
        <MiniStat label="Total P&L" value={`${totalPnl > 0 ? '+' : ''}${formatInr(totalPnl)}`} icon={TrendingUp} color={totalPnl > 0 ? 'text-neon-green' : totalPnl < 0 ? 'text-neon-red' : 'text-slate-400'} />
        <MiniStat label="Open Positions" value={openPositionsCount.toString()} icon={Crosshair} color="text-neon-cyan" />
        <MiniStat label="Unrealized P&L" value={`${mergedTotalUnrealized > 0 ? '+' : ''}${formatInr(mergedTotalUnrealized)}`} icon={mergedTotalUnrealized >= 0 ? ArrowUp : ArrowDown} color={mergedTotalUnrealized > 0 ? 'text-neon-green' : mergedTotalUnrealized < 0 ? 'text-neon-red' : 'text-slate-400'} />
      </div>

      {/* Open Positions Panel */}
      {openPositionsCount > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-neon-cyan" />
            Live Open Positions
            <span className="text-[10px] text-slate-500 font-normal">(cloud cron · 1 min interval)</span>
          </h3>
          <div className="space-y-2">
            {openTrades.map((trade) => {
              const isLong = trade.direction === 'long';
              const pnl = mergedPnlMap.get(trade.id) ?? 0;
              const pnlPositive = pnl >= 0;
              const pos = positions.find(p => p?.symbol && p.symbol.replace('USDT', '') === trade.coin && p.status === 'open');
              const entry = Number(trade.entry_price);
              const lev = Number(trade.leverage) || 1;
              const qty = Number(trade.quantity) || 0;
              const PNL_USD_INR = 102;
              // CEO DIRECTIVE: Target/SL price derivation.
              // The DB stores two kinds of values:
              //   - Absolute price mode: take_profit_amount / current_stop_loss
              //     hold the actual target/SL PRICE (set by the trailing engine).
              //   - Fiat amount mode: fixed_profit / fixed_loss hold INR amounts;
              //     price = Entry +/- (FiatAmount / (qty * USD_INR)).
              //   - Percentage mode: take_profit_pct / stop_loss_pct hold a % of
              //     entry; price = Entry +/- (Entry * pct / (lev * 100)).
              // For SHORT positions the arithmetic is reversed:
              //   Target = Entry - distance, SL = Entry + distance.
              // A price is only shown when a real, distinct value exists —
              // otherwise the row is hidden entirely so the UI can never render
              // a Target and SL that are identical or equal to entry.
              let targetPrice: number | null = null;
              let stopLossPrice: number | null = null;
              if (entry > 0 && qty > 0) {
                if (pos?.take_profit_amount && pos.take_profit_amount > 0) {
                  targetPrice = Number(pos.take_profit_amount);
                } else if (pos?.fixed_profit && pos.fixed_profit > 0) {
                  const dist = Number(pos.fixed_profit) / (qty * PNL_USD_INR);
                  targetPrice = isLong ? entry + dist : entry - dist;
                } else if (pos?.take_profit_pct && pos.take_profit_pct > 0) {
                  const move = entry * (pos.take_profit_pct / (lev * 100));
                  targetPrice = isLong ? entry + move : entry - move;
                }
                if (pos?.current_stop_loss && pos.current_stop_loss > 0) {
                  stopLossPrice = Number(pos.current_stop_loss);
                } else if (pos?.fixed_loss && pos.fixed_loss > 0) {
                  const dist = Number(pos.fixed_loss) / (qty * PNL_USD_INR);
                  stopLossPrice = isLong ? entry - dist : entry + dist;
                } else if (pos?.stop_loss_pct && pos.stop_loss_pct > 0) {
                  const move = entry * (pos.stop_loss_pct / (lev * 100));
                  stopLossPrice = isLong ? entry - move : entry + move;
                }
              }
              // Hide the entire Target/SL row when the two computed prices
              // collapse to the same value — that means no distinct target/SL
              // was configured and showing them would mislead the user.
              const showTargetSl =
                (targetPrice !== null || stopLossPrice !== null) &&
                !(targetPrice !== null && stopLossPrice !== null &&
                  Math.abs(targetPrice - stopLossPrice) < 1e-8);
              const fmtPrice = (v: number) => v >= 1000 ? `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${v.toFixed(4)}`;
              return (
                <div key={trade.id} className="py-2.5 px-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold ${isLong ? 'bg-neon-green/10 text-neon-green border border-neon-green/20' : 'bg-neon-red/10 text-neon-red border border-neon-red/20'}`}>
                        {isLong ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white">{trade.coin}/USDT</p>
                          {pos?.trailing_enabled && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 font-bold">TRAILING</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {trade.executed_by} · {trade.leverage}x · Entry: {fmtPrice(entry)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className={`text-sm font-mono tabular-nums font-bold ${pnl > 0 ? 'text-neon-green' : pnl < 0 ? 'text-neon-red' : 'text-slate-400'}`}>
                          {pnl > 0 ? '+' : ''}{formatInr(pnl)}
                        </p>
                        <p className="text-[10px] text-slate-500">Qty: {Number(trade.quantity).toFixed(4)}</p>
                      </div>
                      <button
                        onClick={() => handleSquareOff(trade.id, trade.coin)}
                        disabled={squaringOffId === trade.id}
                        title="Manually exit this position now"
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-neon-red/15 text-neon-red border border-neon-red/40 hover:bg-neon-red/25 transition-all disabled:opacity-40 whitespace-nowrap"
                      >
                        {squaringOffId === trade.id ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /></>
                        ) : (
                          <><XCircle className="w-3 h-3" /> Square Off</>
                        )}
                      </button>
                      <button
                        onClick={() => handleForceDeletePosition(trade.id, trade.coin)}
                        disabled={forceDeletingId === trade.id}
                        title="Force-delete this stuck position from the database (does NOT close on the broker)"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:bg-neon-red/20 hover:text-neon-red hover:border-neon-red/40 transition-all disabled:opacity-40 whitespace-nowrap"
                      >
                        {forceDeletingId === trade.id ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /></>
                        ) : (
                          <><Trash2 className="w-3 h-3" /></>
                        )}
                      </button>
                    </div>
                  </div>
                  {showTargetSl && (
                    <div className="flex items-center gap-4 mt-2 pt-2 border-t border-white/[0.04] text-[10px] font-mono tabular-nums">
                      {stopLossPrice !== null && (
                        <span className="text-neon-red/80">
                          SL: {fmtPrice(stopLossPrice)}
                        </span>
                      )}
                      {targetPrice !== null && (
                        <span className="text-neon-green/80">
                          Target: {fmtPrice(targetPrice)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bot cards with bulk selection */}
      {bots.length === 0 ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center text-center">
          <BotIcon className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-sm font-semibold text-slate-300">No bots deployed yet</p>
          <p className="text-xs text-slate-500 mt-1">Head to the AI Smart Bot builder to create your first trading bot.</p>
        </div>
      ) : (
        <>
          {/* Bulk Action Bar */}
          {selectedIds.size > 0 && (
            <div className="sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-3 rounded-xl glass-card border border-neon-amber/20 animate-slide-up">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-neon-amber/15 border border-neon-amber/30 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 text-neon-amber" />
                </div>
                <span className="text-sm font-semibold text-white">
                  {selectedIds.size} bot{selectedIds.size !== 1 ? 's' : ''} selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedIds(new Set())} disabled={bulkActioning}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all disabled:opacity-40">
                  Clear
                </button>
                <button onClick={() => handleBulkStatus('running')} disabled={bulkActioning || killSwitch}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25 transition-all disabled:opacity-40 active:scale-[0.98]">
                  <Play className="w-3.5 h-3.5" /> Start
                </button>
                <button onClick={() => handleBulkStatus('paused')} disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-neon-amber/15 text-neon-amber border border-neon-amber/30 hover:bg-neon-amber/25 transition-all disabled:opacity-40 active:scale-[0.98]">
                  <Pause className="w-3.5 h-3.5" /> Pause
                </button>
                <button onClick={() => handleBulkStatus('idle')} disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/[0.06] text-slate-300 border border-white/[0.1] hover:bg-white/[0.1] transition-all disabled:opacity-40 active:scale-[0.98]">
                  <Square className="w-3.5 h-3.5" /> Stop
                </button>
                <button onClick={handleBulkClose} disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-neon-red/80 border border-neon-red hover:bg-neon-red transition-all disabled:opacity-50 active:scale-[0.98]">
                  {bulkActioning ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Closing...</> : <><XCircle className="w-3.5 h-3.5" /> Close</>}
                </button>
                <button onClick={handleBulkDelete} disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-neon-red/15 text-neon-red border border-neon-red/40 hover:bg-neon-red/25 transition-all disabled:opacity-50 active:scale-[0.98]">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          )}

          {/* Select All header */}
          <div className="flex items-center gap-3 px-1">
            <button onClick={toggleSelectAll} disabled={bulkActioning}
              title={allSelected ? 'Deselect all' : 'Select all'}
              className="text-slate-400 hover:text-neon-amber transition-colors disabled:opacity-40">
              {allSelected ? <CheckSquare className="w-5 h-5 text-neon-amber" /> : someSelected ? <CheckSquare className="w-5 h-5 text-neon-amber/50" /> : <UncheckSquare className="w-5 h-5" />}
            </button>
            <span className="text-xs text-slate-500">
              {allSelected ? 'All selected' : someSelected ? `${selectedIds.size} selected` : 'Select all bots'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bots.map((bot) => {
              const sc = statusConfig[bot.status] ?? statusConfig.idle;
              const isSelected = selectedIds.has(bot.id);
              const botRealized = realizedPnlByBot.get(bot.id) ?? 0;
              const botUnrealized = unrealizedPnlByBot.get(bot.id) ?? 0;
              const botTotalPnl = botRealized + botUnrealized;
              const individualDisabled = bulkActioning || selectedIds.size > 0;
              return (
                <div key={bot.id} className={`glass-card p-5 relative overflow-hidden transition-all ${bot.status === 'running' ? sc.border : ''} ${isSelected ? 'ring-1 ring-neon-amber/40' : ''}`}>
                  {bot.status === 'running' && <div className="absolute -top-10 -right-10 w-28 h-28 bg-neon-green/5 rounded-full blur-3xl" />}
                  <div className="relative">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        {/* Checkbox */}
                        <button onClick={() => toggleSelectOne(bot.id)} disabled={bulkActioning}
                          title={isSelected ? 'Deselect' : 'Select'}
                          className="text-slate-400 hover:text-neon-amber transition-colors disabled:opacity-40 flex-shrink-0">
                          {isSelected ? <CheckSquare className="w-5 h-5 text-neon-amber" /> : <UncheckSquare className="w-5 h-5" />}
                        </button>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-white">{bot.name}</h3>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{bot.coin}/USDT · {bot.market_type.toUpperCase()}</p>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold ${sc.bg} ${sc.color} ${sc.border} border flex items-center gap-1.5`}>
                        {bot.status === 'running' && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neon-green" />
                          </span>
                        )}
                        {sc.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-3 mb-4">
                      <BotStat label="Strategy" value={bot.strategy.charAt(0).toUpperCase() + bot.strategy.slice(1)} />
                      <BotStat label="P&L" value={`${botTotalPnl > 0 ? '+' : ''}${formatInr(botTotalPnl)}`} accent={botTotalPnl > 0 ? 'text-neon-green' : botTotalPnl < 0 ? 'text-neon-red' : 'text-slate-400'} />
                      <BotStat label="Market" value={bot.market_type.toUpperCase()} />
                      <BotStat label="Coin" value={bot.coin} />
                    </div>

                    {/* Controls */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateStatus(bot.id, 'running')}
                        disabled={individualDisabled || killSwitch || bot.status === 'running'}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                          bot.status === 'running'
                            ? 'glass text-slate-400 cursor-default'
                            : killSwitch
                            ? 'bg-white/[0.02] text-slate-600 border border-white/[0.04] cursor-not-allowed'
                            : 'bg-neon-green/10 text-neon-green border border-neon-green/30 hover:neon-glow-green'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5" /> Start
                      </button>
                      <button
                        onClick={() => handleTradeNow(bot.id, bot.name)}
                        disabled={individualDisabled || killSwitch || tradeNowId === bot.id || bot.status !== 'running'}
                        title="Execute an instant trade on this bot right now"
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 transition-all"
                      >
                        {tradeNowId === bot.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <><Zap className="w-3.5 h-3.5" /> Trade Now</>
                        )}
                      </button>
                      <button
                        onClick={() => updateStatus(bot.id, 'paused')}
                        disabled={individualDisabled}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${bot.status === 'paused' ? 'glass text-slate-400 cursor-default' : 'bg-neon-amber/10 text-neon-amber border border-neon-amber/30 hover:bg-neon-amber/20'}`}
                      >
                        <Pause className="w-3.5 h-3.5" /> Pause
                      </button>
                      <button
                        onClick={() => updateStatus(bot.id, 'idle')}
                        disabled={individualDisabled}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-neon-red/10 text-neon-red border border-neon-red/30 hover:bg-neon-red/20 transition-all"
                      >
                        <Square className="w-3.5 h-3.5" /> Stop
                      </button>
                      <button
                        onClick={() => setDeleteTarget(bot)}
                        disabled={individualDisabled || deletingBotId === bot.id}
                        title="Force Delete: close all positions on the exchange, then permanently delete this bot from the database"
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-neon-red/20 text-neon-red border border-neon-red/50 hover:bg-neon-red/40 transition-all active:scale-[0.98]"
                      >
                        {deletingBotId === bot.id ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting...</>
                        ) : (
                          <><AlertOctagon className="w-3.5 h-3.5" /> Force Delete</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Force Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-base-900/80 backdrop-blur-md" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-md animate-scale-in">
            <div className="glass-strong neon-glow-red p-6">
              <div className="flex items-center gap-2 mb-4">
                <AlertOctagon className="w-5 h-5 text-neon-red" />
                <h2 className="text-base font-bold text-white">Force Delete Bot?</h2>
              </div>
              <p className="text-sm text-slate-300 mb-2">
                This will <span className="font-bold text-neon-red">permanently wipe</span> <span className="font-bold text-white">{deleteTarget.name}</span> from the database.
              </p>
              <p className="text-xs text-slate-400 mb-2">
                First, any open exchange position for {deleteTarget.coin}/USDT will be closed at market price. Then the bot and its position records will be permanently deleted.
              </p>
              <p className="text-xs text-neon-red/80 mb-5">
                This action cannot be undone. The bot will never reappear on refresh.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 px-4 py-2.5 rounded-xl glass hover:bg-white/[0.07] text-sm text-slate-300 transition-all">
                  Cancel
                </button>
                <button onClick={() => handleDeleteBot(deleteTarget.id)} disabled={deletingBotId === deleteTarget.id}
                  className="flex-1 px-4 py-2.5 rounded-xl border font-bold text-sm transition-all active:scale-95 bg-neon-red/20 border-neon-red/50 text-neon-red hover:bg-neon-red/40 disabled:opacity-50">
                  {deletingBotId === deleteTarget.id ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Force Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl glass-card border border-white/[0.1] text-xs text-white font-medium shadow-xl animate-slide-up whitespace-nowrap z-[100]">
          {toast}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof Activity; color: string }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className={`text-lg font-bold font-mono tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function BotStat({ label, value, accent = 'text-slate-200' }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-xs font-bold font-mono tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

function DailyLimitStat({
  label,
  current,
  limit,
  type,
  formatInr,
}: {
  label: string;
  current: number;
  limit: number;
  type: 'profit' | 'loss' | 'trades';
  formatInr?: (v: number) => string;
}) {
  const limitActive = limit > 0;
  const usagePct = limitActive
    ? type === 'loss'
      ? Math.min((Math.abs(current) / limit) * 100, 100)
      : Math.min((current / limit) * 100, 100)
    : 0;
  const breached = limitActive && (
    (type === 'loss' && Math.abs(current) >= limit) ||
    (type === 'profit' && current >= limit) ||
    (type === 'trades' && current >= limit)
  );
  const displayValue = type === 'trades'
    ? `${current}${limitActive ? ` / ${limit}` : ''}`
    : `${current > 0 ? '+' : ''}${formatInr ? formatInr(current) : current}${limitActive ? ` / ${formatInr ? formatInr(limit) : limit}` : ''}`;
  const valueColor = breached
    ? 'text-neon-red'
    : type === 'profit'
    ? current > 0 ? 'text-neon-green' : 'text-slate-300'
    : type === 'loss'
    ? current < 0 ? 'text-neon-red' : 'text-slate-300'
    : 'text-neon-cyan';
  const barColor = breached ? 'bg-neon-red' : type === 'profit' ? 'bg-neon-green' : type === 'loss' ? 'bg-neon-amber' : 'bg-neon-cyan';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</span>
        {breached && <AlertOctagon className="w-3.5 h-3.5 text-neon-red" />}
      </div>
      <p className={`text-base font-bold font-mono tabular-nums ${valueColor}`}>{displayValue}</p>
      {limitActive && (
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${usagePct}%` }} />
        </div>
      )}
    </div>
  );
}
