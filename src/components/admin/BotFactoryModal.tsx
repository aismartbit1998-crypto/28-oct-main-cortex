import { useState, useEffect, useRef } from 'react';
import {
  Rocket, X, Zap, ChevronDown, Check,
  Loader2, Cpu, Shield, Target, Gauge,
  Workflow, Activity, AlertTriangle,
  TrendingUp, DollarSign, Percent, Brain, Radio,
  ArrowUpDown, Coins,
} from 'lucide-react';
import { allStrategies, allIndicators, indianExchanges } from '@/data/adminMockData';
import type { BotTemplate } from '@/lib/supabase';

export interface BotFactoryDraft {
  name: string;
  description: string;
  bot_type: 'custom';
  execution_mode: 'auto' | 'manual';
  market_type: 'spot' | 'futures';
  strategies: string[];
  indicators: string[];
  max_drawdown_pct: number;
  default_tp_pct: number;
  default_sl_pct: number;
  tp_sl_ratio: number;
  max_leverage: number;
  risk_level: 'Low' | 'Medium' | 'High';
  source_exchanges: string[];
  win_rate: number;
  expected_return: string;
  required_tier: 'starter' | 'pro' | 'enterprise';
  martingale_multiplier: number;
  max_martingale_steps: number;
  strategy_settings: {
    strategy_mode: 'rule_based' | 'manual_signal' | 'ai_strategy';
    trade_sizing: 'fixed_quote' | 'percent_balance' | 'risk_based';
    sizing_value: number;
    risk_per_trade_pct: number;
    max_notional: number;
    trailing_enabled: boolean;
    trailing_distance_pct: number;
    exchange: string;
    trading_pairs: string[];
  };
  risk_settings: {
    max_trades_per_day: number;
    max_daily_loss_threshold: number;
  };
  backtest_config?: {
    strategy: string;
    trade_direction: 'long' | 'short';
    capital: number;
    tp_sl_mode: 'percentage' | 'fixed';
    take_profit: number;
    stop_loss: number;
    tp_fixed: number;
    sl_fixed: number;
    leverage: number;
    max_trades_per_day: number;
    cooldown_minutes: number;
    martingale_multiplier: number;
    martingale_steps: number;
    trailing_enabled: boolean;
    trailing_distance: number;
  };
}

interface Props {
  onClose: () => void;
  onSave: (draft: BotFactoryDraft) => Promise<void>;
  editing?: BotTemplate | null;
}

const strategyModes = [
  { id: 'rule_based' as const, label: 'Rule-Based', icon: Workflow, desc: 'Execute based on predefined technical rules' },
  { id: 'manual_signal' as const, label: 'Manual Signal', icon: Radio, desc: 'Generate signals for manual approval' },
  { id: 'ai_strategy' as const, label: 'AI Strategy', icon: Brain, desc: 'AI-driven adaptive strategy selection' },
];

const tradeSizingModes = [
  { id: 'fixed_quote' as const, label: 'Fixed Quote Amount', icon: DollarSign, desc: 'Fixed dollar amount per trade' },
  { id: 'percent_balance' as const, label: '% of Balance', icon: Percent, desc: 'Percentage of total wallet balance' },
  { id: 'risk_based' as const, label: 'Risk-Based Sizing', icon: Shield, desc: 'Position size based on risk per trade' },
];

const availablePairs = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT',
];

