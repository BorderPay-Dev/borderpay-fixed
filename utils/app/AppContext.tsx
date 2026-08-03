/**
 * BorderPay Africa — Global AppContext
 *
 * Purpose (Part 3 of the Claude directive):
 *   - Synchronous session read on mount (no flicker while waiting on getSession)
 *   - 5-minute localStorage TTL cache of:
 *       user profile · KYC status · Bridge customer · wallet balances · email confirmation
 *   - Single context — every screen reads from here, not from fresh network fetches
 *
 * Design:
 *   - Hydrates synchronously from localStorage at first render (no await on mount)
 *   - Fires a single background refresh and broadcasts updates to subscribers
 *   - Never auto-creates products; only reads
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback, ReactNode } from 'react';
import { supabase, SUPABASE_URL, ANON_KEY, readUserProfile, storeUserProfile, isPasswordRecovery, isBiometricLoginPending, isAppLocked } from '../supabase/client';
import type { Session, User } from '@supabase/supabase-js';

// ── Types ────────────────────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  country?: string;
  phone?: string;
  account_type?: 'individual' | 'business' | string;
  avatar_url?: string;
  profile_picture_url?: string;
  date_of_birth?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  // Bridge fields (Bridge is the current provider for KYC/KYB/VAs/wallets/transfers).
  bridge_customer_id?: string | null;
  account_status?: string | null;
  bridge_kyc_status?: 'not_started' | 'pending' | 'under_review' | 'approved' | 'rejected' | null;
  bridge_kyb_status?: 'not_started' | 'pending' | 'under_review' | 'approved' | 'rejected' | null;
  bridge_account_status?: string | null;
  // KYC review fields
  kyc_status?: 'not_started' | 'under_review' | 'approved' | 'rejected' | string;
  admin_kyc_decision?: string | null;
  admin_kyc_notes?: string | null;
  admin_kyc_approved_at?: string | null;
  // Email confirmation
  email_confirmed_at?: string | null;
}

export interface Wallet {
  id: string;
  user_id: string;
  currency: string;
  balance: number;
  status: 'active' | 'pending' | 'frozen';
  kind?: string;
}

export interface AppState {
  hydrated: boolean;               // true after first localStorage read (immediate)
  sessionChecked: boolean;         // true after Supabase getSession resolves
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  wallets: Wallet[];
  emailConfirmed: boolean;
  isAuthenticated: boolean;
  loading: boolean;
}

interface AppContextValue extends AppState {
  reload: () => Promise<void>;
  refreshWallets: () => Promise<void>;
  setProfile: (p: UserProfile | null) => void;
  invalidateCache: () => void;
}

// ── localStorage keys & TTL ──────────────────────────────────────────────────
const CACHE_KEY = 'borderpay_app_state_v1';
const SESSION_KEY = 'borderpay_session_v1';
const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedState {
  profile: UserProfile | null;
  wallets: Wallet[];
  emailConfirmed: boolean;
  cachedAt: number;
}

function readCache(): CachedState | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedState = JSON.parse(raw);
    if (Date.now() - parsed.cachedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(s: CachedState) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch {}
}

function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

/** Read the Supabase session synchronously from localStorage (no await).
 *  Supabase stores the session under its default key `sb-<project>-auth-token`. */
function readSessionSync(): { session: Session | null; user: User | null } {
  try {
    // Find the supabase auth token key (format: sb-<ref>-auth-token)
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        // supabase-js v2 shape: { access_token, refresh_token, expires_at, user, ... }
        if (parsed?.access_token && parsed?.user) {
          // Check expiry
          const exp = parsed.expires_at ? parsed.expires_at * 1000 : 0;
          if (exp && Date.now() >= exp) return { session: null, user: null };
          return { session: parsed as Session, user: parsed.user as User };
        }
      }
    }
  } catch {}
  return { session: null, user: null };
}

