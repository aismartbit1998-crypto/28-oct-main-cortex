import { useEffect, useState } from 'react';
import {
  SlidersHorizontal, Loader2, Save, Check, Brain, BarChart3,
  LineChart, Cpu, Zap, Users, Plus, Trash2, Edit3, Shield,
  UserCheck, X
} from 'lucide-react';
import { supabase, type ApiSettings, type MasterTrader } from '@/lib/supabase';

interface ApiField {
  key: keyof ApiSettings;
  label: string;
  placeholder: string;
  icon: typeof Brain;
}

interface ApiSection {
  title: string;
  icon: typeof Brain;
  accent: string;
  fields: ApiField[];
}

const aiEngineSection: ApiSection = {
  title: 'Global AI Engines',
  icon: Brain,
  accent: 'cyan',
  fields: [
    { key: 'openai_api_key', label: 'OpenAI API Key', placeholder: 'sk-proj-... (paid)', icon: Brain },
    { key: 'anthropic_api_key', label: 'Anthropic API Key', placeholder: 'sk-ant-... (paid)', icon: Cpu },
    { key: 'gemini_api_key', label: 'Google Gemini API Key', placeholder: 'AIza... (FREE tier)', icon: Cpu },
    { key: 'deepseek_api_key', label: 'DeepSeek API Key', placeholder: 'ds-... (FREE tier)', icon: Cpu },
  ],
};

const marketDataSection: ApiSection = {
  title: 'Global Market Data & Charting',
  icon: BarChart3,
  accent: 'green',
  fields: [
    { key: 'coingecko_api_key', label: 'CoinGecko API Key (optional)', placeholder: 'CG-... — not required, Binance WS is used', icon: LineChart },
    { key: 'coinmarketcap_api_key', label: 'CoinMarketCap API Key (optional)', placeholder: 'CMC-... — not required, Binance WS is used', icon: BarChart3 },
    { key: 'tradingview_license_key', label: 'TradingView License Key (optional)', placeholder: 'tv_lic_... — lightweight-charts is free', icon: LineChart },
  ],
};

