/**
 * EmailVerificationLanding
 * ────────────────────────────────────────────────────────────────────────────
 * Tiny landing page for `/auth/verify?token=…&purpose=…`.
 *
 * On mount it calls `verify-email-token`. The token is consumed server-side
 * (single-use, expiry-aware), and on success Supabase Auth flips
 * `email_confirmed_at` for the user.
 *
 * Outcomes:
 *   • ok            → "Email verified — you can sign in now"  (auto-redirect)
 *   • already_used  → "Already verified" (still success-y; user can sign in)
 *   • expired       → "Link expired" with a Resend button
 *   • not_found     → "Invalid link" with a Resend button
 *   • internal      → generic error with retry
 *
 * This component does NOT sign the user in. It explicitly directs them to
 * the login screen so the session is minted from a real password sign-in
 * after the email is confirmed.
 */

import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, Mail } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { toast } from 'sonner';

type State =
  | { kind: 'verifying' }
  | { kind: 'ok'; redirect: string }
  | { kind: 'already_used'; redirect: string }
  | { kind: 'expired' }
  | { kind: 'not_found' }
  | { kind: 'malformed' }
  | { kind: 'error'; message: string };

interface Props {
  token: string;
  purpose: 'signup_individual' | 'signup_business' | 'password_reset' | 'email_change';
  onNavigateToLogin: () => void;
}

export function EmailVerificationLanding({ token, purpose, onNavigateToLogin }: Props) {
  const [state, setState] = useState<State>({ kind: 'verifying' });
  const [resendEmail, setResendEmail] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r: any = await backendAPI.auth.verifyEmailToken(token, purpose);
      if (cancelled) return;
      if (r?.success && r?.data?.user_id) {
        setState({ kind: 'ok', redirect: r.data.redirect || '/' });
        return;
      }
      const code = r?.code || r?.body?.code;
      if (code === 'already_used')      setState({ kind: 'already_used', redirect: '/' });
      else if (code === 'expired')      setState({ kind: 'expired' });
      else if (code === 'not_found')    setState({ kind: 'not_found' });
      else if (code === 'malformed')    setState({ kind: 'malformed' });
      else                              setState({ kind: 'error', message: r?.error || 'Verification failed' });
    })();
    return () => { cancelled = true; };
  }, [token, purpose]);

  const handleResend = async () => {
    if (!resendEmail) {
      toast.error('Enter your email so we can send a fresh link.');
      return;
    }
    setResending(true);
    try {
      const r: any = await backendAPI.auth.resendVerification(resendEmail.trim().toLowerCase());
      if (r?.success) {
        toast.success(r?.data?.already_verified ? 'Already verified.' : 'Verification email sent.');
      } else {
        const code = r?.code;
        toast.error(
          code === 'cooldown'   ? 'Hold on — wait a minute and try again.' :
          code === 'rate_limit' ? 'Too many requests. Try again in an hour.' :
          (r?.error || 'Could not resend. Please try again.')
        );
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md bg-[#13171C] border border-white/10 rounded-3xl p-8 text-center">
        {state.kind === 'verifying' && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#C7FF00]/10 flex items-center justify-center mb-5">
              <Loader2 className="w-7 h-7 text-[#C7FF00] animate-spin" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Verifying your email…</h1>
            <p className="text-sm text-white/60">One moment.</p>
          </>
        )}

        {(state.kind === 'ok' || state.kind === 'already_used') && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#C7FF00]/10 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-8 h-8 text-[#C7FF00]" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">
              {state.kind === 'already_used' ? 'Already verified' : 'Email verified'}
            </h1>
            <p className="text-sm text-white/60 mb-6">
              {state.kind === 'already_used'
                ? 'This link has already been used. You can sign in normally.'
                : 'Your email is now confirmed. Sign in to continue.'}
            </p>
            <button
              onClick={onNavigateToLogin}
              className="w-full py-3 rounded-xl bg-[#C7FF00] text-black font-bold text-sm"
            >
              Continue to sign in
            </button>
          </>
        )}

        {(state.kind === 'expired' || state.kind === 'not_found' || state.kind === 'malformed' || state.kind === 'error') && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#FF5A5A]/10 flex items-center justify-center mb-5">
              <AlertTriangle className="w-7 h-7 text-[#FF5A5A]" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">
              {state.kind === 'expired'   ? 'Link expired'
              : state.kind === 'not_found' ? 'Invalid link'
              : state.kind === 'malformed' ? 'Bad link'
              :                              'Verification failed'}
            </h1>
            <p className="text-sm text-white/60 mb-5">
              {state.kind === 'expired'
                ? 'For security, verification links are valid for 24 hours. Request a fresh one below.'
                : state.kind === 'not_found' || state.kind === 'malformed'
                ? 'This link doesn\'t look valid. Request a fresh one below.'
                : (state as any).message || 'Please request a new link.'}
            </p>

            <label className="block text-left text-xs text-white/60 mb-2">
              <Mail className="inline w-3.5 h-3.5 mr-1 -mt-0.5" /> Email
            </label>
            <input
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-[#0B0E11] border border-white/10 rounded-xl px-4 py-3 text-sm text-white mb-3 focus:outline-none focus:border-[#C7FF00]/40"
            />
            <button
              onClick={handleResend}
              disabled={resending || !resendEmail}
              className="w-full py-3 rounded-xl bg-[#C7FF00] text-black font-bold text-sm disabled:opacity-60 mb-2"
            >
              {resending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Send a fresh link'}
            </button>
            <button
              onClick={onNavigateToLogin}
              className="w-full py-2 text-xs text-white/50 hover:text-white"
            >
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
