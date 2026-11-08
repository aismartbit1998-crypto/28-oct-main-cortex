import { useEffect, useState } from 'react';
import {
  KeyRound, Loader2, Plus, Check, Zap, Users, TrendingUp,
  Calendar, Sparkles, Crown, Rocket, X, Clock, Coins, AlertTriangle,
  UserPlus,
} from 'lucide-react';
import { supabase, type License } from '@/lib/supabase';
import { licensePlanConfigs } from '@/data/adminMockData';
import { PLAN_RULES, type PlanType } from '@/lib/planRules';
import { useAuth } from '@/context/AuthContext';

const planColors = {
  green: { text: 'text-neon-green', border: 'border-neon-green/30', bg: 'bg-neon-green/10', glow: 'neon-glow-green' },
  cyan: { text: 'text-neon-cyan', border: 'border-neon-cyan/30', bg: 'bg-neon-cyan/10', glow: 'neon-glow-cyan' },
  amber: { text: 'text-neon-amber', border: 'border-neon-amber/30', bg: 'bg-neon-amber/10', glow: '' },
};

const tierIconMap: Record<string, typeof Zap> = {
  starter: Zap,
  pro: Rocket,
  enterprise: Crown,
};

type AllotMode = 'client' | 'subadmin';

interface AdminLicensesProps {
  creditBalance: number;
  onCreditsChange?: () => void;
}

