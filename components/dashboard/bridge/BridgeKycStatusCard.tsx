/**
 * BridgeKycStatusCard — dashboard product card showing KYC/KYB state.
 *
 * Uses the same Bridge-first derivation as profile/gating, so terminal Bridge
 * account rejection does not render as "not started" when bridge_kyc_status is
 * stale or absent. Drives the user into the KYC screen on click.
 *
 * Drop into Dashboard.tsx (individual) or BusinessDashboard.tsx (business)
 * with: <BridgeKycStatusCard userId={userId} onStartVerification={() => onNavigate('kyc')} />
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { supabase } from '../../../utils/supabase/client';
import { useThemeLanguage, useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';
import { BRIDGE_ONBOARDING_LIVE } from '../../../utils/featureFlags';
import { deriveKycStatus } from '../../../utils/config/environment';

type CardStatus = 'not_started' | 'incomplete' | 'pending' | 'under_review' | 'approved' | 'rejected';
type AccountType  = 'individual' | 'business';

interface Props {
  userId:               string;
  onStartVerification:  () => void;
}

export function BridgeKycStatusCard({ userId, onStartVerification }: Props) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  // Seed synchronously from the cached profile so the card paints its real
  // status instantly (no loading shimmer on the dashboard); the fetch below
  // refreshes silently.
  const cachedProfile = (() => {
    try { return JSON.parse(localStorage.getItem('borderpay_user') || 'null'); } catch { return null; }
  })();
  const cachedAcct: AccountType = cachedProfile?.account_type === 'business' ? 'business' : 'individual';
  const cachedStatus: CardStatus = (() => {
    if (!cachedProfile) return 'not_started';
    const d = deriveKycStatus(cachedAcct === 'business' ? { ...cachedProfile, account_type: 'business' } : cachedProfile);
    return (d === 'verified' ? 'approved' : d) as CardStatus;
  })();

  const [accountType, setAccountType] = useState<AccountType>(cachedAcct);
  const [status, setStatus]           = useState<CardStatus>(cachedStatus);
  const [loading, setLoading]         = useState(!cachedProfile);

  useEffect(() => {
    if (!BRIDGE_ONBOARDING_LIVE) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('account_type, kyc_status, bridge_kyc_status, bridge_account_status')
        .eq('id', userId)
        .maybeSingle();
      if (!alive) return;
      const acct: AccountType = prof?.account_type === 'business' ? 'business' : 'individual';
      setAccountType(acct);

      if (acct === 'business') {
        const { data: biz } = await supabase
          .from('business_profiles')
          .select('bridge_kyb_status')
          .eq('user_id', userId)
          .maybeSingle();
        if (!alive) return;
        const derived = deriveKycStatus({
          ...prof,
          bridge_kyb_status: biz?.bridge_kyb_status ?? null,
          account_type: 'business',
        });
        setStatus(derived === 'verified' ? 'approved' : derived);
      } else {
        const derived = deriveKycStatus(prof);
        setStatus(derived === 'verified' ? 'approved' : derived);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  if (!BRIDGE_ONBOARDING_LIVE) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 sm:p-6`}
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-2xl bg-[#C7FF00]/20 flex items-center justify-center">
            <Clock className="w-6 h-6 text-black" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`text-base font-semibold ${tc.text} mb-1`}>
              {tt('dash.kyc.paused.title', 'Verification paused')}
            </h3>
            <p className={`text-sm ${tc.textSecondary}`}>
              {tt(
                'dash.kyc.paused.body',
                'KYC and KYB onboarding is paused until BorderPay launches money movement.',
              )}
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  const isBusiness = accountType === 'business';

  const ctaLabel =
    status === 'not_started' ? (isBusiness ? tt('dash.kyb.start',     'Start business verification')   : tt('dash.kyc.start',     'Start identity verification'))
  : status === 'incomplete'  ? tt('dash.kyc.continue', 'Continue verification')
  : status === 'pending'     ? (isBusiness ? tt('dash.kyb.continue',  'Continue verification')         : tt('dash.kyc.continue',  'Continue verification'))
  : status === 'rejected'    ? tt('dash.kyc.contactSupport', 'Contact support')
  : null;

  const headline =
    status === 'approved'      ? (isBusiness ? tt('dash.kyb.approved.title','Business verified') : tt('dash.kyc.approved.title','Identity verified'))
  : status === 'under_review'  ? tt('dash.kyc.review.title',  'We are reviewing your submission')
  : status === 'incomplete'    ? tt('dash.kyc.incomplete.title', 'Verification incomplete')
  : status === 'pending'       ? tt('dash.kyc.pending.title', 'Verification in progress')
  : status === 'rejected'      ? tt('dash.kyc.rejected.title','Verification did not pass')
  : (isBusiness ? tt('dash.kyb.start.title','Verify your business to unlock accounts') : tt('dash.kyc.start.title','Verify your identity to unlock accounts'));

  // Body copy for each status.
  //
  // Business strings avoid naming the verifier, drop any
  // BorderPay-collects-documents framing, and carry NO timeline claims
  // (review timelines vary by submission). The approved string also drops
  // the "and transfers" overclaim — transfers stay product-flagged and
  // we don't want to imply availability before the flag flips.
  //
  // Individual strings preserve the existing hosted-flow expectation
  // (ID + selfie ≈ 2-3 minutes) which is a reasonable UX hint, and
  // only the "approved" subline is revised to remove the transfers
  // overclaim that is currently misleading for individuals as well.
  const subline =
    status === 'approved'
      ? (isBusiness
          ? tt('dash.kyb.approved.body', 'Business verified. Virtual accounts and wallets are now available.')
          : tt('dash.kyc.approved.body', 'Identity verified. Virtual accounts and wallets are now available.'))
  : status === 'under_review'
      ? (isBusiness
          ? tt('dash.kyb.review.body', 'We are reviewing your business submission. Timelines vary depending on the business and required documents.')
          : tt('dash.kyc.review.body', 'Most reviews complete in a few minutes.'))
  : status === 'incomplete'   ? tt('dash.kyc.incomplete.body', 'You started verification but still have steps to complete.')
  : status === 'pending'      ? tt('dash.kyc.pending.body',  'Pick up where you left off.')
  : status === 'rejected'     ? tt('dash.kyc.rejected.body', 'Contact support so our team can review the account and advise the next step.')
  : (isBusiness
      ? tt('dash.kyb.start.body', "Complete business, ownership, and address checks in BorderPay's secure verification flow.")
      : tt('dash.kyc.start.body', 'Provide a government ID and a quick selfie. Takes 2–3 minutes.'));

  const Icon = status === 'approved'     ? CheckCircle2
             : status === 'under_review' ? Clock
             : status === 'rejected'     ? AlertCircle
             :                             ShieldCheck;
  const iconBg = status === 'approved'  ? 'bg-[#C7FF00]'
             : status === 'rejected'    ? 'bg-red-100'
             : status === 'under_review'? 'bg-[#C7FF00]/40'
             : 'bg-[#C7FF00]';
  const iconFg = status === 'rejected'  ? 'text-red-600' : 'text-black';

  if (loading) {
    return (
      <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 flex items-center gap-3`}>
        <Loader2 className={`w-5 h-5 ${tc.textSecondary} animate-spin`} />
        <span className={tc.textMuted}>{tt('common.loading', 'Loading…')}</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 sm:p-6`}
    >
      <div className="flex items-start gap-4">
        <div className={`shrink-0 w-12 h-12 rounded-2xl ${iconBg} flex items-center justify-center`}>
          <Icon className={`w-6 h-6 ${iconFg}`} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`text-base font-semibold ${tc.text} mb-1`}>{headline}</h3>
          <p className={`text-sm ${tc.textSecondary}`}>{subline}</p>
          {ctaLabel && (
            <button
              onClick={() => {
                if (status === 'rejected') {
                  window.location.href = 'mailto:support@borderpayafrica.com';
                  return;
                }
                onStartVerification();
              }}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#C7FF00] text-black text-sm font-semibold hover:opacity-90 transition"
            >
              {ctaLabel}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default BridgeKycStatusCard;
