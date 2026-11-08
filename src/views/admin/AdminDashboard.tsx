import { useEffect, useState } from 'react';
import { Users, Coins, Bot, TrendingUp, Activity, Server, Zap, ShieldCheck, AlertTriangle, ArrowUpRight, ArrowDownRight, Loader2, CreditCard, UserPlus, KeyRound, Crown, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLivePrices } from '@/hooks/useLivePrices';
import { useAuth } from '@/context/AuthContext';
import type { AdminViewId } from '@/components/admin/AdminSidebar';
import GlobalRunningBotsModal from '@/components/admin/GlobalRunningBotsModal';
interface AdminClient {
  id: string;
  email: string;
  name: string;
  plan: string;
  status: 'active' | 'suspended' | 'banned';
  totalFunds: number;
  unrealizedPnl: number;
  realizedPnl: number;
  activeBots: number;
  manualTrading: boolean;
  joinedDate: string;
  lastActive: string;
  country: string;
  licenseValidUntil: string;
  licenseCycle: 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';
  botLimit: number;
  unlockedStrategies: string[];
  unlockedIndicators: string[];
  connectedExchanges: { name: string; status: 'connected' | 'disconnected' | 'error'; apiKeyMasked?: string }[];
}

interface ActivityLog {
  id: string;
  admin_email: string;
  admin_name: string | null;
  action_type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  created_at: string;
}

const severityConfig = {
  info: 'text-slate-400',
  warning: 'text-neon-amber',
  critical: 'text-neon-red',
  success: 'text-neon-green',
};

const typeIcon: Record<string, typeof Users> = {
  login: Users,
  bot_deploy: Bot,
  trade: TrendingUp,
  license_change: CreditCard,
  risk_alert: AlertTriangle,
  admin_action: ShieldCheck,
};

interface DashboardProps {
  isSuperAdmin?: boolean;
  onNavigate?: (view: AdminViewId) => void;
}