export default function AdminLicenses({ creditBalance, onCreditsChange }: AdminLicensesProps) {
  const { user } = useAuth();
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Allot modal state
  const [allotMode, setAllotMode] = useState<AllotMode>('client');
  const [selectedTier, setSelectedTier] = useState<string>('pro');
  const [selectedDays, setSelectedDays] = useState<number>(30);
  const [targetEmail, setTargetEmail] = useState<string>('');
  const [targetUserId, setTargetUserId] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<number>(100);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const computedCost = PLAN_RULES[selectedTier as PlanType].creditsPerDay * selectedDays;

  const fetchLicenses = async () => {
    const { data, error } = await supabase.from('licenses').select('*').order('created_at', { ascending: false });
    if (error) console.error('Failed to fetch licenses:', error.message);
    setLicenses((data as License[]) ?? []);
    setLoading(false);
  };

  const fetchRole = async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('admin_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) console.error('Failed to fetch role:', error.message);
    const roleData = data as { role: string } | null;
    const isMasterEmail = user?.email === 'vinodbardev@gmail.com';
    setIsSuperAdmin(roleData?.role === 'super_admin' || isMasterEmail);
  };

  useEffect(() => {
    fetchLicenses();
    fetchRole();
  }, [user?.id]);

  const handleSearchUser = async () => {
    setError(null);
    const cleaned = targetEmail.trim();
    if (!cleaned) {
      setError('Enter an email to search.');
      return;
    }
    try {
      const { data, error: rpcError } = await supabase
        .rpc('find_user_by_email', { p_email: cleaned });

      if (rpcError) {
        console.error('[License] find_user_by_email RPC error:', rpcError.message, rpcError);
        setError(`Lookup failed: ${rpcError.message}`);
        return;
      }
      if (!data || data.length === 0) {
        setError(`No user found with email "${cleaned}". Make sure they have registered an account.`);
        return;
      }
      setTargetUserId(data[0].id);
      setSuccess(`Found user: ${data[0].email}`);
    } catch (err) {
      console.error('[License] User search exception:', err);
      setError(`Search error: ${(err as Error).message}`);
    }
  };

  const handleAllot = async () => {
    setError(null);
    setSuccess(null);

    if (allotMode === 'client') {
      if (!targetUserId) {
        setError('Search and select a client first.');
        return;
      }
      if (!isSuperAdmin && computedCost > creditBalance) {
        setError(`Insufficient credits. This allotment costs ${computedCost} credits but you have ${creditBalance}.`);
        return;
      }
      setSaving(true);
      try {
        const allowedBots = selectedTier === 'enterprise'
          ? ['scalper', 'dca', 'grid', 'copier', 'martingale']
          : selectedTier === 'pro'
          ? ['scalper', 'dca', 'grid', 'copier']
          : ['scalper', 'dca'];

        const { data, error: rpcError } = await supabase.rpc('allot_license', {
          p_target_user_id: targetUserId,
          p_plan_type: selectedTier,
          p_validity_days: selectedDays,
          p_allowed_bots: allowedBots,
        });

        if (rpcError) {
          console.error('[License] allot_license RPC error:', rpcError.message, rpcError);
          setError(`Allotment failed: ${rpcError.message}`);
          setSaving(false);
          return;
        }

        if (!data || data.length === 0) {
          setError('License allotment returned no result. Please try again.');
          setSaving(false);
          return;
        }

        const result = data[0];
        if (!isSuperAdmin && onCreditsChange) {
          onCreditsChange();
        }
        setSuccess(`License allotted! ${isSuperAdmin ? 'No credits deducted (Super Admin)' : `${result.credits_spent} credits spent, ${result.remaining_credits} remaining.`}`);
        setSaving(false);
        fetchLicenses();
        setTimeout(() => {
          setShowGenerate(false);
          setSuccess(null);
          setTargetEmail('');
          setTargetUserId('');
        }, 2500);
      } catch (err) {
        console.error('[License] Allotment exception:', err);
        setError(`Allotment error: ${(err as Error).message}`);
        setSaving(false);
      }
    } else {
      // Sub-admin credit transfer
      if (!targetEmail.trim()) {
        setError('Enter a sub-admin email.');
        return;
      }
      if (!transferAmount || transferAmount < 1) {
        setError('Enter a valid credit amount (minimum 1).');
        return;
      }
      setSaving(true);
      const { data, error: rpcError } = await supabase.rpc('transfer_credits', {
        p_target_email: targetEmail.trim().toLowerCase(),
        p_credits: transferAmount,
      });

      if (rpcError) {
        setError(rpcError.message);
        setSaving(false);
        return;
      }

      if (data && data.length > 0) {
        const result = data[0];
        setSuccess(`Credits transferred! ${result.target_name} now has ${result.new_balance.toLocaleString()} credits.`);
      }
      setSaving(false);
      setTimeout(() => {
        setShowGenerate(false);
        setSuccess(null);
        setTargetEmail('');
        setTransferAmount(100);
      }, 2500);
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    const prevLicenses = licenses;
    setLicenses(prev => prev.map(l => l.id === id ? { ...l, is_active: !current } : l));
    const { error } = await supabase.from('licenses').update({ is_active: !current }).eq('id', id);
    if (error) {
      setLicenses(prevLicenses);
      console.error('Failed to toggle license:', error.message);
    }
  };

  const openGenerate = () => {
    setAllotMode('client');
    setSelectedTier('pro');
    setSelectedDays(30);
    setTargetEmail('');
    setTargetUserId('');
    setTransferAmount(100);
    setError(null);
    setSuccess(null);
    setShowGenerate(true);
  };

  const switchMode = (mode: AllotMode) => {
    setAllotMode(mode);
    setTargetEmail('');
    setTargetUserId('');
    setError(null);
    setSuccess(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-neon-cyan animate-spin" /></div>;
  }

  const totalLicenses = licenses.length;
  const activeLicensesCount = licenses.filter(l => l.is_active && (!l.valid_until || new Date(l.valid_until) > new Date())).length;
  const expiredLicensesCount = licenses.filter(l => l.valid_until && new Date(l.valid_until) <= new Date()).length;
  const planCounts: Record<string, number> = { starter: 0, pro: 0, enterprise: 0 };
  licenses.forEach(l => {
    const p = (l.plan_name ?? 'starter').toLowerCase();
    if (p in planCounts) planCounts[p]++;
  });

  const canSubmit = allotMode === 'client'
    ? targetUserId && !saving && (isSuperAdmin || computedCost <= creditBalance)
    : targetEmail.trim() && transferAmount >= 1 && !saving;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-neon-cyan" /> License & Subscription Manager
          </h2>
          <p className="text-sm text-slate-400">Allot credit-based licenses to clients or transfer credits to sub-admins</p>
        </div>
        <button
          onClick={openGenerate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:neon-glow-cyan text-sm font-semibold transition-all"
        >
          <Plus className="w-4 h-4" /> Allot License
        </button>
      </div>

      {/* Credit balance banner */}
      <div className="glass-card p-4 flex items-center gap-4 border border-neon-amber/20">
        <div className={`w-12 h-12 rounded-xl ${isSuperAdmin ? 'bg-neon-amber/15' : 'bg-neon-amber/10'} border border-neon-amber/30 flex items-center justify-center`}>
          {isSuperAdmin ? <Crown className="w-6 h-6 text-neon-amber animate-pulse" /> : <Coins className="w-6 h-6 text-neon-amber" />}
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{isSuperAdmin ? 'Unlimited Credits' : 'Available Credits'}</p>
          {isSuperAdmin ? (
            <p className="text-2xl font-bold text-neon-amber font-mono" style={{ textShadow: '0 0 12px rgba(255,176,32,0.5)' }}>∞</p>
          ) : (
            <p className="text-2xl font-bold text-neon-amber font-mono">{creditBalance.toLocaleString()}</p>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-400">
          <span>Starter: 2/day</span>
          <span>Pro: 4/day</span>
          <span>Enterprise: 6/day</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-cyan/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Total Licenses</p>
            <p className="text-2xl font-bold text-white font-mono mt-1">{totalLicenses}</p>
          </div>
        </div>
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-green/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Active</p>
            <p className="text-2xl font-bold text-neon-green font-mono mt-1">{activeLicensesCount}</p>
          </div>
        </div>
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-red/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Expired</p>
            <p className="text-2xl font-bold text-neon-red font-mono mt-1">{expiredLicensesCount}</p>
          </div>
        </div>
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-amber/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Pro Licenses</p>
            <p className="text-2xl font-bold text-neon-amber font-mono mt-1">{planCounts.pro}</p>
          </div>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {licensePlanConfigs.map(plan => {
          const a = planColors[plan.color];
          const TIcon = tierIconMap[plan.id];
          return (
            <div key={plan.id} className={`glass-card p-6 relative overflow-hidden ${a.border}`}>
              <div className={`absolute -top-12 -right-12 w-32 h-32 ${a.bg} rounded-full blur-3xl opacity-40`} />
              <div className="relative">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <TIcon className={`w-5 h-5 ${a.text}`} />
                    <h3 className={`text-lg font-bold ${a.text}`}>{plan.label}</h3>
                  </div>
                  <span className={`px-2 py-1 rounded-md text-[10px] font-bold ${a.bg} ${a.text} ${a.border} border`}>
                    {planCounts[plan.id]} active
                  </span>
                </div>
                <p className="text-2xl font-bold text-white mb-1">
                  {plan.creditsPerDay}<span className="text-sm text-slate-500 font-normal"> credits/day</span>
                </p>
                <div className="flex items-center gap-4 mt-4 mb-4">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className={`w-4 h-4 ${a.text}`} />
                    <span className="text-sm text-slate-300">{plan.botLimit >= 999 ? 'Unlimited' : plan.botLimit} bots</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Zap className={`w-4 h-4 ${a.text}`} />
                    <span className="text-sm text-slate-300">{plan.maxLeverage}x max</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {plan.features.map(f => (
                    <div key={f} className="flex items-center gap-2 text-xs text-slate-400">
                      <Check className={`w-3.5 h-3.5 ${a.text} flex-shrink-0`} /> {f}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Licenses table */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-neon-cyan" /> License Database
          </h3>
          <span className="text-xs text-slate-500 font-mono">{licenses.length} records</span>
        </div>
        {licenses.length === 0 ? (
          <div className="p-12 text-center">
            <KeyRound className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-300">No licenses allotted yet</p>
            <p className="text-xs text-slate-500 mt-1">Use "Allot License" to assign a plan to a client.</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="text-left py-3 px-4 font-semibold">Plan</th>
                  <th className="text-right py-3 px-4 font-semibold">Bot Limit</th>
                  <th className="text-left py-3 px-4 font-semibold hidden md:table-cell">Valid Until</th>
                  <th className="text-center py-3 px-4 font-semibold">Status</th>
                  <th className="text-center py-3 px-4 font-semibold">Toggle</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map(l => {
                  const isExpired = l.valid_until && new Date(l.valid_until) < new Date();
                  const planLabel = (l.plan_name ?? 'starter').charAt(0).toUpperCase() + (l.plan_name ?? 'starter').slice(1);
                  return (
                    <tr key={l.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-white capitalize">{planLabel}</td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-300">
                        {l.bot_limit >= 2147483647 ? 'Unlimited' : l.bot_limit}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-400 hidden md:table-cell font-mono">
                        {l.valid_until ? new Date(l.valid_until).toLocaleDateString() : 'Unlimited'}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {isExpired ? (
                          <span className="px-2.5 py-1 rounded-md text-[10px] font-bold text-neon-red bg-neon-red/10 border border-neon-red/25">EXPIRED</span>
                        ) : l.is_active ? (
                          <span className="px-2.5 py-1 rounded-md text-[10px] font-bold text-neon-green bg-neon-green/10 border border-neon-green/25">ACTIVE</span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-md text-[10px] font-bold text-slate-500 bg-white/[0.03] border border-white/[0.06]">INACTIVE</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => toggleActive(l.id, l.is_active)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                            l.is_active ? 'bg-neon-green/10 text-neon-green border-neon-green/20 hover:bg-neon-green/20' : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:text-white'
                          }`}
                        >
                          {l.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Allot Modal */}
      {showGenerate && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-base-900/85 backdrop-blur-md" onClick={() => setShowGenerate(false)} />
          <div className="relative w-full max-w-xl animate-scale-in">
            <div className="glass-strong neon-glow-cyan max-h-[92vh] overflow-y-auto scrollbar-thin rounded-2xl">
              <div className="sticky top-0 z-25 bg-base-800/90 backdrop-blur-xl border-b border-white/[0.06] px-5 sm:px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center">
                    <KeyRound className="w-5 h-5 text-neon-cyan" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">
                      {allotMode === 'client' ? 'Allot License to Client' : 'Transfer Credits to Sub-Admin'}
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      {allotMode === 'client' ? 'Assign a time-based plan to a client' : 'Add credits so they can allot their own licenses'}
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowGenerate(false)} className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/[0.06]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-5 sm:px-6 py-5 space-y-5">
                {/* Credit balance */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-neon-amber/5 border border-neon-amber/15">
                  <div className="flex items-center gap-2">
                    {isSuperAdmin ? <Crown className="w-5 h-5 text-neon-amber" /> : <Coins className="w-5 h-5 text-neon-amber" />}
                    <span className="text-xs text-slate-400">{isSuperAdmin ? 'Unlimited' : 'Your Credits'}</span>
                  </div>
                  {isSuperAdmin ? (
                    <span className="text-lg font-bold text-neon-amber font-mono" style={{ textShadow: '0 0 8px rgba(255,176,32,0.5)' }}>∞</span>
                  ) : (
                    <span className="text-lg font-bold text-neon-amber font-mono">{creditBalance.toLocaleString()}</span>
                  )}
                </div>

                {/* Mode Toggle */}
                <div className="grid grid-cols-2 gap-3 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <button
                    onClick={() => switchMode('client')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${
                      allotMode === 'client'
                        ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <KeyRound className="w-4 h-4" /> Allot to Client
                  </button>
                  <button
                    onClick={() => switchMode('subadmin')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${
                      allotMode === 'subadmin'
                        ? 'bg-neon-amber/15 text-neon-amber border border-neon-amber/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <UserPlus className="w-4 h-4" /> Allot to Sub-Admin
                  </button>
                </div>

                {/* === CLIENT MODE === */}
                {allotMode === 'client' && (
                  <>
                    {/* User search */}
                    <div>
                      <label className="text-xs text-slate-400 mb-2 block font-semibold">Client Email</label>
                      <div className="flex gap-2">
                        <input
                          type="email"
                          value={targetEmail}
                          onChange={e => { setTargetEmail(e.target.value); setTargetUserId(''); setError(null); }}
                          placeholder="client@example.com"
                          className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-cyan/40"
                        />
                        <button
                          onClick={handleSearchUser}
                          className="px-4 py-2.5 rounded-xl bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 text-xs font-bold hover:bg-neon-cyan/25 transition-all"
                        >
                          Search
                        </button>
                      </div>
                      {targetUserId && (
                        <p className="mt-2 text-xs text-neon-green flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5" /> User found and ready for allotment
                        </p>
                      )}
                    </div>

                    {/* Plan selection */}
                    <div>
                      <label className="text-xs text-slate-400 mb-3 block font-semibold">Select Plan</label>
                      <div className="grid grid-cols-3 gap-3">
                        {licensePlanConfigs.map(tier => {
                          const isSelected = selectedTier === tier.id;
                          const TIcon = tierIconMap[tier.id];
                          const a = planColors[tier.color];
                          return (
                            <button
                              key={tier.id}
                              onClick={() => setSelectedTier(tier.id)}
                              className={`relative p-4 rounded-xl border text-center transition-all overflow-hidden ${
                                isSelected ? `${a.bg} ${a.border}` : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                              }`}
                            >
                              <div className="relative">
                                <div className={`w-10 h-10 rounded-lg ${isSelected ? a.bg : 'bg-white/[0.05]'} flex items-center justify-center mx-auto mb-2`}>
                                  <TIcon className={`w-5 h-5 ${isSelected ? a.text : 'text-slate-400'}`} />
                                </div>
                                <p className={`text-sm font-bold ${isSelected ? a.text : 'text-slate-300'}`}>{tier.label}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">{tier.creditsPerDay} credits/day</p>
                                <p className="text-[10px] text-slate-600 mt-0.5">{tier.botLimit >= 999 ? 'Unlimited' : tier.botLimit} bots · {tier.maxLeverage}x</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Duration */}
                    <div>
                      <label className="text-xs text-slate-400 mb-3 block font-semibold flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Duration (Days)
                      </label>
                      <div className="flex gap-2 mb-3">
                        {[7, 30, 90, 180, 365].map(d => (
                          <button
                            key={d}
                            onClick={() => setSelectedDays(d)}
                            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                              selectedDays === d
                                ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40'
                                : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:border-white/[0.12]'
                            }`}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        min="1"
                        max="3650"
                        value={selectedDays}
                        onChange={e => setSelectedDays(Math.max(1, Math.min(3650, Number(e.target.value))))}
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/40"
                      />
                    </div>

                    {/* Cost summary */}
                    <div className="p-4 rounded-xl bg-neon-cyan/5 border border-neon-cyan/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-neon-cyan" />
                          <span className="text-xs text-slate-400">Expiry Date</span>
                        </div>
                        <span className="text-sm font-mono text-slate-200">
                          {new Date(Date.now() + selectedDays * 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
                        <div className="flex items-center gap-2">
                          <Coins className="w-4 h-4 text-neon-amber" />
                          <span className="text-xs text-slate-400">Total Cost</span>
                        </div>
                        <span className={`text-lg font-bold font-mono ${!isSuperAdmin && computedCost > creditBalance ? 'text-neon-red' : 'text-neon-amber'}`}>
                          {isSuperAdmin ? 'FREE' : `${computedCost} credits`}
                        </span>
                      </div>
                      {computedCost > creditBalance && !isSuperAdmin && (
                        <p className="mt-2 text-[11px] text-neon-red flex items-center gap-1.5">
                          <AlertTriangle className="w-3 h-3" /> Insufficient credits for this allotment.
                        </p>
                      )}
                    </div>
                  </>
                )}

                {/* === SUB-ADMIN MODE === */}
                {allotMode === 'subadmin' && (
                  <>
                    {/* Sub-admin email */}
                    <div>
                      <label className="text-xs text-slate-400 mb-2 block font-semibold">Sub-Admin Email</label>
                      <input
                        type="email"
                        value={targetEmail}
                        onChange={e => { setTargetEmail(e.target.value); setError(null); }}
                        placeholder="subadmin@cortex.ai"
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-amber/40"
                      />
                      <p className="mt-2 text-[11px] text-slate-500">
                        Enter the email of an active sub-admin. Credits will be added to their balance.
                      </p>
                    </div>

                    {/* Credits amount */}
                    <div>
                      <label className="text-xs text-slate-400 mb-3 block font-semibold flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5" /> Credits to Transfer
                      </label>
                      <div className="flex gap-2 mb-3">
                        {[50, 100, 500, 1000, 5000].map(amount => (
                          <button
                            key={amount}
                            onClick={() => setTransferAmount(amount)}
                            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                              transferAmount === amount
                                ? 'bg-neon-amber/15 text-neon-amber border border-neon-amber/40'
                                : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:border-white/[0.12]'
                            }`}
                          >
                            {amount}
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        min="1"
                        max="1000000"
                        value={transferAmount}
                        onChange={e => setTransferAmount(Math.max(1, Math.min(1000000, Number(e.target.value))))}
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40"
                      />
                    </div>

                    {/* Transfer summary */}
                    <div className="p-4 rounded-xl bg-neon-amber/5 border border-neon-amber/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <UserPlus className="w-4 h-4 text-neon-amber" />
                          <span className="text-xs text-slate-400">Recipient</span>
                        </div>
                        <span className="text-sm font-mono text-slate-200">
                          {targetEmail.trim() || '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
                        <div className="flex items-center gap-2">
                          <Coins className="w-4 h-4 text-neon-amber" />
                          <span className="text-xs text-slate-400">Credits to Add</span>
                        </div>
                        <span className="text-lg font-bold font-mono text-neon-amber">
                          +{transferAmount.toLocaleString()}
                        </span>
                      </div>
                      {isSuperAdmin && (
                        <p className="mt-2 text-[11px] text-neon-amber flex items-center gap-1.5">
                          <Crown className="w-3 h-3" /> No deduction from your balance — Super Admin has unlimited credits.
                        </p>
                      )}
                    </div>
                  </>
                )}

                {/* Error / Success */}
                {error && (
                  <div className="p-3 rounded-xl bg-neon-red/10 border border-neon-red/30 text-xs text-neon-red flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
                  </div>
                )}
                {success && (
                  <div className="p-3 rounded-xl bg-neon-green/10 border border-neon-green/30 text-xs text-neon-green flex items-start gap-2">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" /> {success}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 bg-base-800/90 backdrop-blur-xl border-t border-white/[0.06] px-5 sm:px-6 py-4 flex items-center justify-between gap-3">
                <button
                  onClick={() => setShowGenerate(false)}
                  className="px-4 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-sm text-slate-300 border border-white/[0.06]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAllot}
                  disabled={!canSubmit}
                  className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                    canSubmit
                      ? allotMode === 'client'
                        ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40 hover:neon-glow-cyan'
                        : 'bg-neon-amber/15 text-neon-amber border border-neon-amber/40 hover:neon-glow-amber'
                      : 'bg-white/[0.03] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                  }`}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {allotMode === 'client'
                    ? `Allot License ${isSuperAdmin ? '(Free)' : `(${computedCost} credits)`}`
                    : `Transfer ${transferAmount.toLocaleString()} Credits`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
