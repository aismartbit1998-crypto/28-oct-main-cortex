import {
  LayoutDashboard, Bot, Users, KeyRound, ShieldCheck,
  AlertTriangle, Settings, ChevronRight, Wallet, SlidersHorizontal,
  Coins, Crown,
} from 'lucide-react';

export type AdminViewId =
  | 'dashboard' | 'bots' | 'clients' | 'licenses'
  | 'admins' | 'risk-control' | 'system-settings' | 'payment-analytics' | 'api-control' | 'credit-requests' | 'plan-limits';

interface NavItem {
  id: AdminViewId;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'bots', label: 'AI Smart Bots', icon: Bot },
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'licenses', label: 'Licenses', icon: KeyRound },
  { id: 'payment-analytics', label: 'Payment & Revenue', icon: Wallet, badge: 'NEW' },
  { id: 'credit-requests', label: 'Credit Requests', icon: Coins, badge: 'NEW' },
  { id: 'plan-limits', label: 'Plan Limits', icon: Crown, badge: 'NEW' },
  { id: 'admins', label: 'Admins', icon: ShieldCheck },
  { id: 'risk-control', label: 'Risk Control', icon: AlertTriangle },
  { id: 'api-control', label: 'Master API Control', icon: SlidersHorizontal, badge: 'NEW' },
  { id: 'system-settings', label: 'System Settings', icon: Settings },
];

interface Props {
  active: AdminViewId;
  onSelect: (id: AdminViewId) => void;
  onClose?: () => void;
  isSubAdmin?: boolean;
}

export default function AdminSidebar({ active, onSelect, onClose, isSubAdmin }: Props) {
  const visibleItems = navItems.filter(item => {
    if (isSubAdmin && (item.id === 'admins' || item.id === 'api-control' || item.id === 'risk-control' || item.id === 'plan-limits')) {
      return false;
    }
    return true;
  });
  return (
    <nav className="h-full flex flex-col py-4 px-3 overflow-y-auto scrollbar-thin">
      {/* Admin label */}
      <div className="px-3 mb-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neon-amber/5 border border-neon-amber/15">
          <ShieldCheck className="w-4 h-4 text-neon-amber" />
          <span className="text-xs font-bold text-neon-amber tracking-wide">{isSubAdmin ? 'RESELLER PANEL' : 'MASTER ADMIN'}</span>
        </div>
      </div>

      <div className="space-y-1">
        {visibleItems.map((item) => {
          const isActive = active === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => {
                onSelect(item.id);
                onClose?.();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative ${
                isActive
                  ? 'bg-gradient-to-r from-neon-amber/10 to-transparent text-white border border-neon-amber/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-neon-amber" style={{ boxShadow: '0 0 10px rgba(255, 176, 32, 0.5)' }} />
              )}
              <Icon className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${isActive ? 'text-neon-amber' : 'text-slate-500 group-hover:text-slate-300'}`} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.badge && (
                <span className="px-1.5 py-0.5 rounded-md bg-neon-green/15 text-neon-green text-[9px] font-bold tracking-wide neon-glow-green">
                  {item.badge}
                </span>
              )}
              {isActive && <ChevronRight className="w-4 h-4 text-neon-amber/50" />}
            </button>
          );
        })}
      </div>

      {/* Back to client app */}
      <div className="mt-auto px-3 pt-4 border-t border-white/[0.04]">
        <button
          onClick={() => { window.location.hash = ''; window.location.reload(); }}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] transition-all"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Back to Cortex AI
        </button>
        <p className="text-[10px] text-slate-600 mt-2">Admin Panel v2.0</p>
      </div>
    </nav>
  );
}
