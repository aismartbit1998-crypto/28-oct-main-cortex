import { useEffect, useState } from 'react';
import { Menu, X, Loader2, ShieldX, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase, type RiskSettings } from '@/lib/supabase';
import AuthScreen from '@/components/AuthScreen';
import AdminSidebar, { type AdminViewId } from '@/components/admin/AdminSidebar';
import AdminTopNav from '@/components/admin/AdminTopNav';
import AdminDashboard from '@/views/admin/AdminDashboard';
import AdminBots from '@/views/admin/AdminBots';
import AdminClients from '@/views/admin/AdminClients';
import AdminLicenses from '@/views/admin/AdminLicenses';
import AdminAdmins from '@/views/admin/AdminAdmins';
import AdminRiskControl from '@/views/admin/AdminRiskControl';
import AdminSystemSettings from '@/views/admin/AdminSystemSettings';
import AdminPaymentAnalytics from '@/views/admin/AdminPaymentAnalytics';
import AdminApiControl from '@/views/admin/AdminApiControl';
import AdminCreditRequests from '@/views/admin/AdminCreditRequests';
import AdminPlanLimits from '@/views/admin/AdminPlanLimits';
import BuyCreditsModal from '@/components/admin/BuyCreditsModal';
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';

const viewTitles: Record<AdminViewId, string> = {
  'dashboard': 'Dashboard',
  'bots': 'AI Smart Bots',
  'clients': 'Clients',
  'licenses': 'Licenses',
  'admins': 'Admins',
  'risk-control': 'Risk Control',
  'system-settings': 'System Settings',
  'payment-analytics': 'Payment & Revenue',
  'credit-requests': 'Credit Requests',
  'api-control': 'Master API Control',
  'plan-limits': 'Plan Limits',
};

