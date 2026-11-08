import { useEffect, useState, useCallback } from 'react';
import { CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, Info, X, Circle as XCircle } from 'lucide-react';
import { supabase, type ClientUpdate } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
}

export default function RealtimeToast() {
  const { session } = useAuth();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(prev => [...prev.slice(-4), { ...toast, id }]);
    setTimeout(() => removeToast(id), 8000);
  }, [removeToast]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const channel = supabase
      .channel('user-updates-feed')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'client_updates',
          filter: `client_id=eq.${session.user.id}`,
        },
        (payload) => {
          const u = payload.new as ClientUpdate;
          const toast: Omit<ToastItem, 'id'> = {
            title: u.title,
            message: u.message,
            severity: u.severity as ToastItem['severity'],
          };
          addToast(toast);
        }
      )
      .subscribe(() => {});

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addToast, session?.user?.id]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[120] flex flex-col gap-3 max-w-sm pointer-events-none">
      {toasts.map(toast => (
        <ToastCard key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const config = {
    success: { icon: CheckCircle2, color: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/30', glow: 'neon-glow-green' },
    warning: { icon: AlertTriangle, color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/30', glow: 'neon-glow-amber' },
    critical: { icon: XCircle, color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/30', glow: 'neon-glow-red' },
    info: { icon: Info, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/30', glow: 'neon-glow-cyan' },
  };

  const c = config[toast.severity] ?? config.info;
  const Icon = c.icon;

  return (
    <div
      className={`glass-strong ${c.glow} p-4 pr-6 flex items-start gap-3 pointer-events-auto animate-slide-up border ${c.border} rounded-2xl`}
    >
      <div className={`w-10 h-10 rounded-xl ${c.bg} ${c.border} border flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 ${c.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white mb-1">{toast.title}</p>
        <p className="text-xs text-slate-400 leading-relaxed">{toast.message}</p>
      </div>
      <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors flex-shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
