import { useState, useEffect } from 'react';
import { X, Coins, Copy, Check, Loader2, Building2, CreditCard, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Props {
  subAdminId: string;
  onClose: () => void;
  onPurchased: () => void;
}

interface MasterSettings {
  upi_id?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  ifsc_code?: string | null;
  qr_code_url?: string | null;
}

export default function BuyCreditsModal({ subAdminId, onClose, onPurchased }: Props) {
  const [masterSettings, setMasterSettings] = useState<MasterSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState(100);
  const [amount, setAmount] = useState('');
  const [utr, setUtr] = useState('');
  const [copied, setCopied] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    supabase.rpc('get_master_settings').then(({ data, error }) => {
      if (error) {
        console.error('Failed to load master settings:', error.message);
      }
      setMasterSettings(data as MasterSettings | null);
      setLoading(false);
    });
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleSubmit = async () => {
    if (credits <= 0) { setError('Credits must be greater than 0'); return; }
    if (!utr.trim()) { setError('UTR number is required'); return; }
    setSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase.from('credit_requests').insert({
      sub_admin_id: subAdminId,
      credits_requested: credits,
      amount_paid: parseFloat(amount) || 0,
      utr_number: utr.trim(),
      status: 'pending',
    });

    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => onPurchased(), 2000);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <Loader2 className="w-8 h-8 text-neon-amber animate-spin" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="glass-card max-w-md w-full p-6 text-center animate-slide-up">
          <div className="w-16 h-16 rounded-full bg-neon-green/10 border border-neon-green/30 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-neon-green" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Request Submitted</h2>
          <p className="text-sm text-slate-400">Your credit top-up request for {credits} credits has been submitted. The Master Admin will verify your UTR and approve shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card max-w-lg w-full p-6 animate-slide-up max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-neon-amber" />
            <h2 className="text-lg font-bold text-white">Buy Credits</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Master Admin Payment Details */}
        <div className="mb-5">
          <p className="text-xs text-slate-400 mb-3 font-semibold">Pay to Master Admin via UPI or Bank Transfer:</p>

          {masterSettings?.upi_id && (
            <div className="mb-3 p-3 rounded-xl bg-neon-amber/5 border border-neon-amber/15">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase">UPI ID</p>
                  <p className="text-sm font-mono text-white">{masterSettings.upi_id}</p>
                </div>
                <button onClick={() => copyToClipboard(masterSettings.upi_id!, 'upi')} className="px-2 py-1 rounded-lg bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] transition-all">
                  {copied === 'upi' ? <Check className="w-3.5 h-3.5 text-neon-green" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}

          {masterSettings?.bank_name && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-500">Bank</p>
                  <p className="text-sm text-white truncate">{masterSettings.bank_name}</p>
                </div>
              </div>
              {masterSettings?.account_number && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div>
                    <p className="text-[10px] text-slate-500">Account Number</p>
                    <p className="text-sm font-mono text-white">{masterSettings.account_number}</p>
                  </div>
                  <button onClick={() => copyToClipboard(masterSettings.account_number!, 'acc')} className="px-2 py-1 rounded-lg bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] transition-all">
                    {copied === 'acc' ? <Check className="w-3.5 h-3.5 text-neon-green" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
              {masterSettings?.ifsc_code && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div>
                    <p className="text-[10px] text-slate-500">IFSC Code</p>
                    <p className="text-sm font-mono text-white">{masterSettings.ifsc_code}</p>
                  </div>
                  <button onClick={() => copyToClipboard(masterSettings.ifsc_code!, 'ifsc')} className="px-2 py-1 rounded-lg bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] transition-all">
                    {copied === 'ifsc' ? <Check className="w-3.5 h-3.5 text-neon-green" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>
          )}

          {masterSettings?.qr_code_url && (
            <div className="mt-3 flex flex-col items-center p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <img src={masterSettings.qr_code_url} alt="Payment QR" className="w-32 h-32 rounded-lg object-cover border border-white/[0.08]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <p className="text-[10px] text-slate-500 mt-2">Scan QR to pay</p>
            </div>
          )}

          {!masterSettings?.upi_id && !masterSettings?.bank_name && (
            <div className="p-4 rounded-xl bg-neon-amber/5 border border-neon-amber/15 text-center">
              <p className="text-xs text-slate-400">Master Admin has not configured payment details yet. Please contact them directly.</p>
            </div>
          )}
        </div>

        {/* Submit UTR Form */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Credits Requested</label>
              <input type="number" value={credits} onChange={e => setCredits(parseInt(e.target.value) || 0)} min={1}
                className="w-full px-3 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-amber/40" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Amount Paid (INR)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                className="w-full px-3 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-amber/40" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-semibold">UTR / Transaction Reference Number</label>
            <input value={utr} onChange={e => setUtr(e.target.value)} placeholder="e.g. 456789012345678"
              className="w-full px-3 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40" />
          </div>

          {error && <p className="text-xs text-neon-red">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting || !utr.trim()}
            className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all ${submitting || !utr.trim() ? 'bg-white/[0.05] text-slate-400 cursor-wait' : 'bg-gradient-to-r from-neon-amber/20 to-neon-green/20 text-white border border-neon-amber/40 hover:from-neon-amber/30 hover:to-neon-green/30 neon-glow-amber'}`}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {submitting ? 'Submitting...' : 'Submit UTR for Verification'}
          </button>
        </div>
      </div>
    </div>
  );
}
