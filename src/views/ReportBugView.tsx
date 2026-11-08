import { useState } from 'react';
import { Bug, Send, Check, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export default function ReportBugView() {
  const [category, setCategory] = useState('trading');
  const [severity, setSeverity] = useState('medium');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setSubmitting(true);
    const { error: logErr } = await supabase.from('admin_activity_log').insert({
      admin_email: user?.email ?? 'unknown',
      admin_name: 'Bug Report',
      action_type: 'admin_action',
      message: `Bug Report [${severity}] — Category: ${category} — ${description.slice(0, 200)}`,
      severity: severity === 'high' ? 'critical' : severity === 'medium' ? 'warning' : 'info',
    });
    setSubmitting(false);
    if (logErr) {
      console.error('Failed to submit bug report:', logErr.message);
      return;
    }
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setDescription('');
    }, 4000);
  };

  return (
    <div className="space-y-5 animate-slide-up max-w-2xl">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Bug className="w-5 h-5 text-neon-red" />
          Report a Bug
        </h2>
        <p className="text-sm text-slate-400">Help us improve Cortex AI by reporting issues you encounter</p>
      </div>

      {submitted && (
        <div className="glass-card p-4 border-neon-green/30 flex items-center gap-3 animate-slide-up">
          <div className="w-10 h-10 rounded-xl bg-neon-green/10 border border-neon-green/30 flex items-center justify-center">
            <Check className="w-5 h-5 text-neon-green" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Bug Report Submitted</p>
            <p className="text-xs text-slate-400">Thank you! Our team will investigate this issue. Ticket #CTX-{Math.floor(Math.random() * 99999)}.</p>
          </div>
        </div>
      )}

      <div className="glass-card p-5 space-y-5">
        {/* Category */}
        <div>
          <label className="text-xs text-slate-400 mb-2 block font-semibold uppercase tracking-wide">Category</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { id: 'trading', label: 'Trading' },
              { id: 'ai-bot', label: 'AI Bot' },
              { id: 'ui', label: 'UI/UX' },
              { id: 'broker', label: 'Broker' },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  category === c.id
                    ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40'
                    : 'glass text-slate-400 hover:text-slate-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Severity */}
        <div>
          <label className="text-xs text-slate-400 mb-2 block font-semibold uppercase tracking-wide">Severity</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'low', label: 'Low', color: 'text-neon-green border-neon-green/30 bg-neon-green/10' },
              { id: 'medium', label: 'Medium', color: 'text-neon-amber border-neon-amber/30 bg-neon-amber/10' },
              { id: 'high', label: 'High', color: 'text-neon-red border-neon-red/30 bg-neon-red/10' },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setSeverity(s.id)}
                className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  severity === s.id ? s.color : 'glass text-slate-400 hover:text-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-slate-400 mb-2 block font-semibold uppercase tracking-wide">Describe the Bug</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Please describe what happened, what you expected, and steps to reproduce..."
            className="w-full px-4 py-3 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors resize-none scrollbar-thin"
          />
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2 text-xs text-slate-500">
          <AlertCircle className="w-4 h-4 text-neon-amber flex-shrink-0 mt-0.5" />
          <p>Do not include API keys, passwords, or personal information in your bug report.</p>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!description.trim() || submitting}
          className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${
            description.trim() && !submitting
              ? 'bg-neon-red/15 text-neon-red border border-neon-red/40 hover:bg-neon-red/25 neon-glow-red active:scale-95'
              : 'bg-white/[0.03] text-slate-500 border border-white/[0.06] cursor-not-allowed'
          }`}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {submitting ? 'Submitting...' : 'Submit Bug Report'}
        </button>
      </div>
    </div>
  );
}
