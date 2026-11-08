import { useState, useEffect } from 'react';
import { Menu, X, Loader2, Lock } from 'lucide-react';
import { AppProvider } from '@/context/AppContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import AuthScreen from '@/components/AuthScreen';
import RiskDisclaimerModal from '@/components/RiskDisclaimerModal';
import TopNav from '@/components/TopNav';
import Sidebar, { type ViewId } from '@/components/Sidebar';
import Footer from '@/components/Footer';
import PanicModal from '@/components/PanicModal';
import AdminApp from '@/components/admin/AdminApp';
import DashboardView from '@/views/DashboardView';
import AISmartBotView from '@/views/AISmartBotView';
import TradingStatusView from '@/views/TradingStatusView';
import SignalsView from '@/views/SignalsView';
import CryptoView from '@/views/CryptoView';
import CopyTradingView from '@/views/CopyTradingView';
import TradeHistoryView from '@/views/TradeHistoryView';
import PerformanceAnalyticsView from '@/views/PerformanceAnalyticsView';
import WalletView from '@/views/WalletView';
import MySubscriptionView from '@/views/MySubscriptionView';
import ConnectBrokerView from '@/views/ConnectBrokerView';
import BrokerResponseView from '@/views/BrokerResponseView';
import TutorialsView from '@/views/TutorialsView';
import FAQView from '@/views/FAQView';
import HelpCenterView from '@/views/HelpCenterView';
import ReportBugView from '@/views/ReportBugView';
import RealtimeToast from '@/components/RealtimeToast';
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';
import { supabase } from '@/lib/supabase';
import { useFeatureFlags, type FeatureKey } from '@/lib/featureFlags';

function isAdminRoute() {
  const hash = window.location.hash;
  // Admin routes: #admin, #admin/<view>
  return hash === '#admin' || hash.startsWith('#admin/');
}

