import { AlertTriangle } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.04] bg-base-900/50 backdrop-blur-sm px-4 sm:px-6 py-2.5">
      <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500">
        <AlertTriangle className="w-3 h-3 text-neon-amber/60 flex-shrink-0" />
        <p className="text-center">
          <span className="text-slate-400">Risk Warning:</span> Crypto trading carries substantial risk of loss. AI signals are not financial advice. Never invest more than you can afford to lose.
        </p>
      </div>
    </footer>
  );
}