// ── Context ──────────────────────────────────────────────────────────────────
const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // Synchronous initial hydration — no await, no flicker
  const initialSession = useMemo(() => readSessionSync(), []);
  const initialCache = useMemo(() => readCache(), []);
  const initialProfile = initialCache?.profile || readUserProfile() || null;

  const [state, setState] = useState<AppState>(() => ({
    hydrated: true,
    sessionChecked: false,
    user: initialSession.user,
    session: initialSession.session,
    profile: initialProfile,
    wallets: initialCache?.wallets || [],
    emailConfirmed: initialCache?.emailConfirmed ?? !!initialSession.user?.email_confirmed_at,
    // A Supabase password-recovery session is NOT a login — never authenticate
    // (or hydrate dashboard data) while a recovery is in progress. The same holds
    // while a biometric login is pending (session restored, WebAuthn not yet passed).
    isAuthenticated: !!initialSession.user && !!initialSession.session && !isPasswordRecovery() && !isBiometricLoginPending() && !isAppLocked(),
    loading: !initialCache, // loading only if we had no cache to serve
  }));

  const mountedRef = useRef(true);

  // Background refresh — always authoritative
  const reload = useCallback(async () => {
    if (!supabase?.auth) {
      if (mountedRef.current) setState(s => ({ ...s, sessionChecked: true, loading: false }));
      return;
    }
    // Password-recovery session is NOT a login: do not hydrate profile/wallet or
    // mark authenticated. The reset-password screen drives this flow instead.
    if (isPasswordRecovery()) {
      if (mountedRef.current) setState(s => ({
        ...s,
        user: null, session: null, profile: null, wallets: [],
        emailConfirmed: false, isAuthenticated: false,
        sessionChecked: true, loading: false,
      }));
      return;
    }
    // Biometric-login-pending is the same: the session was restored only so the
    // WebAuthn assertion can run; do not hydrate or authenticate until it passes.
    if (isBiometricLoginPending()) {
      if (mountedRef.current) setState(s => ({
        ...s,
        user: null, session: null, profile: null, wallets: [],
        emailConfirmed: false, isAuthenticated: false,
        sessionChecked: true, loading: false,
      }));
      return;
    }
    // App-locked ("Lock app"): a refreshable session is preserved but the app is
    // locked behind biometric — do not hydrate or authenticate until unlock.
    if (isAppLocked()) {
      if (mountedRef.current) setState(s => ({
        ...s,
        user: null, session: null, profile: null, wallets: [],
        emailConfirmed: false, isAuthenticated: false,
        sessionChecked: true, loading: false,
      }));
      return;
    }
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session ?? null;
      let user: User | null = null;
      if (session) {
        const { data: userData } = await supabase.auth.getUser();
        user = userData?.user ?? null;
      }

      let profile: UserProfile | null = null;
      let wallets: Wallet[] = [];
      if (user && session) {
        // Fetch profile from DB
        try {
          const pRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user.id}&select=*`, {
            headers: { Authorization: `Bearer ${session.access_token}`, apikey: ANON_KEY },
          });
          if (pRes.ok) {
            const arr = await pRes.json();
            if (Array.isArray(arr) && arr[0]) {
              profile = arr[0];
              // Business parity: hydrate bridge_kyb_status from business_profiles so
              // cached profile always carries both Bridge status fields.
              if (profile?.account_type === 'business') {
                try {
                  const bRes = await fetch(`${SUPABASE_URL}/rest/v1/business_profiles?user_id=eq.${user.id}&select=bridge_kyb_status&limit=1`, {
                    headers: { Authorization: `Bearer ${session.access_token}`, apikey: ANON_KEY },
                  });
                  if (bRes.ok) {
                    const bArr = await bRes.json();
                    const kyb = Array.isArray(bArr) && bArr[0] ? bArr[0].bridge_kyb_status : null;
                    if (kyb != null) profile = { ...profile, bridge_kyb_status: kyb };
                  }
                } catch {
                  // Non-blocking; keep user_profiles payload on transient error.
                }
              }
              storeUserProfile(profile);
            }
          }
        } catch {}
        // Fetch wallets (non-blocking; skip on error)
        try {
          const wRes = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${user.id}&select=id,user_id,currency,balance,status,kind`, {
            headers: { Authorization: `Bearer ${session.access_token}`, apikey: ANON_KEY },
          });
          if (wRes.ok) wallets = await wRes.json();
        } catch {}
      }

      const emailConfirmed = !!user?.email_confirmed_at;
      const next: AppState = {
        hydrated: true,
        sessionChecked: true,
        user, session, profile,
        wallets,
        emailConfirmed,
        isAuthenticated: !!user && !!session && !isPasswordRecovery() && !isBiometricLoginPending() && !isAppLocked(),
        loading: false,
      };
      if (mountedRef.current) setState(next);

      writeCache({ profile, wallets, emailConfirmed, cachedAt: Date.now() });
    } catch {
      if (mountedRef.current) setState(s => ({ ...s, sessionChecked: true, loading: false }));
    }
  }, []);

  const refreshWallets = useCallback(async () => {
    const { session, user } = state;
    if (!session || !user) return;
    try {
      const wRes = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${user.id}&select=id,user_id,currency,balance,status,kind`, {
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: ANON_KEY },
      });
      if (wRes.ok) {
        const wallets: Wallet[] = await wRes.json();
        if (mountedRef.current) setState(s => ({ ...s, wallets }));
        const cur = readCache();
        writeCache({
          profile: cur?.profile ?? state.profile,
          wallets,
          emailConfirmed: cur?.emailConfirmed ?? state.emailConfirmed,
          cachedAt: Date.now(),
        });
      }
    } catch {}
  }, [state]);

  const setProfile = useCallback((p: UserProfile | null) => {
    setState(s => ({ ...s, profile: p }));
    if (p) storeUserProfile(p);
    const cur = readCache();
    writeCache({
      profile: p,
      wallets: cur?.wallets ?? [],
      emailConfirmed: cur?.emailConfirmed ?? false,
      cachedAt: Date.now(),
    });
  }, []);

  const invalidateCache = useCallback(() => { clearCache(); }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Fire background refresh without blocking render
    reload();

    let subscription: any = null;
    if (supabase?.auth) {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          clearCache();
          if (mountedRef.current) {
            setState({
              hydrated: true, sessionChecked: true,
              user: null, session: null, profile: null, wallets: [],
              emailConfirmed: false, isAuthenticated: false, loading: false,
            });
          }
        } else {
          reload();
        }
      });
      subscription = data?.subscription;
    }
    return () => {
      mountedRef.current = false;
      subscription?.unsubscribe();
    };
  }, [reload]);

  const value: AppContextValue = useMemo(() => ({
    ...state,
    reload,
    refreshWallets,
    setProfile,
    invalidateCache,
  }), [state, reload, refreshWallets, setProfile, invalidateCache]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp() must be used inside <AppProvider>');
  return ctx;
}

/** Convenience selectors */
export function useProfile() { return useApp().profile; }
export function useWallets() { return useApp().wallets; }
export function useIsAuthenticated() { return useApp().isAuthenticated; }
export function useEmailConfirmed() { return useApp().emailConfirmed; }
