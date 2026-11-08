import { BrainCircuit, Radio, AlertTriangle, LogOut, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLivePrices } from '@/hooks/useLivePrices';

interface Props {
  onPanic: () => void;
}

export default function TopNav({ onPanic }: Props) {
  const { user, signOut } = useAuth();
  const { coins } = useLivePrices();

  const userEmail = user?.email ?? '';
  const emailPrefix = userEmail.split('@')[0];

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-base-900/70 backdrop-blur-2xl">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-neon-cyan/20 to-neon-green/20 border border-neon-cyan/30 flex items-center justify-center neon-glow-cyan">
            <BrainCircuit className="w-5 h-5 text-neon-cyan" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-base font-bold tracking-tight">
              <span className="text-neon-cyan neon-text-cyan">Cortex</span>{' '}
              <span className="text-neon-green neon-text-green">AI</span>
            </h1>
            <p className="text-[10px] text-slate-500 -mt-0.5">Next-Gen Trading Intelligence</p>
          </div>
        </div>

        {/* Ticker - hidden on small screens */}
        <div className="hidden lg:flex flex-1 overflow-hidden mx-2">
          {coins.length > 0 ? (
            <div className="flex gap-6 animate-ticker whitespace-nowrap text-xs">
              {[...coins, ...coins].map((t, i) => (
                <span key={i} className="flex items-center gap-1.5 font-mono">
                  <span className="text-slate-400">{t.symbol}</span>
                  <span className="text-slate-200">${t.price.toLocaleString()}</span>
                  <span className={t.change24h >= 0 ? 'text-neon-green' : 'text-neon-red'}>
                    {t.change24h >= 0 ? '+' : ''}{t.change24h.toFixed(2)}%
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Radio className="w-3 h-3 animate-pulse" />
              <span>Connecting to live market data...</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {/* LIVE indicator */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl glass">
            <Radio className="w-4 h-4 text-neon-red animate-pulse" />
            <span className="text-xs font-semibold text-neon-red neon-text-red">LIVE</span>
          </div>

          {/* Panic Button */}
          <button
            onClick={onPanic}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl bg-neon-red/15 border border-neon-red/40 text-neon-red font-bold text-xs hover:bg-neon-red/25 neon-glow-red transition-all duration-200 active:scale-95 group"
          >
            <AlertTriangle className="w-4 h-4 group-hover:animate-pulse" />
            <span className="hidden sm:inline">PANIC</span>
            <span className="hidden md:inline">Liquidate All</span>
          </button>

          {/* User + Sign Out */}
          <div className="flex items-center gap-2">
            <div className="hidden xl:flex items-center gap-2 px-3 py-2 rounded-xl glass">
              <User className="w-4 h-4 text-neon-cyan" />
              <span className="text-xs text-slate-300 max-w-[120px] truncate">{emailPrefix}</span>
            </div>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass hover:bg-neon-red/15 hover:border-neon-red/30 transition-all duration-200"
              title="Sign out"
            >
              <LogOut className="w-4 h-4 text-slate-400 hover:text-neon-red" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