// Hash-based URL routing for the client app.
// Reads the current view from the URL hash (#/<viewId>) so a page refresh
// keeps the user on the same view. Falls back to 'dashboard' when empty.
function getViewFromHash(): ViewId {
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#admin' || hash.startsWith('#admin/')) return 'dashboard';
  // Strip leading # and optional /
  const view = hash.replace(/^#\/?/, '').split('/')[0] as ViewId;
  const validViews: ViewId[] = [
    'dashboard', 'ai-smart-bot', 'trading-status', 'signals',
    'crypto', 'copy-trading', 'trade-history', 'performance-analytics', 'wallet',
    'connect-broker', 'broker-response', 'my-subscription', 'tutorials', 'faq',
    'help-center', 'report-bug',
  ];
  return validViews.includes(view) ? view : 'dashboard';
}

function setViewInHash(view: ViewId) {
  const target = `#/${view}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

const viewTitles: Record<ViewId, string> = {
  'dashboard': 'Dashboard',
  'ai-smart-bot': 'AI Smart Bot',
  'trading-status': 'Trading Status',
  'signals': 'Signals',
  'crypto': 'Crypto',
  'copy-trading': 'Copy Trading Marketplace',
  'trade-history': 'Trade History',
  'performance-analytics': 'Performance Analytics',
  'wallet': 'Wallet & Calculation',
  'my-subscription': 'My Subscription',
  'connect-broker': 'Connect Your Broker',
  'broker-response': 'Broker Response',
  'tutorials': 'Tutorials & Guides',
  'faq': 'FAQ',
  'help-center': 'Help Center',
  'report-bug': 'Report Bug',
};

const FEATURE_FLAG_VIEWS: Partial<Record<ViewId, FeatureKey>> = {
  'signals': 'signals',
  'crypto': 'crypto_view',
  'copy-trading': 'copy_trading',
  'trade-history': 'trade_history',
  'performance-analytics': 'performance_analytics',
  'wallet': 'wallet',
};

function AppContent() {
  const { session, profile, loading, refreshProfile, hasActiveLicense } = useAuth();
  const { isFeatureOn } = useFeatureFlags();
  const [activeView, setActiveView] = useState<ViewId>(() => getViewFromHash());
  const [panicOpen, setPanicOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panicLoading, setPanicLoading] = useState(false);
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceChecked, setMaintenanceChecked] = useState(false);

  const showDisclaimer = session?.user && (!profile || !profile.disclaimer_accepted);
  const isLocked = !hasActiveLicense;

  useEffect(() => {
    let active = true;
    supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'maintenance_mode')
      .is('admin_id', null)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setMaintenanceMode(data?.value === 'true');
        setMaintenanceChecked(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (maintenanceChecked && maintenanceMode) {
      const channel = supabase
        .channel('maintenance_mode_watch')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'system_settings',
          filter: 'key=eq.maintenance_mode',
        }, (payload) => {
          setMaintenanceMode((payload.new as { value?: string })?.value === 'true');
        })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }
  }, [maintenanceChecked, maintenanceMode]);

  // Sync URL hash → active view (handles browser back/forward and refresh).
  useEffect(() => {
    const onHashChange = () => {
      if (!isAdminRoute()) {
        setActiveView(getViewFromHash());
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Sync active view → URL hash (so the URL always reflects the current page).
  useEffect(() => {
    if (!isAdminRoute()) {
      setViewInHash(activeView);
    }
  }, [activeView]);

  useEffect(() => {
    const flagKey = FEATURE_FLAG_VIEWS[activeView];
    if (flagKey && !isFeatureOn(flagKey)) {
      setActiveView('dashboard');
    }
  }, [activeView, isFeatureOn]);

  // Internal 'navigate' events update the hash, which the hashchange listener
  // picks up to set the view — keeping the URL as the single source of truth.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail as ViewId;
      if (detail) {
        // Going to admin via navigate event uses the #admin hash.
        if (detail === 'admin' as unknown as ViewId) {
          window.location.hash = 'admin';
        } else {
          setViewInHash(detail);
        }
      }
    };
    const onLockClick = () => setLockModalOpen(true);
    window.addEventListener('navigate', onNavigate);
    window.addEventListener('license-locked-click', onLockClick);
    return () => {
      window.removeEventListener('navigate', onNavigate);
      window.removeEventListener('license-locked-click', onLockClick);
    };
  }, []);

  const handlePanicConfirm = async () => {
    setPanicLoading(true);
    try {
      await supabase.functions.invoke('trigger-panic-sell', {
        body: JSON.stringify({ mode: 'user' }),
      });
    } catch {
      // Even if the edge function fails, pause bots as a fallback
      const { error: pauseErr } = await supabase.from('bots').update({ status: 'paused' }).neq('status', 'paused');
      if (pauseErr) console.error('Panic fallback bot pause failed:', pauseErr.message);
    }
    setPanicLoading(false);
  };

  const renderView = () => {
    switch (activeView) {
      case 'dashboard': return <DashboardView />;
      case 'ai-smart-bot': return <AISmartBotView />;
      case 'trading-status': return <TradingStatusView />;
      case 'signals': return <SignalsView />;
      case 'crypto': return <CryptoView />;
      case 'copy-trading': return <CopyTradingView />;
      case 'trade-history': return <TradeHistoryView />;
      case 'performance-analytics': return <PerformanceAnalyticsView />;
      case 'wallet': return <WalletView />;
      case 'my-subscription': return <MySubscriptionView />;
      case 'connect-broker': return <ConnectBrokerView />;
      case 'broker-response': return <BrokerResponseView />;
      case 'tutorials': return <TutorialsView />;
      case 'faq': return <FAQView />;
      case 'help-center': return <HelpCenterView />;
      case 'report-bug': return <ReportBugView />;
      default: return <DashboardView />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-neon-cyan animate-spin" />
          <p className="text-sm text-slate-400">Loading Cortex AI...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (maintenanceChecked && maintenanceMode) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-neon-amber/10 border border-neon-amber/30 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-neon-amber animate-spin" />
          </div>
          <h1 className="text-xl font-bold text-white">System Under Maintenance</h1>
          <p className="text-sm text-slate-400">
            Cortex AI is currently undergoing scheduled maintenance. Please check back shortly.
          </p>
          <button
            onClick={() => { window.location.reload(); }}
            className="px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-sm text-slate-200 border border-white/[0.08] transition-all"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {showDisclaimer && (
        <RiskDisclaimerModal onProceed={async () => { await refreshProfile(); }} />
      )}

      <ImpersonationBanner />
      <TopNav onPanic={() => setPanicOpen(true)} />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-64 flex-shrink-0 border-r border-white/[0.06] bg-base-850/50 backdrop-blur-sm">
          <Sidebar active={activeView} onSelect={setActiveView} locked={isLocked} />
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
              <Sidebar active={activeView} onSelect={setActiveView} onClose={() => setSidebarOpen(false)} locked={isLocked} />
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
              <span className="text-slate-500">Cortex AI</span>
              <span className="text-slate-700">/</span>
              <span className="text-neon-cyan font-semibold">{viewTitles[activeView]}</span>
            </div>
            {renderView()}
          </div>
          <Footer />
        </main>
      </div>

      <PanicModal open={panicOpen} onClose={() => setPanicOpen(false)} onConfirm={handlePanicConfirm} />
      {lockModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-base-900/80 backdrop-blur-sm" onClick={() => setLockModalOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-neon-amber/20 bg-base-850 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-neon-amber/10 border border-neon-amber/20 flex items-center justify-center">
                <Lock className="w-5 h-5 text-neon-amber" />
              </div>
              <h3 className="text-lg font-bold text-white">Feature Locked</h3>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed mb-5">
              You don't have an active plan. Please ask your admin to upgrade you to a Starter, Pro, or Enterprise plan to unlock this feature.
            </p>
            <button
              onClick={() => setLockModalOpen(false)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.1] transition-colors text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
      <RealtimeToast />
    </div>
  );
}

function AppRouter() {
  const { impersonating } = useAuth();
  const [adminRoute, setAdminRoute] = useState(isAdminRoute());

  useEffect(() => {
    const onHashChange = () => setAdminRoute(isAdminRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // When admin impersonates a user, switch to the user panel regardless of route
  const showAdmin = adminRoute && !impersonating;

  return showAdmin ? <AdminApp /> : <AppContent />;
}

function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <AppRouter />
      </AppProvider>
    </AuthProvider>
  );
}

export default App;
