import React, { useEffect, useState } from 'react';
import { CalendarDays, CircleCheck, CircleAlert } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

type Subscription = {
  account_type: 'individual' | 'business'; monthly_fee: number; currency: string;
  status: string; payment_status: 'active' | 'failed' | 'pending'; next_billing_date: string;
  restricted_at: string | null;
};

export function AccountSubscriptionCard() {
  const tc = useThemeClasses();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void backendAPI.subscription.current().then((response: any) => {
      if (active && response?.success) setSubscription(response.data?.subscription ?? null);
    }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  if (!loaded) return <section className={`mx-5 sm:mx-6 h-[148px] rounded-2xl border ${tc.cardBorder} ${tc.card} animate-pulse`} aria-label="Loading account subscription" />;
  if (!subscription) return null;
  const failed = subscription.payment_status === 'failed';
  const status = subscription.restricted_at ? 'Restricted' : failed ? 'Payment failed' : 'Active';
  const date = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${subscription.next_billing_date}T00:00:00Z`));

  return (
    <section className={`mx-5 sm:mx-6 rounded-2xl border ${failed ? 'border-amber-500/30' : tc.cardBorder} ${tc.card} p-4`} aria-labelledby="account-subscription-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id="account-subscription-title" className={`text-sm font-semibold ${tc.text}`}>Account Subscription</p>
          <p className={`mt-1 text-xs ${tc.textMuted}`}>{subscription.account_type === 'business' ? 'Business' : 'Individual'} plan</p>
        </div>
        <div className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${failed ? 'bg-amber-500/10 text-amber-300' : 'bg-[#C7FF00]/10 text-[#C7FF00]'}`}>
          {failed ? <CircleAlert size={14} /> : <CircleCheck size={14} />}{status}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div><p className={`text-[11px] ${tc.textMuted}`}>Monthly fee</p><p className={`mt-1 text-base font-semibold tabular-nums ${tc.text}`}>${Number(subscription.monthly_fee).toFixed(0)} USD</p></div>
        <div><p className={`text-[11px] ${tc.textMuted}`}>Next billing date</p><p className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${tc.text}`}><CalendarDays size={14} />{date}</p></div>
      </div>
      {failed && <p className="mt-3 text-xs leading-5 text-amber-200">Deposit USDC or USDT to complete the pending payment. Your wallet view and support remain available.</p>}
    </section>
  );
}
