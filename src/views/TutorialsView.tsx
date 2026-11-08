import { useState } from 'react';
import { BookOpen, Play, Clock, ChevronRight, X } from 'lucide-react';

const tutorials = [
  { title: 'Getting Started with Cortex AI', duration: '5 min', level: 'Beginner', desc: 'Learn the basics of navigating the dashboard and understanding AI signals.', target: 'dashboard' },
  { title: 'Deploying Your First AI Strategy', duration: '8 min', level: 'Beginner', desc: 'Step-by-step guide to deploying automatic strategies on autopilot.', target: 'ai-smart-bot' },
  { title: 'Building a Custom Trading Bot', duration: '12 min', level: 'Intermediate', desc: 'Create a custom bot with your own risk/reward parameters and strategy core.', target: 'ai-smart-bot' },
  { title: 'Understanding AI Market Sentiment', duration: '7 min', level: 'Intermediate', desc: 'Deep dive into how Cortex Neural Engine analyzes 1,200+ data sources.', target: 'signals' },
  { title: 'Advanced Grid Trading Techniques', duration: '15 min', level: 'Advanced', desc: 'Master grid trading in sideways markets with dynamic interval optimization.', target: 'ai-smart-bot' },
  { title: 'Risk Management & Position Sizing', duration: '10 min', level: 'Intermediate', desc: 'Learn proper position sizing and risk/reward ratio calculation.', target: 'ai-smart-bot' },
  { title: 'Connecting Multiple Brokers', duration: '6 min', level: 'Beginner', desc: 'Link exchange accounts and manage API keys securely.', target: 'connect-broker' },
  { title: 'Futures Trading with Leverage', duration: '14 min', level: 'Advanced', desc: 'Understand leverage up to 100x and liquidation risk management.', target: 'ai-smart-bot' },
];

const levelColors = {
  Beginner: 'text-neon-green bg-neon-green/10 border-neon-green/20',
  Intermediate: 'text-neon-amber bg-neon-amber/10 border-neon-amber/20',
  Advanced: 'text-neon-red bg-neon-red/10 border-neon-red/20',
};

export default function TutorialsView() {
  const [selected, setSelected] = useState<typeof tutorials[0] | null>(null);

  const navigateTo = (target: string) => {
    const event = new CustomEvent('navigate', { detail: target });
    window.dispatchEvent(event);
  };

  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-neon-cyan" />
          Tutorials & Guides
        </h2>
        <p className="text-sm text-slate-400">Learn to master Cortex AI with our video and written guides</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {tutorials.map((t, i) => (
          <div
            key={i}
            onClick={() => setSelected(t)}
            className="glass-card p-5 group hover:border-white/[0.12] transition-all duration-300 cursor-pointer"
          >
            {/* Thumbnail */}
            <div className="relative h-32 rounded-xl bg-gradient-to-br from-neon-cyan/10 to-neon-green/5 border border-white/[0.06] flex items-center justify-center mb-4 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-base-700/50 to-transparent" />
              <div className="relative w-12 h-12 rounded-full bg-white/[0.08] border border-white/[0.1] flex items-center justify-center group-hover:bg-neon-cyan/20 group-hover:border-neon-cyan/40 transition-all duration-300">
                <Play className="w-5 h-5 text-white group-hover:text-neon-cyan ml-0.5" fill="currentColor" />
              </div>
              <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md bg-base-900/60 text-[10px] text-slate-300">
                <Clock className="w-3 h-3" /> {t.duration}
              </div>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${levelColors[t.level as keyof typeof levelColors]}`}>
                {t.level}
              </span>
            </div>
            <h3 className="text-sm font-bold text-white mb-1 group-hover:text-neon-cyan transition-colors">{t.title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">{t.desc}</p>
            <div className="flex items-center gap-1 text-xs text-neon-cyan font-semibold">
              Watch now <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </div>
        ))}
      </div>

      {/* Tutorial detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="glass-card max-w-lg w-full p-6 space-y-4 animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${levelColors[selected.level as keyof typeof levelColors]}`}>
                  {selected.level}
                </span>
                <h3 className="text-lg font-bold text-white mt-2">{selected.title}</h3>
                <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                  <Clock className="w-3 h-3" /> {selected.duration}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative h-40 rounded-xl bg-gradient-to-br from-neon-cyan/10 to-neon-green/5 border border-white/[0.06] flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-neon-cyan/20 border border-neon-cyan/40 flex items-center justify-center">
                <Play className="w-7 h-7 text-neon-cyan ml-1" fill="currentColor" />
              </div>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">{selected.desc}</p>
            <button
              onClick={() => {
                navigateTo(selected.target);
                setSelected(null);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/25 text-sm font-bold transition-all"
            >
              Go to {selected.target.replace(/-/g, ' ')} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
