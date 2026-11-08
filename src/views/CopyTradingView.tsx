import { useState, useEffect } from 'react';
import {
  Copy, Search, TrendingUp, Users, Shield, Zap, Crown, Sparkles,
  Check, Award, Flame, Activity, Layers, ChevronDown, Loader2,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { supabase, type MasterTrader } from '@/lib/supabase';

const riskConfig = {
  Low: { color: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/20' },
  Medium: { color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20' },
  High: { color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20' },
};

type SortKey = 'roi' | 'copiers' | 'winRate';

export default function CopyTradingView() {
  const { formatCompact } = useApp();
  const [traders, setTraders] = useState<MasterTrader[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('roi');
  const [copied, setCopied] = useState<Set<string>>(new Set());
  const [sortOpen, setSortOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const { session } = useAuth();

  useEffect(() => {
    supabase
      .from('master_traders')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setTraders((data as MasterTrader[]) ?? []);
        setLoading(false);
      });

    // Load existing copy relationships for this user
    if (session?.user?.id) {
      supabase
        .from('copy_relationships')
        .select('trader_id')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .then(({ data }) => {
          if (data) setCopied(new Set(data.map((r: { trader_id: string }) => r.trader_id)));
        });
    }
  }, [session]);

  const sortLabels: Record<SortKey, string> = {
    roi: 'Monthly Return',
    copiers: 'Total Copiers',
    winRate: 'Win Rate',
  };

  const filtered = [...traders]
    .filter(t => {
      const matchesSearch = t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.strategy ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (t.exchange ?? '').toLowerCase().includes(search.toLowerCase());
      const matchesRisk = riskFilter === 'all' || t.risk_level.toLowerCase() === riskFilter;
      return matchesSearch && matchesRisk;
    })
    .sort((a, b) => {
      if (sortKey === 'roi') return Number(b.roi_percentage) - Number(a.roi_percentage);
      if (sortKey === 'copiers') return b.active_copiers - a.active_copiers;
      return Number(b.win_rate) - Number(a.win_rate);
    });

  const handleCopy = async (id: string) => {
    if (!session?.user?.id) return;
    setCopying(true);
    const { error } = await supabase.from('copy_relationships').upsert({
      user_id: session.user.id,
      trader_id: id,
      status: 'active',
    }, { onConflict: 'user_id,trader_id' });
    setCopying(false);
    if (error) {
      console.error('Copy failed:', error.message);
      return;
    }
    setCopied(prev => new Set(prev).add(id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  const totalCopiers = traders.reduce((s, t) => s + t.active_copiers, 0);
  const avgRoi = traders.length > 0 ? traders.reduce((s, t) => s + Number(t.roi_percentage), 0) / traders.length : 0;
  const topRoi = traders.length > 0 ? Math.max(...traders.map(t => Number(t.roi_percentage))) : 0;

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Copy className="w-5 h-5 text-neon-cyan" />
            Copy Trading Marketplace
          </h2>
          <p className="text-sm text-slate-400">Copy strategies from top-performing master traders verified by Cortex AI</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neon-green/5 border border-neon-green/15">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-neon-green" />
          </span>
          <span className="text-xs font-semibold text-neon-green">{totalCopiers.toLocaleString()} active copiers</span>
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-cyan/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Master Traders</p>
            <p className="text-xl font-bold text-white font-mono mt-1">{traders.length}</p>
            <p className="text-[10px] text-neon-cyan mt-0.5">Verified strategies</p>
          </div>
        </div>
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-green/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Avg Monthly Return</p>
            <p className="text-xl font-bold text-neon-green font-mono mt-1">+{avgRoi.toFixed(1)}%</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Across all traders</p>
          </div>
        </div>
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-amber/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Top Performer</p>
            <p className="text-xl font-bold text-neon-amber font-mono mt-1">+{topRoi.toFixed(1)}%</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Best monthly return</p>
          </div>
        </div>
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-red/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Total Copiers</p>
            <p className="text-xl font-bold text-white font-mono mt-1">{formatCompact(totalCopiers)}</p>
            <p className="text-[10px] text-neon-red mt-0.5">Community tracking</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, strategy, or exchange..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-white focus:outline-none focus:border-neon-cyan/30 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          {['all', 'low', 'medium', 'high'].map(r => (
            <button
              key={r}
              onClick={() => setRiskFilter(r)}
              className={`px-3 py-2.5 rounded-xl text-xs font-semibold capitalize transition-all ${
                riskFilter === r
                  ? r === 'low' ? 'bg-neon-green/15 text-neon-green border border-neon-green/30'
                    : r === 'medium' ? 'bg-neon-amber/15 text-neon-amber border border-neon-amber/30'
                    : r === 'high' ? 'bg-neon-red/15 text-neon-red border border-neon-red/30'
                    : 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30'
                  : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              {r === 'all' ? 'All Risk' : r}
            </button>
          ))}
        </div>
        <div className="relative">
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-slate-300 hover:border-white/[0.12] transition-all"
          >
            <span className="text-xs text-slate-500">Sort:</span>
            <span className="text-xs font-semibold text-neon-cyan">{sortLabels[sortKey]}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 glass-strong rounded-xl p-1.5 min-w-[160px] animate-scale-in">
              {(Object.keys(sortLabels) as SortKey[]).map(key => (
                <button
                  key={key}
                  onClick={() => { setSortKey(key); setSortOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${
                    sortKey === key ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-slate-400 hover:bg-white/[0.04]'
                  }`}
                >
                  {sortLabels[key]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Master Trader Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(trader => (
          <MasterTraderCard
            key={trader.id}
            trader={trader}
            copied={copied.has(trader.id)}
            onCopy={() => handleCopy(trader.id)}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="glass-card p-12 flex flex-col items-center justify-center text-center">
          <Copy className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-sm font-semibold text-slate-300">{traders.length === 0 ? 'No master traders available yet' : 'No traders match your filters'}</p>
          <p className="text-xs text-slate-500 mt-1">{traders.length === 0 ? 'Master admins need to add traders from the Admin Panel.' : 'Try adjusting your search or risk level filter.'}</p>
        </div>
      )}
    </div>
  );
}

function MasterTraderCard({ trader, copied, onCopy }: { trader: MasterTrader; copied: boolean; onCopy: () => void }) {
  const rc = riskConfig[trader.risk_level] ?? riskConfig.Medium;
  const isTopEarner = Number(trader.roi_percentage) > 20;
  const isHighRisk = trader.risk_level === 'High';
  const accent = trader.risk_level === 'Low' ? 'green' : trader.risk_level === 'High' ? 'amber' : 'cyan';
  const accentCls = {
    green: { text: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/30' },
    cyan: { text: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/30' },
    amber: { text: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/30' },
  }[accent];

  return (
    <div className={`glass-card p-5 relative overflow-hidden group hover:border-white/[0.12] transition-all duration-300 ${copied ? accentCls.border : ''}`}>
      <div className={`absolute -top-12 -right-12 w-32 h-32 ${accentCls.bg} rounded-full blur-3xl opacity-40 group-hover:opacity-70 transition-opacity`} />

      <div className="relative">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl ${accentCls.bg} ${accentCls.border} border flex items-center justify-center`}>
              <Crown className={`w-6 h-6 ${accentCls.text}`} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{trader.name}</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">{trader.exchange ?? 'Verified Trader'}</p>
            </div>
          </div>
        </div>

        {/* Description */}
        {trader.bio && <p className="text-xs text-slate-400 leading-relaxed mb-4 line-clamp-2">{trader.bio}</p>}

        {/* Monthly Return */}
        <div className="flex items-center justify-between mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
          <div>
            <p className="text-[9px] text-slate-500 uppercase font-semibold">Monthly Return</p>
            <p className={`text-2xl font-bold font-mono ${isTopEarner ? 'text-neon-green' : accentCls.text}`}>
              +{Number(trader.roi_percentage).toFixed(1)}%
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-slate-500 uppercase font-semibold">Win Rate</p>
            <p className="text-lg font-bold text-neon-green font-mono">{Number(trader.win_rate).toFixed(0)}%</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center py-2 rounded-lg bg-white/[0.03]">
            <p className="text-[9px] text-slate-500 uppercase mb-0.5">Copiers</p>
            <p className="text-xs font-bold text-neon-cyan font-mono">{trader.active_copiers.toLocaleString()}</p>
          </div>
          <div className="text-center py-2 rounded-lg bg-white/[0.03]">
            <p className="text-[9px] text-slate-500 uppercase mb-0.5">Max DD</p>
            <p className="text-xs font-bold text-neon-red font-mono">{Number(trader.max_drawdown ?? 0).toFixed(1)}%</p>
          </div>
          <div className="text-center py-2 rounded-lg bg-white/[0.03]">
            <p className="text-[9px] text-slate-500 uppercase mb-0.5">Commission</p>
            <p className="text-xs font-bold text-slate-300 font-mono">{Number(trader.commission_pct).toFixed(1)}%</p>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className={`px-2 py-1 rounded-md text-[10px] font-semibold ${rc.bg} ${rc.color} ${rc.border} border flex items-center gap-1`}>
            <Shield className="w-3 h-3" /> {trader.risk_level} Risk
          </span>
          {trader.strategy && (
            <span className="px-2 py-1 rounded-md bg-white/[0.04] text-[10px] text-slate-400 flex items-center gap-1">
              <Layers className="w-3 h-3" /> {trader.strategy}
            </span>
          )}
          {trader.market && (
            <span className="px-2 py-1 rounded-md bg-white/[0.04] text-[10px] text-slate-400 flex items-center gap-1">
              <Activity className="w-3 h-3" /> {trader.market}
            </span>
          )}
        </div>

        {/* Footer: copiers + Copy button */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <Users className="w-3.5 h-3.5" />
            {trader.active_copiers.toLocaleString()} copiers
          </div>
          <button
            onClick={onCopy}
            disabled={copied}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all duration-300 ${
              copied
                ? 'bg-neon-green/15 text-neon-green border border-neon-green/40 neon-glow-green cursor-default'
                : 'bg-gradient-to-r from-neon-cyan/20 to-neon-green/20 text-white border border-neon-cyan/40 hover:from-neon-cyan/30 hover:to-neon-green/30 neon-glow-cyan hover:scale-[1.02]'
            }`}
          >
            {copied ? (
              <><Check className="w-3.5 h-3.5" /> Copied!</>
            ) : (
              <><Copy className="w-3.5 h-3.5" /> Copy Strategy</>
            )}
          </button>
        </div>

        {copied && (
          <div className="mt-3 p-2.5 rounded-lg bg-neon-green/5 border border-neon-green/15 flex items-center gap-2 animate-fade-in">
            <Check className="w-3.5 h-3.5 text-neon-green flex-shrink-0" />
            <p className="text-[11px] text-neon-green">You are now copying this strategy. Trades will auto-mirror to your account.</p>
          </div>
        )}
      </div>
    </div>
  );
}
