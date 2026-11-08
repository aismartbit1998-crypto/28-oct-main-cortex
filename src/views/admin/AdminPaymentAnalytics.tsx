import { useEffect, useState, useCallback } from 'react';
import {
  Wallet, TrendingUp, TrendingDown, DollarSign, Users, CreditCard,
  Loader2, CheckCircle, AlertCircle, Clock, XCircle,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase, type Transaction } from '@/lib/supabase';
import { Coins } from 'lucide-react';

interface CreditRequest {
  id: string;
  sub_admin_id: string;
  credits_requested: number;
  amount_paid: number;
  utr_number: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  sub_admin: { email: string; name: string | null; credit_balance: number } | null;
}

const statusConfig = {
  completed: { icon: CheckCircle, color: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/20' },
  pending: { icon: Clock, color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20' },
  failed: { icon: XCircle, color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20' },
  refunded: { icon: AlertCircle, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/20' },
};

const planConfig: Record<string, { color: string; bg: string }> = {
  starter: { color: 'text-neon-cyan', bg: 'bg-neon-cyan/10' },
  pro: { color: 'text-neon-green', bg: 'bg-neon-green/10' },
  enterprise: { color: 'text-neon-amber', bg: 'bg-neon-amber/10' },
};

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl px-3 py-2 text-xs border border-white/[0.08]">
      <p className="text-slate-400 mb-1">{label}</p>
      <p className="text-neon-green font-bold font-mono">{payload[0].value.toLocaleString()} credits</p>
    </div>
  );
}

export default function AdminPaymentAnalytics({ isSubAdmin }: { isSubAdmin?: boolean }) {
  const fmtNum = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [chartData, setChartData] = useState<{ month: string; revenue: number; mrr: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [creditRequests, setCreditRequests] = useState<CreditRequest[]>([]);
  const [approving, setApproving] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.from('transactions').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      if (!mounted) return;
      const txns = (data as Transaction[]) ?? [];
      setTransactions(txns);

      // Build revenue chart from real transaction data, grouped by month
      const monthlyMap: Record<string, { revenue: number; mrr: number }> = {};
      for (const t of txns) {
        const d = new Date(t.created_at);
        const monthKey = d.toLocaleDateString('en-US', { month: 'short' });
        if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { revenue: 0, mrr: 0 };
        if (t.status === 'completed') {
          monthlyMap[monthKey].revenue += Number(t.amount);
          monthlyMap[monthKey].mrr += Number(t.amount);
        }
      }
      const sorted = Object.entries(monthlyMap)
        .map(([month, vals]) => ({ month, revenue: vals.revenue, mrr: vals.mrr }))
        .slice(-6);
      setChartData(sorted);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const fetchCreditRequests = useCallback(async () => {
    if (isSubAdmin) return;
    const { data, error } = await supabase
      .from('credit_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Failed to fetch credit requests:', error.message);
      return;
    }
    const requests = (data as CreditRequest[]) ?? [];
    // Fetch sub-admin details separately (no direct FK from credit_requests to admin_roles)
    const subAdminIds = [...new Set(requests.map(r => r.sub_admin_id))];
    if (subAdminIds.length > 0) {
      const { data: adminData } = await supabase
        .from('admin_roles')
        .select('user_id, email, name, credit_balance')
        .in('user_id', subAdminIds);
      const adminMap = new Map<string, { email: string; name: string | null; credit_balance: number }>();
      for (const a of (adminData ?? []) as Array<{ user_id: string; email: string; name: string | null; credit_balance: number }>) {
        adminMap.set(a.user_id, { email: a.email, name: a.name, credit_balance: a.credit_balance });
      }
      setCreditRequests(requests.map(r => ({ ...r, sub_admin: adminMap.get(r.sub_admin_id) ?? null })));
    } else {
      setCreditRequests(requests.map(r => ({ ...r, sub_admin: null })));
    }
  }, [isSubAdmin]);

  useEffect(() => {
    fetchCreditRequests();
  }, [fetchCreditRequests]);

  const totalRevenue = transactions
    .filter(t => t.status === 'completed')
    .reduce((s, t) => s + Number(t.amount), 0);
  const completedCount = transactions.filter(t => t.status === 'completed').length;
  const pendingCount = transactions.filter(t => t.status === 'pending').length;

  const currentMrr = chartData.length > 0 ? chartData[chartData.length - 1].mrr : 0;
  const prevMrr = chartData.length > 1 ? chartData[chartData.length - 2].mrr : 0;
  const mrrGrowth = prevMrr > 0 ? ((currentMrr - prevMrr) / prevMrr) * 100 : 0;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-neon-cyan animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Wallet className="w-5 h-5 text-neon-green" /> Payment Analytics & Revenue
        </h2>
        <p className="text-sm text-slate-400">Track platform revenue, subscriptions, and transaction history</p>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="glass-card p-4 relative overflow-hidden group hover:border-white/[0.12] transition-all duration-300">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-green/10 rounded-full blur-2xl opacity-50 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Total Revenue</span>
              <Coins className="w-4 h-4 text-neon-green" />
            </div>
            <p className="text-lg sm:text-xl font-bold text-neon-green font-mono">{fmtNum(totalRevenue)}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Total credits spent</p>
          </div>
        </div>

        <div className="glass-card p-4 relative overflow-hidden group hover:border-white/[0.12] transition-all duration-300">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-cyan/10 rounded-full blur-2xl opacity-50 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">MRR</span>
              <TrendingUp className="w-4 h-4 text-neon-cyan" />
            </div>
            <p className="text-lg sm:text-xl font-bold text-neon-cyan font-mono">{fmtNum(currentMrr)}</p>
            <p className={`text-[10px] mt-0.5 ${mrrGrowth >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
              {mrrGrowth >= 0 ? '+' : ''}{mrrGrowth.toFixed(1)}% MoM
            </p>
          </div>
        </div>

        <div className="glass-card p-4 relative overflow-hidden group hover:border-white/[0.12] transition-all duration-300">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-amber/10 rounded-full blur-2xl opacity-50 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Active Subscriptions</span>
              <Users className="w-4 h-4 text-neon-amber" />
            </div>
            <p className="text-lg sm:text-xl font-bold text-white font-mono">{completedCount}</p>
            <p className="text-[10px] text-neon-amber mt-0.5">{pendingCount} pending</p>
          </div>
        </div>

        <div className="glass-card p-4 relative overflow-hidden group hover:border-white/[0.12] transition-all duration-300">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-red/10 rounded-full blur-2xl opacity-50 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Avg Revenue/User</span>
              <CreditCard className="w-4 h-4 text-neon-red" />
            </div>
            <p className="text-lg sm:text-xl font-bold text-white font-mono">
              {fmtNum(completedCount > 0 ? totalRevenue / completedCount : 0)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Per active sub</p>
          </div>
        </div>
      </div>

      {/* Revenue Chart */}
      <div className="glass-card p-5 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-neon-green" /> Revenue Trend (Last 6 Months)
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Monthly revenue vs MRR comparison</p>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-neon-green" style={{ boxShadow: '0 0 8px rgba(0,255,157,0.6)' }} />
              <span className="text-slate-400">Revenue</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-neon-cyan" style={{ boxShadow: '0 0 8px rgba(0,229,255,0.6)' }} />
              <span className="text-slate-400">MRR</span>
            </span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00ff9d" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#00ff9d" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00e5ff" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#00e5ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="month"
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => fmtNum(v)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#00ff9d"
              strokeWidth={2.5}
              fill="url(#revGrad)"
              dot={{ fill: '#00ff9d', r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: '#00ff9d', stroke: '#05060a', strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="mrr"
              stroke="#00e5ff"
              strokeWidth={2}
              fill="url(#mrrGrad)"
              dot={{ fill: '#00e5ff', r: 2, strokeWidth: 0 }}
              activeDot={{ r: 4, fill: '#00e5ff', stroke: '#05060a', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Pending B2B Credit Requests (Super Admin only) */}
      {!isSubAdmin && (
        <div className="glass-card overflow-hidden border-neon-amber/20">
          <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Coins className="w-4 h-4 text-neon-amber" /> Pending B2B Credit Requests
            </h3>
            <span className="text-xs text-neon-amber font-semibold">
              {creditRequests.filter(r => r.status === 'pending').length} pending
            </span>
          </div>
          {creditRequests.length === 0 ? (
            <div className="py-10 text-center">
              <Coins className="w-8 h-8 mx-auto mb-2 text-slate-700" />
              <p className="text-sm text-slate-500">No credit requests submitted yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="text-left py-3 px-4 font-semibold">Sub-Admin</th>
                    <th className="text-right py-3 px-4 font-semibold">Credits</th>
                    <th className="text-right py-3 px-4 font-semibold hidden sm:table-cell">Amount Paid</th>
                    <th className="text-left py-3 px-4 font-semibold hidden md:table-cell">UTR Number</th>
                    <th className="text-left py-3 px-4 font-semibold hidden lg:table-cell">Date</th>
                    <th className="text-center py-3 px-4 font-semibold">Status</th>
                    <th className="text-right py-3 px-4 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {creditRequests.map((req) => (
                    <tr key={req.id} className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${req.status === 'pending' ? 'bg-neon-amber/[0.03]' : ''}`}>
                      <td className="py-3 px-4">
                        <p className="text-sm font-semibold text-white">{req.sub_admin?.name ?? 'Unknown'}</p>
                        <p className="text-[10px] text-slate-500">{req.sub_admin?.email ?? req.sub_admin_id.slice(0, 8)}</p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-neon-amber">{req.credits_requested.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-200 hidden sm:table-cell">₹{fmtNum(Number(req.amount_paid))}</td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs font-mono text-slate-400">{req.utr_number}</td>
                      <td className="py-3 px-4 hidden lg:table-cell text-xs text-slate-500 font-mono">
                        {new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold border ${
                          req.status === 'pending' ? 'bg-neon-amber/10 text-neon-amber border-neon-amber/25' :
                          req.status === 'approved' ? 'bg-neon-green/10 text-neon-green border-neon-green/25' :
                          'bg-neon-red/10 text-neon-red border-neon-red/25'
                        }`}>
                          <span className="capitalize">{req.status}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {req.status === 'pending' ? (
                          <button
                            onClick={async () => {
                              setApproving(req.id);
                              const { data, error } = await supabase.rpc('approve_credit_request', { req_id: req.id });
                              if (error) {
                                console.error('Approval failed:', error.message);
                                setApproving(null);
                                return;
                              }
                              const result = data as { success: boolean; error?: string } | null;
                              if (result?.success) {
                                await fetchCreditRequests();
                              } else {
                                console.error('Approval failed:', result?.error ?? 'Unknown error');
                              }
                              setApproving(null);
                            }}
                            disabled={approving === req.id}
                            className="px-3 py-1.5 rounded-lg bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25 text-xs font-bold transition-all active:scale-95"
                          >
                            {approving === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Approve'}
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Recent Transactions Table */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-neon-cyan" /> Recent Transactions
          </h3>
          <span className="text-xs text-slate-500">{transactions.length} records</span>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                <th className="text-left py-3 px-4 font-semibold">Client</th>
                <th className="text-left py-3 px-4 font-semibold hidden sm:table-cell">Plan</th>
                <th className="text-right py-3 px-4 font-semibold">Amount</th>
                <th className="text-left py-3 px-4 font-semibold hidden md:table-cell">Date</th>
                <th className="text-left py-3 px-4 font-semibold hidden lg:table-cell">Method</th>
                <th className="text-center py-3 px-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const sc = statusConfig[t.status as keyof typeof statusConfig] ?? statusConfig.completed;
                const SIcon = sc.icon;
                const pc = planConfig[t.plan_name] ?? planConfig.starter;
                return (
                  <tr key={t.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4">
                      <p className="text-sm font-semibold text-white">{t.client_name}</p>
                      <p className="text-[10px] text-slate-500">{t.client_email}</p>
                    </td>
                    <td className="py-3 px-4 hidden sm:table-cell">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-bold ${pc.bg} ${pc.color}`}>
                        {t.plan_name}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-200">
                      {fmtNum(Number(t.amount))} credits
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell text-xs text-slate-500 font-mono">
                      {new Date(t.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell text-xs text-slate-400">
                      {t.payment_method ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold border ${sc.bg} ${sc.color} ${sc.border}`}>
                        <SIcon className="w-3 h-3" />
                        <span className="capitalize">{t.status}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
