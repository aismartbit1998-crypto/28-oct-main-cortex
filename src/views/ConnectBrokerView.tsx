import { useEffect, useState } from 'react';
import { Plug, Check, Zap, Loader2, Trash2, KeyRound, ShieldCheck, Lock } from 'lucide-react';
import { supabase, type BrokerKey } from '@/lib/supabase';

const brokerCatalog = [
  { name: 'CoinDCX', logo: 'CDX', desc: 'India\'s most popular crypto investment app', features: ['INR deposits via UPI', '200+ coins', 'INR-M futures', 'FIU-IND registered'] },
];

function maskKey(key: string): string {
  if (!key || key.length <= 8) return '****';
  return key.slice(0, 4) + '-****-' + key.slice(-4);
}

export default function ConnectBrokerView() {
  const [connected, setConnected] = useState<BrokerKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalBroker, setModalBroker] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase
      .from('broker_keys')
      .select('id, user_id, exchange_name, api_key, is_connected, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!mounted) return;
        setConnected((data as BrokerKey[]) ?? []);
        setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const handleConnect = async () => {
    if (!modalBroker || !apiKey.trim() || !apiSecret.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        setError('Authentication session expired. Please sign in again.');
        setSaving(false);
        return;
      }

      const vaultResp = await fetch(`${supabaseUrl}/functions/v1/vault`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: 'encrypt',
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
        }),
      });

      if (!vaultResp.ok) {
        const vaultErr = await vaultResp.json().catch(() => ({ error: 'Vault encryption failed' }));
        setError(vaultErr.error ?? 'Failed to encrypt API keys');
        setSaving(false);
        return;
      }

      const { encryptedKey, encryptedSecret, keyPreview } = await vaultResp.json();

      const { data: existing } = await supabase
        .from('broker_keys')
        .select('id')
        .eq('exchange_name', modalBroker)
        .maybeSingle();

      if (existing) {
        const { error: updateErr } = await supabase
          .from('broker_keys')
          .update({
            api_key: encryptedKey,
            api_secret: encryptedSecret,
            is_connected: true,
          })
          .eq('id', existing.id);
        if (updateErr) {
        const msg = updateErr.message ?? '';
        if (msg.includes('one_active_broker_per_user') || msg.includes('unique constraint')) {
          setError('Only one exchange connection is allowed at a time. Disconnect your active exchange first.');
        } else {
          setError(msg);
        }
        setSaving(false);
        return;
      }
      } else {
        const { error: insertErr } = await supabase
          .from('broker_keys')
          .insert({
            exchange_name: modalBroker,
            api_key: encryptedKey,
            api_secret: encryptedSecret,
            is_connected: true,
          });
        if (insertErr) {
        const msg = insertErr.message ?? '';
        if (msg.includes('one_active_broker_per_user') || msg.includes('unique constraint')) {
          setError('Only one exchange connection is allowed at a time. Disconnect your active exchange first.');
        } else {
          setError(msg);
        }
        setSaving(false);
        return;
      }
      }

      const { data } = await supabase
        .from('broker_keys')
        .select('id, user_id, exchange_name, api_key, is_connected, created_at')
        .order('created_at', { ascending: false });
      setConnected((data as BrokerKey[]) ?? []);
      setSaving(false);
      setModalBroker(null);
      setApiKey('');
      setApiSecret('');
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    const { error } = await supabase.from('broker_keys').delete().eq('id', id);
    if (error) {
      console.error('Failed to disconnect broker:', error.message);
      return;
    }
    setConnected(prev => prev.filter(b => b.id !== id));
  };

  const isConnected = (name: string) => connected.find(b => b.exchange_name === name && b.is_connected);
  const hasActiveConnection = connected.some(b => b.is_connected);
  const activeConnectionName = connected.find(b => b.is_connected)?.exchange_name;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Plug className="w-5 h-5 text-neon-cyan" />
          Connect Your Broker
        </h2>
        <p className="text-sm text-slate-400">Link your exchange accounts to enable automated trading</p>
      </div>

      {/* API Security Notice */}
      <div className="glass-card p-4 border-neon-green/20 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-neon-green flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-white">AES-256 Encrypted Vault</p>
          <p className="text-xs text-slate-400 mt-1">
            Your API keys are encrypted with AES-256-GCM before storage. Keys are decrypted only in-memory at trade execution time and never exposed to the frontend. Only enable "Read" and "Trade" permissions on your exchange.
          </p>
        </div>
      </div>

      {/* Broker grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {brokerCatalog.map((b) => {
          const conn = isConnected(b.name);
          return (
            <div key={b.name} className="glass-card p-5 hover:border-white/[0.12] transition-all duration-300">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.05] border border-white/[0.06] flex items-center justify-center text-[10px] font-bold text-slate-300">
                    {b.logo}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{b.name}</h3>
                    <p className="text-[10px] text-slate-500">{b.desc}</p>
                  </div>
                </div>
                {conn && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-neon-green/10 text-neon-green text-[10px] font-bold border border-neon-green/20">
                    <Check className="w-3 h-3" /> Connected
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {b.features.map((f) => (
                  <span key={f} className="px-2 py-1 rounded-md bg-white/[0.04] text-[10px] text-slate-400">{f}</span>
                ))}
              </div>

              {conn ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <KeyRound className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <span className="text-xs font-mono text-slate-400">{maskKey(conn.api_key)}</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-neon-green/10 text-neon-green border border-neon-green/30">
                      <Check className="w-4 h-4" /> Active
                    </div>
                    <button
                      onClick={() => handleDisconnect(conn.id)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-neon-red/10 text-neon-red border border-neon-red/30 hover:bg-neon-red/20 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : hasActiveConnection ? (
                <div className="space-y-2">
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/[0.02] text-slate-600 border border-white/[0.04] cursor-not-allowed"
                  >
                    <Lock className="w-4 h-4" /> Locked
                  </button>
                  <p className="text-[10px] text-slate-500 text-center leading-tight">
                    Disconnect {activeConnectionName} to connect a new broker
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => { setModalBroker(b.name); setError(null); setApiKey(''); setApiSecret(''); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold btn-neon-cyan hover:scale-[1.02]"
                >
                  <Plug className="w-4 h-4" /> Connect via API
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* API Key Modal */}
      {modalBroker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-base-900/80 backdrop-blur-md" onClick={() => !saving && setModalBroker(null)} />
          <div className="relative w-full max-w-md animate-scale-in">
            <div className="glass-strong neon-glow-cyan p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-neon-cyan" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Connect to {modalBroker}</h2>
                  <p className="text-xs text-slate-400">Keys are encrypted with AES-256 before storage</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block font-semibold">API Key</label>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Your exchange API key"
                    className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/40 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block font-semibold">API Secret</label>
                  <input
                    type="password"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="Your exchange API secret"
                    className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/40 transition-colors"
                  />
                </div>

                {error && (
                  <p className="text-xs text-neon-red">{error}</p>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setModalBroker(null)}
                    disabled={saving}
                    className="flex-1 px-4 py-2.5 rounded-xl glass hover:bg-white/[0.07] text-sm text-slate-300 transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConnect}
                    disabled={!apiKey.trim() || !apiSecret.trim() || saving}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      apiKey.trim() && apiSecret.trim() && !saving
                        ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40 hover:neon-glow-cyan'
                        : 'bg-white/[0.03] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                    }`}
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Encrypt & Connect'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
