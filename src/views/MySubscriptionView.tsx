import { useState, useEffect, useMemo } from 'react';
import {
  Crown, Zap, Rocket, Check, Sparkles, Bot, TrendingUp, Shield,
  Activity, Copy, KeyRound, Users, SlidersHorizontal, Headphones,
  Building2, Clock, X, Loader2, Send, CheckCircle2, Infinity as InfinityIcon,
  Gauge, BrainCircuit, Layers, CreditCard, Upload, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase, type License } from '@/lib/supabase';
import { normalizePlan, usePlanRules, type PlanType } from '@/lib/planRules';

interface PlanFeature {
  icon: typeof Bot;
  label: string;
}

interface UpgradePlan {
  id: PlanType;
  name: string;
  tagline: string;
  icon: typeof Crown;
  accent: 'cyan' | 'green' | 'amber';
  features: PlanFeature[];
  highlighted?: boolean;
}

const planMeta: Record<PlanType, { tagline: string; icon: typeof Crown; accent: 'cyan' | 'green' | 'amber'; highlighted?: boolean }> = {
  starter: { tagline: 'Begin your AI trading journey', icon: Zap, accent: 'cyan' },
  pro: { tagline: 'For serious algorithmic traders', icon: Rocket, accent: 'green', highlighted: true },
  enterprise: { tagline: 'Unlimited institutional-grade power', icon: Crown, accent: 'amber' },
};

const featureIconMap: Record<string, typeof Bot> = {
  bot: Bot, bots: Bot, unlimited: InfinityIcon, leverage: Gauge, max: Gauge,
  spot: TrendingUp, futures: TrendingUp, markets: Layers, support: Headphones,
  signals: Activity, copy: Copy, strategies: BrainCircuit, custom: SlidersHorizontal,
  manager: Users, api: KeyRound, risk: Shield, features: Sparkles, priority: Sparkles,
};

function getFeatureIcon(label: string): typeof Bot {
  const lower = label.toLowerCase();
  for (const key of Object.keys(featureIconMap)) {
    if (lower.includes(key)) return featureIconMap[key];
  }
  return Check;
}

