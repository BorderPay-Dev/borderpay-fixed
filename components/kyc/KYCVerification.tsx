/**
 * BorderPay Africa — Identity & KYC (read-only status)
 *
 * Verification is initiated by a secure link we email the user after payment —
 * never started in-app. This screen therefore only READS and DISPLAYS the
 * current Bridge KYC/KYB status:
 *
 *   not started · pending · under review · verified · verification failed
 *
 * Status is seeded synchronously from the cached profile (so the screen opens
 * instantly, no loading spinner) and refreshed in the background. No start
 * button, no hosted link — Bridge remains the source of truth and developer/
 * internal rejection reasons are never surfaced.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, CheckCircle2, AlertCircle, Clock, RefreshCw, Mail } from 'lucide-react';
import { supabase } from '../../utils/supabase/client';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface KYCVerificationProps {
  userId:     string;
  userEmail:  string;
  onBack:     () => void;
  onComplete: () => void;
}

type AccountType  = 'individual' | 'business';
type KycView      = 'not_started' | 'pending' | 'under_review' | 'verified' | 'rejected';

function mapBridge(raw: string | null | undefined): KycView {
  switch ((raw || '').toLowerCase()) {
    case 'approved':
    case 'active':
    case 'verified':     return 'verified';
    case 'rejected':     return 'rejected';
    case 'under_review': return 'under_review';
    case 'pending':
    case 'incomplete':   return 'pending';
    default:             return 'not_started';
  }
}

/** Synchronous seed from the cached profile so the screen never flashes a loader. */
function seedFromCache(): { accountType: AccountType; status: KycView } {
  try {
    const u = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
    const accountType: AccountType = u.account_type === 'business' ? 'business' : 'individual';
    if (String(u.bridge_account_status || '').toLowerCase() === 'rejected') {
      return { accountType, status: 'rejected' };
    }
    const raw = accountType === 'business' ? u.bridge_kyb_status : u.bridge_kyc_status;
    return { accountType, status: mapBridge(raw) };
  } catch {
    return { accountType: 'individual', status: 'not_started' };
  }
}

export function KYCVerification({ userId, userEmail, onBack }: KYCVerificationProps) {
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
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('account_type, bridge_kyc_status, bridge_account_status')
        .eq('id', userId)
        .maybeSingle();
      if (prof) {
        const at: AccountType = prof.account_type === 'business' ? 'business' : 'individual';
        setAccountType(at);
        if (String(prof.bridge_account_status || '').toLowerCase() === 'rejected') {
          setStatus('rejected');
        } else if (at === 'business') {
          const { data: biz } = await supabase
            .from('business_profiles')
            .select('bridge_kyb_status')
            .eq('user_id', userId)
            .maybeSingle();
          setStatus(mapBridge(biz?.bridge_kyb_status));
        } else {
          setStatus(mapBridge(prof.bridge_kyc_status));
        }
      }
    } catch { /* keep the cached status on any error */ }
    finally { setRefreshing(false); }
  }, [userId]);

  // Background refresh on mount — no loading gate; the seed already rendered.
  useEffect(() => { refresh(); }, [refresh]);

  const isBusiness = accountType === 'business';

  const VIEW: Record<KycView, { Icon: typeof Clock; tone: string; bg: string; title: string; body: string }> = {
    not_started: {
      Icon: Mail, tone: 'text-amber-400', bg: 'bg-amber-500/15',
      title: tt('kyc.status.notStarted.title', 'Verification not started'),
      body: isBusiness
        ? tt('kyc.status.notStarted.bizBody', 'After activation we email you a secure link to verify your business. Check your inbox to begin.')
        : tt('kyc.status.notStarted.body', 'After activation we email you a secure link to verify your identity. Check your inbox to begin.'),
    },
    pending: {
      Icon: Clock, tone: 'text-amber-400', bg: 'bg-amber-500/15',
      title: tt('kyc.status.pending.title', 'Verification pending'),
      body: tt('kyc.status.pending.body', 'Your details have been received and are awaiting review. We’ll update this automatically.'),
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
      <FloatingBackButton onBack={onBack} />
      <header
        className="flex items-center justify-between pl-16 pr-5 sm:pr-6 pb-3 max-w-2xl mx-auto"
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

          {/* Email reminder for the link (read-only flows) */}
          {(status === 'not_started' || status === 'pending') && (
            <div className={`mt-5 flex items-start gap-2.5 rounded-2xl border ${tc.borderLight} ${tc.bgAlt} px-4 py-3`}>
              <Mail className={`w-4 h-4 ${tc.textMuted} mt-0.5 flex-shrink-0`} />
              <p className={`text-xs ${tc.textMuted} leading-snug`}>
                {tt('kyc.emailNote', 'Your secure verification link is sent to your email')}
                {userEmail ? <> — <span className={tc.textSecondary}>{userEmail}</span></> : null}.
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
    </div>
  );
}

export default KYCVerification;
