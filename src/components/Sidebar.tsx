import { useState } from 'react';
import {
  LayoutDashboard, Bot, Activity, Radio, Bitcoin,
  History, Wallet, Plug, Server, BookOpen,
  HelpCircle, LifeBuoy, Bug, ChevronRight, ShieldCheck, Copy, KeyRound, BarChart3,
  Lock,
} from 'lucide-react';
import { useFeatureFlags, type FeatureKey } from '@/lib/featureFlags';

export type ViewId =
  | 'dashboard' | 'ai-smart-bot' | 'trading-status' | 'signals' | 'crypto'
  | 'copy-trading' | 'trade-history' | 'performance-analytics' | 'wallet' | 'connect-broker' | 'broker-response'
  | 'my-subscription' | 'tutorials' | 'faq' | 'help-center' | 'report-bug';

interface NavItem {
  id: ViewId;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
  locked?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const LOCKED_VIEWS: ViewId[] = [
  'ai-smart-bot', 'trading-status', 'signals',
  'copy-trading', 'performance-analytics',
];

const FEATURE_FLAG_MAP: Record<ViewId, FeatureKey | null> = {
  'dashboard': null,
  'ai-smart-bot': null,
  'trading-status': null,
  'signals': 'signals',
  'crypto': 'crypto_view',
  'copy-trading': 'copy_trading',
  'trade-history': 'trade_history',
  'performance-analytics': 'performance_analytics',
  'wallet': 'wallet',
  'connect-broker': null,
  'broker-response': null,
  'my-subscription': null,
  'tutorials': null,
  'faq': null,
  'help-center': null,
  'report-bug': null,
};

function buildGroups(locked: boolean, isFeatureOn: (key: FeatureKey) => boolean): NavGroup[] {
  const markLocked = (id: ViewId, item: Omit<NavItem, 'id'>): NavItem => ({
    id,
    ...item,
    locked: locked && LOCKED_VIEWS.includes(id),
  });

  const allTradingItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    markLocked('ai-smart-bot', { label: 'AI Smart Bot', icon: Bot, badge: 'NEW' }),
    markLocked('trading-status', { label: 'Trading Status', icon: Activity }),
    { id: 'trade-history', label: 'Trade History', icon: History },
    { id: 'crypto', label: 'Crypto', icon: Bitcoin },
    markLocked('signals', { label: 'Signals', icon: Radio }),
    markLocked('copy-trading', { label: 'Copy Trading Marketplace', icon: Copy, badge: 'NEW' }),
    markLocked('performance-analytics', { label: 'Performance Analytics', icon: BarChart3, badge: 'NEW' }),
    { id: 'wallet', label: 'Wallet & Calculation', icon: Wallet },
    { id: 'my-subscription', label: 'My Subscription', icon: KeyRound, badge: 'NEW' },
    { id: 'connect-broker', label: 'Connect Your Broker', icon: Plug },
    { id: 'broker-response', label: 'Broker Response', icon: Server },
  ];

  const filteredTrading = allTradingItems.filter((item) => {
    const flagKey = FEATURE_FLAG_MAP[item.id];
    if (!flagKey) return true;
    return isFeatureOn(flagKey);
  });

  return [
    {
      title: 'TRADING WORKFLOW',
      items: filteredTrading,
    },
    {
      title: 'SUPPORT',
      items: [
        { id: 'tutorials', label: 'Tutorials & Guides', icon: BookOpen },
        { id: 'faq', label: 'FAQ', icon: HelpCircle },
        { id: 'help-center', label: 'Help Center', icon: LifeBuoy },
        { id: 'report-bug', label: 'Report Bug', icon: Bug },
      ],
    },
  ];
}

interface Props {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  onClose?: () => void;
  locked?: boolean;
}

export default function Sidebar({ active, onSelect, onClose, locked = false }: Props) {
  const { isFeatureOn } = useFeatureFlags();
  const groups = buildGroups(locked, isFeatureOn);

  const handleClick = (item: NavItem) => {
    if (item.locked) {
      window.dispatchEvent(new CustomEvent('license-locked-click'));
      return;
    }
    onSelect(item.id);
    onClose?.();
  };

  return (
    <nav className="h-full flex flex-col py-4 px-3 overflow-y-auto scrollbar-thin">
      {locked && (
        <div className="mb-3 mx-1 px-3 py-2.5 rounded-xl bg-neon-amber/10 border border-neon-amber/20">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-neon-amber flex-shrink-0" />
            <p className="text-[11px] font-semibold text-neon-amber leading-tight">
              Account Locked — No Active Plan
            </p>
          </div>
          <p className="text-[10px] text-neon-amber/60 mt-1 leading-tight">
            Ask your admin to assign a plan to unlock trading.
          </p>
        </div>
      )}
      {groups.map((group) => (
        <div key={group.title} className="mb-5">
          <p className="px-3 mb-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
            {group.title}
          </p>
          <div className="space-y-1">
            {group.items.map((item) => {
              const isActive = active === item.id && !item.locked;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative ${
                    isActive
                      ? 'bg-gradient-to-r from-neon-cyan/10 to-transparent text-white border border-neon-cyan/20'
                      : item.locked
                        ? 'text-slate-600 border border-transparent cursor-not-allowed'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-neon-cyan neon-glow-cyan" />
                  )}
                  <Icon className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${isActive ? 'text-neon-cyan' : item.locked ? 'text-slate-700' : 'text-slate-500 group-hover:text-slate-300'}`} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.locked && (
                    <Lock className="w-3 h-3 text-slate-700 flex-shrink-0" />
                  )}
                  {item.badge && !item.locked && (
                    <span className="px-1.5 py-0.5 rounded-md bg-neon-green/15 text-neon-green text-[9px] font-bold tracking-wide neon-glow-green">
                      {item.badge}
                    </span>
                  )}
                  {isActive && <ChevronRight className="w-4 h-4 text-neon-cyan/50" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Admin link + version */}
      <div className="mt-auto px-3 pt-4 border-t border-white/[0.04] space-y-2">
        <button
          onClick={() => { window.location.hash = 'admin'; }}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-neon-amber/80 hover:text-neon-amber bg-neon-amber/5 hover:bg-neon-amber/10 border border-neon-amber/15 transition-all"
        >
          <ShieldCheck className="w-4 h-4" />
          Master Admin Panel
          <ChevronRight className="w-3.5 h-3.5 ml-auto" />
        </button>
        <p className="text-[10px] text-slate-600">Cortex AI v3.2.1</p>
        <p className="text-[10px] text-slate-700">Neural Engine: Online</p>
      </div>
    </nav>
  );
}
