import { useState, useEffect, useCallback } from 'react';
import { Wallet, TrendingUp, ArrowDownLeft, ArrowUpRight, Calculator, PieChart, Loader2, Link2, Info, RefreshCw, AlertCircle } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { supabase, type UserFund, type BrokerKey } from '@/lib/supabase';
import { SkeletonStat } from '@/components/Skeleton';

export default function WalletView() {
  const { formatInr, formatPrice } = useApp();
  const { user } = useAuth();
  const [funds, setFunds] = useState<UserFund[]>([]);
  const [brokerKeys, setBrokerKeys] = useState<BrokerKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [entryPrice, setEntryPrice] = useState(0);
  const [stopPrice, setStopPrice] = useState(0);
  const [riskAmount, setRiskAmount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);

  const loadFunds = useCallback(() => {
    if (!user?.id) return;
    Promise.all([
      supabase
        .from('user_funds')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .throwOnError(),
      supabase
        .from('broker_keys')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_connected', true)
        .order('created_at', { ascending: false })
        .throwOnError(),
    ]).then(([fundsResult, brokerResult]) => {
      setFunds((fundsResult.data as UserFund[]) ?? []);
      setBrokerKeys((brokerResult.data as BrokerKey[]) ?? []);
      setLoading(false);
    });
  }, [user?.id]);

  useEffect(() => {
    loadFunds();
  }, [loadFunds]);

  // Auto-sync balance from the connected exchange on mount if a broker is connected.
  // Surfaces a visible error if the API key lacks the required read permissions.
  const handleSync = useCallback(async () => {
    if (!user?.id || brokerKeys.length === 0) return;
    setSyncing(true);
    setSyncError(null);
    setSyncSuccess(null);
    try {
      const { data, error } = await supabase.functions.invoke('sync-wallet', {
        method: 'POST',
        body: {},
      });

      const json = data as { balance?: number; account_type?: string; source?: 'futures' | 'spot'; error?: string } | null;
      if (error || json?.error) {
        let detail = json?.error ?? error?.message ?? 'Failed to sync balance. Please try again.';
        const response = (error as { context?: Response } | null)?.context;
        if (response instanceof Response) {
          const errorBody = await response.clone().json().catch(() => null) as { error?: string } | null;
          detail = errorBody?.error ?? detail;
        }
        setSyncError(detail);
      } else if (typeof json?.balance !== 'number') {
        setSyncError('The exchange returned an invalid balance response. Please try again.');
      } else {
        const sourceLabel = json.source === 'spot' ? 'Spot Wallet' : 'Futures Wallet (INR)';
        setSyncSuccess(`Synced ${formatInr(json.balance)} from ${sourceLabel}.`);
        // Re-fetch from DB to get the authoritative state after sync.
        // This avoids stale local-state ghost rows from case-sensitivity mismatches.
        loadFunds();
      }
    } catch (err) {
      setSyncError(`Sync failed: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
      // Auto-clear success after a few seconds.
      setTimeout(() => setSyncSuccess(null), 4000);
    }
  }, [formatInr, user?.id, brokerKeys]);

  useEffect(() => {
    if (brokerKeys.length > 0) {
      handleSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerKeys.length]);

  const exchangeFunds = funds.filter((f) => f.exchange_name.toLowerCase() !== 'manual' && f.balance > 0);
  const totalBalance = exchangeFunds.reduce((s, f) => s + f.balance, 0);
  const totalUnrealizedPnl = exchangeFunds.reduce((s, f) => s + f.unrealized_pnl, 0);
  const totalRealizedPnl = exchangeFunds.reduce((s, f) => s + f.realized_pnl, 0);
  const totalPnl = totalUnrealizedPnl + totalRealizedPnl;
  const hasConnectedBroker = brokerKeys.length > 0;
  const primaryExchange = brokerKeys[0]?.exchange_name ?? '';

  // Position size calculator
  const riskPerUnit = entryPrice - stopPrice;
  const positionSize = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;
  const positionValue = positionSize * entryPrice;

  if (loading) {
    return (
      <div className="space-y-5 animate-slide-up">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2"><SkeletonStat /></div>
          <SkeletonStat />
        </div>
        <SkeletonStat />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-slide-up">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-neon-green/10 border border-neon-green/30 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-neon-green" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Wallet Overview</h2>
          <p className="text-sm text-slate-400">Read-only mirror of your connected exchange balance</p>
        </div>
      </div>

      {/* Synced badge or connect CTA */}
      {hasConnectedBroker ? (
        <div className="glass-card p-4 flex items-center gap-3 border border-neon-green/20">
          <div className="w-8 h-8 rounded-lg bg-neon-green/10 border border-neon-green/20 flex items-center justify-center flex-shrink-0">
            <RefreshCw className={`w-4 h-4 text-neon-green ${syncing ? 'animate-spin' : ''}`} />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-white">Synced with {primaryExchange}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Balance data is read-only and synced from your connected exchange API. Futures wallet is queried first.</p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25 disabled:opacity-50 text-xs font-bold transition-all whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      ) : (
        <div className="glass-card p-4 flex items-center gap-3 border border-neon-amber/20">
          <div className="w-8 h-8 rounded-lg bg-neon-amber/10 border border-neon-amber/20 flex items-center justify-center flex-shrink-0">
            <Link2 className="w-4 h-4 text-neon-amber" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-white">No Exchange Connected</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Connect your exchange API keys to sync and view your balance.</p>
          </div>
          <button
            onClick={() => { const event = new CustomEvent('navigate', { detail: 'connect-broker' }); window.dispatchEvent(event); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25 text-xs font-bold transition-all whitespace-nowrap"
          >
            <Link2 className="w-3.5 h-3.5" /> Connect Exchange API
          </button>
        </div>
      )}

      {/* Sync status toast (error or success) */}
      {syncError && (
        <div className="glass-card p-4 flex items-start gap-3 border border-neon-red/30 animate-slide-up">
          <div className="w-8 h-8 rounded-lg bg-neon-red/10 border border-neon-red/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <AlertCircle className="w-4 h-4 text-neon-red" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-neon-red">Failed to sync {primaryExchange} balance</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{syncError}</p>
          </div>
          <button onClick={() => setSyncError(null)} className="text-slate-500 hover:text-white transition-colors text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}
      {syncSuccess && (
        <div className="glass-card p-4 flex items-center gap-3 border border-neon-green/30 animate-slide-up">
          <div className="w-8 h-8 rounded-lg bg-neon-green/10 border border-neon-green/20 flex items-center justify-center flex-shrink-0">
            <RefreshCw className="w-4 h-4 text-neon-green" />
          </div>
          <p className="text-xs font-bold text-neon-green">{syncSuccess}</p>
        </div>
      )}

      {/* Non-custodial notice */}
      <div className="glass-card p-4 flex items-start gap-3 border border-neon-cyan/20">
        <div className="w-8 h-8 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Info className="w-4 h-4 text-neon-cyan" />
        </div>
        <div>
          <p className="text-xs font-bold text-white">Non-Custodial Wallet</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Cortex AI does NOT hold your funds. This balance is read directly from your connected exchange via API keys. Your assets remain on the exchange at all times.</p>
        </div>
      </div>

      {/* Portfolio overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white">
              {hasConnectedBroker ? `Connected Exchange Balance (${primaryExchange})` : 'Exchange Balance'}
            </h3>
            <PieChart className="w-4 h-4 text-neon-cyan" />
          </div>

          {hasConnectedBroker ? (
            <>
              <p className="text-3xl font-bold text-white font-mono tabular-nums">{formatInr(totalBalance)}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-sm font-semibold tabular-nums ${totalPnl > 0 ? 'text-neon-green' : totalPnl < 0 ? 'text-neon-red' : 'text-slate-400'}`}>
                  {totalPnl > 0 ? '+' : ''}{formatInr(totalPnl)}
                </span>
                <span className="text-xs text-slate-500">all-time P&L</span>
              </div>

              {/* Allocation bars */}
              {exchangeFunds.length > 0 ? (
                <div className="mt-5 space-y-3">
                  {exchangeFunds.map((f) => {
                    const pct = totalBalance > 0 ? (f.balance / totalBalance) * 100 : 0;
                    return (
                      <div key={f.id}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-300 font-semibold">{f.exchange_name}</span>
                          <span className="text-slate-400 font-mono tabular-nums">{formatInr(f.balance)} · {pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-base-700 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-neon-cyan/60 to-neon-green/60 transition-all duration-1000"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-5 text-center py-8">
                  <Wallet className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                  <p className="text-sm text-slate-500">No balance data synced yet from {primaryExchange}.</p>
                  <p className="text-xs text-slate-600 mt-1 mb-3">Your exchange futures balance will appear here once the sync engine runs.</p>
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25 disabled:opacity-50 text-xs font-bold transition-all"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? 'Syncing...' : 'Sync Now'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="mt-5 relative">
              <div className="text-center py-10 blur-[2px] opacity-50 select-none">
                <p className="text-3xl font-bold text-slate-600 font-mono tabular-nums mb-2">$0.00</p>
                <p className="text-sm text-slate-600">No balance data available.</p>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <button
                  onClick={() => { const event = new CustomEvent('navigate', { detail: 'connect-broker' }); window.dispatchEvent(event); }}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25 text-sm font-bold transition-all"
                >
                  <Link2 className="w-4 h-4" /> Connect Exchange API to View Balance
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick stats */}
        <div className="space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Available Balance</span>
              <Wallet className="w-4 h-4 text-neon-green" />
            </div>
            <p className="text-xl font-bold text-white font-mono tabular-nums">{hasConnectedBroker ? formatInr(totalBalance) : formatInr(0)}</p>
            <p className="text-[10px] text-neon-green mt-0.5">{brokerKeys.length} exchange{brokerKeys.length !== 1 ? 's' : ''} connected</p>
          </div>
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Total P&L</span>
              <TrendingUp className={`w-4 h-4 ${totalPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}`} />
            </div>
            <p className={`text-xl font-bold font-mono tabular-nums ${totalPnl > 0 ? 'text-neon-green' : totalPnl < 0 ? 'text-neon-red' : 'text-slate-400'}`}>
              {hasConnectedBroker ? `${totalPnl > 0 ? '+' : ''}${formatInr(totalPnl)}` : formatInr(0)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Unrealized: {formatInr(totalUnrealizedPnl)} · Realized: {formatInr(totalRealizedPnl)}
            </p>
          </div>
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-slate-500 text-xs font-bold">
                <ArrowDownLeft className="w-4 h-4" /> Read-Only
              </div>
              <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-slate-500 text-xs font-bold">
                <ArrowUpRight className="w-4 h-4" /> Read-Only
              </div>
            </div>
            <p className="text-[10px] text-slate-500 text-center">Funds are managed directly on your exchange. Deposits and withdrawals happen there, not here.</p>
          </div>
        </div>
      </div>

      {/* Position Size Calculator */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-neon-amber" />
          Position Size Calculator
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <CalcInput label="Entry Price" value={formatPrice(entryPrice)} onChange={v => setEntryPrice(v)} />
          <CalcInput label="Stop Loss Price" value={formatPrice(stopPrice)} onChange={v => setStopPrice(v)} />
          <CalcInput label={`Risk Amount (₹)`} value={formatInr(riskAmount)} onChange={v => setRiskAmount(v)} />
          <CalcInput label="Risk Per Unit" value={formatPrice(riskPerUnit)} readOnly />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-neon-cyan/5 border border-neon-cyan/15">
            <p className="text-[10px] text-slate-500 uppercase mb-1">Position Size</p>
            <p className="text-lg font-bold text-neon-cyan font-mono">{positionSize.toFixed(6)} units</p>
          </div>
          <div className="p-4 rounded-xl bg-neon-green/5 border border-neon-green/15">
            <p className="text-[10px] text-slate-500 uppercase mb-1">Position Value</p>
            <p className="text-lg font-bold text-neon-green font-mono">{formatInr(positionValue)}</p>
          </div>
        </div>
      </div>

      {/* Funds table */}
      {hasConnectedBroker && exchangeFunds.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06]">
            <h3 className="text-sm font-bold text-white">Exchange Funds (Synced)</h3>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04] text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="text-left py-2.5 px-5 font-semibold">Exchange</th>
                  <th className="text-right py-2.5 px-5 font-semibold">Balance</th>
                  <th className="text-right py-2.5 px-5 font-semibold">Unrealized P&L</th>
                  <th className="text-right py-2.5 px-5 font-semibold hidden sm:table-cell">Realized P&L</th>
                  <th className="text-right py-2.5 px-5 font-semibold hidden sm:table-cell">Last Synced</th>
                </tr>
              </thead>
              <tbody>
                {exchangeFunds.map((f) => (
                  <tr key={f.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-5 font-semibold text-white">{f.exchange_name}</td>
                    <td className="py-3 px-5 text-right font-mono tabular-nums text-slate-200">{formatInr(f.balance)}</td>
                    <td className={`py-3 px-5 text-right font-mono tabular-nums ${f.unrealized_pnl > 0 ? 'text-neon-green' : f.unrealized_pnl < 0 ? 'text-neon-red' : 'text-slate-400'}`}>
                      {f.unrealized_pnl > 0 ? '+' : ''}{formatInr(f.unrealized_pnl)}
                    </td>
                    <td className={`py-3 px-5 text-right font-mono tabular-nums hidden sm:table-cell ${f.realized_pnl > 0 ? 'text-neon-green' : f.realized_pnl < 0 ? 'text-neon-red' : 'text-slate-400'}`}>
                      {f.realized_pnl > 0 ? '+' : ''}{formatInr(f.realized_pnl)}
                    </td>
                    <td className="py-3 px-5 text-right text-xs text-slate-500 font-mono hidden sm:table-cell">
                      {f.last_synced_at ? new Date(f.last_synced_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : 'Pending'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CalcInput({ label, value, onChange, readOnly }: { label: string; value: string; onChange?: (v: number) => void; readOnly?: boolean }) {
  const isNumeric = onChange !== undefined;
  return (
    <div className="p-3 rounded-xl glass">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      {readOnly || !isNumeric ? (
        <p className="text-sm font-bold text-white font-mono">{value}</p>
      ) : (
        <input
          type="number"
          value={parseFloat(value.replace(/[^0-9.-]/g, '')) || 0}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full bg-transparent text-sm font-bold text-white font-mono focus:outline-none"
        />
      )}
    </div>
  );
}