const accentMap = {
  cyan: { text: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/30', glow: 'neon-glow-cyan', hex: '#00e5ff' },
  green: { text: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/30', glow: 'neon-glow-green', hex: '#00ff9d' },
  amber: { text: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/30', glow: 'neon-glow-amber', hex: '#ffb020' },
};



interface CurrentPlan {
  plan: PlanType;
  botLimit: number;
  maxLeverage: number;
  validFrom: string;
  validUntil: string;
  features: string[];
  isActive: boolean;
}

function makeFallbackPlan(rules: Record<PlanType, import('@/lib/planRules').PlanRule>): CurrentPlan {
  return {
    plan: 'starter',
    botLimit: rules.starter.botLimit ?? Number.MAX_SAFE_INTEGER,
    maxLeverage: rules.starter.maxLeverage,
    validFrom: new Date().toISOString().split('T')[0],
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    features: rules.starter.features,
    isActive: false,
  };
}

export default function MySubscriptionView() {
  const { user } = useAuth();
  const { rules } = usePlanRules();
  const [requestModal, setRequestModal] = useState<UpgradePlan | null>(null);
  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentPlanData, setCurrentPlanData] = useState<CurrentPlan>(() => makeFallbackPlan(rules));
  const [currentLicenseId, setCurrentLicenseId] = useState<string | null>(null);

  // Checkout state
  const [paymentDetails, setPaymentDetails] = useState<{ upiId: string; bankName: string; accountNumber: string; ifscCode: string; qrCodeUrl: string } | null>(null);
  const [utrNumber, setUtrNumber] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(false);

  const upgradePlans: UpgradePlan[] = useMemo(() => {
    return (Object.keys(rules) as PlanType[]).map((id) => {
      const rule = rules[id];
      const meta = planMeta[id];
      return {
        id,
        name: rule.label,
        tagline: meta.tagline,
        icon: meta.icon,
        accent: meta.accent,
        highlighted: meta.highlighted,
        features: rule.features.map(label => ({ icon: getFeatureIcon(label), label })),
      };
    });
  }, [rules]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('licenses')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const license = data as License;
          setCurrentLicenseId(license.id);
          const planName = normalizePlan(license.plan_name);
          setCurrentPlanData({
            plan: planName,
            botLimit: rules[planName].botLimit ?? Number.MAX_SAFE_INTEGER,
            maxLeverage: rules[planName].maxLeverage,
            validFrom: license.valid_from,
            validUntil: license.valid_until ?? new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
            features: rules[planName].features ?? rules.starter.features,
            isActive: license.is_active,
          });
        }
        setLoading(false);
      });
  }, [user?.id]);

  const validFrom = new Date(currentPlanData.validFrom);
  const validUntil = new Date(currentPlanData.validUntil);
  const now = new Date();
  const totalDays = Math.ceil((validUntil.getTime() - validFrom.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.ceil((now.getTime() - validFrom.getTime()) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, totalDays - daysElapsed);
  const progressPct = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));

  const currentAccent = currentPlanData.plan === 'enterprise' ? 'amber' : currentPlanData.plan === 'pro' ? 'green' : 'cyan';
  const a = accentMap[currentAccent as keyof typeof accentMap];

  const handleOpenCheckout = async () => {
    if (!requestModal) return;
    setCheckoutError(null);
    setUtrNumber('');
    setScreenshotUrl('');
    setLoadingPayment(true);

    try {
      // First, find the client's admin_id from their profile to fetch their reseller's payment settings
      const { data: profileData } = await supabase
        .from('profiles')
        .select('admin_id')
        .eq('id', user?.id)
        .maybeSingle();
      const clientAdminId = (profileData as { admin_id: string | null } | null)?.admin_id ?? null;

      const settingsQuery = supabase
        .from('system_settings')
        .select('key, value')
        .in('key', ['manual_upi_id', 'manual_bank_name', 'manual_account_number', 'manual_ifsc_code', 'manual_qr_code_url']);

      // If the client has a reseller (admin_id), fetch that reseller's settings; otherwise fetch global (super admin) settings
      const scopedQuery = clientAdminId
        ? settingsQuery.eq('admin_id', clientAdminId)
        : settingsQuery.is('admin_id', null);

      let { data: settingsData } = await scopedQuery;

      // Fallback: if no reseller-specific settings found, use get_master_settings RPC
      if (!settingsData || settingsData.length === 0) {
        const { data: masterData } = await supabase.rpc('get_master_settings');
        if (masterData) {
          const md = masterData as Record<string, string | null>;
          setPaymentDetails({
            upiId: md.upi_id ?? '',
            bankName: md.bank_name ?? '',
            accountNumber: md.account_number ?? '',
            ifscCode: md.ifsc_code ?? '',
            qrCodeUrl: md.qr_code_url ?? '',
          });
          setLoadingPayment(false);
          return;
        }
      }

      if (settingsData) {
        const map: Record<string, string> = {};
        for (const row of settingsData) map[row.key] = row.value;
        setPaymentDetails({
          upiId: map.manual_upi_id ?? '',
          bankName: map.manual_bank_name ?? '',
          accountNumber: map.manual_account_number ?? '',
          ifscCode: map.manual_ifsc_code ?? '',
          qrCodeUrl: map.manual_qr_code_url ?? '',
        });
      }
    } catch {
      // Payment details fetch failed — still show modal with empty fields
    }

    setLoadingPayment(false);
  };

  useEffect(() => {
    if (requestModal) {
      handleOpenCheckout();
    }
  }, [requestModal]);

  const handleSubmitPayment = async () => {
    if (!requestModal || !user?.id) return;
    if (!utrNumber.trim()) {
      setCheckoutError('Please enter your UTR / Transaction Reference Number.');
      return;
    }

    setSending(true);
    setCheckoutError(null);

    try {
      // Update the user's license with payment reference and pending status
      if (currentLicenseId) {
        const { error: updateErr } = await supabase
          .from('licenses')
          .update({
            payment_reference: utrNumber.trim(),
            payment_screenshot_url: screenshotUrl.trim() || null,
            is_active: false,
          })
          .eq('id', currentLicenseId);

        if (updateErr) throw updateErr;
      } else {
        // No existing license — create one with pending verification
        const { error: insertErr } = await supabase
          .from('licenses')
          .insert({
            user_id: user.id,
            plan_name: requestModal.id,
            bot_limit: rules[requestModal.id].botLimit ?? 10,
            is_active: false,
            valid_from: new Date().toISOString().split('T')[0],
            valid_until: null,
            monthly_fee: 0,
            payment_reference: utrNumber.trim(),
            payment_screenshot_url: screenshotUrl.trim() || null,
          });
        if (insertErr) throw insertErr;
      }

      await supabase.rpc('log_admin_action', {
        p_action_type: 'license_update',
        p_message: `Client ${user.email} submitted payment for ${requestModal.name} plan. UTR: ${utrNumber.trim()}`,
        p_severity: 'info',
      });

      setSending(false);
      setRequestModal(null);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);
    } catch (err) {
      setCheckoutError((err as Error).message || 'Failed to submit payment. Please try again.');
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center neon-glow-cyan">
          <KeyRound className="w-6 h-6 text-neon-cyan" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">My Subscription</h2>
          <p className="text-sm text-slate-400">Manage your plan, view active features, and request upgrades</p>
        </div>
      </div>

      {/* === Section 1: Current Plan Overview === */}
      <div className={`glass-card p-5 sm:p-6 relative overflow-hidden border ${a.border}`}>
        <div className={`absolute -top-20 -right-20 w-60 h-60 ${a.bg} rounded-full blur-3xl opacity-40`} />

        <div className="relative">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl ${a.bg} ${a.border} border flex items-center justify-center ${a.glow}`}>
                <Crown className={`w-7 h-7 ${a.text}`} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-bold text-white">{rules[currentPlanData.plan].label} Plan</h3>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${a.bg} ${a.text} ${a.border} border flex items-center gap-1`}>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neon-green" />
                    </span>
                    ACTIVE
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Valid from {validFrom.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {' — '}
                  {validUntil.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Days Remaining</p>
              <p className={`text-3xl font-bold ${a.text} font-mono`}>{daysLeft}</p>
              <p className="text-[10px] text-slate-500">of {totalDays} days</p>
            </div>
          </div>

          {/* Glowing Time-Left Progress Bar */}
          <div className="mb-6">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5">
              <span>Subscription Period</span>
              <span className={a.text}>{progressPct.toFixed(0)}% elapsed</span>
            </div>
            <div className="h-3 rounded-full bg-base-700 overflow-hidden relative">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${currentAccent === 'amber' ? 'from-neon-amber to-neon-cyan' : currentAccent === 'green' ? 'from-neon-green to-neon-cyan' : 'from-neon-cyan to-neon-green'} transition-all duration-1000 relative`}
                style={{ width: `${progressPct}%` }}
              >
                <div className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 20px ${a.hex}99` }} />
                <div className="absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-white/30 to-transparent" />
              </div>
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-slate-600">
              <span>{validFrom.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
              <span>{validUntil.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04] text-center">
              <Bot className={`w-4 h-4 mx-auto mb-1 ${a.text}`} />
              <p className="text-lg font-bold text-white font-mono">{currentPlanData.botLimit}</p>
              <p className="text-[9px] text-slate-500 uppercase">Bot Limit</p>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04] text-center">
              <Gauge className={`w-4 h-4 mx-auto mb-1 ${a.text}`} />
              <p className="text-lg font-bold text-white font-mono">{currentPlanData.maxLeverage}x</p>
              <p className="text-[9px] text-slate-500 uppercase">Max Leverage</p>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04] text-center">
              <Clock className={`w-4 h-4 mx-auto mb-1 ${a.text}`} />
              <p className="text-lg font-bold text-white font-mono">{daysLeft}d</p>
              <p className="text-[9px] text-slate-500 uppercase">Time Left</p>
            </div>
          </div>

          {/* Active Features */}
          <div>
            <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-3 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Your Active Features
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {currentPlanData.features.map((feat) => (
                <div key={feat} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <div className={`w-5 h-5 rounded-md ${a.bg} flex items-center justify-center flex-shrink-0`}>
                    <Check className={`w-3 h-3 ${a.text}`} />
                  </div>
                  <span className="text-xs text-slate-300 font-medium">{feat}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* === Section 2: Upgrade Plans Matrix === */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-neon-cyan" />
            Upgrade Your Plan
          </h3>
        </div>
        <p className="text-sm text-slate-400 mb-5">Unlock more bots, higher leverage, advanced strategies, and premium features</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {upgradePlans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} currentPlan={currentPlanData.plan} onRequest={() => setRequestModal(plan)} />
          ))}
        </div>
      </div>

      {/* === Checkout Modal === */}
      {requestModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-base-900/85 backdrop-blur-md" onClick={() => !sending && setRequestModal(null)} />
          <div className="relative w-full max-w-md animate-scale-in max-h-[90vh] overflow-y-auto scrollbar-thin">
            <div className={`glass-strong ${accentMap[requestModal.accent].glow} p-6`}>
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl ${accentMap[requestModal.accent].bg} border ${accentMap[requestModal.accent].border} flex items-center justify-center`}>
                    <CreditCard className={`w-5 h-5 ${accentMap[requestModal.accent].text}`} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Checkout — {requestModal.name}</h2>
                    <p className="text-xs text-slate-400">Manual UPI / Bank Transfer</p>
                  </div>
                </div>
                <button onClick={() => !sending && setRequestModal(null)} className="text-slate-400 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {loadingPayment ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Plan summary */}
                  <div className={`p-3 rounded-xl ${accentMap[requestModal.accent].bg} border ${accentMap[requestModal.accent].border}`}>
                    <p className={`text-sm font-bold ${accentMap[requestModal.accent].text}`}>{requestModal.name} Plan</p>
                    <p className="text-xs text-slate-400 mt-0.5">{requestModal.tagline}</p>
                  </div>

                  {/* Payment instructions */}
                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
                    <p className="text-xs font-bold text-white">Transfer to the details below:</p>

                    {paymentDetails?.upiId && (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">UPI ID</span>
                        <span className="text-xs text-neon-cyan font-mono font-bold">{paymentDetails.upiId}</span>
                      </div>
                    )}
                    {paymentDetails?.bankName && (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Bank</span>
                        <span className="text-xs text-white font-mono">{paymentDetails.bankName}</span>
                      </div>
                    )}
                    {paymentDetails?.accountNumber && (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Account No.</span>
                        <span className="text-xs text-white font-mono">{paymentDetails.accountNumber}</span>
                      </div>
                    )}
                    {paymentDetails?.ifscCode && (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">IFSC</span>
                        <span className="text-xs text-white font-mono">{paymentDetails.ifscCode}</span>
                      </div>
                    )}
                    {paymentDetails?.qrCodeUrl && (
                      <div className="flex justify-center pt-2">
                        <img src={paymentDetails.qrCodeUrl} alt="Payment QR" className="w-32 h-32 rounded-lg border border-white/[0.08]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </div>
                    )}
                    {!paymentDetails?.upiId && !paymentDetails?.bankName && (
                      <p className="text-[11px] text-neon-amber">Payment details not yet configured by admin. Please contact support.</p>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    After transferring, submit your transaction reference below for admin verification. Your plan will activate once approved.
                  </p>

                  {/* UTR input */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block font-semibold">UTR / Transaction Reference Number *</label>
                    <input value={utrNumber} onChange={e => setUtrNumber(e.target.value)} placeholder="e.g. 9876543210"
                      className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/40 transition-colors" />
                  </div>

                  {/* Screenshot URL */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Payment Screenshot URL (Optional)</label>
                    <div className="relative">
                      <Upload className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input value={screenshotUrl} onChange={e => setScreenshotUrl(e.target.value)} placeholder="https://...screenshot.png"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors" />
                    </div>
                  </div>

                  {checkoutError && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-neon-red/5 border border-neon-red/15">
                      <AlertCircle className="w-4 h-4 text-neon-red flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-neon-red">{checkoutError}</p>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex gap-3">
                    <button onClick={() => setRequestModal(null)} disabled={sending}
                      className="flex-1 px-4 py-2.5 rounded-xl glass hover:bg-white/[0.07] text-sm text-slate-300 transition-all disabled:opacity-50">
                      Cancel
                    </button>
                    <button onClick={handleSubmitPayment} disabled={sending || !utrNumber.trim()}
                      className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${accentMap[requestModal.accent].bg} ${accentMap[requestModal.accent].text} border ${accentMap[requestModal.accent].border} hover:opacity-90 active:scale-95 disabled:opacity-50`}>
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {sending ? 'Submitting...' : 'Submit Payment'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === Success Toast === */}
      {showSuccess && (
        <div className="fixed bottom-6 right-6 z-[110] animate-slide-up">
          <div className="glass-strong neon-glow-green p-4 pr-6 flex items-start gap-3 max-w-sm">
            <div className="w-10 h-10 rounded-xl bg-neon-green/15 border border-neon-green/30 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-neon-green" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Upgrade Request Sent!</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Your upgrade request has been sent to the Master Admin. Our team will contact you shortly.
              </p>
            </div>
            <button onClick={() => setShowSuccess(false)} className="text-slate-500 hover:text-white transition-colors flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const planIconMap: Record<string, typeof Crown> = {
  starter: Zap,
  pro: Rocket,
  enterprise: Crown,
};

function PlanCard({ plan, currentPlan, onRequest }: { plan: UpgradePlan; currentPlan: string; onRequest: () => void }) {
  const a = accentMap[plan.accent];
  const PIcon = plan.icon;
  const isCurrent = plan.id === currentPlan;

  return (
    <div className={`glass-card p-6 relative overflow-hidden group transition-all duration-300 ${plan.highlighted ? `border-2 ${a.border} ${a.glow}` : 'hover:border-white/[0.12]'}`}>
      {plan.highlighted && (
        <div className={`absolute -top-16 -right-16 w-40 h-40 ${a.bg} rounded-full blur-3xl opacity-50`} />
      )}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative">
        {/* Highlighted badge */}
        {plan.highlighted && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className={`px-3 py-1 rounded-full ${a.bg} ${a.text} text-[9px] font-bold tracking-wide border ${a.border} whitespace-nowrap flex items-center gap-1`}>
              <Sparkles className="w-3 h-3" /> MOST POPULAR
            </span>
          </div>
        )}

        {/* Icon + Name */}
        <div className="flex items-center gap-3 mb-4 mt-1">
          <div className={`w-12 h-12 rounded-xl ${a.bg} ${a.border} border flex items-center justify-center`}>
            <PIcon className={`w-6 h-6 ${a.text}`} />
          </div>
          <div>
            <h3 className={`text-lg font-bold ${a.text}`}>{plan.name}</h3>
            <p className="text-[10px] text-slate-500">{plan.tagline}</p>
          </div>
        </div>

        {/* Features list */}
        <div className="space-y-2.5 mb-6">
          {plan.features.map((feat) => {
            const FIcon = feat.icon;
            return (
              <div key={feat.label} className="flex items-center gap-2.5">
                <div className={`w-5 h-5 rounded-md ${a.bg} flex items-center justify-center flex-shrink-0`}>
                  <Check className={`w-3 h-3 ${a.text}`} />
                </div>
                <FIcon className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                <span className="text-xs text-slate-300 font-medium">{feat.label}</span>
              </div>
            );
          })}
        </div>

        {/* Action button */}
        {isCurrent ? (
          <div className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm font-bold text-slate-400">
            <CheckCircle2 className="w-4 h-4 text-neon-green" />
            Current Plan
          </div>
        ) : (
          <button
            onClick={onRequest}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${a.bg} ${a.text} border ${a.border} hover:opacity-90 hover:scale-[1.02] ${plan.highlighted ? a.glow : ''}`}
          >
            <Send className="w-4 h-4" />
            {plan.id === 'enterprise' ? 'Contact Sales' : 'Request Upgrade'}
          </button>
        )}
      </div>
    </div>
  );
}
