import { useState } from 'react';
import {
  UserPlus, X, Mail, Lock, User, Phone,
  Loader2, Check, AlertCircle,
} from 'lucide-react';

interface CreateClientModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateClientModal({ onClose, onSuccess }: CreateClientModalProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError('');

    if (!fullName.trim() || !email.trim() || !password.trim()) {
      setError('Full name, email, and password are required.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/create-client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          email,
          password,
          fullName,
          mobile: mobile.trim() || null,
        }),
      });

      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || `Request failed (${response.status})`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to create client');
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1800);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
        <div className="absolute inset-0 bg-base-900/80 backdrop-blur-md" onClick={onClose} />
        <div className="relative w-full max-w-md animate-scale-in">
          <div className="glass-strong neon-glow-green p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-neon-green/20 border border-neon-green/40 text-neon-green flex items-center justify-center mx-auto mb-4">
              <Check className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Client Onboarded!</h3>
            <p className="text-sm text-slate-400">
              {fullName} has been registered. Assign a license from the client list to activate their subscription.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-base-900/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-md animate-scale-in max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="glass-strong neon-glow-cyan p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-neon-cyan" />
              <h2 className="text-base font-bold text-white">Add New Client</h2>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-[11px] text-slate-500 mb-4">
            Register a new client account. License assignment is handled separately from the client list.
          </p>

          <div className="space-y-3">
            {/* Full Name */}
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Full Name"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors"
              />
            </div>

            {/* Email */}
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email Address"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors"
              />
            </div>

            {/* Mobile */}
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="tel"
                value={mobile}
                onChange={e => setMobile(e.target.value)}
                placeholder="Mobile Number (optional)"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors"
              />
            </div>

            {/* Password */}
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Temporary Password"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-neon-red/10 border border-neon-red/20 text-xs text-neon-red">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl glass hover:bg-white/[0.07] text-sm text-slate-300 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 px-4 py-2.5 rounded-xl border bg-neon-cyan/20 border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/30 font-semibold text-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Create Client
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
