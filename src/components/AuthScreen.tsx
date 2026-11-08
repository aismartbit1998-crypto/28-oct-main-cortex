import { useState } from 'react';
import { BrainCircuit, Mail, Lock, LogIn, UserPlus, Loader as Loader2, CircleAlert as AlertCircle, CircleCheck as CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (mode === 'signup') {
      const { error } = await signUp(email, password);
      if (error) {
        setError(error);
        setLoading(false);
      } else {
        setSuccess('Account created successfully. Please log in.');
        setMode('signin');
        setPassword('');
        setLoading(false);
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error);
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-neon-cyan/10 rounded-full blur-3xl animate-pulse-slow" />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-neon-green/10 rounded-full blur-3xl animate-pulse-slow" />

      <div className="relative w-full max-w-md animate-scale-in">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-neon-cyan/20 to-neon-green/20 border border-neon-cyan/30 flex items-center justify-center neon-glow-cyan mb-4">
            <BrainCircuit className="w-9 h-9 text-neon-cyan" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-neon-cyan neon-text-cyan">Cortex</span>{' '}
            <span className="text-neon-green neon-text-green">AI</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">Next-Gen Crypto Trading Intelligence</p>
        </div>

        <div className="glass-strong neon-glow-cyan p-6 sm:p-8">
          {/* Tab switcher */}
          <div className="flex gap-2 p-1 rounded-xl bg-base-800/50 mb-6">
            <button
              onClick={() => { setMode('signin'); setError(null); setSuccess(null); }}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                mode === 'signin' ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LogIn className="w-4 h-4" />
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); setSuccess(null); }}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                mode === 'signup' ? 'bg-neon-green/15 text-neon-green border border-neon-green/30' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              Sign Up
            </button>
          </div>

          <h2 className="text-lg font-bold text-white mb-1">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="text-xs text-slate-400 mb-5">
            {mode === 'signin' ? 'Sign in to access your trading dashboard' : 'Start your AI-powered trading journey'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 rounded-xl glass text-sm text-white focus:outline-none focus:border-neon-cyan/40 transition-colors"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-neon-red/10 border border-neon-red/20 text-xs text-neon-red animate-slide-up">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Success */}
            {success && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-neon-green/10 border border-neon-green/20 text-xs text-neon-green animate-slide-up">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{success}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${
                loading
                  ? 'bg-white/[0.05] text-slate-400 cursor-wait'
                  : mode === 'signin'
                  ? 'bg-gradient-to-r from-neon-cyan/20 to-neon-green/20 text-white border border-neon-cyan/40 hover:from-neon-cyan/30 hover:to-neon-green/30 neon-glow-cyan hover:scale-[1.02]'
                  : 'bg-gradient-to-r from-neon-green/20 to-neon-cyan/20 text-white border border-neon-green/40 hover:from-neon-green/30 hover:to-neon-cyan/30 neon-glow-green hover:scale-[1.02]'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {mode === 'signin' ? 'Signing in...' : 'Creating account...'}
                </>
              ) : (
                <>
                  {mode === 'signin' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                  {mode === 'signin' ? 'Sign In' : 'Create Account'}
                </>
              )}
            </button>
          </form>

          {/* Footer note */}
          <p className="mt-5 text-center text-[11px] text-slate-500">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setSuccess(null); }}
              className="text-neon-cyan hover:text-neon-green transition-colors font-semibold"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>

        <p className="mt-4 text-center text-[10px] text-slate-600">
          By continuing, you agree to Cortex AI's Terms of Use and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
