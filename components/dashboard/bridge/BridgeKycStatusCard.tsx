/**
 * BridgeKycStatusCard — dashboard product card showing KYC/KYB state.
 *
 * Reads bridge_kyc_status (individual) or bridge_kyb_status (business) from
 * the user's profile. Drives the user into the KYC screen on click.
 *
 * Drop into Dashboard.tsx (individual) or BusinessDashboard.tsx (business)
 * with: <BridgeKycStatusCard userId={userId} onStartVerification={() => onNavigate('kyc')} />
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { supabase } from '../../../utils/supabase/client';
import { useThemeLanguage, useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';

type BridgeStatus = 'not_started' | 'pending' | 'under_review' | 'approved' | 'rejected';
type AccountType  = 'individual' | 'business';

interface Props {
  userId:               string;
  onStartVerification:  () => void;
}

export function BridgeKycStatusCard({ userId, onStartVerification }: Props) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [accountType, setAccountType] = useState<AccountType>('individual');
  const [status, setStatus]           = useState<BridgeStatus>('not_started');
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('account_type, bridge_kyc_status')
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
        setStatus((biz?.bridge_kyb_status as BridgeStatus) || 'not_started');
      } else {
        setStatus((prof?.bridge_kyc_status as BridgeStatus) || 'not_started');
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  const isBusiness = accountType === 'business';

  const ctaLabel =
    status === 'not_started' ? (isBusiness ? tt('dash.kyb.start',     'Start business verification')   : tt('dash.kyc.start',     'Start identity verification'))
  : status === 'pending'     ? (isBusiness ? tt('dash.kyb.continue',  'Continue verification')         : tt('dash.kyc.continue',  'Continue verification'))
  : status === 'rejected'    ? (isBusiness ? tt('dash.kyb.retry',     'Retry verification')            : tt('dash.kyc.retry',     'Retry verification'))
  : null;

  const headline =
    status === 'approved'      ? (isBusiness ? tt('dash.kyb.approved.title','Business verified') : tt('dash.kyc.approved.title','Identity verified'))
  : status === 'under_review'  ? tt('dash.kyc.review.title',  'We are reviewing your submission')
  : status === 'pending'       ? tt('dash.kyc.pending.title', 'Verification in progress')
  : status === 'rejected'      ? tt('dash.kyc.rejected.title','Verification did not pass')
  : (isBusiness ? tt('dash.kyb.start.title','Verify your business to unlock accounts') : tt('dash.kyc.start.title','Verify your identity to unlock accounts'));

  const subline =
    status === 'approved'     ? tt('dash.kyc.approved.body', 'You have full access to virtual accounts, wallets and transfers.')
  : status === 'under_review' ? tt('dash.kyc.review.body',   'Most reviews complete in a few minutes.')
  : status === 'pending'      ? tt('dash.kyc.pending.body',  'Pick up where you left off.')
  : status === 'rejected'     ? tt('dash.kyc.rejected.body', 'You can retry, or contact support.')
  : (isBusiness ? tt('dash.kyb.start.body',  'Provide a few corporate documents and beneficial owners. Takes 5–10 minutes.')
                : tt('dash.kyc.start.body',  'Provide a government ID and a quick selfie. Takes 2–3 minutes.'));

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
              onClick={onStartVerification}
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
