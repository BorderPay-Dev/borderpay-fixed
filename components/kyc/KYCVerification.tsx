/**
 * BorderPay Africa — KYC / KYB
 *
 * Bridge hosted-link flow. Replaces the prior 1400-line legacy-provider
 * document-upload form. The component now does five things only:
 *
 *   1. Fetches the user's current Bridge KYC/KYB status from the database.
 *   2. Decides whether to drive Individual KYC or Business KYB based on
 *      user_profiles.account_type.
 *   3. Calls bridge-kyc-link or bridge-kyb-link to obtain a hosted Bridge URL.
 *   4. Opens the URL in a new tab/window so the user completes ID + selfie +
 *      (for KYB) ownership / corporate docs on Bridge's hosted page.
 *   5. Polls the database for status flips written by the bridge-webhook
 *      handler. When approved, calls onComplete(). When rejected, surfaces
 *      Bridge's reason and offers Retry.
 *
 * Bridge is the source of truth. We never collect ID images directly here.
 *
 * Props are unchanged from the prior version so MainApp.tsx keeps working.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft, ShieldCheck, ExternalLink, Loader2, CheckCircle2, AlertCircle,
  Clock, RefreshCw, Building2, User as UserIcon,
} from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { supabase } from '../../utils/supabase/client';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { showToast } from '../common/StatusToast';

interface KYCVerificationProps {
  userId:    string;
  userEmail: string;
  onBack:    () => void;
  onComplete: () => void;
}

type AccountType   = 'individual' | 'business';
type BridgeStatus  = 'not_started' | 'pending' | 'under_review' | 'approved' | 'rejected';

interface ProfileSnapshot {
  account_type:    AccountType;
  bridge_status:   BridgeStatus;
  bridge_link_url: string | null;
  rejected_reason: string | null;
}

const POLL_INTERVAL_MS  = 8_000;
const POLL_MAX_DURATION = 5 * 60_000;

export function KYCVerification({ userId, userEmail, onBack, onComplete }: KYCVerificationProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fallback: string) => ((t as any)?.(k) ?? fallback) as string;

  const [profile, setProfile]     = useState<ProfileSnapshot | null>(null);
  const [loading, setLoading]     = useState(true);
  const [starting, setStarting]   = useState(false);
  const [polling, setPolling]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollUntil = useRef<number>(0);

  const fetchProfile = useCallback(async (): Promise<ProfileSnapshot | null> => {
    const { data: prof, error: pErr } = await supabase
      .from('user_profiles')
      .select('account_type, bridge_kyc_status, bridge_kyc_link_url')
      .eq('id', userId)
      .maybeSingle();
    if (pErr || !prof) {
      setError(pErr?.message || 'Could not load your profile.');
      return null;
    }
    const accountType: AccountType = prof.account_type === 'business' ? 'business' : 'individual';

    if (accountType === 'business') {
      const { data: biz } = await supabase
        .from('business_profiles')
        .select('bridge_kyb_status, bridge_kyb_link_url')
        .eq('user_id', userId)
        .maybeSingle();
      const snap: ProfileSnapshot = {
        account_type:    'business',
        bridge_status:   (biz?.bridge_kyb_status as BridgeStatus) ?? 'not_started',
        bridge_link_url: biz?.bridge_kyb_link_url ?? null,
        rejected_reason: null,
      };
      setProfile(snap);
      return snap;
    }

    const snap: ProfileSnapshot = {
      account_type:    'individual',
      bridge_status:   (prof.bridge_kyc_status as BridgeStatus) ?? 'not_started',
      bridge_link_url: prof.bridge_kyc_link_url ?? null,
      rejected_reason: null,
    };
    setProfile(snap);
    return snap;
  }, [userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const snap = await fetchProfile();
      if (!alive) return;
      setLoading(false);
      if (snap?.bridge_status === 'approved') onComplete();
    })();
    return () => { alive = false; };
  }, [fetchProfile, onComplete]);

  useEffect(() => () => {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
  }, []);

  const startPolling = useCallback(() => {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    setPolling(true);
    pollUntil.current = Date.now() + POLL_MAX_DURATION;
    pollTimer.current = window.setInterval(async () => {
      const snap = await fetchProfile();
      if (snap?.bridge_status === 'approved') {
        if (pollTimer.current) window.clearInterval(pollTimer.current);
        setPolling(false);
        onComplete();
        return;
      }
      if (snap?.bridge_status === 'rejected' || Date.now() > pollUntil.current) {
        if (pollTimer.current) window.clearInterval(pollTimer.current);
        setPolling(false);
      }
    }, POLL_INTERVAL_MS);
  }, [fetchProfile, onComplete]);

  const handleStart = useCallback(async () => {
    if (!profile) return;
    setError(null);
    setStarting(true);
    try {
      const r = profile.account_type === 'business'
        ? await backendAPI.bridge.kyb.startBusiness({ redirect_url: `${window.location.origin}/onboarding/kyc-complete` })
        : await backendAPI.bridge.kyc.startIndividual({ redirect_url: `${window.location.origin}/onboarding/kyc-complete` });

      if (!r.success) {
        // Map structured server codes (bridge-kyc-link / bridge-kyb-link).
        //   country_not_supported → DRC / Bridge-prohibited jurisdiction.
        //     Bridge customer creation refuses these users until our
        //     BorderPay enables local rails.
        //   wrong_account_type → caller hit /kyb on an individual or vice
        //     versa. UI surface should not allow this, but fail closed.
        const code = (r as any)?.code;
        const msg =
          code === 'country_not_supported'
            ? (r.error || 'Your country is not yet supported. We are bringing African local rails online soon.')
        : code === 'wrong_account_type'
            ? 'This verification flow does not match your account type.'
        : (r.error || tt('kyc.error.start_failed', 'Could not start verification. Please try again.'));
        setError(msg);
        showToast.error(msg);
        return;
      }
      const url = r.data?.link_url;
      if (r.data?.already_approved) {
        await fetchProfile();
        onComplete();
        return;
      }
      if (!url) {
        setError(tt('kyc.error.no_link', 'Verification link not available. Please try again.'));
        return;
      }

      window.open(url, '_blank', 'noopener,noreferrer');
      await fetchProfile();
      startPolling();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }, [profile, fetchProfile, onComplete, startPolling, tt]);

  const handleContinue = useCallback(() => {
    if (!profile?.bridge_link_url) return;
    window.open(profile.bridge_link_url, '_blank', 'noopener,noreferrer');
    startPolling();
  }, [profile, startPolling]);

  const handleManualRefresh = useCallback(async () => {
    const snap = await fetchProfile();
    if (snap?.bridge_status === 'approved') onComplete();
  }, [fetchProfile, onComplete]);

  const headerText = useMemo(() => {
    const isBusiness = profile?.account_type === 'business';
    if (isBusiness) return tt('kyc.header.business', 'Business verification (KYB)');
    return tt('kyc.header.individual', 'Identity verification (KYC)');
  }, [profile, tt]);

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className={`sticky top-0 z-10 ${tc.headerBg} border-b ${tc.border}`}>
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={onBack} aria-label={tt('common.back', 'Back')}
                  className={`p-2 -ml-2 rounded-full ${tc.hoverBg} transition`}>
            <ArrowLeft className={`w-5 h-5 ${tc.text}`} />
          </button>
          <h1 className={`text-lg font-semibold ${tc.text}`}>{headerText}</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-6 sm:p-10`}
        >
          {loading ? (
            <div className="flex flex-col items-center py-10">
              <Loader2 className={`w-6 h-6 ${tc.textSecondary} animate-spin mb-3`} />
              <p className={tc.textMuted}>{tt('common.loading', 'Loading…')}</p>
            </div>
          ) : !profile ? (
            <div className="flex flex-col items-center py-10 text-center">
              <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
              <p className={`${tc.text} mb-2`}>{tt('kyc.error.profile_missing', 'Could not load your profile.')}</p>
              {error && <p className={`text-sm ${tc.textMuted}`}>{error}</p>}
              <button onClick={handleManualRefresh}
                      className={`mt-4 px-4 py-2 rounded-full ${tc.glassButton}`}>
                {tt('common.retry', 'Retry')}
              </button>
            </div>
          ) : (
            <KycBody
              profile={profile}
              email={userEmail}
              starting={starting}
              polling={polling}
              error={error}
              onStart={handleStart}
              onContinue={handleContinue}
              onRefresh={handleManualRefresh}
              tt={tt}
              tc={tc}
            />
          )}
        </motion.div>

        <p className={`mt-4 text-xs ${tc.textMuted} text-center`}>
          {tt('kyc.disclaimer.partner', 'Verification is performed through BorderPay. We do not store your ID images.')}
        </p>
      </div>
    </div>
  );
}

function KycBody({
  profile, email, starting, polling, error,
  onStart, onContinue, onRefresh, tt, tc,
}: {
  profile:  ProfileSnapshot;
  email:    string;
  starting: boolean;
  polling:  boolean;
  error:    string | null;
  onStart:    () => void;
  onContinue: () => void;
  onRefresh:  () => void;
  tt: (k: string, fb: string) => string;
  tc: ReturnType<typeof useThemeClasses>;
}) {
  const isBusiness = profile.account_type === 'business';
  const Icon = isBusiness ? Building2 : UserIcon;

  if (profile.bridge_status === 'approved') {
    return (
      <Centered icon={<CheckCircle2 className="w-10 h-10 text-black" />} accent
                title={tt('kyc.approved.title', 'Verification complete')}
                subtitle={tt('kyc.approved.body', 'You can now access all BorderPay financial features.')} tc={tc} />
    );
  }
  if (profile.bridge_status === 'rejected') {
    return (
      <div className="text-center">
        <div className="mx-auto w-20 h-20 rounded-2xl bg-red-100 flex items-center justify-center mb-5">
          <AlertCircle className="w-10 h-10 text-red-600" />
        </div>
        <h2 className={`text-2xl font-bold ${tc.text} mb-2`}>{tt('kyc.rejected.title', 'Verification did not pass')}</h2>
        <p className={`${tc.textSecondary} mb-1 max-w-md mx-auto`}>
          {tt('kyc.rejected.body', 'We could not verify the documents provided. You can retry or contact support if you think this is in error.')}
        </p>
        {profile.rejected_reason && (
          <p className={`text-sm ${tc.textMuted} mb-4`}>{profile.rejected_reason}</p>
        )}
        <button onClick={onStart} disabled={starting}
                className="mt-4 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#C7FF00] text-black font-semibold hover:opacity-90 disabled:opacity-50 transition">
          {starting && <Loader2 className="w-4 h-4 animate-spin" />}
          {tt('kyc.action.retry', 'Retry verification')}
        </button>
      </div>
    );
  }
  if (profile.bridge_status === 'under_review') {
    return (
      <Centered
        icon={<Clock className="w-10 h-10 text-black" />} accent
        title={tt('kyc.review.title', 'We are reviewing your submission')}
        subtitle={tt('kyc.review.body', 'Most reviews complete within a few minutes. We will email you at this address as soon as it is done.')}
        secondary={email}
        action={
          <button onClick={onRefresh}
                  className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full ${tc.glassButton}`}>
            <RefreshCw className="w-4 h-4" /> {tt('common.refresh', 'Refresh status')}
          </button>
        }
        tc={tc}
      />
    );
  }
  if (profile.bridge_status === 'pending' && profile.bridge_link_url) {
    return (
      <div className="text-center">
        <div className="mx-auto w-20 h-20 rounded-2xl bg-[#C7FF00] flex items-center justify-center mb-5">
          <Icon className="w-10 h-10 text-black" />
        </div>
        <h2 className={`text-2xl font-bold ${tc.text} mb-2`}>
          {tt('kyc.continue.title', 'Continue your verification')}
        </h2>
        <p className={`${tc.textSecondary} mb-6 max-w-md mx-auto`}>
          {tt('kyc.continue.body', 'You started verification but did not finish. You can pick up where you left off.')}
        </p>
        <button onClick={onContinue}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#C7FF00] text-black font-semibold hover:opacity-90 transition">
          <ExternalLink className="w-4 h-4" />
          {tt('kyc.action.continue', 'Continue verification')}
        </button>
        {polling && (
          <p className={`mt-4 text-xs ${tc.textMuted}`}>
            <Loader2 className="w-3 h-3 inline animate-spin mr-1 align-middle" />
            {tt('kyc.polling', 'Checking for completion…')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mx-auto w-20 h-20 rounded-2xl bg-[#C7FF00] flex items-center justify-center mb-5">
        <ShieldCheck className="w-10 h-10 text-black" strokeWidth={2} />
      </div>
      <h2 className={`text-2xl font-bold ${tc.text} mb-2`}>
        {isBusiness
          ? tt('kyc.start.business.title',  'Verify your business')
          : tt('kyc.start.individual.title', 'Verify your identity')}
      </h2>
      <p className={`${tc.textSecondary} mb-6 max-w-md mx-auto leading-relaxed`}>
        {isBusiness
          ? tt('kyc.start.business.body',  "Complete business, ownership, and address checks in BorderPay's secure verification flow. Timelines vary depending on the business and required documents.")
          : tt('kyc.start.individual.body','We need a government-issued ID and a quick selfie. The whole process takes about 2–3 minutes.')}
      </p>
      <ul className={`${tc.textMuted} text-sm space-y-1 mb-6 max-w-sm mx-auto text-left`}>
        {(isBusiness
          ? ['Certificate of incorporation', 'Beneficial owners (≥ 25%)', 'Director ID + selfie']
          : ['Government ID (passport / driver licence / national ID)', 'Selfie for liveness check', 'Proof of address (utility bill or bank statement)']
        ).map((row) => (
          <li key={row} className="flex items-start gap-2">
            <span className="mt-1 inline-block w-1.5 h-1.5 rounded-full bg-[#C7FF00]" />
            <span>{row}</span>
          </li>
        ))}
      </ul>
      <button onClick={onStart} disabled={starting}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#C7FF00] text-black font-semibold hover:opacity-90 disabled:opacity-50 transition">
        {starting && <Loader2 className="w-4 h-4 animate-spin" />}
        {!starting && <ExternalLink className="w-4 h-4" />}
        {isBusiness
          ? tt('kyc.action.start.business',  'Start business verification')
          : tt('kyc.action.start.individual','Start identity verification')}
      </button>
      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
    </div>
  );
}

function Centered({
  icon, title, subtitle, secondary, action, accent, tc,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  secondary?: string;
  action?: React.ReactNode;
  accent?: boolean;
  tc: ReturnType<typeof useThemeClasses>;
}) {
  return (
    <div className="text-center">
      <div className={`mx-auto w-20 h-20 rounded-2xl ${accent ? 'bg-[#C7FF00]' : 'bg-gray-100'} flex items-center justify-center mb-5`}>
        {icon}
      </div>
      <h2 className={`text-2xl font-bold ${tc.text} mb-2`}>{title}</h2>
      {subtitle && <p className={`${tc.textSecondary} mb-1 max-w-md mx-auto`}>{subtitle}</p>}
      {secondary && <p className={`${tc.textMuted} text-sm`}>{secondary}</p>}
      {action}
    </div>
  );
}

export default KYCVerification;
