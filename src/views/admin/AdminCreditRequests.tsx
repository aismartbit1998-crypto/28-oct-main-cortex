import { useEffect, useState, useCallback } from 'react';
import {
  Coins, Loader2, Check, X, Clock, ArrowUpRight, ArrowDownCircle,
  Plus, AlertCircle, User, Hash, IndianRupee, FileText,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import BuyCreditsModal from '@/components/admin/BuyCreditsModal';

interface CreditRequest {
  id: string;
  sub_admin_id: string;
  credits_requested: number;
  amount_paid: number;
  utr_number: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  sub_admin_email?: string;
  sub_admin_name?: string;
}

const statusConfig = {
  pending: { label: 'Pending', color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/25', icon: Clock },
  approved: { label: 'Approved', color: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/25', icon: Check },
  rejected: { label: 'Rejected', color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/25', icon: X },
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface Props {
  isSubAdmin: boolean;
}

export default function AdminCreditRequests({ isSubAdmin }: Props) {
  const { user } = useAuth();
  const [requests, setRequests] = useState<CreditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    let query = supabase.from('credit_requests').select('*').order('created_at', { ascending: false });
    if (isSubAdmin && user?.id) {
      query = query.eq('sub_admin_id', user.id);
    }
    const { data, error: fetchErr } = await query;
    if (fetchErr) {
      console.error('Failed to fetch credit requests:', fetchErr.message);
      setError(fetchErr.message);
      setRequests([]);
      setLoading(false);
      return;
    }

    const reqs = (data as CreditRequest[]) ?? [];

    if (!isSubAdmin && reqs.length > 0) {
      const adminIds = [...new Set(reqs.map((r) => r.sub_admin_id))];
      const { data: adminRows } = await supabase
        .from('admin_roles')
        .select('user_id, email, name')
        .in('user_id', adminIds);
      const adminMap = new Map((adminRows ?? []).map((a: { user_id: string; email: string; name: string | null }) => [a.user_id, a]));
      reqs.forEach((r) => {
        const admin = adminMap.get(r.sub_admin_id);
        r.sub_admin_email = admin?.email ?? undefined;
        r.sub_admin_name = admin?.name ?? undefined;
      });
    }

    setRequests(reqs);
    setError(null);
    setLoading(false);
  }, [isSubAdmin, user?.id]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleApprove = async (reqId: string) => {
    setActionLoading(reqId);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('approve_credit_request', { req_id: reqId });
    if (rpcErr) {
      setError(rpcErr.message);
      setActionLoading(null);
      return;
    }
    if (data && !(data as { success: boolean }).success) {
      setError((data as { error: string }).error);
      setActionLoading(null);
      return;
    }
    await fetchRequests();
    setActionLoading(null);
  };

  const handleReject = async (reqId: string) => {
    setActionLoading(reqId);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('reject_credit_request', { req_id: reqId });
    if (rpcErr) {
      setError(rpcErr.message);
      setActionLoading(null);
      return;
    }
    if (data && !(data as { success: boolean }).success) {
      setError((data as { error: string }).error);
      setActionLoading(null);
      return;
    }
    await fetchRequests();
    setActionLoading(null);
  };

  const filteredRequests = filter === 'all' ? requests : requests.filter((r) => r.status === filter);

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const approvedCount = requests.filter((r) => r.status === 'approved').length;
  const rejectedCount = requests.filter((r) => r.status === 'rejected').length;
  const totalCreditsApproved = requests.filter((r) => r.status === 'approved').reduce((s, r) => s + r.credits_requested, 0);

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Coins className="w-5 h-5 text-neon-amber" /> Credit Purchase Requests
          </h2>
          <p className="text-sm text-slate-400">
            {isSubAdmin ? 'Submit offline credit purchases for master admin approval' : 'Review and approve sub-admin credit purchase requests'}
          </p>
        </div>
        {isSubAdmin && (
          <button
            onClick={() => setShowBuyModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neon-amber/15 text-neon-amber border border-neon-amber/30 hover:bg-neon-amber/25 text-sm font-semibold transition-all"
          >
            <Plus className="w-4 h-4" /> New Credit Request
          </button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-amber/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Pending</p>
            <p className="text-xl font-bold text-neon-amber font-mono mt-1">{pendingCount}</p>
          </div>
        </div>
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-green/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Approved</p>
            <p className="text-xl font-bold text-neon-green font-mono mt-1">{approvedCount}</p>
          </div>
        </div>
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-red/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Rejected</p>
            <p className="text-xl font-bold text-neon-red font-mono mt-1">{rejectedCount}</p>
          </div>
        </div>
        <div className="glass-card p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-neon-cyan/10 rounded-full blur-2xl opacity-50" />
          <div className="relative">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Credits Approved</p>
            <p className="text-xl font-bold text-neon-cyan font-mono mt-1">{totalCreditsApproved.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-neon-red/10 border border-neon-red/20 text-xs text-neon-red">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
              filter === f
                ? 'bg-neon-amber/15 text-neon-amber border border-neon-amber/30'
                : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:bg-white/[0.06]'
            }`}
          >
            {f === 'all' ? 'All Requests' : f}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-neon-amber/20 text-[9px]">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Requests table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-neon-amber animate-spin" />
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="text-center py-16">
            <Coins className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-slate-500">
              {isSubAdmin ? 'No credit requests yet. Click "New Credit Request" to buy credits.' : 'No credit requests to review.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                  {!isSubAdmin && <th className="text-left px-4 py-3 font-semibold">Sub-Admin</th>}
                  <th className="text-right px-4 py-3 font-semibold">Credits</th>
                  <th className="text-right px-4 py-3 font-semibold hidden sm:table-cell">Amount Paid</th>
                  <th className="text-left px-4 py-3 font-semibold">UTR Reference</th>
                  <th className="text-center px-4 py-3 font-semibold">Status</th>
                  <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Date</th>
                  {!isSubAdmin && <th className="text-center px-4 py-3 font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req) => {
                  const sc = statusConfig[req.status];
                  const SIcon = sc.icon;
                  return (
                    <tr key={req.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                      {!isSubAdmin && (
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 flex items-center justify-center flex-shrink-0">
                              <User className="w-3.5 h-3.5 text-neon-cyan" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{req.sub_admin_name ?? req.sub_admin_email ?? 'Unknown'}</p>
                              <p className="text-[10px] text-slate-500 truncate">{req.sub_admin_email}</p>
                            </div>
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-sm font-bold text-neon-amber font-mono">{req.credits_requested.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right hidden sm:table-cell">
                        <span className="text-sm text-slate-300 font-mono">
                          {req.amount_paid > 0 ? `₹${req.amount_paid.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <Hash className="w-3 h-3 text-slate-500 flex-shrink-0" />
                          <span className="text-xs text-slate-300 font-mono truncate max-w-[160px]">{req.utr_number}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md ${sc.bg} ${sc.border} border text-[11px] font-bold ${sc.color}`}>
                          <SIcon className="w-3 h-3" /> {sc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <span className="text-[11px] text-slate-400">{formatRelativeTime(req.created_at)}</span>
                      </td>
                      {!isSubAdmin && (
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-center gap-1.5">
                            {req.status === 'pending' ? (
                              <>
                                <button
                                  onClick={() => handleApprove(req.id)}
                                  disabled={actionLoading === req.id}
                                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25 text-xs font-bold transition-all whitespace-nowrap"
                                >
                                  {actionLoading === req.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleReject(req.id)}
                                  disabled={actionLoading === req.id}
                                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neon-red/10 text-neon-red border border-neon-red/20 hover:bg-neon-red/20 text-xs font-bold transition-all whitespace-nowrap"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  Reject
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-slate-600 italic">Processed</span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sub-admin info panel */}
      {isSubAdmin && (
        <div className="glass-card p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-neon-cyan" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white mb-1">How offline credit purchases work</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                1 credit = ₹10. Transfer funds to the Master Admin via UPI or bank transfer, then submit your UTR reference here.
                The Master Admin will verify your payment and approve credits to your balance. Approved credits can be used to
                assign licenses to your clients.
              </p>
            </div>
          </div>
        </div>
      )}

      {showBuyModal && user?.id && (
        <BuyCreditsModal
          subAdminId={user.id}
          onClose={() => setShowBuyModal(false)}
          onPurchased={() => {
            setShowBuyModal(false);
            fetchRequests();
          }}
        />
      )}
    </div>
  );
}
