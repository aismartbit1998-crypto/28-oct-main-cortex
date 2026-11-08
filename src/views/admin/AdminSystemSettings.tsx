import { useState, useEffect, useCallback } from 'react';
import { Settings, Save, Palette, Globe, Bell, ShieldCheck, Check, Loader2, BrainCircuit, Coins, CreditCard, Building2, ToggleLeft, ToggleRight, Radio, Copy, Brain, BarChart3, Crosshair, Bitcoin, Wallet, History, Server } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAllFlagRows, updateFeatureFlag, refreshFeatureFlags, type FeatureFlagRow } from '@/lib/featureFlags';

const featureIconMap: Record<string, typeof Radio> = {
  signals: Radio,
  copy_trading: Copy,
  ai_market_predictor: Brain,
  backtesting: BarChart3,
  performance_analytics: BarChart3,
  position_monitor: Crosshair,
  crypto_view: Bitcoin,
  wallet: Wallet,
  trade_history: History,
};

export default function AdminSystemSettings({ isSubAdmin, adminUserId }: { isSubAdmin?: boolean; adminUserId?: string }) {
  const isSuperAdmin = !isSubAdmin;

  const [appName, setAppName] = useState('Cortex AI');
  const [tagline, setTagline] = useState('Next-Gen Trading Intelligence');
  const [primaryColor, setPrimaryColor] = useState('cyan');
  const [accentColor, setAccentColor] = useState('green');
  const [supportEmail, setSupportEmail] = useState('support@cortexai.io');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [twoFactor, setTwoFactor] = useState(true);
  const [upiId, setUpiId] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [featureRows, setFeatureRows] = useState<FeatureFlagRow[]>([]);
  const [flagSaving, setFlagSaving] = useState<string | null>(null);
  const [brokerRows, setBrokerRows] = useState<Array<{ id: string; exchange_key: string; exchange_name: string; base_url: string; is_active: boolean; sort_order: number }>>([]);
  const [brokerSaving, setBrokerSaving] = useState<string | null>(null);

  const loadFeatureFlags = useCallback(async () => {
    const rows = await fetchAllFlagRows();
    setFeatureRows(rows);
  }, []);

  const loadBrokerSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('broker_settings')
      .select('id, exchange_key, exchange_name, base_url, is_active, sort_order')
      .order('sort_order');
    if (!error && data) setBrokerRows(data as typeof brokerRows);
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      loadFeatureFlags();
      loadBrokerSettings();
    }
  }, [isSuperAdmin, loadFeatureFlags, loadBrokerSettings]);

  // Load saved settings from system_settings table (scoped to admin_id)
  useEffect(() => {
    const query = supabase.from('system_settings').select('key, value');
    // Sub-admins only see their own settings; super_admins see all (NULL admin_id = global)
    const scopedQuery = isSubAdmin && adminUserId
      ? query.eq('admin_id', adminUserId)
      : query.is('admin_id', null);
    scopedQuery.then(({ data, error }) => {
      if (error) { console.error('Failed to load system settings:', error.message); return; }
      if (!data) return;
      const map: Record<string, string> = {};
      for (const row of data) map[row.key] = row.value;
      if (map.app_name) setAppName(map.app_name);
      if (map.tagline) setTagline(map.tagline);
      if (map.primary_color) setPrimaryColor(map.primary_color);
      if (map.accent_color) setAccentColor(map.accent_color);
      if (map.support_email) setSupportEmail(map.support_email);
      if (map.maintenance_mode) setMaintenanceMode(map.maintenance_mode === 'true');
      if (map.email_alerts) setEmailAlerts(map.email_alerts === 'true');
      if (map.two_factor) setTwoFactor(map.two_factor === 'true');
      if (map.manual_upi_id) setUpiId(map.manual_upi_id);
      if (map.manual_bank_name) setBankName(map.manual_bank_name);
      if (map.manual_account_number) setAccountNumber(map.manual_account_number);
      if (map.manual_ifsc_code) setIfscCode(map.manual_ifsc_code);
      if (map.manual_qr_code_url) setQrCodeUrl(map.manual_qr_code_url);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const settings: Record<string, string> = {
      app_name: appName,
      tagline,
      primary_color: primaryColor,
      accent_color: accentColor,
      support_email: supportEmail,
      maintenance_mode: String(maintenanceMode),
      email_alerts: String(emailAlerts),
      two_factor: String(twoFactor),
      manual_upi_id: upiId,
      manual_bank_name: bankName,
      manual_account_number: accountNumber,
      manual_ifsc_code: ifscCode,
      manual_qr_code_url: qrCodeUrl,
    };
    let failed = false;
    for (const [key, value] of Object.entries(settings)) {
      const adminId = isSubAdmin ? adminUserId : null;
      const { error } = await supabase.from('system_settings').upsert(
        { key, value, admin_id: adminId ?? undefined, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
      if (error) { console.error(`Failed to save setting ${key}:`, error.message); failed = true; }
    }
    setSaving(false);
    if (failed) {
      setSaved(false);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };


  const colorOptions = [
    { id: 'cyan', color: '#00e5ff' },
    { id: 'green', color: '#00ff9d' },
    { id: 'amber', color: '#ffb020' },
    { id: 'red', color: '#ff3b5c' },
  ];

  return (
    <div className="space-y-5 animate-slide-up max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-neon-cyan" /> System Settings
        </h2>
        <p className="text-sm text-slate-400">App editing, white-labeling, and platform configuration</p>
      </div>

      {/* Credit System Info */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <Coins className="w-4 h-4 text-neon-amber" /> Credit System
        </h3>
        <p className="text-[11px] text-slate-500 mb-4">
          This platform operates on a credit-based model. Admins and Sub-Admins hold a credit balance and spend credits to allot time-based licenses to clients.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <div className="p-3 rounded-xl bg-neon-cyan/5 border border-neon-cyan/15 text-center">
            <p className="text-lg font-bold text-neon-cyan font-mono">2</p>
            <p className="text-[10px] text-slate-500 mt-0.5">credits/day · Starter</p>
          </div>
          <div className="p-3 rounded-xl bg-neon-green/5 border border-neon-green/15 text-center">
            <p className="text-lg font-bold text-neon-green font-mono">4</p>
            <p className="text-[10px] text-slate-500 mt-0.5">credits/day · Pro</p>
          </div>
          <div className="p-3 rounded-xl bg-neon-amber/5 border border-neon-amber/15 text-center">
            <p className="text-lg font-bold text-neon-amber font-mono">6</p>
            <p className="text-[10px] text-slate-500 mt-0.5">credits/day · Enterprise</p>
          </div>
        </div>
      </div>

      {/* White-Label / Branding */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <Palette className="w-4 h-4 text-neon-cyan" /> White-Label & Branding
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-semibold">App Name</label>
            <div className="relative">
              <BrainCircuit className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input value={appName} onChange={e => setAppName(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Tagline</label>
            <input value={tagline} onChange={e => setTagline(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors" />
          </div>
        </div>

        {/* Color scheme */}
        <div className="mt-4">
          <label className="text-xs text-slate-400 mb-2 block font-semibold">Theme Colors</label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-slate-500 mb-2">Primary Color</p>
              <div className="flex gap-2">
                {colorOptions.map(c => (
                  <button key={c.id} onClick={() => setPrimaryColor(c.id)}
                    className={`w-10 h-10 rounded-xl border-2 transition-all ${primaryColor === c.id ? 'scale-110 border-white' : 'border-transparent'}`}
                    style={{ backgroundColor: c.color, boxShadow: primaryColor === c.id ? `0 0 15px ${c.color}` : 'none' }} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-2">Accent Color</p>
              <div className="flex gap-2">
                {colorOptions.map(c => (
                  <button key={c.id} onClick={() => setAccentColor(c.id)}
                    className={`w-10 h-10 rounded-xl border-2 transition-all ${accentColor === c.id ? 'scale-110 border-white' : 'border-transparent'}`}
                    style={{ backgroundColor: c.color, boxShadow: accentColor === c.id ? `0 0 15px ${c.color}` : 'none' }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="mt-4 p-4 rounded-xl bg-base-800/50 border border-white/[0.06]">
          <p className="text-[10px] text-slate-500 mb-2">Live Preview</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl border flex items-center justify-center" style={{ borderColor: colorOptions.find(c => c.id === primaryColor)?.color + '60', background: colorOptions.find(c => c.id === primaryColor)?.color + '15' }}>
              <BrainCircuit className="w-5 h-5" style={{ color: colorOptions.find(c => c.id === primaryColor)?.color }} />
            </div>
            <div>
              <h4 className="text-sm font-bold" style={{ color: colorOptions.find(c => c.id === primaryColor)?.color }}>{appName}</h4>
              <p className="text-[10px] text-slate-500">{tagline}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Platform Config */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <Globe className="w-4 h-4 text-neon-green" /> Platform Configuration
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
            <div>
              <p className="text-sm font-semibold text-white">Support Email</p>
              <p className="text-[10px] text-slate-500">Displayed in Help Center and contact pages</p>
            </div>
            <input value={supportEmail} onChange={e => setSupportEmail(e.target.value)}
              className="px-3 py-2 rounded-lg glass text-xs text-white font-mono focus:outline-none focus:border-neon-cyan/40 w-56" />
          </div>
          <ToggleRow label="Maintenance Mode" desc="Take the platform offline for updates" icon={Settings}
            enabled={maintenanceMode} onToggle={() => setMaintenanceMode(!maintenanceMode)} />
          <ToggleRow label="Email Alerts" desc="Send admin email notifications for critical events" icon={Bell}
            enabled={emailAlerts} onToggle={() => setEmailAlerts(!emailAlerts)} />
          <ToggleRow label="Two-Factor Authentication" desc="Require 2FA for all admin accounts" icon={ShieldCheck}
            enabled={twoFactor} onToggle={() => setTwoFactor(!twoFactor)} />
        </div>
      </div>

      {/* Manual Payment Settings */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-neon-amber" /> Payment Settings (Manual)
        </h3>
        <p className="text-[11px] text-slate-500 mb-4">
          Configure UPI and bank details for manual payment verification. These are shown to users during the checkout flow when they upgrade their plan.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-semibold">UPI ID</label>
            <input value={upiId} onChange={e => setUpiId(e.target.value)} placeholder="e.g. cortexai@upi"
              className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-amber/40 transition-colors font-mono" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Bank Account Name</label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Cortex AI Technologies"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-amber/40 transition-colors" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Account Number</label>
            <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="e.g. 12345678901234"
              className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-amber/40 transition-colors font-mono" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-semibold">IFSC Code</label>
            <input value={ifscCode} onChange={e => setIfscCode(e.target.value.toUpperCase())} placeholder="e.g. HDFC0001234"
              className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-amber/40 transition-colors font-mono" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-400 mb-1.5 block font-semibold">QR Code Image URL (Optional)</label>
            <input value={qrCodeUrl} onChange={e => setQrCodeUrl(e.target.value)} placeholder="https://...qr-code.png"
              className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-amber/40 transition-colors" />
            {qrCodeUrl && (
              <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <img src={qrCodeUrl} alt="Payment QR" className="w-20 h-20 rounded-lg object-cover border border-white/[0.08]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <p className="text-[10px] text-slate-500">Preview of the QR code that users will see during checkout.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feature Toggles — Super Admin Only */}
      {isSuperAdmin && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
            <ToggleLeft className="w-4 h-4 text-neon-cyan" /> Feature Toggles
          </h3>
          <p className="text-[11px] text-slate-500 mb-4">
            Globally enable or disable client-facing features. When OFF, the feature is hidden from all client sidebars and its edge functions reject requests.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {featureRows.map((flag) => {
              const icon = featureIconMap[flag.feature_key] ?? Radio;
              const Icon = icon;
              const isOn = flag.is_enabled;
              const isSaving = flagSaving === flag.feature_key;
              return (
                <div key={flag.id} className={`flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border ${isOn ? 'border-neon-green/20' : 'border-white/[0.06]}'}`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isOn ? 'text-neon-green' : 'text-slate-500'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{flag.label}</p>
                      <p className="text-[10px] text-slate-500 truncate">{flag.description}</p>
                    </div>
                  </div>
                  <button
                    disabled={isSaving}
                    onClick={async () => {
                      setFlagSaving(flag.feature_key);
                      const ok = await updateFeatureFlag(flag.feature_key, !isOn);
                      if (ok) {
                        setFeatureRows(prev => prev.map(r => r.feature_key === flag.feature_key ? { ...r, is_enabled: !isOn } : r));
                        await refreshFeatureFlags();
                      }
                      setFlagSaving(null);
                    }}
                    className={`relative w-11 h-6 rounded-full transition-all duration-200 flex-shrink-0 ml-3 ${isOn ? 'bg-neon-green/30' : 'bg-white/[0.08]'}`}
                  >
                    {isSaving ? (
                      <Loader2 className="absolute top-0.5 left-0.5 w-5 h-5 animate-spin text-slate-400" />
                    ) : (
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-200 ${isOn ? 'translate-x-5 bg-neon-green neon-glow-green' : 'bg-slate-500'}`} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Broker Settings — Super Admin Only */}
      {isSuperAdmin && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
            <Server className="w-4 h-4 text-neon-green" /> Broker / Exchange Settings
          </h3>
          <p className="text-[11px] text-slate-500 mb-4">
            Globally control which exchanges are available to clients. Toggle OFF to block new connections to an exchange.
          </p>
          <div className="space-y-3">
            {brokerRows.map((broker) => {
              const isOn = broker.is_active;
              const isSaving = brokerSaving === broker.exchange_key;
              return (
                <div key={broker.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isOn ? 'bg-neon-green/10 border border-neon-green/20' : 'bg-white/[0.04] border border-white/[0.06]'}`}>
                      <Server className={`w-4 h-4 ${isOn ? 'text-neon-green' : 'text-slate-500'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{broker.exchange_name}</p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">{broker.base_url}</p>
                    </div>
                  </div>
                  <button
                    disabled={isSaving}
                    onClick={async () => {
                      setBrokerSaving(broker.exchange_key);
                      const { error } = await supabase
                        .from('broker_settings')
                        .update({ is_active: !isOn, updated_at: new Date().toISOString() })
                        .eq('exchange_key', broker.exchange_key);
                      if (!error) {
                        setBrokerRows(prev => prev.map(r => r.exchange_key === broker.exchange_key ? { ...r, is_active: !isOn } : r));
                      }
                      setBrokerSaving(null);
                    }}
                    className={`relative w-11 h-6 rounded-full transition-all duration-200 flex-shrink-0 ml-3 ${isOn ? 'bg-neon-green/30' : 'bg-white/[0.08]'}`}
                  >
                    {isSaving ? (
                      <Loader2 className="absolute top-0.5 left-0.5 w-5 h-5 animate-spin text-slate-400" />
                    ) : (
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-200 ${isOn ? 'translate-x-5 bg-neon-green neon-glow-green' : 'bg-slate-500'}`} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="flex items-center gap-1.5 text-xs text-neon-green animate-fade-in">
            <Check className="w-4 h-4" /> Settings saved successfully
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${
            saving
              ? 'bg-white/[0.05] text-slate-400 cursor-wait'
              : 'bg-gradient-to-r from-neon-cyan/20 to-neon-green/20 text-white border border-neon-cyan/40 hover:from-neon-cyan/30 hover:to-neon-green/30 neon-glow-cyan hover:scale-[1.02]'
          }`}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, icon: Icon, enabled, onToggle }: {
  label: string; desc: string; icon: typeof Settings; enabled: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
      <div className="flex items-center gap-3">
        <Icon className={`w-4 h-4 ${enabled ? 'text-neon-green' : 'text-slate-500'}`} />
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="text-[10px] text-slate-500">{desc}</p>
        </div>
      </div>
      <button onClick={onToggle}
        className={`relative w-12 h-6 rounded-full transition-all duration-200 ${enabled ? 'bg-neon-green/30' : 'bg-white/[0.08]'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-200 ${enabled ? 'translate-x-6 bg-neon-green neon-glow-green' : 'bg-slate-500'}`} />
      </button>
    </div>
  );
}