const accentMap: Record<string, { text: string; bg: string; border: string; glow: string }> = {
  cyan: { text: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/30', glow: 'shadow-[0_0_12px_rgba(0,229,255,0.2)]' },
  green: { text: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/30', glow: 'shadow-[0_0_12px_rgba(0,255,157,0.2)]' },
  amber: { text: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/30', glow: 'shadow-[0_0_12px_rgba(255,176,32,0.2)]' },
};

export default function AdminApiControl() {
  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [masterTraders, setMasterTraders] = useState<MasterTrader[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Modal state for adding/editing master traders
  const [showTraderModal, setShowTraderModal] = useState(false);
  const [editingTrader, setEditingTrader] = useState<MasterTrader | null>(null);
  const [traderName, setTraderName] = useState('');
  const [traderBio, setTraderBio] = useState('');
  const [traderExchange, setTraderExchange] = useState('CoinDCX');
  const [traderStrategy, setTraderStrategy] = useState('');
  const [traderMarket, setTraderMarket] = useState<'spot' | 'futures'>('spot');
  const [traderRoi, setTraderRoi] = useState(0);
  const [traderWinRate, setTraderWinRate] = useState(0);
  const [traderRiskLevel, setTraderRiskLevel] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [traderMaxDrawdown, setTraderMaxDrawdown] = useState(0);
  const [traderCommission, setTraderCommission] = useState(15);

  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      // Fetch global API settings
      const { data: apiData } = await supabase.from('api_settings').select('*').limit(1).maybeSingle();
      // Fetch registered master traders
      const { data: traderData } = await supabase.from('master_traders').select('*').order('created_at', { ascending: false });

      if (!mounted) return;
      setSettings(apiData as ApiSettings | null);
      setMasterTraders((traderData as MasterTrader[]) ?? []);
      setLoading(false);
    }
    fetchData();
    return () => { mounted = false; };
  }, []);

  const updateField = (key: keyof ApiSettings, value: string) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const handleSaveGlobalAiAndMarket = async () => {
    if (!settings) return;
    setSaving(true);
    const updatePayload: Record<string, string | null> = {};
    [...aiEngineSection.fields, ...marketDataSection.fields].forEach(f => {
      updatePayload[f.key] = settings[f.key] ?? null;
    });
    updatePayload.updated_at = new Date().toISOString();
    const { error } = await supabase.from('api_settings').update(updatePayload).eq('id', settings.id);
    setSaving(false);
    if (error) {
      setSaved(false);
      setSaveError(`Save failed: ${error.message}`);
      return;
    }
    setSaved(true);
    setSaveError(null);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleOpenAddTrader = () => {
    setEditingTrader(null);
    setTraderName('');
    setTraderBio('');
    setTraderExchange('CoinDCX');
    setTraderStrategy('');
    setTraderMarket('spot');
    setTraderRoi(0);
    setTraderWinRate(0);
    setTraderRiskLevel('Medium');
    setTraderMaxDrawdown(0);
    setTraderCommission(15);
    setShowTraderModal(true);
  };

  const handleOpenEditTrader = (trader: MasterTrader) => {
    setEditingTrader(trader);
    setTraderName(trader.name);
    setTraderBio(trader.bio ?? '');
    setTraderExchange(trader.exchange ?? 'CoinDCX');
    setTraderStrategy(trader.strategy ?? '');
    setTraderMarket((trader.market as 'spot' | 'futures') ?? 'spot');
    setTraderRoi(Number(trader.roi_percentage));
    setTraderWinRate(Number(trader.win_rate));
    setTraderRiskLevel(trader.risk_level);
    setTraderMaxDrawdown(Number(trader.max_drawdown ?? 0));
    setTraderCommission(Number(trader.commission_pct));
    setShowTraderModal(true);
  };

  const handleSaveTrader = async () => {
    if (!traderName.trim()) return;
    setSaving(true);

    const payload = {
      name: traderName.trim(),
      bio: traderBio.trim() || null,
      exchange: traderExchange,
      strategy: traderStrategy.trim() || null,
      market: traderMarket,
      roi_percentage: Number(traderRoi),
      win_rate: Number(traderWinRate),
      risk_level: traderRiskLevel,
      max_drawdown: Number(traderMaxDrawdown),
      commission_pct: Number(traderCommission),
    };

    if (editingTrader) {
      const { error } = await supabase.from('master_traders').update(payload).eq('id', editingTrader.id);
      if (error) {
        setSaving(false);
        setSaveError(`Failed to save trader: ${error.message}`);
        return;
      }
      setMasterTraders(prev => prev.map(t => t.id === editingTrader.id ? { ...t, ...payload } : t));
    } else {
      const { data, error } = await supabase.from('master_traders').insert({
        ...payload,
        status: 'active',
        active_copiers: 0,
      }).select('*').single();

      if (error) {
        setSaving(false);
        setSaveError(`Failed to create trader: ${error.message}`);
        return;
      }

      if (data) {
        setMasterTraders(prev => [data as MasterTrader, ...prev]);
      }
    }

    setSaving(false);
    setShowTraderModal(false);
  };

  const handleToggleTraderStatus = async (trader: MasterTrader) => {
    const newStatus = trader.status === 'active' ? 'paused' : 'active';
    const prevTraders = masterTraders;
    setMasterTraders(prev => prev.map(t => t.id === trader.id ? { ...t, status: newStatus } : t));
    const { error } = await supabase.from('master_traders').update({ status: newStatus }).eq('id', trader.id);
    if (error) {
      setMasterTraders(prevTraders);
      setSaveError(`Failed to toggle status: ${error.message}`);
      return;
    }
    setSaveError(null);
  };

  const handleDeleteTrader = async (id: string) => {
    if (!window.confirm("Are you sure you want to remove this master trader?")) return;
    const prevTraders = masterTraders;
    setMasterTraders(prev => prev.filter(t => t.id !== id));
    const { error } = await supabase.from('master_traders').delete().eq('id', id);
    if (error) {
      setMasterTraders(prevTraders);
      setSaveError(`Failed to delete trader: ${error.message}`);
      return;
    }
    setSaveError(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-neon-cyan animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-neon-cyan" /> Master Settings & API Control
          </h2>
          <p className="text-sm text-slate-400">Manage global AI keys, market data, and registered copy-trading master traders</p>
        </div>
        <button
          onClick={handleSaveGlobalAiAndMarket}
          disabled={saving}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 flex-shrink-0 ${
            saving
              ? 'bg-white/[0.05] text-slate-400 cursor-wait'
              : saved
              ? 'bg-neon-green/15 text-neon-green border border-neon-green/40 neon-glow-green'
              : 'bg-gradient-to-r from-neon-cyan/20 to-neon-green/20 text-white border border-neon-cyan/40 hover:from-neon-cyan/30 hover:to-neon-green/30 neon-glow-cyan hover:scale-[1.02]'
          }`}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Global Config'}
        </button>
      </div>

      {/* AI Engines Section */}
      <ApiSectionCard section={aiEngineSection} settings={settings} onUpdate={updateField} />

      {/* AI Fallback Priority Info */}
      <div className="glass-card p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-4 h-4 text-neon-cyan flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-bold text-white mb-1">AI Engine Fallback Chain</p>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-2">
              When generating AI sentiment summaries, the system tries engines in this order:
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 rounded-md bg-neon-green/10 text-neon-green text-[10px] font-bold border border-neon-green/20">1. Gemini (Free)</span>
              <span className="px-2 py-1 rounded-md bg-neon-green/10 text-neon-green text-[10px] font-bold border border-neon-green/20">2. DeepSeek (Free)</span>
              <span className="px-2 py-1 rounded-md bg-neon-amber/10 text-neon-amber text-[10px] font-bold border border-neon-amber/20">3. OpenAI (Paid)</span>
              <span className="px-2 py-1 rounded-md bg-neon-amber/10 text-neon-amber text-[10px] font-bold border border-neon-amber/20">4. Anthropic (Paid)</span>
              <span className="px-2 py-1 rounded-md bg-white/[0.05] text-slate-400 text-[10px] font-bold border border-white/[0.08]">5. Built-in NLP (Zero cost)</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">If all API keys are blank, the system uses the built-in NLP heuristic engine — it never crashes.</p>
          </div>
        </div>
      </div>

      {/* Market Data & Charting Section */}
      <ApiSectionCard section={marketDataSection} settings={settings} onUpdate={updateField} />

      {/* Registered Master Traders & Copier Nodes Manager */}
      <div className="glass-card p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-neon-amber/10 border border-neon-amber/30 flex items-center justify-center">
              <Users className="w-5 h-5 text-neon-amber" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Registered Master Traders (Copy Trading Hub)</h3>
              <p className="text-[11px] text-slate-500">Manage expert signal providers whose exchange accounts clients can copy</p>
            </div>
          </div>
          <button
            onClick={handleOpenAddTrader}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-neon-amber/15 text-neon-amber border border-neon-amber/30 hover:bg-neon-amber/25 text-xs font-bold transition-all"
          >
            <Plus className="w-4 h-4" /> Add Master Trader
          </button>
        </div>

        {masterTraders.length === 0 ? (
          <div className="p-10 text-center border border-dashed border-white/[0.08] rounded-2xl">
            <UserCheck className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-300">No Master Traders Registered</p>
            <p className="text-xs text-slate-500 mt-1">Add expert traders to the copy-trading marketplace so clients can copy their strategies.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {masterTraders.map(trader => {
              const isActive = trader.status === 'active';
              return (
                <div key={trader.id} className={`relative rounded-2xl border p-5 transition-all ${isActive ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-neon-amber/5 border-neon-amber/20 opacity-75'}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center text-xs font-bold text-neon-cyan">
                        {(trader.exchange ?? '????').slice(0, 4).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">{trader.name}</h4>
                        <p className="text-[10px] text-slate-400">Exchange: <span className="text-neon-cyan font-semibold">{trader.exchange ?? 'N/A'}</span></p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${isActive ? 'bg-neon-green/10 text-neon-green border-neon-green/30' : 'bg-neon-amber/10 text-neon-amber border-neon-amber/30'}`}>
                      {trader.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 my-3 p-3 rounded-xl bg-white/[0.03] text-xs">
                    <div>
                      <span className="text-slate-500 block text-[10px]">ROI</span>
                      <span className="font-bold text-neon-green font-mono">+{Number(trader.roi_percentage).toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Win Rate</span>
                      <span className="font-bold text-white font-mono">{Number(trader.win_rate).toFixed(0)}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Copiers</span>
                      <span className="font-bold text-neon-cyan font-mono">{trader.active_copiers}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                    <button
                      onClick={() => handleOpenEditTrader(trader)}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-slate-300 hover:text-white border border-white/[0.08] text-xs font-semibold transition-all"
                    >
                      <Edit3 className="w-3.5 h-3.5 inline mr-1" /> Edit
                    </button>
                    <button
                      onClick={() => handleToggleTraderStatus(trader)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${isActive ? 'bg-neon-amber/10 text-neon-amber border-neon-amber/20' : 'bg-neon-green/10 text-neon-green border-neon-green/20'}`}
                    >
                      {isActive ? 'Pause' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDeleteTrader(trader.id)}
                      className="p-1.5 rounded-lg bg-neon-red/10 text-neon-red border border-neon-red/20 hover:bg-neon-red/20 transition-all"
                      title="Remove Trader"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Master Trader Modal */}
      {showTraderModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-base-900/85 backdrop-blur-md" onClick={() => setShowTraderModal(false)} />
          <div className="relative w-full max-w-lg animate-scale-in">
            <div className="glass-strong neon-glow-amber rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-neon-amber" /> {editingTrader ? 'Edit Master Trader' : 'Add New Master Trader'}
                </h3>
                <button onClick={() => setShowTraderModal(false)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block font-semibold">Trader / Expert Name</label>
                  <input
                    type="text"
                    value={traderName}
                    onChange={e => setTraderName(e.target.value)}
                    placeholder="e.g. Alpha Capital Group"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-amber/40"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1 block font-semibold">Bio / Description</label>
                  <input
                    type="text"
                    value={traderBio}
                    onChange={e => setTraderBio(e.target.value)}
                    placeholder="Short description shown in the marketplace..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-amber/40"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block font-semibold">Exchange Name</label>
                    <select
                      value={traderExchange}
                      onChange={e => setTraderExchange(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-base-800 border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-amber/40"
                    >
                      <option value="CoinDCX">CoinDCX</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block font-semibold">Market</label>
                    <select
                      value={traderMarket}
                      onChange={e => setTraderMarket(e.target.value as 'spot' | 'futures')}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-base-800 border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-amber/40"
                    >
                      <option value="spot">Spot</option>
                      <option value="futures">Futures</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1 block font-semibold">Strategy</label>
                  <input
                    type="text"
                    value={traderStrategy}
                    onChange={e => setTraderStrategy(e.target.value)}
                    placeholder="e.g. Grid Trading, DCA, Scalping..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-amber/40"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block font-semibold">Monthly ROI (%)</label>
                    <input
                      type="number"
                      value={traderRoi}
                      onChange={e => setTraderRoi(Number(e.target.value))}
                      step="0.1"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block font-semibold">Win Rate (%)</label>
                    <input
                      type="number"
                      value={traderWinRate}
                      onChange={e => setTraderWinRate(Number(e.target.value))}
                      step="1"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block font-semibold">Risk Level</label>
                    <select
                      value={traderRiskLevel}
                      onChange={e => setTraderRiskLevel(e.target.value as 'Low' | 'Medium' | 'High')}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-base-800 border border-white/[0.08] text-sm text-white focus:outline-none focus:border-neon-amber/40"
                    >
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block font-semibold">Max Drawdown (%)</label>
                    <input
                      type="number"
                      value={traderMaxDrawdown}
                      onChange={e => setTraderMaxDrawdown(Number(e.target.value))}
                      step="0.1"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1 block font-semibold">Profit Commission (%)</label>
                  <input
                    type="number"
                    value={traderCommission}
                    onChange={e => setTraderCommission(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-3 border-t border-white/[0.06]">
                <button
                  onClick={() => setShowTraderModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.04] text-slate-300 hover:text-white text-sm font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTrader}
                  disabled={saving || !traderName.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-neon-amber/15 text-neon-amber border border-neon-amber/40 hover:bg-neon-amber/25 text-sm font-bold transition-all disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Check className="w-4 h-4 inline mr-1" />}
                  Save Trader
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ApiSectionCard({ section, settings, onUpdate }: {
  section: ApiSection;
  settings: ApiSettings | null;
  onUpdate: (key: keyof ApiSettings, value: string) => void;
}) {
  const a = accentMap[section.accent];
  const SIcon = section.icon;

  return (
    <div className="glass-card p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className={`w-10 h-10 rounded-xl ${a.bg} ${a.border} border flex items-center justify-center`}>
          <SIcon className={`w-5 h-5 ${a.text}`} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">{section.title}</h3>
          <p className="text-[11px] text-slate-500">Configure external API integrations</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {section.fields.map((field) => {
          const FIcon = field.icon;
          const value = settings ? (settings[field.key] ?? '') : '';
          const hasKey = Boolean(value);
          return (
            <div key={field.key} className="relative">
              <label className="text-[10px] text-slate-500 mb-1.5 block font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <FIcon className={`w-3 h-3 ${hasKey ? a.text : 'text-slate-600'}`} />
                {field.label}
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={value}
                  onChange={e => onUpdate(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className={`w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border text-sm text-white font-mono focus:outline-none transition-colors ${
                    hasKey ? 'border-neon-green/30 focus:border-neon-green/50' : 'border-white/[0.08] focus:border-white/[0.16]'
                  }`}
                />
                {hasKey && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                    <span className="text-[9px] text-neon-green font-bold">SET</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}