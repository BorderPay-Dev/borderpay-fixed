/**
 * BorderPay Africa — Identity & KYC
 *
 * KYC/KYB is FREE and automatic (Bridge webhook drives status). This screen
 * shows the current status AND lets an un-started user begin verification in
 * one tap (secure hosted flow):
 *
 *   not started (+ Verify CTA) · pending · under review · verified · failed
 *
 * Status is seeded synchronously from the cached profile (instant open, no
 * loading spinner) and refreshed in the background. Bridge remains the source
 * of truth; developer/internal rejection reasons are never surfaced.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, CheckCircle2, AlertCircle, Clock, RefreshCw, Mail, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { friendlyError } from '../../utils/errors/friendlyError';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface KYCVerificationProps {
  userId:     string;
  userEmail:  string;
  onBack:     () => void;
  onComplete: () => void;
}

type AccountType  = 'individual' | 'business';
type KycView      = 'not_started' | 'incomplete' | 'pending' | 'under_review' | 'verified' | 'rejected';

function mapBridge(raw: string | null | undefined): KycView {
  switch ((raw || '').toLowerCase()) {
    case 'approved':
    case 'active':
    case 'authorized':
    case 'completed':
    case 'complete':
    case 'accepted':
    case 'verified':     return 'verified';
    case 'rejected':     return 'rejected';
    case 'review_pending':
    case 'under_review': return 'under_review';
    case 'incomplete':   return 'incomplete';
    case 'pending':      return 'pending';
    default:             return 'not_started';
  }
}

function deriveStatus(input: {
  accountType: AccountType;
  bridgeKycStatus?: string | null;
  bridgeKybStatus?: string | null;
  bridgeAccountStatus?: string | null;
}): KycView {
  const accountStatus = (input.bridgeAccountStatus || '').toLowerCase();
  if (['rejected', 'blocked', 'suspended'].includes(accountStatus)) return 'rejected';
  if (['active', 'approved', 'authorized'].includes(accountStatus)) return 'verified';
  const verificationRaw = input.accountType === 'business' ? input.bridgeKybStatus : input.bridgeKycStatus;
  return mapBridge(verificationRaw);
}

/** Synchronous seed from the cached profile so the screen never flashes a loader. */
function seedFromCache(): { accountType: AccountType; status: KycView } {
  try {
    const u = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
    const accountType: AccountType = u.account_type === 'business' ? 'business' : 'individual';
    return {
      accountType,
      status: deriveStatus({
        accountType,
        bridgeKycStatus: u.bridge_kyc_status,
        bridgeKybStatus: u.bridge_kyb_status,
        bridgeAccountStatus: u.bridge_account_status,
      }),
    };
  } catch {
    return { accountType: 'individual', status: 'not_started' };
  }
}

