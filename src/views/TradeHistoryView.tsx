import { useEffect, useState } from 'react';
import { History, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { supabase, type TradeHistory } from '@/lib/supabase';
import { SkeletonTable } from '@/components/Skeleton';

export default function TradeHistoryView() {
  const { formatInr } = useApp();
  const { session } = useAuth();
  const userId = session?.user?.id ?? '';
  const [trades, setTrades] = useState<TradeHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let mounted = true;

    const load = () => {
      supabase
        .from('trade_history')
        .select('*')
        .eq('user_id', userId)
        .not('status', 'in', '("open","pending")')
        .order('closed_at', { ascending: false, nullsFirst: false })
        .then(({ data }) => {
          if (!mounted) return;
          setTrades((data as TradeHistory[]) ?? []);
          setLoading(false);
        });
    };

    load();

    const channel = supabase
      .channel('trade-history-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_history', filter: `user_id=eq.${userId}` },
        (payload) => {
          const newTrade = payload.new as TradeHistory;
          if (newTrade.status === 'open' || newTrade.status === 'pending') return;
          setTrades((prev) => [newTrade, ...prev].slice(0, 200));
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="space-y-5 animate-slide-up">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="h-6 w-40 rounded bg-slate-800 animate-pulse mb-2" />
            <div className="h-4 w-64 rounded bg-slate-800/70 animate-pulse" />
          </div>
        </div>
        <SkeletonTable rows={6} />
      </div>
    );
  }

  const totalPnl = trades.reduce((sum, t) => sum + (t.realized_pnl ?? 0), 0);
  const winners = trades.filter((t) => (t.realized_pnl ?? 0) > 0).length;
  const winRate = trades.length > 0 ? (winners / trades.length) * 100 : 0;

  return (
    <div className="space-y-5 animate-slide-up">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-neon-cyan" />
            Trade History
          </h2>
          <p className="text-sm text-slate-400">Complete exchange-level log of all your closed positions</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="glass-card px-4 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Realized P&amp;L</div>
            <div className={`text-sm font-bold tabular-nums ${totalPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
              {formatInr(totalPnl)}
            </div>
          </div>
          <div className="glass-card px-4 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Win Rate</div>
            <div className="text-sm font-bold tabular-nums text-slate-200">{winRate.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center text-center">
          <History className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-sm font-semibold text-slate-300">No trades yet</p>
          <p className="text-xs text-slate-500 mt-1">Your closed positions will appear here with full exchange details once your bots start trading.</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="text-left py-3 px-4 font-semibold">Closed At</th>
                  <th className="text-left py-3 px-4 font-semibold">Asset</th>
                  <th className="text-center py-3 px-4 font-semibold">Side</th>
                  <th className="text-right py-3 px-4 font-semibold hidden sm:table-cell">Entry</th>
                  <th className="text-right py-3 px-4 font-semibold hidden sm:table-cell">Exit</th>
                  <th className="text-right py-3 px-4 font-semibold hidden md:table-cell">Margin</th>
                  <th className="text-center py-3 px-4 font-semibold hidden md:table-cell">Lev</th>
                  <th className="text-center py-3 px-4 font-semibold">Status</th>
                  <th className="text-right py-3 px-4 font-semibold">Realized P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const realized = t.realized_pnl ?? 0;
                  const coin = t.coin ?? t.pair.replace('USDT', '');
                  const statusLabel = (t.status ?? 'closed').replace('_', ' ');
                  const statusColor =
                    t.status === 'closed_tp' ? 'text-neon-green' :
                    t.status === 'closed_sl' ? 'text-neon-red' : 'text-slate-400';
                  return (
                    <tr key={t.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 text-xs text-slate-500 font-mono">
                        {(t.closed_at ?? t.timestamp)
                          ? new Date(t.closed_at ?? t.timestamp).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })
                          : '—'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-white">{coin}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold ${t.side === 'BUY' ? 'text-neon-green bg-neon-green/10' : 'text-neon-red bg-neon-red/10'}`}>
                          {t.side === 'BUY' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {t.side === 'BUY' ? 'LONG' : 'SHORT'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300 hidden sm:table-cell">
                        {t.entry_price != null ? formatInr(t.entry_price) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300 hidden sm:table-cell">
                        {t.exit_price != null ? formatInr(t.exit_price) : formatInr(t.price)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-400 hidden md:table-cell">
                        {(() => {
                          if (t.margin_used == null) return '—';
                          // Legacy rows stored margin in USDT (e.g. 0.98) instead
                          // of INR. Detect: if the raw value is suspiciously small
                          // relative to the position notional, convert via 102.
                          const raw = t.margin_used;
                          const notional = t.entry_price != null && t.leverage != null && t.leverage > 0
                            ? (t.amount ?? 0) * t.entry_price
                            : 0;
                          const expectedMarginInr = notional > 0 ? notional / (t.leverage ?? 1) : 0;
                          // If stored value is < 5% of expected INR margin, it's USDT.
                          const displayMargin = expectedMarginInr > 0 && raw < expectedMarginInr * 0.05
                            ? raw * 102
                            : raw;
                          return formatInr(displayMargin);
                        })()}
                      </td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums text-slate-400 hidden md:table-cell">
                        {t.leverage != null ? `${t.leverage}x` : '—'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-[10px] font-bold capitalize ${statusColor}`}>{statusLabel}</span>
                      </td>
                      <td className={`py-3 px-4 text-right font-mono tabular-nums font-bold ${realized >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                        {formatInr(realized)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