export default function AdminDashboard({ isSuperAdmin, onNavigate }: DashboardProps) {
  const formatNumber = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const { coins } = useLivePrices();
  const { startImpersonation } = useAuth();
  const [botCount, setBotCount] = useState(0);
  const [activeBots, setActiveBots] = useState(0);
  const [tradeCount, setTradeCount] = useState(0);
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBotsModal, setShowBotsModal] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [{ data: botData }, { data: tradeData }, { data: profilesData }, { data: fundsData }, { data: licenseData }, { data: activityData }] =
        await Promise.all([
          supabase.from('bots').select('*'),
          supabase.from('trades').select('*'),
          supabase.from('profiles').select('*'),
          supabase.from('user_funds').select('*'),
          supabase.from('licenses').select('*'),
          supabase.from('admin_activity_log').select('*').order('created_at', { ascending: false }).limit(10),
        ]);
      if (!mounted) return;
      setBotCount(botData?.length ?? 0);
      setActiveBots(botData?.filter((b: { status: string }) => b.status === 'running').length ?? 0);
      setTradeCount(tradeData?.length ?? 0);

      const profiles = profilesData ?? [];
      const funds = fundsData ?? [];
      const licenses = licenseData ?? [];
      const mapped: AdminClient[] = profiles.map((p: { id: string; email: string; created_at: string }) => {
        const fund = funds.find((f: { user_id: string }) => f.user_id === p.id);
        const license = licenses.find((l: { user_id: string }) => l.user_id === p.id);
        return {
          id: p.id,
          email: p.email,
          name: p.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          plan: license?.plan_name ?? 'Starter',
          status: 'active' as const,
          totalFunds: Number(fund?.balance ?? 0),
          unrealizedPnl: Number(fund?.unrealized_pnl ?? 0),
          realizedPnl: Number(fund?.realized_pnl ?? 0),
          activeBots: 0,
          manualTrading: false,
          joinedDate: p.created_at?.split('T')[0] ?? '',
          lastActive: '',
          country: 'India',
          licenseValidUntil: license?.valid_until ?? '',
          licenseCycle: 'monthly' as const,
          botLimit: Number(license?.bot_limit ?? 2),
          unlockedStrategies: [],
          unlockedIndicators: [],
          connectedExchanges: [],
        };
      });
      setClients(mapped);
      setActivities((activityData as ActivityLog[]) ?? []);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const totalClientFunds = clients.reduce((s, c) => s + c.totalFunds, 0);
  const totalUnrealizedPnl = clients.reduce((s, c) => s + c.unrealizedPnl, 0);
  const totalRealizedPnl = clients.reduce((s, c) => s + c.realizedPnl, 0);
  const activeClients = clients.filter(c => c.status === 'active').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total Account Value" value={formatNumber(totalClientFunds)} icon={Coins} accent="cyan" sub="Across active clients" />
        <StatCard label="Active Clients" value={activeClients.toString()} icon={Users} accent="green" sub={`${clients.length} total`} />
        <button onClick={() => setShowBotsModal(true)} className="text-left focus:outline-none">
          <StatCard label="Running Bots" value={activeBots.toString()} icon={Bot} accent="amber" sub={`${botCount} total deployed · Click to manage`} clickable />
        </button>
        <StatCard label="Total Trades" value={tradeCount.toString()} icon={Activity} accent="cyan" sub="all-time" />
      </div>

      {/* Quick Actions */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-amber" />
          Quick Actions
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => onNavigate?.('licenses')}
            className="flex-1 flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:neon-glow-cyan text-sm font-bold transition-all duration-200 active:scale-[0.98] group"
          >
            <KeyRound className="w-5 h-5 group-hover:scale-110 transition-transform" />
            Allot License
            {isSuperAdmin && (
              <span className="px-2 py-0.5 rounded-md bg-neon-amber/15 text-neon-amber text-[10px] font-bold border border-neon-amber/30">FREE</span>
            )}
          </button>
          {isSuperAdmin && (
            <button
              onClick={() => onNavigate?.('admins')}
              className="flex-1 flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-white/[0.04] text-slate-200 border border-white/[0.08] hover:bg-white/[0.07] text-sm font-bold transition-all duration-200 active:scale-[0.98] group"
            >
              <UserPlus className="w-5 h-5 group-hover:scale-110 transition-transform" />
              Add Sub-Admin
            </button>
          )}
          {isSuperAdmin && (
            <button
              onClick={() => onNavigate?.('api-control')}
              className="flex-1 flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-white/[0.04] text-slate-200 border border-white/[0.08] hover:bg-white/[0.07] text-sm font-bold transition-all duration-200 active:scale-[0.98] group"
            >
              <Server className="w-5 h-5 group-hover:scale-110 transition-transform" />
              Master API Control
            </button>
          )}
        </div>
        {isSuperAdmin && (
          <div className="mt-3 flex items-center gap-2 text-xs text-neon-amber">
            <Crown className="w-3.5 h-3.5 animate-pulse" />
            <span>Super Admin mode — all license allotments are free with unlimited credits.</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* PnL */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-neon-green" />
            Platform P&L Overview
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-neon-green/5 border border-neon-green/10">
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Unrealized P&L</p>
                <p className="text-xl font-bold text-neon-green font-mono">{totalUnrealizedPnl >= 0 ? '+' : ''}{formatNumber(totalUnrealizedPnl)}</p>
              </div>
              {totalUnrealizedPnl >= 0 ? <ArrowUpRight className="w-6 h-6 text-neon-green/50" /> : <ArrowDownRight className="w-6 h-6 text-neon-red/50" />}
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-neon-cyan/5 border border-neon-cyan/10">
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Realized P&L</p>
                <p className="text-xl font-bold text-neon-cyan font-mono">{totalRealizedPnl >= 0 ? '+' : ''}{formatNumber(totalRealizedPnl)}</p>
              </div>
              <TrendingUp className="w-6 h-6 text-neon-cyan/50" />
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Total Platform P&L</p>
                <p className="text-xl font-bold text-white font-mono">{totalUnrealizedPnl + totalRealizedPnl >= 0 ? '+' : ''}{formatNumber(totalUnrealizedPnl + totalRealizedPnl)}</p>
              </div>
              <Zap className="w-6 h-6 text-neon-amber/50" />
            </div>
          </div>
        </div>

        {/* System Activity */}
        <div className="glass-card p-5 lg:col-span-2">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-cyan" />
            System Activity Feed
          </h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-thin">
            {activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="w-8 h-8 text-slate-600 mb-2" />
                <p className="text-xs text-slate-500">No system activity recorded yet.</p>
              </div>
            ) : activities.map((a) => {
              const Icon = typeIcon[a.action_type] || Activity;
              return (
                <div key={a.id} className="flex items-start gap-3 py-2.5 px-3 rounded-xl hover:bg-white/[0.03] transition-colors">
                  <div className={`w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-4 h-4 ${severityConfig[a.severity]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200">{a.message}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-slate-500">{a.admin_email}</span>
                      <span className="text-[10px] text-slate-600">·</span>
                      <span className="text-[10px] text-slate-500">{new Date(a.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                  <span className={`text-[9px] font-bold uppercase ${severityConfig[a.severity]}`}>{a.severity}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top clients + market overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Clients */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-green" />
            Top Clients by AUM
          </h3>
          <div className="space-y-2">
            {clients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Users className="w-8 h-8 text-slate-600 mb-2" />
                <p className="text-xs text-slate-500">No clients registered yet.</p>
              </div>
            ) : (
              [...clients].sort((a, b) => b.totalFunds - a.totalFunds).slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-white/[0.03] transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center text-[10px] font-bold text-slate-300">
                      {c.email.split('@')[0].slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{c.email.split('@')[0]}</p>
                      <p className="text-[10px] text-slate-500">{c.plan} · {c.activeBots} bots</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-mono text-slate-200">{formatNumber(c.totalFunds)}</p>
                      <p className={`text-[10px] font-semibold ${c.unrealizedPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                        {c.unrealizedPnl >= 0 ? '+' : ''}{formatNumber(c.unrealizedPnl)}
                      </p>
                    </div>
                    <button
                      onClick={() => startImpersonation(c.id, c.email)}
                      title="View as this user"
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/25 hover:bg-neon-cyan/20 transition-all"
                    >
                      <Eye className="w-3 h-3" /> View
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Market snapshot */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Server className="w-4 h-4 text-neon-cyan" />
            Market Snapshot
          </h3>
          <div className="space-y-2">
            {coins.slice(0, 5).map((c) => (
              <div key={c.symbol} className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-white/[0.03] transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center text-[10px] font-bold text-slate-300">
                    {c.symbol.slice(0, 3)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{c.symbol}</p>
                    <p className="text-[10px] text-slate-500">{c.name}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono text-slate-200">{c.price.toLocaleString()}</p>
                  <p className={`text-[10px] font-semibold ${c.change24h >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                    {c.change24h >= 0 ? '+' : ''}{c.change24h.toFixed(2)}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <GlobalRunningBotsModal open={showBotsModal} onClose={() => setShowBotsModal(false)} />
    </div>
  );
}

function StatCard({ label, value, icon: Icon, accent, sub, clickable }: { label: string; value: string; icon: typeof Coins; accent: 'cyan' | 'green' | 'amber' | 'red'; sub: string; clickable?: boolean }) {
  const colors = {
    cyan: { text: 'text-neon-cyan', bg: 'bg-neon-cyan/10' },
    green: { text: 'text-neon-green', bg: 'bg-neon-green/10' },
    amber: { text: 'text-neon-amber', bg: 'bg-neon-amber/10' },
    red: { text: 'text-neon-red', bg: 'bg-neon-red/10' },
  };
  const a = colors[accent];
  return (
    <div className={`glass-card p-4 relative overflow-hidden group transition-all duration-300 ${clickable ? 'cursor-pointer hover:border-neon-amber/30 hover:bg-neon-amber/[0.03]' : 'hover:border-white/[0.12]'}`}>
      <div className={`absolute -top-8 -right-8 w-24 h-24 ${a.bg} rounded-full blur-2xl opacity-50 group-hover:opacity-100 transition-opacity`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</span>
          <Icon className={`w-4 h-4 ${a.text} ${clickable ? 'group-hover:scale-110 transition-transform' : ''}`} />
        </div>
        <p className="text-lg sm:text-xl font-bold text-white font-mono">{value}</p>
        <p className={`text-[10px] mt-0.5 ${a.text}`}>{sub}</p>
      </div>
    </div>
  );
}
