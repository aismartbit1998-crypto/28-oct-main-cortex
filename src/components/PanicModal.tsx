import { AlertTriangle, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function PanicModal({ open, onClose, onConfirm }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-base-900/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-md animate-scale-in">
        <div className="glass-strong neon-glow-red p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-neon-red/15 border border-neon-red/40 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-neon-red animate-pulse" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Panic Liquidation</h2>
                <p className="text-xs text-slate-400">Emergency exit all positions</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed mb-5">
            This will immediately market-sell <span className="text-neon-red font-semibold">ALL</span> open positions and cancel all pending orders across connected brokers. This action is irreversible.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl glass hover:bg-white/[0.07] text-sm text-slate-300 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => { onConfirm(); onClose(); }}
              className="flex-1 px-4 py-2.5 rounded-xl bg-neon-red/20 border border-neon-red/50 text-neon-red font-bold text-sm hover:bg-neon-red/30 neon-glow-red transition-all active:scale-95"
            >
              Liquidate Everything
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
