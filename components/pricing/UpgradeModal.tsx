/**
 * UpgradeModal — the wallet-debit paywall.
 *
 * v1 flow:
 *   1. Modal opens with a target plan_key (Premium or Growth).
 *   2. We fetch the user's USD virtual accounts from
 *      `public.bridge_virtual_accounts` joined with balances
 *      `public.bridge_virtual_account_balances`.
 *   3. User selects which USD VA to charge.
 *   4. UI shows: plan price, source VA balance after debit, confirm button.
 *   5. Confirm calls `backendAPI.subscription.upgrade({plan_key, bridge_va_id})`
 *      which atomically (a) creates an invoice, (b) debits the VA,
 *      (c) writes ledger + tx mirror, (d) activates the plan for 30 days.
 *   6. Success state → calls onUpgraded(); error state shows the structured
 *      error code from the edge function.
 *
 * Error mapping (HTTP code → user-facing):
 *   • 402 insufficient_funds         → "Top up your USD account to upgrade."
 *   • 403 country_not_supported      → "DRC support is coming soon." (rare here)
 *   • 409 plan_account_type_mismatch → "This plan is for the other account type."
 *   • 409 no_active_subscription     → "Please contact support."
 *   • else                           → generic provider error.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, Loader2, CheckCircle2, AlertCircle, Wallet, ArrowRight } from 'lucide-react';
import { supabase } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { getPlan, formatPlanPrice, type PlanKey } from '../../utils/subscriptions/plans';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

export interface UpgradeModalProps {
  open:          boolean;
  planKey:       PlanKey;
  userId:        string;
  isBusinessAccount: boolean;
  onClose:       () => void;
  onUpgraded?:   (result: { plan_key: string; period_end: string }) => void;
}

interface UsdVa {
  bridge_virtual_account_id: string;
  available_balance_minor:   number;
}

export function UpgradeModal({
  open, planKey, userId, isBusinessAccount, onClose, onUpgraded,
}: UpgradeModalProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const plan = getPlan(planKey);
  const priceCents = plan.price_monthly_usd ?? 0;
  const priceUsd   = priceCents / 100;

  const [vas, setVas]               = useState<UsdVa[]>([]);
  const [selectedVa, setSelectedVa] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState<{ period_end: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setSuccess(null);
    (async () => {
      // bridge_virtual_account_balances is the canonical source for USD balances.
      const q = supabase
        .from('bridge_virtual_account_balances')
        .select('bridge_virtual_account_id, available_balance_minor')
        .eq('currency', 'USD');
      const { data, error: e } = isBusinessAccount
        ? await q.eq('business_user_id', userId)
        : await q.eq('user_id', userId);
      if (!alive) return;
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as UsdVa[];
      setVas(rows);
      // Prefer the first VA with enough balance.
      const candidate = rows.find(r => r.available_balance_minor >= priceCents) ?? rows[0];
      setSelectedVa(candidate?.bridge_virtual_account_id ?? null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, userId, isBusinessAccount, priceCents]);

  const selectedBalance = useMemo(() => {
    return vas.find(v => v.bridge_virtual_account_id === selectedVa)?.available_balance_minor ?? 0;
  }, [vas, selectedVa]);

  const hasEnough = selectedBalance >= priceCents;
  const remainingAfter = selectedBalance - priceCents;

  const confirm = async () => {
    if (!selectedVa) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await backendAPI.subscription.upgrade({
        plan_key:     planKey as 'individual_premium' | 'business_growth',
        bridge_va_id: selectedVa,
      });
      if (!r.success) {
        const code = (r as any).code;
        if (code === 'insufficient_funds') setError(tt('upgrade.err.funds', 'Not enough balance in the selected USD account.'));
        else if (code === 'plan_account_type_mismatch') setError(tt('upgrade.err.mismatch', 'This plan is for the other account type.'));
        else if (code === 'no_active_subscription') setError(tt('upgrade.err.no_sub', 'Subscription not found. Please contact support.'));
        else setError(r.error || tt('upgrade.err.generic', 'Upgrade failed. Please try again.'));
        setSubmitting(false);
        return;
      }
      setSuccess({ period_end: r.data!.period_end });
      onUpgraded?.({ plan_key: r.data!.plan_key, period_end: r.data!.period_end });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={tt('upgrade.title', 'Upgrade your plan')}
            className={`fixed bottom-0 sm:bottom-auto sm:top-1/2 sm:left-1/2 z-50 w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 ${tc.bg} rounded-t-3xl sm:rounded-3xl border ${tc.cardBorder} shadow-2xl p-6 sm:p-7`}
            initial={{ y: '100%', opacity: 0.5 }}
            animate={{ y: 0,      opacity: 1   }}
            exit={{    y: '100%', opacity: 0   }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            <button
              type="button"
              aria-label={tt('common.close', 'Close')}
              onClick={onClose}
              className={`absolute top-4 right-4 p-2 rounded-full ${tc.hoverBg}`}
            >
              <X className={`w-5 h-5 ${tc.text}`} />
            </button>

            {success ? (
              <SuccessState planLabel={plan.display_name} periodEnd={success.period_end} onDone={onClose} tc={tc} tt={tt} />
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-[#C7FF00]" />
                  <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${tc.textMuted}`}>
                    {tt('upgrade.eyebrow', 'Upgrade')}
                  </span>
                </div>
                <h2 className={`text-2xl font-bold ${tc.text} tracking-tight`}>
                  {tt('upgrade.title.with', 'Upgrade to')} {plan.display_name}
                </h2>
                <p className={`mt-1 text-sm ${tc.textSecondary}`}>
                  {tt('upgrade.subtitle', 'Pay from your USD virtual account. No card needed.')}
                </p>

                {/* Price row */}
                <div className={`mt-5 flex items-center justify-between p-4 rounded-2xl ${tc.bgAlt} border ${tc.border}`}>
                  <div>
                    <div className={`text-xs ${tc.textMuted}`}>{tt('upgrade.price', 'Monthly price')}</div>
                    <div className={`mt-0.5 text-2xl font-bold ${tc.text}`}>${priceUsd.toFixed(2)}</div>
                  </div>
                  <div className={`text-xs ${tc.textMuted} text-right`}>
                    {tt('upgrade.period', '30 days')}<br />
                    USD
                  </div>
                </div>

                {/* VA picker */}
                <div className="mt-5">
                  <div className={`text-xs font-semibold uppercase tracking-wider ${tc.textMuted} mb-2`}>
                    {tt('upgrade.source', 'Pay from')}
                  </div>
                  {loading ? (
                    <div className="flex items-center gap-2 py-3">
                      <Loader2 className={`w-4 h-4 ${tc.textSecondary} animate-spin`} />
                      <span className={tc.textMuted}>{tt('common.loading', 'Loading…')}</span>
                    </div>
                  ) : vas.length === 0 ? (
                    <div className={`p-4 rounded-2xl border ${tc.border} ${tc.bgAlt} flex items-start gap-3`}>
                      <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                      <div>
                        <div className={`text-sm font-medium ${tc.text}`}>
                          {tt('upgrade.no_va.title', 'No USD account yet')}
                        </div>
                        <div className={`mt-1 text-xs ${tc.textSecondary}`}>
                          {tt('upgrade.no_va.body', 'Create a USD virtual account first and fund it, then come back to upgrade.')}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {vas.map(va => {
                        const enough = va.available_balance_minor >= priceCents;
                        const sel    = va.bridge_virtual_account_id === selectedVa;
                        return (
                          <li key={va.bridge_virtual_account_id}>
                            <button
                              type="button"
                              onClick={() => setSelectedVa(va.bridge_virtual_account_id)}
                              className={`w-full p-3 rounded-2xl border ${sel ? 'border-[#C7FF00] ring-1 ring-[#C7FF00]/60' : tc.border} ${tc.bgAlt} flex items-center justify-between`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-xl bg-[#C7FF00]/15 flex items-center justify-center">
                                  <Wallet className="w-4 h-4 text-[#C7FF00]" />
                                </div>
                                <div className="text-left min-w-0">
                                  <div className={`text-sm font-medium ${tc.text}`}>USD</div>
                                  <div className={`text-[10px] ${tc.textMuted} font-mono truncate max-w-[160px]`}>
                                    {va.bridge_virtual_account_id.slice(0, 18)}…
                                  </div>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className={`text-sm font-semibold ${enough ? tc.text : 'text-amber-400'}`}>
                                  ${(va.available_balance_minor / 100).toFixed(2)}
                                </div>
                                {!enough && (
                                  <div className="text-[10px] text-amber-400 font-medium">
                                    {tt('upgrade.insufficient', 'Insufficient')}
                                  </div>
                                )}
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Balance preview */}
                {!loading && vas.length > 0 && selectedVa && (
                  <div className={`mt-4 p-3 rounded-2xl ${tc.bgAlt} border ${tc.border} flex items-center justify-between text-sm`}>
                    <span className={tc.textMuted}>{tt('upgrade.after_balance', 'Balance after')}</span>
                    <span className={`font-semibold ${hasEnough ? tc.text : 'text-amber-400'}`}>
                      ${(remainingAfter / 100).toFixed(2)}
                    </span>
                  </div>
                )}

                {error && (
                  <div className="mt-4 flex items-start gap-2 p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!selectedVa || !hasEnough || submitting || loading}
                  onClick={confirm}
                  className={`mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-full text-sm font-semibold transition
                    ${(!selectedVa || !hasEnough || submitting || loading)
                      ? `${tc.bgAlt} ${tc.textMuted} cursor-not-allowed`
                      : 'bg-[#C7FF00] text-black hover:opacity-90'}`}
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {!submitting && (
                    <>
                      <span>{tt('upgrade.confirm', 'Pay')} ${priceUsd.toFixed(2)}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <p className={`mt-3 text-center text-[10px] ${tc.textMuted}`}>
                  {tt('upgrade.notice', '30-day period. Renew manually from your account page. No auto-charge.')}
                </p>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SuccessState({
  planLabel, periodEnd, onDone, tc, tt,
}: {
  planLabel: string;
  periodEnd: string;
  onDone:    () => void;
  tc:        ReturnType<typeof useThemeClasses>;
  tt:        (k: string, fb: string) => string;
}) {
  const dt = new Date(periodEnd);
  return (
    <div className="text-center py-3">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-[#C7FF00] flex items-center justify-center mb-4">
        <CheckCircle2 className="w-10 h-10 text-black" strokeWidth={2} />
      </div>
      <h2 className={`text-2xl font-bold ${tc.text}`}>
        {tt('upgrade.success.title', 'Welcome to')} {planLabel}
      </h2>
      <p className={`mt-2 text-sm ${tc.textSecondary}`}>
        {tt('upgrade.success.body', 'Your plan is active. Enjoy the full BorderPay experience.')}
      </p>
      <p className={`mt-1 text-xs ${tc.textMuted}`}>
        {tt('upgrade.success.until', 'Active until')} {dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
      </p>
      <button
        onClick={onDone}
        className="mt-6 inline-flex items-center justify-center px-6 py-3 rounded-full bg-[#C7FF00] text-black text-sm font-semibold hover:opacity-90"
      >
        {tt('upgrade.success.done', 'Continue')}
      </button>
    </div>
  );
}

export default UpgradeModal;
