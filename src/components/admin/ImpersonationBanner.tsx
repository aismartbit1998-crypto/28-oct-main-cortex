import { LogIn, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function ImpersonationBanner() {
  const { impersonating, stopImpersonation } = useAuth();
  if (!impersonating) return null;
  return (
    <div className="sticky top-0 z-[80] w-full px-4 py-2 bg-neon-amber/15 border-b border-neon-amber/40 backdrop-blur-md flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs">
        <LogIn className="w-4 h-4 text-neon-amber flex-shrink-0" />
        <span className="text-slate-300">
          You are viewing as{' '}
          <span className="font-bold text-neon-amber">{impersonating.email}</span>
        </span>
      </div>
      <button
        onClick={stopImpersonation}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neon-amber/20 border border-neon-amber/40 text-neon-amber hover:bg-neon-amber/30 text-xs font-bold transition-all active:scale-95"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Return to Master Admin
      </button>
    </div>
  );
}
