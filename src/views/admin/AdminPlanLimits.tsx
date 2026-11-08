import { useState, useEffect, useCallback } from 'react';
import {
  Crown, Zap, Rocket, Save, Loader2, Check, AlertCircle,
  Bot, Gauge, Coins, BrainCircuit, Sparkles, RotateCcw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePlanRules, refreshPlanLimits, type PlanType, type PlanRule } from '@/lib/planRules';

interface PlanLimitRow {
  id: string;
  plan_key: PlanType;
  label: string;
  bot_limit: number | null;
  max_leverage: number;
  credits_per_day: number;
  features: string[];
  ai_auto_tune: boolean;
  unlocked_strategies_count: number;
  allowed_strategy_ids: string[];
  is_active: boolean;
  sort_order: number;
}

const planIcons: Record<PlanType, typeof Crown> = {
  starter: Zap,
  pro: Rocket,
  enterprise: Crown,
};

const planAccents: Record<PlanType, { text: string; bg: string; border: string }> = {
  starter: { text: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/30' },
  pro: { text: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/30' },
  enterprise: { text: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/30' },
};

export default function AdminPlanLimits() {
  const { rules, loading: rulesLoading } = usePlanRules();
  const [rows, setRows] = useState<PlanLimitRow[]>([]);
  const [customBots, setCustomBots] = useState<{ id: string; name: string; strategy_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchLimits = useCallback(async () => {
    setLoading(true);
    const [limitsRes, botsRes] = await Promise.all([
      supabase.from('plan_limits').select('*').order('sort_order'),
      supabase.from('bot_templates').select('id, name, strategy_id, bot_type').order('created_at', { ascending: false }),
    ]);
    if (limitsRes.err) {
      setError(limitsRes.err.message);
    } else if (limitsRes.data) {
      setRows(limitsRes.data as PlanLimitRow[]);
    }
    if (botsRes.err) {
      console.error('Failed to fetch bot templates:', botsRes.err.message);
    } else if (botsRes.data) {
      setCustomBots((botsRes.data as { id: string; name: string; strategy_id: string | null; bot_type: string | null }[])
        .map((b) => ({ id: b.id, name: b.name, strategy_id: b.strategy_id })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLimits(); }, [fetchLimits]);

  const handleSave = async (planKey: PlanType) => {
    setSaving(planKey);
    setError(null);
    setSuccess(null);

    const row = rows.find(r => r.plan_key === planKey);
    if (!row) return;

    const { error: err } = await supabase
      .from('plan_limits')
      .update({
        label: row.label,
        bot_limit: row.bot_limit,
        max_leverage: row.max_leverage,
        credits_per_day: row.credits_per_day,
        features: row.features,
        ai_auto_tune: row.ai_auto_tune,
        unlocked_strategies_count: row.unlocked_strategies_count,
        allowed_strategy_ids: row.allowed_strategy_ids,
        updated_at: new Date().toISOString(),
      })
      .eq('plan_key', planKey);

    if (err) {
      setError(`Failed to save ${row.label}: ${err.message}`);
    } else {
      setSuccess(`${row.label} plan updated successfully.`);
      await refreshPlanLimits();
      setTimeout(() => setSuccess(null), 3000);
    }
    setSaving(null);
  };

  const updateRow = (planKey: PlanType, field: keyof PlanLimitRow, value: unknown) => {
    setRows(prev => prev.map(r => r.plan_key === planKey ? { ...r, [field]: value } : r));
  };

  const updateFeatures = (planKey: PlanType, featuresText: string) => {
    const features = featuresText.split('\n').map(f => f.trim()).filter(Boolean);
    updateRow(planKey, 'features', features);
  };

  const updateStrategyIds = (planKey: PlanType, idsText: string) => {
    const ids = idsText.split('\n').map(s => s.trim()).filter(Boolean);
    updateRow(planKey, 'allowed_strategy_ids', ids);
  };

  const toggleBotForPlan = (planKey: PlanType, strategyId: string) => {
    setRows(prev => prev.map(r => {
      if (r.plan_key !== planKey) return r;
      const has = r.allowed_strategy_ids.includes(strategyId);
      return {
        ...r,
        allowed_strategy_ids: has
          ? r.allowed_strategy_ids.filter(id => id !== strategyId)
          : [...r.allowed_strategy_ids, strategyId],
      };
    }));
  };

  if (loading || rulesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-neon-amber animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-neon-amber/10 border border-neon-amber/30 flex items-center justify-center neon-glow-amber">
          <Crown className="w-6 h-6 text-neon-amber" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Plan Limits Manager</h2>
          <p className="text-sm text-slate-400">Dynamically control bot limits, leverage, credits, and features for each plan tier</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-neon-red/5 border border-neon-red/15">
          <AlertCircle className="w-4 h-4 text-neon-red flex-shrink-0 mt-0.5" />
          <p className="text-xs text-neon-red">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-neon-green/5 border border-neon-green/15">
          <Check className="w-4 h-4 text-neon-green flex-shrink-0 mt-0.5" />
          <p className="text-xs text-neon-green">{success}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {rows.map((row) => {
          const planKey = row.plan_key;
          const Icon = planIcons[planKey] ?? Crown;
          const a = planAccents[planKey];
          const isSaving = saving === planKey;
          const isUnlimited = row.bot_limit === null || row.bot_limit >= 999;

          return (
            <div key={row.id} className={`glass-card p-5 space-y-4 border ${a.border}`}>
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-xl ${a.bg} ${a.border} border flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${a.text}`} />
                </div>
                <div className="flex-1">
                  <input
                    value={row.label}
                    onChange={e => updateRow(planKey, 'label', e.target.value)}
                    className={`w-full bg-transparent text-base font-bold text-white border-b border-white/[0.06] focus:outline-none focus:border-${a.text.replace('text-', '')}/40 transition-colors`}
                  />
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{planKey}</p>
                </div>
              </div>

              {/* Bot Limit */}
              <div>
                <label className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1.5 flex items-center gap-1.5">
                  <Bot className="w-3 h-3" /> Bot Limit
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={isUnlimited ? '' : (row.bot_limit ?? '')}
                    onChange={e => {
                      const val = e.target.value;
                      updateRow(planKey, 'bot_limit', val === '' ? null : Math.max(1, parseInt(val) || 1));
                    }}
                    placeholder="Unlimited"
                    className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isUnlimited}
                      onChange={e => updateRow(planKey, 'bot_limit', e.target.checked ? null : 5)}
                      className="w-4 h-4 rounded accent-neon-amber"
                    />
                    Unlimited
                  </label>
                </div>
              </div>

              {/* Max Leverage */}
              <div>
                <label className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1.5 flex items-center gap-1.5">
                  <Gauge className="w-3 h-3" /> Max Leverage
                </label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={row.max_leverage}
                  onChange={e => updateRow(planKey, 'max_leverage', Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40"
                />
              </div>

              {/* Credits Per Day */}
              <div>
                <label className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1.5 flex items-center gap-1.5">
                  <Coins className="w-3 h-3" /> Credits Per Day
                </label>
                <input
                  type="number"
                  min="0"
                  value={row.credits_per_day}
                  onChange={e => updateRow(planKey, 'credits_per_day', Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40"
                />
              </div>

              {/* Unlocked Strategies Count */}
              <div>
                <label className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1.5 flex items-center gap-1.5">
                  <BrainCircuit className="w-3 h-3" /> Unlocked Strategies Count
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={row.unlocked_strategies_count}
                  onChange={e => updateRow(planKey, 'unlocked_strategies_count', Math.max(0, Math.min(10, parseInt(e.target.value) || 0)))}
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40"
                />
              </div>

              {/* AI Auto Tune */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <label className="text-xs text-slate-300 font-medium flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-slate-500" /> AI Auto-Tune
                </label>
                <button
                  onClick={() => updateRow(planKey, 'ai_auto_tune', !row.ai_auto_tune)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${row.ai_auto_tune ? 'bg-neon-green/30' : 'bg-white/[0.08]'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${row.ai_auto_tune ? 'translate-x-5 bg-neon-green' : 'bg-slate-500'}`} />
                </button>
              </div>

              {/* Features */}
              <div>
                <label className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1.5 block">
                  Features (one per line)
                </label>
                <textarea
                  value={row.features.join('\n')}
                  onChange={e => updateFeatures(planKey, e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-slate-300 focus:outline-none focus:border-neon-amber/40 scrollbar-thin resize-none"
                />
              </div>

              {/* Allowed Strategy IDs */}
              <div>
                <label className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1.5 block">
                  Allowed Strategy IDs (one per line)
                </label>
                <textarea
                  value={row.allowed_strategy_ids.join('\n')}
                  onChange={e => updateStrategyIds(planKey, e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-slate-300 font-mono focus:outline-none focus:border-neon-amber/40 scrollbar-thin resize-none"
                />
              </div>

              {/* Custom Bots Auto-Sync Toggles */}
              <div>
                <label className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1.5 flex items-center gap-1.5">
                  <Bot className="w-3 h-3" /> Custom Bots in this Plan
                </label>
                {customBots.length === 0 ? (
                  <p className="text-[10px] text-slate-500 italic px-2 py-1.5">
                    No custom bots found. New bots auto-sync here.
                  </p>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin pr-1">
                    {customBots.map((bot) => {
                      const stratId = bot.strategy_id ?? bot.id;
                      const checked = row.allowed_strategy_ids.includes(stratId);
                      return (
                        <label
                          key={bot.id}
                          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all border ${checked ? `${a.bg} ${a.border}` : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05]'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBotForPlan(planKey, stratId)}
                            className={`w-4 h-4 rounded accent-${a.text.replace('text-', '')} flex-shrink-0`}
                          />
                          <span className={`text-xs font-medium flex-1 truncate ${checked ? a.text : 'text-slate-400'}`}>
                            {bot.name}
                          </span>
                          <span className="text-[9px] font-mono text-slate-500 truncate max-w-[80px]">
                            {stratId}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Save Button */}
              <button
                onClick={() => handleSave(planKey)}
                disabled={isSaving}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${a.bg} ${a.text} border ${a.border} hover:opacity-90 active:scale-95 disabled:opacity-50`}
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isSaving ? 'Saving...' : `Save ${row.label}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Reset / Refresh */}
      <div className="flex justify-end">
        <button
          onClick={fetchLimits}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-xs text-slate-400 border border-white/[0.06] transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reload from Database
        </button>
      </div>
    </div>
  );
}
