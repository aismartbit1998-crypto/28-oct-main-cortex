import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type Profile, type LicenseInfo } from '@/lib/supabase';

interface ImpersonationState {
  userId: string;
  email: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  license: LicenseInfo | null;
  hasActiveLicense: boolean;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  impersonating: ImpersonationState | null;
  startImpersonation: (userId: string, email: string) => void;
  stopImpersonation: () => void;
  effectiveUserId: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonating, setImpersonating] = useState<ImpersonationState | null>(null);

  const effectiveUserId = impersonating?.userId ?? session?.user?.id ?? null;

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch profile:', error.message);
      return;
    }

    if (data) {
      setProfile(data as Profile);
    }

    // Fetch license status
    const { data: licData } = await supabase
      .from('licenses')
      .select('id, plan_name, is_active, valid_until, bot_limit')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (licData) {
      setLicense(licData as LicenseInfo);
    } else {
      setLicense(null);
    }
  };

  const refreshProfile = async () => {
    if (session?.user?.id) {
      await fetchProfile(session.user.id);
    }
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      if (session?.user?.id) {
        fetchProfile(session.user.id).finally(() => mounted && setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession?.user?.id) {
        setProfile(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      (async () => {
        await fetchProfile(newSession.user.id);
        if (mounted) setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const hasActiveLicense = !!(
    license?.is_active &&
    license.valid_until &&
    new Date(license.valid_until) > new Date()
  );

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };

    if (data.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({ id: data.user.id, email: data.user.email });
      if (profileError) {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        return { error: `Account created but profile setup failed: ${profileError.message}. Please contact support.` };
      }
    }

    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);

    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setLicense(null);
    setImpersonating(null);
  };

  const startImpersonation = (userId: string, email: string) => {
    setImpersonating({ userId, email });
  };

  const stopImpersonation = () => {
    setImpersonating(null);
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, profile, license, hasActiveLicense, loading, signUp, signIn, signOut, refreshProfile, impersonating, startImpersonation, stopImpersonation, effectiveUserId }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
