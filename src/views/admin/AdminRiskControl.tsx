import { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle, ShieldCheck, Loader2, Zap, Activity, Server,
  Gauge, Cpu, Brain, BarChart3, LineChart, Plug, ShieldAlert,
  CheckCircle2, XCircle, RefreshCw, Sliders, Power
} from 'lucide-react';
import { supabase, type RiskSettings } from '@/lib/supabase';

interface ApiHealthItem {
  name: string;
  category: 'AI Engine' | 'Market Data';
  status: 'healthy' | 'degraded' | 'down';
  latency: number;
  uptime: number;
  lastCheck: string;
}

const healthConfig = {
  healthy: { color: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/25', dot: 'bg-neon-green' },
  degraded: { color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/25', dot: 'bg-neon-amber' },
  down: { color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/25', dot: 'bg-neon-red' },
};

export default function AdminRiskControl() {
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiLogs, setApiLogs] = useState<ApiHealthItem[]>([]);
  const [refreshingLogs, setRefreshingLogs] = useState(false);
  const [aiCircuitBreaker, setAiCircuitBreaker] = useState(true);
  const [maxSlippagePct, setMaxSlippagePct] = useState(1.5);

  useEffect(() => {
    let mounted = true;
    supabase.from('risk_settings').select('*').limit(1).maybeSingle().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error('Failed to fetch risk settings:', error.message);
      const rs = data as RiskSettings | null;
      setSettings(rs);
      setAiCircuitBreaker(rs?.ai_circuit_breaker ?? true);
      setMaxSlippagePct(rs?.max_slippage_pct ?? 1.5);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const update = async (field: keyof RiskSettings, value: boolean | number) => {
    if (!settings) return;
    const prevSettings = settings;
    setSettings({ ...settings, [field]: value });
    setSaving(true);
    const { error } = await supabase.from('risk_settings').update({
      [field]: value,
      updated_at: new Date().toISOString()
    }).eq('id', settings.id);

    if (error) {
      setSettings(prevSettings);
      console.error('Failed to update risk settings:', error.message);
      setSaving(false);
      return;
    }

    if (field === 'global_kill_switch' && value === true) {
      // Always pause ALL running/paper bots via direct DB update first —
      // this is the reliable halt. invoke() does not throw on HTTP errors
      // (it returns { data, error }), so a catch block would never fire.
      const { error: pauseErr } = await supabase
        .from('bots')
        .update({ status: 'paused' })
        .in('status', ['running', 'paper']);
      if (pauseErr) console.error('Kill switch on but failed to pause bots:', pauseErr.message);

      // Then invoke the panic-sell edge function to liquidate open positions.
      const { error: panicError } = await supabase.functions.invoke('trigger-panic-sell', {
        body: { mode: 'admin' },
      });
      if (panicError) console.error('Panic-sell edge function failed:', panicError instanceof Error ? panicError.message : String(panicError));
    }

    setSaving(false);
  };

  const refreshApiLogs = useCallback(async () => {
    setRefreshingLogs(true);
    const { data, error } = await supabase
      .from('broker_api_logs')
      .select('broker, endpoint, status, latency_ms, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) console.error('Failed to fetch API logs:', error.message);
    if (data && data.length > 0) {
      const grouped: Record<string, { count: number; latencySum: number; failures: number; latest: string }> = {};
      for (const row of data) {
        const key = row.broker;
        if (!grouped[key]) grouped[key] = { count: 0, latencySum: 0, failures: 0, latest: row.created_at };
        grouped[key].count++;
        grouped[key].latencySum += row.latency_ms ?? 0;
        if (row.status === 'error') grouped[key].failures++;
        if (row.created_at > grouped[key].latest) grouped[key].latest = row.created_at;
      }
      const items: ApiHealthItem[] = Object.entries(grouped).map(([broker, stats]) => {
        const avgLatency = Math.round(stats.latencySum / stats.count);
        const failureRate = stats.failures / stats.count;
        const status = failureRate > 0.3 ? 'down' : failureRate > 0.1 ? 'degraded' : 'healthy';
        const uptime = Math.round((1 - failureRate) * 10000) / 100;
        return {
          name: broker,
          category: 'Market Data' as const,
          status: status as 'healthy' | 'degraded' | 'down',
          latency: avgLatency,
          uptime,
          lastCheck: new Date(stats.latest).toLocaleTimeString(),
        };
      });
      setApiLogs(items);
    } else {
      setApiLogs([]);
    }
    setRefreshingLogs(false);
  }, []);

  useEffect(() => { refreshApiLogs(); }, [refreshApiLogs]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-neon-cyan animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-neon-amber" /> Risk Control & Platform Infrastructure
          </h2>
          <p className="text-sm text-slate-400">Manage risk breach defenses, AI circuit breakers, and global core API health</p>
        </div>
        {saving && (
          <div className="flex items-center gap-2 text-xs text-neon-amber font-mono bg-neon-amber/10 px-3 py-1.5 rounded-lg border border-neon-amber/20">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving changes...
          </div>
        )}
      </div>

      {/* Primary Risk Defense Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Global Kill Switch */}
        <div className="glass-card p-5 space-y-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-neon-red/10 border border-neon-red/20 text-neon-red">
                <Power className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Global Kill Switch</h3>
                <p className="text-[11px] text-slate-500">Instantly halt all bot launches and starts platform-wide</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${settings?.global_kill_switch ? 'text-neon-red bg-neon-red/10 border-neon-red/25' : 'text-neon-green bg-neon-green/10 border-neon-green/25'}`}>
              {settings?.global_kill_switch ? 'HALTED' : 'ACTIVE'}
            </span>
          </div>
          <button
            onClick={() => update('global_kill_switch', !(settings?.global_kill_switch ?? false))}
            className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all border ${
              settings?.global_kill_switch
                ? 'bg-neon-green/15 text-neon-green border-neon-green/30 hover:bg-neon-green/25'
                : 'bg-neon-red/15 text-neon-red border-neon-red/30 hover:bg-neon-red/25'
            }`}
          >
            {settings?.global_kill_switch ? 'Resume Platform (Click to Reactivate)' : 'Halt All Trading (Click to Kill)'}
          </button>
        </div>

        {/* Auto-Disable on Breach */}
        <div className="glass-card p-5 space-y-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-neon-green/10 border border-neon-green/20 text-neon-green">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Auto-Disable on Risk Breach</h3>
                <p className="text-[11px] text-slate-500">Automatically pause bots upon risk limit violations</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${settings?.auto_disable_on_breach ? 'text-neon-green bg-neon-green/10 border-neon-green/25' : 'text-slate-500 bg-white/[0.03] border-white/[0.06]'}`}>
              {settings?.auto_disable_on_breach ? 'ENABLED' : 'DISABLED'}
            </span>
          </div>
          <button
            onClick={() => update('auto_disable_on_breach', !(settings?.auto_disable_on_breach ?? true))}
            className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all border ${
              settings?.auto_disable_on_breach
                ? 'bg-neon-green/15 text-neon-green border-neon-green/30 hover:bg-neon-green/25'
                : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:text-white'
            }`}
          >
            {settings?.auto_disable_on_breach ? 'Active Defense Enabled (Click to Toggle)' : 'Defense Disabled (Click to Enable)'}
          </button>
        </div>

        {/* Max Slippage Protection Guard */}
        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Max Slippage Protection Guard</h3>
                <p className="text-[11px] text-slate-500">Reject orders if slippage exceeds threshold</p>
              </div>
            </div>
            <span className="text-xl font-bold font-mono text-neon-cyan">{maxSlippagePct}%</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="5.0"
            step="0.1"
            value={maxSlippagePct}
            onChange={e => {
              const v = Number(e.target.value);
              setMaxSlippagePct(v);
              update('max_slippage_pct', v);
            }}
            className="w-full h-2 rounded-full appearance-none cursor-pointer accent-neon-cyan bg-white/[0.08]"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>0.1% (Strict)</span>
            <span>1.5% (Standard)</span>
            <span>5.0% (Relaxed)</span>
          </div>
        </div>
      </div>

      {/* Platform Risk Limits Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Max Leverage */}
        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-neon-amber/10 border border-neon-amber/20 text-neon-amber">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Max Platform Leverage</h3>
                <p className="text-[11px] text-slate-500">Hard ceiling on leverage any bot can use</p>
              </div>
            </div>
            <span className="text-xl font-bold font-mono text-neon-amber">{settings?.max_leverage ?? 20}x</span>
          </div>
          <input
            type="range"
            min="1"
            max="125"
            step="1"
            value={settings?.max_leverage ?? 20}
            onChange={e => update('max_leverage', Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer bg-white/[0.08]"
            style={{ accentColor: '#ffb020' }}
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>1x</span><span>50x</span><span>125x</span>
          </div>
        </div>

        {/* Max Daily Loss */}
        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-neon-red/10 border border-neon-red/20 text-neon-red">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Max Daily Loss %</h3>
                <p className="text-[11px] text-slate-500">Auto-pause all bots if daily loss exceeds this</p>
              </div>
            </div>
            <span className="text-xl font-bold font-mono text-neon-red">{settings?.max_daily_loss_pct ?? 10}%</span>
          </div>
          <input
            type="range"
            min="1"
            max="50"
            step="1"
            value={settings?.max_daily_loss_pct ?? 10}
            onChange={e => update('max_daily_loss_pct', Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer bg-white/[0.08]"
            style={{ accentColor: '#ff3b5c' }}
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>1%</span><span>25%</span><span>50%</span>
          </div>
        </div>
      </div>

      {/* API Health Alerts Toggle */}
      <div className="glass-card p-5 space-y-4 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">API Health Alerts</h3>
              <p className="text-[11px] text-slate-500">Send real-time alerts when exchange or AI APIs degrade</p>
            </div>
          </div>
          <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${settings?.api_health_alerts ? 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/25' : 'text-slate-500 bg-white/[0.03] border-white/[0.06]'}`}>
            {settings?.api_health_alerts ? 'ENABLED' : 'DISABLED'}
          </span>
        </div>
        <button
          onClick={() => update('api_health_alerts', !(settings?.api_health_alerts ?? true))}
          className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all border ${
            settings?.api_health_alerts
              ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/30 hover:bg-neon-cyan/25'
              : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:text-white'
          }`}>
          {settings?.api_health_alerts ? 'Alerts Active (Click to Toggle)' : 'Alerts Disabled (Click to Enable)'}
        </button>
      </div>

      {/* Futuristic AI Risk Controls */}
      <div className="grid grid-cols-1 md:grid-cols-1 gap-5">
        {/* AI Volatility Circuit Breaker */}
        <div className="glass-card p-5 space-y-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-neon-amber/10 border border-neon-amber/20 text-neon-amber">
                <Brain className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">AI Volatility Circuit Breaker</h3>
                <p className="text-[11px] text-slate-500">AI monitors market spikes & pauses trades during flash crashes</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${aiCircuitBreaker ? 'text-neon-amber bg-neon-amber/10 border-neon-amber/25' : 'text-slate-500 bg-white/[0.03] border-white/[0.06]'}`}>
              {aiCircuitBreaker ? 'SHIELD ACTIVE' : 'OFF'}
            </span>
          </div>
          <button
            onClick={() => {
              const next = !aiCircuitBreaker;
              setAiCircuitBreaker(next);
              update('ai_circuit_breaker', next);
            }}
            className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all border ${
              aiCircuitBreaker
                ? 'bg-neon-amber/15 text-neon-amber border-neon-amber/30 hover:bg-neon-amber/25'
                : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:text-white'
            }`}
          >
            {aiCircuitBreaker ? 'AI Shield Protecting Platform' : 'Enable AI Volatility Shield'}
          </button>
        </div>
      </div>

      {/* Core Infrastructure & AI Engine Health Hub */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-cyan" />
            <h3 className="text-sm font-bold text-white">Core Infrastructure & AI Engine Health Hub</h3>
          </div>
          <button
            onClick={refreshApiLogs}
            disabled={refreshingLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] text-slate-300 hover:text-white text-xs border border-white/[0.08] transition-all disabled:opacity-50"
          >
            {refreshingLogs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Status
          </button>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                <th className="text-left py-3 px-4 font-semibold">Service Name</th>
                <th className="text-left py-3 px-4 font-semibold">Category</th>
                <th className="text-right py-3 px-4 font-semibold">Latency</th>
                <th className="text-right py-3 px-4 font-semibold">Uptime</th>
                <th className="text-center py-3 px-4 font-semibold">Health Status</th>
                <th className="text-right py-3 px-4 font-semibold">Last Checked</th>
              </tr>
            </thead>
            <tbody>
              {apiLogs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-500 text-xs">No API logs yet. Broker API activity will appear here once exchange calls are made.</td></tr>
              ) : apiLogs.map((item, idx) => {
                const hc = healthConfig[item.status];
                const HIcon = item.status === 'healthy' ? CheckCircle2 : item.status === 'degraded' ? AlertTriangle : XCircle;
                return (
                  <tr key={idx} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-white flex items-center gap-2.5">
                      <div className={`w-2 h-2 rounded-full ${hc.dot} animate-pulse`} />
                      {item.name}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-white/[0.05] text-slate-300 border border-white/[0.08]">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-200">
                      <span className={item.latency > 150 ? 'text-neon-amber' : 'text-neon-green'}>
                        {item.latency}ms
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300">{item.uptime}%</td>
                    <td className="py-3.5 px-4 text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold border ${hc.bg} ${hc.color} ${hc.border}`}>
                        <HIcon className="w-3.5 h-3.5" />
                        {item.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right text-xs text-slate-500 font-mono">{item.lastCheck}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