export function KYCVerification({ userId, onBack }: KYCVerificationProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const seed = useMemo(() => seedFromCache(), []);
  const [accountType, setAccountType] = useState<AccountType>(seed.accountType);
  const [status, setStatus] = useState<KycView>(seed.status);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const profileResult = await backendAPI.user.getProfile();
      const prof = profileResult?.success ? profileResult?.data?.user : null;
      if (prof) {
        const at: AccountType = prof.account_type === 'business' ? 'business' : 'individual';
        setAccountType(at);
        setStatus(deriveStatus({
          accountType: at,
          bridgeKycStatus: prof.bridge_kyc_status,
          bridgeKybStatus: prof.bridge_kyb_status,
          bridgeAccountStatus: prof.bridge_account_status,
        }));
      }
    } catch { /* keep the cached status on any error */ }
    finally { setRefreshing(false); }
  }, [userId]);

  // Background refresh on mount — no loading gate; the seed already rendered.
  useEffect(() => {
    const prefetch = (window as any).__borderpay_prefetch;
    if (typeof prefetch === 'function') {
      const warm = () => {
        ['dashboard', 'settings', 'profile', 'wallet-detail'].forEach((s) => {
          try { prefetch(s); } catch { /* noop */ }
        });
      };
      const ric = (window as any).requestIdleCallback;
      if (typeof ric === 'function') ric(warm, { timeout: 1000 });
      else setTimeout(warm, 220);
    }

    refresh();
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const isBusiness = accountType === 'business';

  // KYC/KYB is FREE now — the user can start verification right here. Opens the
  // secure hosted verification flow; Bridge returns them to /?screen=kyc.
  const [lastHostedUrl, setLastHostedUrl] = useState<string | null>(() => {
    try { return localStorage.getItem(`borderpay_last_verify_url:${userId}`); } catch { return null; }
  });
  const [lastHostedUrlTs, setLastHostedUrlTs] = useState<number>(() => {
    try { return Number(localStorage.getItem(`borderpay_last_verify_url_ts:${userId}`) || '0'); } catch { return 0; }
  });
  const resumeAfterTosKey = useMemo(() => `borderpay_resume_verification_after_tos:${userId}`, [userId]);
  const tosAcceptedKey = useMemo(() => `borderpay_tos_accepted_v1:${userId}`, [userId]);
  const [tosAccepted, setTosAccepted] = useState<boolean>(() => {
    try { return localStorage.getItem(`borderpay_tos_accepted_v1:${userId}`) === '1'; } catch { return false; }
  });
  const [tosLinkUrl, setTosLinkUrl] = useState<string | null>(() => {
    try { return localStorage.getItem(`borderpay_last_tos_url:${userId}`); } catch { return null; }
  });
  const [tosLinkUrlTs, setTosLinkUrlTs] = useState<number>(() => {
    try { return Number(localStorage.getItem(`borderpay_last_tos_url_ts:${userId}`) || '0'); } catch { return 0; }
  });
  const [embeddedUrl, setEmbeddedUrl] = useState<string | null>(null);
  const [embeddedTitle, setEmbeddedTitle] = useState<string>('');
  const [embeddedPolling, setEmbeddedPolling] = useState(false);
  const [embeddedReturnEnabled, setEmbeddedReturnEnabled] = useState(true);
  const [embedNonce, setEmbedNonce] = useState(0);
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const persistTosAccepted = useCallback((accepted: boolean) => {
    setTosAccepted(accepted);
    try { localStorage.setItem(tosAcceptedKey, accepted ? '1' : '0'); } catch { /* noop */ }
  }, [tosAcceptedKey]);

  const isFreshHostedLink = useCallback((ts: number) => {
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (Date.now() - ts) <= 90_000;
  }, []);

  const openHostedVerificationUrl = useCallback((url: string, opts?: { cacheAsVerifyUrl?: boolean; title?: string; returnEnabled?: boolean }) => {
    const cacheAsVerifyUrl = opts?.cacheAsVerifyUrl ?? true;
    const title = String(opts?.title || 'Continue verification');
    const returnEnabled = opts?.returnEnabled !== false;
    if (cacheAsVerifyUrl) {
      setLastHostedUrl(url);
      const now = Date.now();
      setLastHostedUrlTs(now);
      try {
        localStorage.setItem(`borderpay_last_verify_url:${userId}`, url);
        localStorage.setItem(`borderpay_last_verify_url_ts:${userId}`, String(now));
      } catch { /* noop */ }
    }
    try {
      // Sev-1 guard: persist desired post-return route so callback never drops
      // to dashboard if query params are stripped by external redirects.
      sessionStorage.setItem('borderpay_post_callback_screen', 'kyc');
    } catch { /* noop */ }
    setEmbeddedUrl(url);
    setEmbeddedTitle(title);
    setEmbeddedPolling(true);
    setEmbeddedReturnEnabled(returnEnabled);
    setEmbedLoaded(false);
    setEmbedNonce((n) => n + 1);
    try {
      sessionStorage.setItem('borderpay_verification_embed_open', '1');
      sessionStorage.setItem('borderpay_verification_embed_title', title);
      sessionStorage.setItem('borderpay_verification_embed_return_enabled', returnEnabled ? '1' : '0');
      window.dispatchEvent(new CustomEvent('borderpay:verification_embed_visibility', { detail: { open: true, title, returnEnabled } }));
    } catch { /* noop */ }
  }, [userId]);

  const openTopLevelHostedFallback = useCallback((url: string | null) => {
    if (!url) return;
    // Some Bridge hosted pages may refuse iframe embedding on specific hops.
    // Hard fail-safe: open same link in current tab to avoid white-screen dead end.
    window.location.href = url;
  }, []);

  const openTopLevelTos = useCallback((url: string) => {
    // ToS must be a first-party browser navigation. Embedded provider pages can
    // render blank when Safari, Firefox, privacy browsers, or mobile webviews
    // block third-party frame storage. The same-tab callback retains this
    // marker and resumes the hosted KYC/KYB flow after acceptance.
    try {
      sessionStorage.setItem(resumeAfterTosKey, '1');
      sessionStorage.setItem('borderpay_post_callback_screen', 'kyc');
      sessionStorage.removeItem('borderpay_verification_embed_open');
      sessionStorage.removeItem('borderpay_verification_embed_title');
      sessionStorage.removeItem('borderpay_verification_embed_return_enabled');
    } catch { /* noop */ }
    setEmbeddedPolling(false);
    setEmbeddedUrl(null);
    window.location.href = url;
  }, [resumeAfterTosKey]);

  useEffect(() => {
    if (!embeddedUrl) return;
    const t = window.setTimeout(() => {
      if (!embedLoaded && embeddedReturnEnabled) {
        openTopLevelHostedFallback(embeddedUrl);
      }
    }, 2200);
    return () => window.clearTimeout(t);
  }, [embeddedUrl, embeddedReturnEnabled, embedLoaded, openTopLevelHostedFallback, embedNonce]);

  // If the previous attempt required Bridge ToS, resume automatically on return
  // to fetch/open the actual hosted KYC/KYB link.
  useEffect(() => {
    let cancelled = false;
    const shouldResume = (() => {
      try { return sessionStorage.getItem(resumeAfterTosKey) === '1'; } catch { return false; }
    })();
    if (!shouldResume) return;
    try { sessionStorage.removeItem(resumeAfterTosKey); } catch { /* noop */ }
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      await autoResumeVerificationAfterTos();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeAfterTosKey]);

  const resolveVerificationContext = useCallback(async (): Promise<{ accountType: AccountType; emailConfirmed: boolean }> => {
    let currentAccountType: AccountType = accountType;
    let emailConfirmed = true;
    try {
      const freshProfile = await backendAPI.user.getProfile();
      const fresh = freshProfile?.success ? freshProfile?.data?.user : null;
      if (fresh) {
        currentAccountType = fresh.account_type === 'business' ? 'business' : 'individual';
        emailConfirmed = Boolean(fresh.email_confirmed);
      }
    } catch {
      // keep cached account type as fallback
    }
    return { accountType: currentAccountType, emailConfirmed };
  }, [accountType]);

  const requestHostedLink = useCallback(async (currentAccountType: AccountType) => {
    const redirect_url = `${window.location.origin}/?screen=kyc`;
    return currentAccountType === 'business'
      ? await backendAPI.bridge.kyb.startBusiness({ redirect_url })
      : await backendAPI.bridge.kyc.startIndividual({ redirect_url });
  }, []);

  const autoResumeVerificationAfterTos = useCallback(async () => {
    const ctx = await resolveVerificationContext();
    if (!ctx.emailConfirmed) {
      toast.error('Verify your email first, then retry verification.');
      return;
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const r: any = await requestHostedLink(ctx.accountType);
      if (r?.success && r.data?.link_url) {
        persistTosAccepted(true);
        setTosLinkUrl(null);
        setLastHostedUrl(r.data.link_url);
        openHostedVerificationUrl(r.data.link_url, { title: 'Continue verification', returnEnabled: true });
        return;
      }
      if (r?.success && r.data?.tos_link_url) {
        persistTosAccepted(false);
        setTosLinkUrl(r.data.tos_link_url);
        openTopLevelTos(r.data.tos_link_url);
        return;
      }
      if (r?.success && r.data?.already_approved) {
        await refresh();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    toast.error('Could not continue verification automatically. Tap Continue verification.');
  }, [openHostedVerificationUrl, openTopLevelTos, persistTosAccepted, refresh, requestHostedLink, resolveVerificationContext]);

  const probeVerificationState = useCallback(async (fromTosCallback = false) => {
    try {
      const ctx = await resolveVerificationContext();
      if (!ctx.emailConfirmed) {
        persistTosAccepted(false);
        setTosLinkUrl(null);
        return;
      }
      const r: any = await requestHostedLink(ctx.accountType);
      if (r?.success && r.data?.tos_link_url) {
        persistTosAccepted(false);
        setTosLinkUrl(r.data.tos_link_url);
        return;
      }
      if (r?.success && r.data?.link_url) {
        persistTosAccepted(true);
        setTosLinkUrl(null);
        setLastHostedUrl(r.data.link_url);
        const now = Date.now();
        setLastHostedUrlTs(now);
        setTosLinkUrlTs(0);
        try {
          localStorage.setItem(`borderpay_last_verify_url:${userId}`, r.data.link_url);
          localStorage.setItem(`borderpay_last_verify_url_ts:${userId}`, String(now));
          localStorage.removeItem(`borderpay_last_tos_url:${userId}`);
          localStorage.removeItem(`borderpay_last_tos_url_ts:${userId}`);
        } catch { /* noop */ }
        if (fromTosCallback) openHostedVerificationUrl(r.data.link_url, { title: 'Continue verification', returnEnabled: true });
        return;
      }
      if (r?.success && r.data?.already_approved) {
        await refresh();
      }
    } catch {
      // silent probe: never block verification screen
    }
  }, [persistTosAccepted, requestHostedLink, resolveVerificationContext, refresh, openHostedVerificationUrl]);

  useEffect(() => {
    if (status === 'verified' || status === 'under_review' || status === 'rejected') return;
    void probeVerificationState(false);
  }, [status, probeVerificationState]);

  useEffect(() => {
    if (!embeddedPolling || !embeddedUrl) return;
    let cancelled = false;
    const poll = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const frame = document.getElementById('kyc-embed-frame') as HTMLIFrameElement | null;
        if (!frame?.contentWindow) return;
        const href = frame.contentWindow.location.href;
        if (!href || !href.startsWith(window.location.origin)) return;
        const url = new URL(href);
        const path = String(url.pathname || '').replace(/\/+$/, '');
        const screen = url.searchParams.get('screen');
        const isCallback = screen === 'kyc' || path === '/onboarding/kyc-complete' || path === '/';
        if (!isCallback) return;
        setEmbeddedPolling(false);
        setEmbeddedUrl(null);
        try {
          sessionStorage.removeItem('borderpay_verification_embed_open');
          sessionStorage.removeItem('borderpay_verification_embed_title');
          sessionStorage.removeItem('borderpay_verification_embed_return_enabled');
          window.dispatchEvent(new CustomEvent('borderpay:verification_embed_visibility', { detail: { open: false, title: '', returnEnabled: false } }));
        } catch { /* noop */ }
        await refresh();
        await probeVerificationState(true);
      } catch {
        // Ignore cross-origin frame access until callback returns to app origin.
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [embeddedPolling, embeddedUrl, probeVerificationState, refresh]);

  useEffect(() => {
    const onReturn = () => {
      setEmbeddedPolling(false);
      setEmbeddedUrl(null);
      try {
        sessionStorage.removeItem('borderpay_verification_embed_open');
        sessionStorage.removeItem('borderpay_verification_embed_title');
        sessionStorage.removeItem('borderpay_verification_embed_return_enabled');
        window.dispatchEvent(new CustomEvent('borderpay:verification_embed_visibility', { detail: { open: false, title: '', returnEnabled: false } }));
      } catch { /* noop */ }
      setEmbeddedReturnEnabled(true);
    };
    window.addEventListener('borderpay:verification_embed_return', onReturn);
    return () => window.removeEventListener('borderpay:verification_embed_return', onReturn);
  }, []);

  const startVerification = async () => {
    try {
      // Always request a fresh hosted link on CTA click to avoid consumed/stale
      // URLs that can render as blank white screens in iframe mode.
      const ctx = await resolveVerificationContext();
      if (!ctx.emailConfirmed) {
        toast.error('Verify your email first, then retry verification.');
        return;
      }
      const r: any = await requestHostedLink(ctx.accountType);
      if (r?.success && r.data?.tos_link_url) {
        setTosLinkUrl(r.data.tos_link_url);
        const now = Date.now();
        setTosLinkUrlTs(now);
        try {
          localStorage.setItem(`borderpay_last_tos_url:${userId}`, r.data.tos_link_url);
          localStorage.setItem(`borderpay_last_tos_url_ts:${userId}`, String(now));
        } catch { /* noop */ }
        openTopLevelTos(r.data.tos_link_url);
        return;
      }
      if (r?.success && r.data?.link_url) {
        persistTosAccepted(true);
        setTosLinkUrl(null);
        const now = Date.now();
        setLastHostedUrlTs(now);
        setTosLinkUrlTs(0);
        try {
          localStorage.removeItem(`borderpay_last_tos_url:${userId}`);
          localStorage.removeItem(`borderpay_last_tos_url_ts:${userId}`);
          localStorage.setItem(`borderpay_last_verify_url:${userId}`, r.data.link_url);
          localStorage.setItem(`borderpay_last_verify_url_ts:${userId}`, String(now));
        } catch { /* noop */ }
        openHostedVerificationUrl(r.data.link_url, { title: 'Continue verification', returnEnabled: true });
        return;
      }
      if (r?.success && r.data?.already_approved) { await refresh(); toast.success('You’re already verified.'); return; }
      if (r?.code === 'email_verification_required') {
        toast.error('Verify your email first, then retry verification.');
        return;
      }
      if (r?.code === 'bridge_onboarding_paused') {
        toast.error('Verification is temporarily unavailable. Please try again shortly.');
        return;
      }
      const safe = friendlyError(r?.error || 'Could not open verification link. Please try again.', 'Could not start verification. Please try again.');
      toast.error(safe);
    } catch (e) {
      toast.error(friendlyError(e, 'Could not start verification. Please try again.'));
    }
  };

  const continueFromEmbeddedTos = async () => {
    try {
      const ctx = await resolveVerificationContext();
      if (!ctx.emailConfirmed) {
        toast.error('Verify your email first, then retry verification.');
        return;
      }
      const r: any = await requestHostedLink(ctx.accountType);
      if (r?.success && r.data?.link_url) {
        persistTosAccepted(true);
        setTosLinkUrl(null);
        setLastHostedUrl(r.data.link_url);
        const now = Date.now();
        setLastHostedUrlTs(now);
        setTosLinkUrlTs(0);
        try {
          localStorage.removeItem(`borderpay_last_tos_url:${userId}`);
          localStorage.removeItem(`borderpay_last_tos_url_ts:${userId}`);
          localStorage.setItem(`borderpay_last_verify_url:${userId}`, r.data.link_url);
          localStorage.setItem(`borderpay_last_verify_url_ts:${userId}`, String(now));
        } catch { /* noop */ }
        // Per product decision: from ToS embed, Continue verification should
        // open Persona/Bridge KYC externally (not in embedded iframe).
        // Keep callback marker so return lands back on verification screen.
        try { sessionStorage.setItem('borderpay_post_callback_screen', 'kyc'); } catch { /* noop */ }
        try {
          sessionStorage.removeItem('borderpay_verification_embed_open');
          sessionStorage.removeItem('borderpay_verification_embed_title');
          sessionStorage.removeItem('borderpay_verification_embed_return_enabled');
          window.dispatchEvent(new CustomEvent('borderpay:verification_embed_visibility', { detail: { open: false, title: '', returnEnabled: false } }));
        } catch { /* noop */ }
        setEmbeddedPolling(false);
        setEmbeddedUrl(null);
        window.location.href = r.data.link_url;
        return;
      }
      if (r?.success && r.data?.tos_link_url) {
        persistTosAccepted(false);
        setTosLinkUrl(r.data.tos_link_url);
        const now = Date.now();
        setTosLinkUrlTs(now);
        try {
          localStorage.setItem(`borderpay_last_tos_url:${userId}`, r.data.tos_link_url);
          localStorage.setItem(`borderpay_last_tos_url_ts:${userId}`, String(now));
        } catch { /* noop */ }
        toast.info('Please accept Terms of Service first, then continue.');
        return;
      }
      if (r?.success && r.data?.already_approved) {
        await refresh();
        return;
      }
      toast.error(friendlyError(r?.error || 'Could not continue verification.', 'Could not continue verification.'));
    } catch (e) {
      toast.error(friendlyError(e, 'Could not continue verification.'));
    }
  };

  const VIEW: Record<KycView, { Icon: typeof Clock; tone: string; bg: string; title: string; body: string }> = {
    not_started: {
      Icon: Mail, tone: 'text-amber-400', bg: 'bg-amber-500/15',
      title: tt('kyc.status.notStarted.title', 'Verification not started'),
      body: isBusiness
        ? tt('kyc.status.notStarted.bizBody', 'Verify your business to unlock USD, EUR & GBP accounts, cards and your wallet. It only takes a few minutes.')
        : tt('kyc.status.notStarted.body', 'Verify your identity to unlock USD, EUR & GBP accounts, cards and your wallet. It only takes a few minutes.'),
    },
    pending: {
      Icon: Clock, tone: 'text-amber-400', bg: 'bg-amber-500/15',
      title: tt('kyc.status.pending.title', 'Verification pending'),
      body: tt('kyc.status.pending.body', 'Your details have been received and are awaiting review. We’ll update this automatically.'),
    },
    incomplete: {
      Icon: Clock, tone: 'text-amber-400', bg: 'bg-amber-500/15',
      title: tt('kyc.status.incomplete.title', 'Verification incomplete'),
      body: tt('kyc.status.incomplete.body', 'You started verification but still have steps to complete.'),
    },
    under_review: {
      Icon: Clock, tone: 'text-blue-400', bg: 'bg-blue-500/15',
      title: tt('kyc.status.review.title', 'Under review'),
      body: tt('kyc.status.review.body', 'We’re reviewing your verification. This usually takes just a few minutes.'),
    },
    verified: {
      Icon: CheckCircle2, tone: 'text-[#C7FF00]', bg: 'bg-[#C7FF00]/15',
      title: tt('kyc.status.verified.title', 'Verified'),
      body: isBusiness
        ? tt('kyc.status.verified.bizBody', 'Your business is verified. Your account and multi-currency features are unlocked.')
        : tt('kyc.status.verified.body', 'Your identity is verified. Your account and multi-currency features are unlocked.'),
    },
    rejected: {
      Icon: AlertCircle, tone: 'text-red-400', bg: 'bg-red-500/15',
      title: tt('kyc.status.failed.title', 'Verification failed'),
      body: tt('kyc.status.failed.body', 'We couldn’t verify your details. Our team can help you resolve this — please contact support.'),
    },
  };

  const v = VIEW[status];
  const title = isBusiness ? tt('kyc.title.business', 'Business verification') : tt('kyc.title.individual', 'Identity & KYC');

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <header
        className="flex items-center justify-between px-5 sm:px-6 pb-3 max-w-2xl mx-auto"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.85rem)' }}
      >
        <h1 className={`text-base font-semibold ${tc.text}`}>{title}</h1>
        <button
          onClick={refresh}
          aria-label="Refresh status"
          className={`w-9 h-9 rounded-full ${tc.card} border ${tc.cardBorder} flex items-center justify-center ${tc.hoverBg}`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${tc.textMuted} ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <main className="px-5 sm:px-6 pb-10 max-w-2xl mx-auto">
        {/* Status card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-6 sm:p-7`}
        >
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-2xl ${v.bg} flex items-center justify-center flex-shrink-0`}>
              <v.Icon className={`w-6 h-6 ${v.tone}`} />
            </div>
            <div className="min-w-0">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${tc.borderLight} ${tc.bgAlt} mb-2`}>
                <span className={`w-1.5 h-1.5 rounded-full ${v.bg} ${v.tone}`} style={{ backgroundColor: 'currentColor' }} />
                <span className={`text-[10px] font-bold tracking-wider uppercase ${v.tone}`}>{status.replace('_', ' ')}</span>
              </span>
              <h2 className={`text-xl font-semibold ${tc.text} tracking-tight mb-1.5`}>{v.title}</h2>
              <p className={`text-sm ${tc.textMuted} leading-relaxed`}>{v.body}</p>
            </div>
          </div>

          {/* Start/continue is available until Bridge moves the submission into review.
              to (re)open the hosted verification link. The provider handles link reuse
              / regeneration idempotently server-side. */}
          {(status === 'not_started' || status === 'incomplete' || status === 'pending') && (
            <button
              onClick={() => { void startVerification(); }}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm hover:brightness-95 transition"
            >
              <>Continue verification <ArrowRight className="w-4 h-4" /></>
            </button>
          )}
          {(status === 'pending' || status === 'under_review') && (
            <div className={`mt-5 flex items-start gap-2.5 rounded-2xl border ${tc.borderLight} ${tc.bgAlt} px-4 py-3`}>
              <Clock className={`w-4 h-4 ${tc.textMuted} mt-0.5 flex-shrink-0`} />
              <p className={`text-xs ${tc.textMuted} leading-snug`}>
                {tt('kyc.pendingNote', 'We’ll update this automatically once your verification is processed.')}
              </p>
            </div>
          )}
          {/* Support entry for the failed state (no developer reasons shown) */}
          {status === 'rejected' && (
            <a
              href="mailto:support@borderpayafrica.com"
              className={`mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full border ${tc.cardBorder} ${tc.text} text-sm font-semibold ${tc.hoverBg}`}
            >
              <Mail className="w-4 h-4" /> {tt('kyc.contactSupport', 'Contact support')}
            </a>
          )}
        </motion.div>

        <div className="mt-6 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3 h-3 text-[#C7FF00]" />
          <span className={`text-[10px] ${tc.textMuted}`}>
            {tt('kyc.secured', 'Identity verification is handled securely by our licensed partner')}
          </span>
        </div>
      </main>

      {embeddedUrl && (
        <div className="fixed inset-0 z-[20] bg-[#0B0E11] flex flex-col h-[100dvh] w-full">
          <iframe
            key={`${embedNonce}:${embeddedUrl}`}
            id="kyc-embed-frame"
            title="BorderPay Verification"
            src={embeddedUrl}
            ref={iframeRef}
            className="w-full flex-1 min-h-0 border-0 bg-white"
            allow="clipboard-read; clipboard-write; camera; microphone"
            loading="eager"
            allowFullScreen
            onLoad={() => {
              setEmbedLoaded(true);
              try {
                const href = iframeRef.current?.contentWindow?.location?.href || '';
                if (href === 'about:blank') {
                  openTopLevelHostedFallback(embeddedUrl);
                }
              } catch {
                // Cross-origin access denied is expected when remote page is loaded;
                // in that case the iframe likely rendered correctly.
              }
            }}
            onError={() => {
              openTopLevelHostedFallback(embeddedUrl);
            }}
          />
          {!embeddedReturnEnabled && (
            <div className="absolute bottom-0 inset-x-0 p-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] bg-gradient-to-t from-black/65 to-transparent">
              <p className="mb-3 rounded-2xl border border-red-500/40 bg-red-500/15 px-4 py-3 text-center text-xs font-semibold leading-snug text-red-400">
                You must accept the Terms of Service before continuing verification. Skipping this step can delay or block account approval.
              </p>
              <button
                onClick={() => { void continueFromEmbeddedTos(); }}
                className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm hover:brightness-95 transition"
              >
                Continue verification <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default KYCVerification;