export default function BotFactoryModal({ onClose, onSave, editing }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [strategiesOpen, setStrategiesOpen] = useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const strategiesRef = useRef<HTMLDivElement>(null);
  const indicatorsRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<BotFactoryDraft>(() => {
    if (editing) {
      const ss = editing.strategy_settings;
      const rs = editing.risk_settings;
      return {
        name: editing.name,
        description: editing.description ?? '',
        bot_type: 'custom',
        execution_mode: (editing.execution_mode ?? 'auto') as BotFactoryDraft['execution_mode'],
        market_type: editing.market_type,
        strategies: editing.strategies ?? [],
        indicators: editing.indicators ?? [],
        max_drawdown_pct: editing.max_drawdown_pct ?? 15,
        default_tp_pct: editing.default_tp_pct,
        default_sl_pct: editing.default_sl_pct,
        tp_sl_ratio: editing.tp_sl_ratio ?? 2,
        max_leverage: editing.max_leverage ?? 20,
        risk_level: editing.risk_level,
        source_exchanges: editing.source_exchanges ?? [],
        win_rate: editing.win_rate ?? 75,
        expected_return: editing.expected_return ?? '',
        required_tier: editing.required_tier ?? 'enterprise',
        martingale_multiplier: editing.martingale_multiplier ?? 2.0,
        max_martingale_steps: editing.max_martingale_steps ?? 5,
        strategy_settings: {
          strategy_mode: ss?.strategy_mode ?? 'rule_based',
          trade_sizing: ss?.trade_sizing ?? 'fixed_quote',
          sizing_value: ss?.sizing_value ?? 100,
          risk_per_trade_pct: ss?.risk_per_trade_pct ?? 1,
          max_notional: ss?.max_notional ?? 10000,
          trailing_enabled: ss?.trailing_enabled ?? false,
          trailing_distance_pct: ss?.trailing_distance_pct ?? 2,
          exchange: ss?.exchange ?? 'CoinDCX',
          trading_pairs: ss?.trading_pairs ?? ['BTCUSDT'],
        },
        risk_settings: {
          max_trades_per_day: rs?.max_trades_per_day ?? 10,
          max_daily_loss_threshold: rs?.max_daily_loss_threshold ?? 500,
        },
      };
    }
    return {
      name: '',
      description: '',
      bot_type: 'custom',
      execution_mode: 'auto',
      market_type: 'futures',
      strategies: [],
      indicators: [],
      max_drawdown_pct: 15,
      default_tp_pct: 5,
      default_sl_pct: 2,
      tp_sl_ratio: 2.5,
      max_leverage: 20,
      risk_level: 'Medium',
      source_exchanges: [],
      win_rate: 75,
      expected_return: '',
      required_tier: 'enterprise',
      martingale_multiplier: 2.0,
      max_martingale_steps: 5,
      strategy_settings: {
        strategy_mode: 'rule_based',
        trade_sizing: 'fixed_quote',
        sizing_value: 100,
        risk_per_trade_pct: 1,
        max_notional: 10000,
        trailing_enabled: false,
        trailing_distance_pct: 2,
        exchange: 'CoinDCX',
        trading_pairs: ['BTCUSDT'],
      },
      risk_settings: {
        max_trades_per_day: 10,
        max_daily_loss_threshold: 500,
      },
    };
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (strategiesRef.current && !strategiesRef.current.contains(e.target as Node)) setStrategiesOpen(false);
      if (indicatorsRef.current && !indicatorsRef.current.contains(e.target as Node)) setIndicatorsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleStrategy = (s: string) => {
    setDraft(prev => ({
      ...prev,
      strategies: prev.strategies.includes(s)
        ? prev.strategies.filter(x => x !== s)
        : [...prev.strategies, s],
    }));
  };

  const toggleIndicator = (i: string) => {
    setDraft(prev => ({
      ...prev,
      indicators: prev.indicators.includes(i)
        ? prev.indicators.filter(x => x !== i)
        : [...prev.indicators, i],
    }));
  };

  const canProceed = (s: number): boolean => {
    if (s === 1) return draft.name.trim().length > 0;
    if (s === 2) return draft.strategies.length > 0 || draft.indicators.length > 0;
    if (s === 3) return draft.default_tp_pct > 0 && draft.default_sl_pct > 0 && draft.max_drawdown_pct > 0;
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  };

  const steps = [
    { num: 1, label: 'Identity', icon: Cpu },
    { num: 2, label: 'Strategy Engine', icon: Workflow },
    { num: 3, label: 'Risk & Safeguards', icon: Shield },
  ];

  const rrRatio = draft.default_sl_pct > 0 ? draft.default_tp_pct / draft.default_sl_pct : 0;
  const riskWidth = draft.default_sl_pct > 0 ? (draft.default_sl_pct / (draft.default_tp_pct + draft.default_sl_pct)) * 100 : 0;
  const rewardWidth = draft.default_sl_pct > 0 ? (draft.default_tp_pct / (draft.default_tp_pct + draft.default_sl_pct)) * 100 : 0;
  const rrColor = rrRatio >= 2 ? 'text-neon-green' : rrRatio >= 1 ? 'text-neon-amber' : 'text-neon-red';
  const rrLabel = rrRatio >= 2 ? 'Excellent R/R — profitable even with 40%+ win rate.' : rrRatio >= 1 ? 'Acceptable R/R — ensure win rate stays above 50%.' : 'Poor R/R — risking more than reward. Consider adjusting.';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-base-900/85 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-3xl animate-scale-in">
        <div className="glass-strong neon-glow-cyan max-h-[92vh] overflow-y-auto scrollbar-thin rounded-2xl">
          {/* Header */}
          <div className="sticky top-0 z-20 bg-base-800/90 backdrop-blur-xl border-b border-white/[0.06] px-5 sm:px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center">
                <Rocket className="w-5 h-5 text-neon-cyan" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">
                  {editing ? 'Modify Custom Bot' : 'Custom Bot Builder'}
                </h2>
                <p className="text-[11px] text-slate-500">Mathematical Trading Bot Constructor</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/[0.06]">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-1 sm:gap-2 px-5 sm:px-6 py-4 border-b border-white/[0.04]">
            {steps.map((s, idx) => {
              const isActive = step === s.num;
              const isDone = step > s.num;
              const SIcon = s.icon;
              return (
                <div key={s.num} className="flex items-center flex-1">
                  <button
                    onClick={() => isDone && setStep(s.num)}
                    disabled={!isDone}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all flex-shrink-0 ${
                      isActive
                        ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30'
                        : isDone
                        ? 'text-neon-green hover:bg-neon-green/5 cursor-pointer'
                        : 'text-slate-600 cursor-not-allowed'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isActive ? 'bg-neon-cyan/15' : isDone ? 'bg-neon-green/10' : 'bg-white/[0.04]'}`}>
                      {isDone ? <Check className="w-3.5 h-3.5" /> : <SIcon className="w-3.5 h-3.5" />}
                    </div>
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                  {idx < steps.length - 1 && (
                    <div className={`flex-1 h-px mx-1 sm:mx-2 transition-colors ${isDone ? 'bg-neon-green/30' : 'bg-white/[0.06]'}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Body */}
          <div className="px-5 sm:px-6 py-5 space-y-5">
            {/* STEP 1 — Identity & Configuration */}
            {step === 1 && (
              <div className="space-y-5 animate-fade-in">
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Bot Name</label>
                  <input
                    value={draft.name}
                    onChange={e => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g. Quantum Mean Reversion v2"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Description (optional)</label>
                  <textarea
                    value={draft.description}
                    onChange={e => setDraft({ ...draft, description: e.target.value })}
                    placeholder="Brief description of the bot's mathematical approach..."
                    rows={2}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors resize-none"
                  />
                </div>

                {/* Exchange & Trading Pairs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                      <ArrowUpDown className="w-3.5 h-3.5" /> Exchange
                    </label>
                    <div className="relative">
                      <select
                        value={draft.strategy_settings.exchange}
                        onChange={e => setDraft({
                          ...draft,
                          strategy_settings: { ...draft.strategy_settings, exchange: e.target.value },
                        })}
                        className="appearance-none w-full pl-4 pr-10 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors cursor-pointer"
                      >
                        {indianExchanges.map(ex => (
                          <option key={ex} value={ex}>{ex}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                      <Coins className="w-3.5 h-3.5" /> Trading Pairs
                    </label>
                    <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto scrollbar-thin">
                      {availablePairs.map(pair => {
                        const selected = draft.strategy_settings.trading_pairs.includes(pair);
                        return (
                          <button
                            key={pair}
                            onClick={() => setDraft(prev => ({
                              ...prev,
                              strategy_settings: {
                                ...prev.strategy_settings,
                                trading_pairs: selected
                                  ? prev.strategy_settings.trading_pairs.filter(p => p !== pair)
                                  : [...prev.strategy_settings.trading_pairs, pair],
                              },
                            }))}
                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-semibold transition-all ${
                              selected
                                ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40'
                                : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:border-white/[0.12]'
                            }`}
                          >
                            {pair}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Strategy Mode Selection */}
                <div>
                  <label className="text-xs text-slate-400 mb-3 block font-semibold flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5" /> Strategy Mode
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {strategyModes.map(mode => {
                      const isSelected = draft.strategy_settings.strategy_mode === mode.id;
                      const MIcon = mode.icon;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => setDraft({
                            ...draft,
                            strategy_settings: { ...draft.strategy_settings, strategy_mode: mode.id },
                          })}
                          className={`relative text-left p-3.5 rounded-xl border transition-all duration-200 overflow-hidden ${
                            isSelected
                              ? 'bg-neon-cyan/10 border-neon-cyan/40 hover:neon-glow-cyan'
                              : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSelected ? 'bg-neon-cyan/15' : 'bg-white/[0.05]'}`}>
                              <MIcon className={`w-4 h-4 ${isSelected ? 'text-neon-cyan' : 'text-slate-400'}`} />
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-neon-cyan" />}
                          </div>
                          <p className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-slate-300'}`}>{mode.label}</p>
                          <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">{mode.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Execution Mode Toggle */}
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <label className="text-xs text-slate-400 mb-3 block font-semibold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" /> Execution Mode
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setDraft({ ...draft, execution_mode: 'auto' })}
                      className={`relative p-3 rounded-xl border text-left transition-all ${
                        draft.execution_mode === 'auto'
                          ? 'bg-neon-green/10 border-neon-green/40'
                          : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Zap className={`w-4 h-4 ${draft.execution_mode === 'auto' ? 'text-neon-green' : 'text-slate-400'}`} />
                        <span className={`text-sm font-bold ${draft.execution_mode === 'auto' ? 'text-neon-green' : 'text-slate-300'}`}>Fully Auto-Trade</span>
                      </div>
                      <p className="text-[10px] text-slate-500">Bot executes trades automatically without human approval.</p>
                      <div className={`mt-2 w-10 h-5 rounded-full transition-colors relative ${draft.execution_mode === 'auto' ? 'bg-neon-green/30' : 'bg-white/[0.08]'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${draft.execution_mode === 'auto' ? 'left-5 bg-neon-green' : 'left-0.5 bg-slate-500'}`} />
                      </div>
                    </button>
                    <button
                      onClick={() => setDraft({ ...draft, execution_mode: 'manual' })}
                      className={`relative p-3 rounded-xl border text-left transition-all ${
                        draft.execution_mode === 'manual'
                          ? 'bg-neon-amber/10 border-neon-amber/40'
                          : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Target className={`w-4 h-4 ${draft.execution_mode === 'manual' ? 'text-neon-amber' : 'text-slate-400'}`} />
                        <span className={`text-sm font-bold ${draft.execution_mode === 'manual' ? 'text-neon-amber' : 'text-slate-300'}`}>Manual Signal Approval</span>
                      </div>
                      <p className="text-[10px] text-slate-500">Bot generates signals; user approves each trade manually.</p>
                      <div className={`mt-2 w-10 h-5 rounded-full transition-colors relative ${draft.execution_mode === 'manual' ? 'bg-neon-amber/30' : 'bg-white/[0.08]'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${draft.execution_mode === 'manual' ? 'left-5 bg-neon-amber' : 'left-0.5 bg-slate-500'}`} />
                      </div>
                    </button>
                  </div>
                </div>

                {/* Market + Risk Level */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-2 block font-semibold">Market</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['spot', 'futures'] as const).map(m => (
                        <button
                          key={m}
                          onClick={() => setDraft({ ...draft, market_type: m })}
                          className={`px-3 py-2.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                            draft.market_type === m
                              ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40'
                              : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:border-white/[0.12]'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-2 block font-semibold">Risk Level</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['Low', 'Medium', 'High'] as const).map(r => (
                        <button
                          key={r}
                          onClick={() => setDraft({ ...draft, risk_level: r })}
                          className={`px-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                            draft.risk_level === r
                              ? r === 'Low' ? 'bg-neon-green/15 text-neon-green border border-neon-green/40'
                                : r === 'Medium' ? 'bg-neon-amber/15 text-neon-amber border border-neon-amber/40'
                                : 'bg-neon-red/15 text-neon-red border border-neon-red/40'
                              : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:border-white/[0.12]'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Required Subscription Tier (Paywall Lock) */}
                <div>
                  <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Required Subscription Tier (Paywall Lock)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { id: 'enterprise' as const, label: 'Enterprise Only', desc: 'Locked for Starter & Pro' },
                      { id: 'pro' as const, label: 'Pro & Enterprise', desc: 'Locked for Starter' },
                      { id: 'starter' as const, label: 'All Plans', desc: 'Unlocked on Starter, Pro & Enterprise' },
                    ].map(opt => {
                      const selected = draft.required_tier === opt.id;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => setDraft({ ...draft, required_tier: opt.id })}
                          className={`relative text-left p-3 rounded-xl border transition-all duration-200 ${
                            selected
                              ? opt.id === 'enterprise'
                                ? 'bg-neon-amber/10 border-neon-amber/40'
                                : opt.id === 'pro'
                                ? 'bg-neon-cyan/10 border-neon-cyan/40'
                                : 'bg-neon-green/10 border-neon-green/40'
                              : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-sm font-bold ${selected ? 'text-white' : 'text-slate-300'}`}>{opt.label}</span>
                            {selected && <Check className={`w-4 h-4 ${opt.id === 'enterprise' ? 'text-neon-amber' : opt.id === 'pro' ? 'text-neon-cyan' : 'text-neon-green'}`} />}
                          </div>
                          <p className="text-[10px] text-slate-500 leading-relaxed">{opt.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-600 mt-2">New bots default to Enterprise lock. Only Enterprise plan users can deploy them unless changed here.</p>
                </div>

                {/* Win Rate & Expected Return */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block font-semibold flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-neon-green" /> Win Rate (%)
                    </label>
                    <input
                      type="number"
                      value={draft.win_rate}
                      onChange={e => setDraft({ ...draft, win_rate: Math.max(0, Math.min(100, Number(e.target.value))) })}
                      step="0.1"
                      min="0"
                      max="100"
                      className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-green/40 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block font-semibold flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-neon-cyan" /> Expected Return
                    </label>
                    <input
                      value={draft.expected_return}
                      onChange={e => setDraft({ ...draft, expected_return: e.target.value })}
                      placeholder="e.g. 5-12% / month"
                      className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2 — Strategy Engine & Trade Sizing */}
            {step === 2 && (
              <div className="space-y-5 animate-fade-in">
                {/* Strategy Multi-Select */}
                <div>
                  <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                    <Workflow className="w-3.5 h-3.5" /> Strategy Engine — Inject Strategies
                  </label>
                  <div ref={strategiesRef} className="relative">
                    <button
                      onClick={() => setStrategiesOpen(!strategiesOpen)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm transition-colors hover:border-white/[0.14]"
                    >
                      <span className={draft.strategies.length > 0 ? 'text-white' : 'text-slate-500'}>
                        {draft.strategies.length > 0 ? `${draft.strategies.length} strategies selected` : 'Select strategies to inject...'}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${strategiesOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {strategiesOpen && (
                      <div className="absolute z-30 top-full mt-1 w-full max-h-56 overflow-y-auto scrollbar-thin glass-strong rounded-xl p-2 animate-scale-in">
                        {allStrategies.map(s => {
                          const selected = draft.strategies.includes(s);
                          return (
                            <button
                              key={s}
                              onClick={() => toggleStrategy(s)}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
                                selected ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-slate-300 hover:bg-white/[0.04]'
                              }`}
                            >
                              <span>{s}</span>
                              {selected && <Check className="w-4 h-4" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {draft.strategies.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {draft.strategies.map(s => (
                        <div key={s} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neon-cyan/10 border border-neon-cyan/25 text-xs text-neon-cyan font-medium">
                          {s}
                          <button onClick={() => toggleStrategy(s)} className="text-neon-cyan/50 hover:text-neon-red transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Indicator Toggle Chips */}
                <div>
                  <label className="text-xs text-slate-400 mb-3 block font-semibold flex items-center gap-1.5">
                    <Gauge className="w-3.5 h-3.5" /> Indicator Engine — Toggle Indicators
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {allIndicators.map(ind => {
                      const selected = draft.indicators.includes(ind);
                      return (
                        <button
                          key={ind}
                          onClick={() => toggleIndicator(ind)}
                          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                            selected
                              ? 'bg-neon-amber/15 text-neon-amber border border-neon-amber/40 shadow-[0_0_12px_rgba(255,176,32,0.2)]'
                              : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:border-white/[0.14] hover:text-slate-200'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full transition-all ${selected ? 'bg-neon-amber shadow-[0_0_6px_rgba(255,176,32,0.8)]' : 'bg-slate-600'}`} />
                            {ind}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Trade Sizing */}
                <div>
                  <label className="text-xs text-slate-400 mb-3 block font-semibold flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" /> Trade Sizing
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                    {tradeSizingModes.map(mode => {
                      const isSelected = draft.strategy_settings.trade_sizing === mode.id;
                      const MIcon = mode.icon;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => setDraft({
                            ...draft,
                            strategy_settings: { ...draft.strategy_settings, trade_sizing: mode.id },
                          })}
                          className={`relative text-left p-3 rounded-xl border transition-all duration-200 ${
                            isSelected
                              ? 'bg-neon-green/10 border-neon-green/40'
                              : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <MIcon className={`w-4 h-4 ${isSelected ? 'text-neon-green' : 'text-slate-400'}`} />
                            <span className={`text-xs font-bold ${isSelected ? 'text-neon-green' : 'text-slate-300'}`}>{mode.label}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-relaxed">{mode.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={draft.strategy_settings.sizing_value}
                      onChange={e => setDraft({
                        ...draft,
                        strategy_settings: { ...draft.strategy_settings, sizing_value: Math.max(0, Number(e.target.value)) },
                      })}
                      step={draft.strategy_settings.trade_sizing === 'percent_balance' ? '1' : '10'}
                      min="0"
                      className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-green/40 transition-colors"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-neon-green font-bold">
                      {draft.strategy_settings.trade_sizing === 'percent_balance' ? '%' : '$'}
                    </span>
                  </div>

                  {/* Risk-Based Sizing Additional Inputs */}
                  {draft.strategy_settings.trade_sizing === 'risk_based' && (
                    <div className="grid grid-cols-2 gap-3 mt-3 animate-slide-up">
                      <div>
                        <label className="text-[10px] text-slate-500 mb-1.5 block">Risk Per Trade (%)</label>
                        <div className="relative">
                          <input
                            type="number"
                            value={draft.strategy_settings.risk_per_trade_pct}
                            onChange={e => setDraft({
                              ...draft,
                              strategy_settings: { ...draft.strategy_settings, risk_per_trade_pct: Math.max(0, Math.min(100, Number(e.target.value))) },
                            })}
                            step="0.1"
                            min="0"
                            max="100"
                            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-green/40 transition-colors"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-neon-green font-bold">%</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 mb-1.5 block">Max Notional ($)</label>
                        <input
                          type="number"
                          value={draft.strategy_settings.max_notional}
                          onChange={e => setDraft({
                            ...draft,
                            strategy_settings: { ...draft.strategy_settings, max_notional: Math.max(0, Number(e.target.value)) },
                          })}
                          step="100"
                          min="0"
                          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-green/40 transition-colors"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Summary preview */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                  <p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Logic Preview</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500">IF</span>
                    {draft.strategies.length > 0 ? (
                      draft.strategies.map((s, i) => (
                        <span key={s}>
                          <span className="px-2 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan">{s}</span>
                          {i < draft.strategies.length - 1 && <span className="text-slate-500 ml-1.5">AND</span>}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-600 italic">no strategies</span>
                    )}
                    <span className="text-slate-500 ml-1">CONFIRMED BY</span>
                    {draft.indicators.length > 0 ? (
                      draft.indicators.map((ind, i) => (
                        <span key={ind}>
                          <span className="px-2 py-0.5 rounded bg-neon-amber/10 text-neon-amber">{ind}</span>
                          {i < draft.indicators.length - 1 && <span className="text-slate-500 ml-1.5">+</span>}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-600 italic">no indicators</span>
                    )}
                    <span className="text-slate-500 ml-1">THEN {draft.execution_mode === 'auto' ? 'EXECUTE' : 'SIGNAL'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 — Risk Parameters, Exits & Safeguards */}
            {step === 3 && (
              <div className="space-y-5 animate-fade-in">
                {/* TP & SL Inputs + R/R Visualizer */}
                <div>
                  <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5" /> Exit Parameters — Take Profit & Stop Loss
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1.5 block">Take Profit (%)</label>
                      <input
                        type="number"
                        value={draft.default_tp_pct}
                        onChange={e => setDraft({ ...draft, default_tp_pct: Number(e.target.value) })}
                        step="0.5"
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-green/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1.5 block">Stop Loss (%)</label>
                      <input
                        type="number"
                        value={draft.default_sl_pct}
                        onChange={e => setDraft({ ...draft, default_sl_pct: Number(e.target.value) })}
                        step="0.5"
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-red/40 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Live Risk/Reward Visualizer */}
                  {draft.default_sl_pct > 0 && (
                    <div className="mt-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Risk / Reward Ratio</span>
                        <span className={`text-sm font-mono font-bold ${rrColor}`}>1 : {rrRatio.toFixed(2)}</span>
                      </div>
                      <div className="flex h-6 rounded-lg overflow-hidden bg-white/[0.04]">
                        <div className="bg-neon-red/30 border-r border-neon-red/50 flex items-center justify-center text-[9px] font-bold text-neon-red" style={{ width: `${riskWidth}%` }}>
                          Risk {draft.default_sl_pct}%
                        </div>
                        <div className="bg-neon-green/30 flex items-center justify-center text-[9px] font-bold text-neon-green" style={{ width: `${rewardWidth}%` }}>
                          Reward {draft.default_tp_pct}%
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-600 mt-1.5">{rrLabel}</p>
                    </div>
                  )}
                </div>

                {/* Trailing Stop Loss Toggle + Input */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-neon-cyan" />
                      <div>
                        <p className="text-sm font-semibold text-white">Trailing Stop Loss</p>
                        <p className="text-[10px] text-slate-500">Dynamically follows price upward</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setDraft({
                        ...draft,
                        strategy_settings: { ...draft.strategy_settings, trailing_enabled: !draft.strategy_settings.trailing_enabled },
                      })}
                      className={`relative w-12 h-6 rounded-full transition-all duration-200 ${draft.strategy_settings.trailing_enabled ? 'bg-neon-cyan/30' : 'bg-white/[0.08]'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-200 ${draft.strategy_settings.trailing_enabled ? 'translate-x-6 bg-neon-cyan neon-glow-cyan' : 'bg-slate-500'}`} />
                    </button>
                  </div>
                  {draft.strategy_settings.trailing_enabled && (
                    <div className="animate-slide-up">
                      <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Trailing Distance (%)</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={draft.strategy_settings.trailing_distance_pct}
                          onChange={e => setDraft({
                            ...draft,
                            strategy_settings: { ...draft.strategy_settings, trailing_distance_pct: Math.max(0, Number(e.target.value)) },
                          })}
                          step="0.1"
                          min="0"
                          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/40 transition-colors"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-neon-cyan font-bold">%</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1.5">Stop loss trails price by {draft.strategy_settings.trailing_distance_pct}% — locks in profit while limiting downside.</p>
                    </div>
                  )}
                </div>

                {/* Max Drawdown Slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-neon-red" /> Max Drawdown
                    </label>
                    <span className="text-sm font-mono font-bold text-neon-red">{draft.max_drawdown_pct}%</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    value={draft.max_drawdown_pct}
                    onChange={e => setDraft({ ...draft, max_drawdown_pct: Number(e.target.value) })}
                    className="w-full slider-neon h-2 rounded-full appearance-none bg-white/[0.06] cursor-pointer"
                    style={{ accentColor: '#ff3b5c' }}
                  />
                  <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                    <span>1%</span><span>25%</span><span>50%</span>
                  </div>
                </div>

                {/* Leverage Limit Slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-neon-amber" /> Leverage Limit
                    </label>
                    <span className="text-sm font-mono font-bold text-neon-amber">{draft.max_leverage}x</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="125"
                    step="1"
                    value={draft.max_leverage}
                    onChange={e => setDraft({ ...draft, max_leverage: Number(e.target.value) })}
                    className="w-full h-2 rounded-full appearance-none bg-white/[0.06] cursor-pointer"
                    style={{ accentColor: '#ffb020' }}
                  />
                  <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                    <span>1x</span><span>50x</span><span>125x</span>
                  </div>
                </div>

                {/* Daily Safeguards */}
                <div className="p-4 rounded-xl bg-neon-red/5 border border-neon-red/15">
                  <label className="text-xs text-neon-red mb-3 block font-semibold flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Daily Safeguards
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1.5 block">Max Trades Per Day</label>
                      <input
                        type="number"
                        value={draft.risk_settings.max_trades_per_day}
                        onChange={e => setDraft({
                          ...draft,
                          risk_settings: { ...draft.risk_settings, max_trades_per_day: Math.max(0, Number(e.target.value)) },
                        })}
                        min="0"
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-red/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1.5 block">Max Daily Loss Threshold ($)</label>
                      <input
                        type="number"
                        value={draft.risk_settings.max_daily_loss_threshold}
                        onChange={e => setDraft({
                          ...draft,
                          risk_settings: { ...draft.risk_settings, max_daily_loss_threshold: Math.max(0, Number(e.target.value)) },
                        })}
                        min="0"
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-red/40 transition-colors"
                      />
                    </div>
                  </div>
                </div>

                {/* Risk Summary */}
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <p className="text-[10px] text-slate-500 uppercase font-semibold mb-3">Risk Configuration Summary</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="text-center py-2 rounded-lg bg-neon-red/5">
                      <p className="text-[9px] text-slate-500 uppercase">Max DD</p>
                      <p className="text-sm font-bold text-neon-red font-mono">{draft.max_drawdown_pct}%</p>
                    </div>
                    <div className="text-center py-2 rounded-lg bg-neon-green/5">
                      <p className="text-[9px] text-slate-500 uppercase">TP</p>
                      <p className="text-sm font-bold text-neon-green font-mono">{draft.default_tp_pct}%</p>
                    </div>
                    <div className="text-center py-2 rounded-lg bg-neon-red/5">
                      <p className="text-[9px] text-slate-500 uppercase">SL</p>
                      <p className="text-sm font-bold text-neon-red font-mono">{draft.default_sl_pct}%</p>
                    </div>
                    <div className="text-center py-2 rounded-lg bg-neon-amber/5">
                      <p className="text-[9px] text-slate-500 uppercase">Max Lev</p>
                      <p className="text-sm font-bold text-neon-amber font-mono">{draft.max_leverage}x</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer — Navigation */}
          <div className="sticky bottom-0 bg-base-800/90 backdrop-blur-xl border-t border-white/[0.06] px-5 sm:px-6 py-4 flex items-center justify-between gap-3">
            <button
              onClick={() => step > 1 ? setStep(step - 1) : onClose()}
              className="px-4 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-sm text-slate-300 border border-white/[0.06] transition-all"
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>

            {step < 3 ? (
              <button
                onClick={() => canProceed(step) && setStep(step + 1)}
                disabled={!canProceed(step)}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                  canProceed(step)
                    ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40 hover:neon-glow-cyan'
                    : 'bg-white/[0.03] text-slate-600 border border-white/[0.06] cursor-not-allowed'
                }`}
              >
                Next <ChevronDown className="w-4 h-4 -rotate-90" />
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-neon-green/15 text-neon-green border border-neon-green/40 hover:neon-glow-green transition-all flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                {editing ? 'Save Changes' : 'Deploy Bot'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