// Hash-based URL routing for the admin panel.
// Admin views live under #admin/<view>. On load and on hashchange, the active
// view is read from the URL so a refresh keeps the admin on the same page.
function getAdminViewFromHash(): AdminViewId {
  const hash = window.location.hash;
  if (!hash || !hash.startsWith('#admin')) return 'dashboard';
  const parts = hash.replace(/^#admin\/?/, '').split('/');
  const view = (parts[0] || 'dashboard') as AdminViewId;
  const validViews: AdminViewId[] = [
    'dashboard', 'bots', 'clients', 'licenses', 'admins',
    'risk-control', 'system-settings', 'payment-analytics',
    'credit-requests', 'api-control', 'plan-limits',
  ];
  return validViews.includes(view) ? view : 'dashboard';
}

function setAdminViewInHash(view: AdminViewId) {
  const target = `#admin/${view}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

export default function AdminApp() {
  const { session, loading } = useAuth();
  const [activeView, setActiveView] = useState<AdminViewId>(() => getAdminViewFromHash());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [riskSettings, setRiskSettings] = useState<RiskSettings | null>(null);
  const [riskLoading, setRiskLoading] = useState(true);
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isSubAdmin, setIsSubAdmin] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [creditBalance, setCreditBalance] = useState(0);

  // Sync URL hash → active admin view (handles browser back/forward and refresh).
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash.startsWith('#admin')) {
        setActiveView(getAdminViewFromHash());
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Sync active admin view → URL hash.
  useEffect(() => {
    setAdminViewInHash(activeView);
  }, [activeView]);

  const userId = session?.user?.id;
  const isMasterEmail = session?.user?.email === 'vinodbardev@gmail.com';

  // Single source of truth for credit balance — fetch + Realtime subscription
  useEffect(() => {
    if (!userId) {
      setCreditBalance(0);
      return;
    }

    const fetchCredits = async () => {
      const { data } = await supabase
        .from('admin_roles')
        .select('credit_balance')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      const balance = (data as { credit_balance: number } | null)?.credit_balance;
      if (typeof balance === 'number') setCreditBalance(balance);
    };

    fetchCredits();

    const channel = supabase
      .channel(`admin_roles_credits_${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'admin_roles',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const newBalance = (payload.new as { credit_balance?: number })?.credit_balance;
        if (typeof newBalance === 'number') setCreditBalance(newBalance);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      setRiskSettings(null);
      setRiskLoading(false);
      setIsAdmin(false);
      setIsSuperAdmin(false);
      setIsSubAdmin(false);
      setAdminChecked(true);
      setAdminError(null);
      return () => { cancelled = true; };
    }

    setAdminChecked(false);
    setAdminError(null);

    const loadAdminAccess = async () => {
      let determinedAdmin = false;
      let determinedSuperAdmin = false;
      let determinedSubAdmin = false;
      let errorMsg: string | null = null;

      const isMasterEmail = session?.user?.email === 'vinodbardev@gmail.com';
      if (isMasterEmail) {
        determinedAdmin = true;
        determinedSuperAdmin = true;
      }

      try {
        const roleResult = await supabase
          .from('admin_roles')
          .select('role, email, user_id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();

        if (cancelled) return;

        if (roleResult.error) {
          errorMsg = `Role query: ${roleResult.error.message}`;
        }

        const roleRow = roleResult.data as { role: string; email: string; user_id: string | null } | null;

        if (roleRow) {
          determinedSuperAdmin = roleRow.role === 'super_admin';
          determinedSubAdmin = roleRow.role === 'sub_admin';
          determinedAdmin = determinedSuperAdmin || determinedSubAdmin;
        }

        if (!determinedAdmin && !cancelled) {
          const { data: rpcResult, error: rpcError } = await supabase.rpc('is_platform_admin');
          if (cancelled) return;
          if (rpcError) {
            errorMsg = (errorMsg ? errorMsg + ' | ' : '') + `RPC: ${rpcError.message}`;
          } else if (rpcResult === true) {
            determinedAdmin = true;
          }
        }

        if (cancelled) return;

        setIsAdmin(determinedAdmin);
        setIsSuperAdmin(determinedSuperAdmin);
        setIsSubAdmin(determinedSubAdmin);
        setAdminChecked(true);
        setAdminError(determinedAdmin ? null : errorMsg);

        const { data: riskData, error: riskError } = await supabase
          .from('risk_settings')
          .select('*')
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (riskError) {
          setRiskSettings(null);
        } else {
          setRiskSettings(riskData as RiskSettings | null);
        }
      } catch (err) {
        if (!cancelled) {
          setRiskSettings(null);
          const msg = err instanceof Error ? err.message : String(err);
          setAdminError(msg);
          setAdminChecked(true);
        }
      } finally {
        if (!cancelled) {
          setRiskLoading(false);
          setAdminChecked(true);
        }
      }
    };

    void loadAdminAccess();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggleKillSwitch = async () => {
    if (!riskSettings) return;
    const newVal = !riskSettings.global_kill_switch;
    const prevSettings = riskSettings;
    setRiskSettings({ ...riskSettings, global_kill_switch: newVal });
    const { error } = await supabase
      .from('risk_settings')
      .update({ global_kill_switch: newVal, updated_at: new Date().toISOString() })
      .eq('id', riskSettings.id);

    if (error) {
      setRiskSettings(prevSettings);
      setAdminError(`Kill switch update failed: ${error.message}`);
      return;
    }

    // When activating the kill switch, immediately pause ALL running/paper
    // bots via direct DB update (reliable), then invoke the panic-sell edge
    // function to liquidate open positions (supplementary). We do NOT rely on
    // the edge function succeeding — invoke() returns { data, error } instead
    // of throwing, so a catch block would never fire on HTTP errors.
    if (newVal) {
      const { error: pauseErr } = await supabase
        .from('bots')
        .update({ status: 'paused' })
        .in('status', ['running', 'paper']);

      if (pauseErr) {
        setAdminError(`Kill switch active but failed to pause bots: ${pauseErr.message}`);
      }

      const { error: panicError } = await supabase.functions.invoke('trigger-panic-sell', {
        body: { mode: 'admin' },
      });

      if (panicError) {
        const msg = panicError instanceof Error ? panicError.message : String(panicError);
        setAdminError(prev => prev ? `${prev} | Panic-sell failed: ${msg}` : `Panic-sell edge function failed: ${msg}`);
      }
    }
  };

  const renderView = () => {
    // Sub-admin access restrictions: redirect blocked views to dashboard
    if (isSubAdmin) {
      if (activeView === 'admins' || activeView === 'api-control' || activeView === 'risk-control' || activeView === 'plan-limits') {
        setActiveView('dashboard');
        return null;
      }
    }
    switch (activeView) {
      case 'dashboard': return <AdminDashboard isSuperAdmin={isSuperAdmin || session?.user?.email === 'vinodbardev@gmail.com'} onNavigate={setActiveView} />;
      case 'bots': return <AdminBots isSubAdmin={isSubAdmin} />;
      case 'clients': return <AdminClients />;
      case 'licenses': return <AdminLicenses creditBalance={creditBalance} onCreditsChange={() => {
        // Realtime will update creditBalance automatically, but also do a manual fetch as fallback
        if (userId) supabase.from('admin_roles').select('credit_balance').eq('user_id', userId).eq('is_active', true).maybeSingle().then(({ data }) => {
          const b = (data as { credit_balance: number } | null)?.credit_balance;
          if (typeof b === 'number') setCreditBalance(b);
        });
      }} />;
      case 'admins': return isSubAdmin ? null : <AdminAdmins />;
      case 'risk-control': return isSubAdmin ? null : <AdminRiskControl />;
      case 'system-settings': return <AdminSystemSettings isSubAdmin={isSubAdmin} adminUserId={userId} />;
      case 'payment-analytics': return <AdminPaymentAnalytics isSubAdmin={isSubAdmin} />;
      case 'credit-requests': return <AdminCreditRequests isSubAdmin={isSubAdmin} />;
      case 'api-control': return isSubAdmin ? null : <AdminApiControl />;
      case 'plan-limits': return isSubAdmin ? null : <AdminPlanLimits />;
      default: return <AdminDashboard isSuperAdmin={isSuperAdmin || session?.user?.email === 'vinodbardev@gmail.com'} onNavigate={setActiveView} />;
    }
  };

  if (loading && !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-neon-amber animate-spin" />
          <p className="text-sm text-slate-400">Loading Admin Panel...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!adminChecked || riskLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-neon-amber animate-spin" />
          <p className="text-sm text-slate-400">Verifying admin access...</p>
        </div>
      </div>
    );
  }

  const hasAuthorizedAdminAccess = isSuperAdmin || isSubAdmin;

  if (!hasAuthorizedAdminAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-neon-red/10 border border-neon-red/30 flex items-center justify-center">
            <ShieldX className="w-8 h-8 text-neon-red" />
          </div>
          <h1 className="text-xl font-bold text-white">Access Denied</h1>
          <p className="text-sm text-slate-400">
            You do not have permission to access the Master Admin Panel.
            This area is restricted to authorized administrators only.
          </p>
          {adminError && (
            <div className="mt-2 w-full rounded-xl border border-neon-amber/20 bg-neon-amber/[0.04] p-3 flex items-start gap-2 text-left">
              <AlertTriangle className="w-4 h-4 text-neon-amber flex-shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300">
                <p className="font-semibold text-neon-amber mb-1">Diagnostic info</p>
                <p className="font-mono text-slate-400 break-all">{adminError}</p>
                <p className="mt-2 text-slate-500">
                  User ID: <span className="font-mono text-slate-400">{userId}</span>
                </p>
              </div>
            </div>
          )}
          <button
            onClick={() => { window.location.hash = ''; window.location.reload(); }}
            className="px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-sm text-slate-200 border border-white/[0.08] transition-all"
          >
            Back to Cortex AI
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <ImpersonationBanner />
      <AdminTopNav
        killSwitchActive={riskSettings?.global_kill_switch ?? false}
        onToggleKill={toggleKillSwitch}
        isSuperAdmin={isSuperAdmin || session?.user?.email === 'vinodbardev@gmail.com'}
        isSubAdmin={isSubAdmin}
        creditBalance={creditBalance}
        onBuyCredits={() => setShowBuyCredits(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-64 flex-shrink-0 border-r border-white/[0.06] bg-base-850/50 backdrop-blur-sm">
          <AdminSidebar active={activeView} onSelect={setActiveView} isSubAdmin={isSubAdmin} />
        </aside>

        {/* Mobile sidebar */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-[90] flex">
            <div className="absolute inset-0 bg-base-900/70 backdrop-blur-md" onClick={() => setSidebarOpen(false)} />
            <div className="relative w-64 h-full bg-base-850 border-r border-white/[0.06] animate-slide-up">
              <button
                onClick={() => setSidebarOpen(false)}
                className="absolute top-3 right-3 z-10 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              <AdminSidebar active={activeView} onSelect={setActiveView} isSubAdmin={isSubAdmin} onClose={() => setSidebarOpen(false)} />
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Mobile header */}
          <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-base-850/50 backdrop-blur-sm sticky top-0 z-30">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
            >
              <Menu className="w-5 h-5" />
              Menu
            </button>
            <span className="text-sm font-semibold text-white">{viewTitles[activeView]}</span>
          </div>

          <div className="p-4 sm:p-6 max-w-7xl mx-auto">
            {/* Desktop breadcrumb */}
            <div className="hidden lg:flex items-center gap-2 mb-5 text-xs">
              <span className="text-neon-amber/70">Cortex Admin</span>
              <span className="text-slate-700">/</span>
              <span className="text-neon-amber font-semibold">{viewTitles[activeView]}</span>
            </div>
            {renderView()}
          </div>
        </main>
      </div>
      {showBuyCredits && isSubAdmin && (
        <BuyCreditsModal
          subAdminId={userId!}
          onClose={() => setShowBuyCredits(false)}
          onPurchased={() => {
            setShowBuyCredits(false);
          }}
        />
      )}
    </div>
  );
}
