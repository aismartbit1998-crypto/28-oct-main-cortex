import { useEffect, useState, useCallback } from 'react';
import { X, Bot, Loader2, Pause, Square, XCircle, Search, CheckSquare, Square as UncheckSquare, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface RunningBot {
  id: string;
  name: string;
  strategy: string;
  bot_type: string | null;
  coin: string;
  market_type: string;
  status: string;
  user_id: string;
  is_paper_mode: boolean | null;
  userEmail: string;
  unrealizedPnl: number;
  openPositions: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function GlobalRunningBotsModal({ open, onClose }: Props) {
  const [bots, setBots] = useState<RunningBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTerminating, setBulkTerminating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [botsRes, profilesRes, positionsRes] = await Promise.all([
      supabase.from('bots').select('id, name, strategy, bot_type, coin, market_type, status, user_id, is_paper_mode').in('status', ['running', 'paper']),
      supabase.from('profiles').select('id, email'),
      supabase.from('positions').select('id, bot_id, status, close_pnl, entry_price, quantity, leverage, side').eq('status', 'open'),
    ]);
    if (botsRes.error) console.error('Failed to fetch running bots:', botsRes.error.message);
    if (profilesRes.error) console.error('Failed to fetch profiles:', profilesRes.error.message);
    if (positionsRes.error) console.error('Failed to fetch positions:', positionsRes.error.message);
    const botsData = botsRes.data;
    const profilesData = profilesRes.data;
    const positionsData = positionsRes.data;

    const profileMap = new Map<string, string>();
    for (const p of (profilesData as { id: string; email: string }[]) ?? []) {
      profileMap.set(p.id, p.email);
    }

    const positionMap = new Map<string, { count: number; pnl: number }>();
    for (const pos of (positionsData as { bot_id: string | null; status: string; close_pnl: number | null }[]) ?? []) {
      if (!pos.bot_id) continue;
      const existing = positionMap.get(pos.bot_id) ?? { count: 0, pnl: 0 };
      existing.count++;
      positionMap.set(pos.bot_id, existing);
    }

    const mapped: RunningBot[] = ((botsData as Record<string, unknown>[]) ?? []).map((b) => {
      const botId = b.id as string;
      const posInfo = positionMap.get(botId) ?? { count: 0, pnl: 0 };
      return {
        id: botId,
        name: (b.name as string) ?? 'Unnamed',
        strategy: (b.strategy as string) ?? 'ai',
        bot_type: (b.bot_type as string | null) ?? null,
        coin: (b.coin as string) ?? 'Unknown',
        market_type: (b.market_type as string) ?? 'spot',
        status: (b.status as string) ?? 'running',
        user_id: (b.user_id as string) ?? '',
        is_paper_mode: (b.is_paper_mode as boolean | null) ?? false,
        userEmail: profileMap.get(b.user_id as string) ?? 'Unknown user',
        unrealizedPnl: posInfo.pnl,
        openPositions: posInfo.count,
      };
    });

    setBots(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  // Realtime: listen for bot status changes while modal is open
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel('admin_running_bots_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bots' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, fetchData]);

  const handleAction = async (botId: string, action: 'pause' | 'stop' | 'close') => {
    setActioningId(botId);
    try {
      if (action === 'close') {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-panic-sell`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token ?? ''}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ mode: 'admin', bot_id: botId }),
        });
        const result = await resp.json();
        if (!resp.ok) {
          setToast(`Close failed: ${result.error ?? 'Unknown error'}`);
        } else {
          setToast(`Bot closed — ${result.positionsClosed ?? 0} positions liquidated`);
        }
      } else {
        const newStatus = action === 'pause' ? 'paused' : 'idle';
        const { error } = await supabase.from('bots').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', botId);
        if (error) {
          setToast(`Failed to ${action} bot: ${error.message}`);
        } else {
          setToast(`Bot ${action === 'pause' ? 'paused' : 'stopped'}`);
        }
      }
      fetchData();
    } catch {
      setToast(`Network error during ${action}`);
    } finally {
      setActioningId(null);
      setTimeout(() => setToast(null), 3500);
    }
  };

  const filtered = bots.filter(b => {
    const q = search.toLowerCase();
    return b.name.toLowerCase().includes(q) || b.userEmail.toLowerCase().includes(q) || b.coin.toLowerCase().includes(q);
  });

  const allVisibleSelected = filtered.length > 0 && filtered.every(b => selectedIds.has(b.id));
  const someVisibleSelected = filtered.some(b => selectedIds.has(b.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const b of filtered) next.delete(b.id);
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const b of filtered) next.add(b.id);
        return next;
      });
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

  const handleBulkTerminate = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkTerminating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const results = await Promise.allSettled(
        ids.map(id =>
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-panic-sell`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token ?? ''}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ mode: 'admin', bot_id: id }),
          })
        )
      );
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.length - succeeded;
      setToast(`Bulk terminate: ${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ''}`);
      setSelectedIds(new Set());
      fetchData();
    } catch {
      setToast('Bulk terminate network error');
    } finally {
      setBulkTerminating(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-base-900/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[85vh] glass-card flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-neon-amber/10 border border-neon-amber/30 flex items-center justify-center">
              <Bot className="w-5 h-5 text-neon-amber" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Global Running Bots</h2>
              <p className="text-xs text-slate-500">{bots.length} active bot{bots.length !== 1 ? 's' : ''} across all clients</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/[0.06]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search + Bulk Action Bar */}
        <div className="px-5 py-3 border-b border-white/[0.04] space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by bot name, client email, or coin..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-neon-amber/40 transition-colors"
            />
          </div>

          {/* Bulk Action Bar — appears when bots are selected */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-neon-red/[0.06] border border-neon-red/20 animate-slide-up">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-neon-red/15 border border-neon-red/30 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 text-neon-red" />
                </div>
                <span className="text-sm font-semibold text-white">
                  {selectedIds.size} bot{selectedIds.size !== 1 ? 's' : ''} selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedIds(new Set())}
                  disabled={bulkTerminating}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all disabled:opacity-40"
                >
                  Clear
                </button>
                <button
                  onClick={handleBulkTerminate}
                  disabled={bulkTerminating}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-neon-red/80 border border-neon-red hover:bg-neon-red transition-all disabled:opacity-50 active:scale-[0.98]"
                >
                  {bulkTerminating ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Terminating...</>
                  ) : (
                    <><XCircle className="w-3.5 h-3.5" /> Terminate Selected</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-neon-amber animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Bot className="w-10 h-10 text-slate-600 mb-3" />
              <p className="text-sm text-slate-400">{search ? 'No bots match your search' : 'No running bots found'}</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {/* Column headers with Select All checkbox */}
              <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-2.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase bg-white/[0.02] sticky top-0 z-10 items-center">
                <div className="col-span-1 flex items-center">
                  <button
                    onClick={toggleSelectAll}
                    title={allVisibleSelected ? 'Deselect all' : 'Select all visible'}
                    className="text-slate-400 hover:text-neon-amber transition-colors"
                  >
                    {allVisibleSelected ? (
                      <CheckSquare className="w-4 h-4 text-neon-amber" />
                    ) : someVisibleSelected ? (
                      <CheckSquare className="w-4 h-4 text-neon-amber/50" />
                    ) : (
                      <UncheckSquare className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="col-span-3">Bot</div>
                <div className="col-span-3">Client</div>
                <div className="col-span-2">Positions</div>
                <div className="col-span-3 text-right">Actions</div>
              </div>
              {filtered.map((bot) => {
                const isSelected = selectedIds.has(bot.id);
                return (
                  <div
                    key={bot.id}
                    className={`grid grid-cols-12 gap-3 px-5 py-3.5 items-center transition-colors ${isSelected ? 'bg-neon-red/[0.04]' : 'hover:bg-white/[0.02]'}`}
                  >
                    {/* Checkbox */}
                    <div className="col-span-1 flex items-center">
                      <button
                        onClick={() => toggleSelectOne(bot.id)}
                        disabled={bulkTerminating}
                        title={isSelected ? 'Deselect' : 'Select'}
                        className="text-slate-400 hover:text-neon-amber transition-colors disabled:opacity-40"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-neon-amber" />
                        ) : (
                          <UncheckSquare className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {/* Bot info */}
                    <div className="col-span-11 sm:col-span-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center text-[10px] font-bold text-slate-300 flex-shrink-0">
                          {bot.coin.slice(0, 3).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{bot.name}</p>
                          <p className="text-[10px] text-slate-500 capitalize">{bot.strategy} · {bot.market_type}{bot.is_paper_mode ? ' · PAPER' : ''}</p>
                        </div>
                      </div>
                    </div>
                    {/* Client */}
                    <div className="col-span-6 sm:col-span-3">
                      <p className="text-sm text-slate-200 truncate">{bot.userEmail.split('@')[0]}</p>
                      <p className="text-[10px] text-slate-500 truncate">{bot.userEmail}</p>
                    </div>
                    {/* Positions */}
                    <div className="col-span-6 sm:col-span-2">
                      {bot.openPositions > 0 ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-neon-cyan/10 text-neon-cyan text-[10px] font-bold border border-neon-cyan/20">
                          {bot.openPositions} open
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">No open positions</span>
                      )}
                    </div>
                    {/* Actions */}
                    <div className="col-span-12 sm:col-span-3 flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleAction(bot.id, 'pause')}
                        disabled={actioningId === bot.id || bulkTerminating}
                        title="Pause bot"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-neon-amber/10 text-neon-amber border border-neon-amber/25 hover:bg-neon-amber/20 transition-all disabled:opacity-40"
                      >
                        <Pause className="w-3 h-3" /> Pause
                      </button>
                      <button
                        onClick={() => handleAction(bot.id, 'stop')}
                        disabled={actioningId === bot.id || bulkTerminating}
                        title="Stop bot"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:bg-white/[0.08] transition-all disabled:opacity-40"
                      >
                        <Square className="w-3 h-3" /> Stop
                      </button>
                      <button
                        onClick={() => handleAction(bot.id, 'close')}
                        disabled={actioningId === bot.id || bulkTerminating}
                        title="Force close all positions and deactivate bot"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-neon-red/15 text-neon-red border border-neon-red/40 hover:bg-neon-red/25 transition-all disabled:opacity-40"
                      >
                        {actioningId === bot.id ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Working...</>
                        ) : (
                          <><XCircle className="w-3 h-3" /> Close</>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl glass-card border border-white/[0.1] text-xs text-white font-medium shadow-xl animate-slide-up whitespace-nowrap">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
