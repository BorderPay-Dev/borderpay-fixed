import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, Users } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { toast } from 'sonner';

type State =
  | { kind: 'ready' }
  | { kind: 'accepting' }
  | { kind: 'accepted'; companyName: string; role: string }
  | { kind: 'error'; message: string; code?: string };

interface TeamInviteLandingProps {
  token: string;
  isAuthenticated: boolean;
  onNavigateToLogin: () => void;
  onNavigateToSignUp: () => void;
  onAccepted: () => void;
}

export function TeamInviteLanding({
  token,
  isAuthenticated,
  onNavigateToLogin,
  onNavigateToSignUp,
  onAccepted,
}: TeamInviteLandingProps) {
  const [state, setState] = useState<State>({ kind: isAuthenticated ? 'accepting' : 'ready' });

  useEffect(() => {
    try { sessionStorage.setItem('borderpay_pending_team_invite_token', token); } catch { /* noop */ }
  }, [token]);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setState({ kind: 'ready' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'accepting' });
    (async () => {
      const r: any = await backendAPI.team.acceptInvite(token);
      if (cancelled) return;
      if (r?.success && r?.data) {
        const companyName = String(r.data.company_name || 'Business account');
        const role = String(r.data.role || 'member');
        try {
          const cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
          const userId = String(cached?.id || '');
          localStorage.setItem('borderpay_user', JSON.stringify({
            ...cached,
            account_type: 'business',
            company_name: companyName,
          }));
          if (userId) localStorage.setItem(`borderpay_business_name_v1:${userId}`, companyName);
          sessionStorage.removeItem('borderpay_pending_team_invite_token');
        } catch { /* cache is best-effort */ }
        toast.success(`Joined ${companyName}`);
        setState({ kind: 'accepted', companyName, role });
        window.setTimeout(onAccepted, 1200);
        return;
      }
      setState({
        kind: 'error',
        message: r?.error || 'Could not accept this invitation.',
        code: r?.code,
      });
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, onAccepted, token]);

  const primaryAction = () => {
    try { sessionStorage.setItem('borderpay_pending_team_invite_token', token); } catch { /* noop */ }
    onNavigateToSignUp();
  };

  const signInAction = () => {
    try { sessionStorage.setItem('borderpay_pending_team_invite_token', token); } catch { /* noop */ }
    onNavigateToLogin();
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md bg-[#13171C] border border-white/10 rounded-3xl p-8 text-center">
        {state.kind === 'ready' && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#C7FF00]/10 flex items-center justify-center mb-5">
              <Users className="w-8 h-8 text-[#C7FF00]" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Business team invite</h1>
            <p className="text-sm text-white/60 mb-6">
              Create a teammate login with the email address that received this invitation. This joins the business workspace; it does not create a separate business account.
            </p>
            <button
              onClick={primaryAction}
              className="w-full py-3 rounded-xl bg-[#C7FF00] text-black font-bold text-sm mb-2"
            >
              Create teammate login
            </button>
            <button
              onClick={signInAction}
              className="w-full py-2 text-xs text-white/60 hover:text-white"
            >
              Already have a BorderPay account? Sign in
            </button>
          </>
        )}

        {state.kind === 'accepting' && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#C7FF00]/10 flex items-center justify-center mb-5">
              <Loader2 className="w-7 h-7 text-[#C7FF00] animate-spin" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Accepting invite…</h1>
            <p className="text-sm text-white/60">One moment.</p>
          </>
        )}

        {state.kind === 'accepted' && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#C7FF00]/10 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-8 h-8 text-[#C7FF00]" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">You're in</h1>
            <p className="text-sm text-white/60 mb-6">
              You now have {state.role} access to {state.companyName}.
            </p>
            <button
              onClick={onAccepted}
              className="w-full py-3 rounded-xl bg-[#C7FF00] text-black font-bold text-sm"
            >
              Open business account
            </button>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#FF5A5A]/10 flex items-center justify-center mb-5">
              <AlertTriangle className="w-7 h-7 text-[#FF5A5A]" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Invite could not be accepted</h1>
            <p className="text-sm text-white/60 mb-6">{state.message}</p>
            {state.code === 'email_mismatch' ? (
              <button
                onClick={onNavigateToLogin}
                className="w-full py-3 rounded-xl bg-[#C7FF00] text-black font-bold text-sm"
              >
                Sign in with invited email
              </button>
            ) : (
              <button
                onClick={onNavigateToLogin}
                className="w-full py-3 rounded-xl bg-[#C7FF00] text-black font-bold text-sm"
              >
                Back to sign in
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
