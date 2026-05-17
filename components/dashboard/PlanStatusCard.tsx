/**
 * PlanStatusCard — compact subscription summary for the signed-in dashboard.
 *
 * Renders on both Dashboard (individual) and BusinessDashboard. Shows:
 *   • Plan display name + monthly price (e.g. "Premium · $9.99/mo").
 *   • Free vs paid styling: lime accent ring + Sparkles for paid plans;
 *     muted card for starter with a prominent "Upgrade" CTA.
 *   • For business accounts: live team-seat usage ("3 of 5 seats used").
 *     Reads `business_team_members` via supabase.rpc(count_active_team_seats).
 *     The cap comes from the plan's `limits.max_team_members` (null = ∞).
 *
 * Routing:
 *   • The "Upgrade" CTA on Starter routes to the in-app pricing screen
 *     (onManagePlans). PricingScreen then opens the UpgradeModal which
 *     atomically debits a USD virtual-account balance for the plan price.
 *   • The "Manage plan" link on paid plans also routes to pricing so users
 *     can downgrade / see invoices.
 *
 * Provider neutrality: this card knows nothing about Bridge. The wallet-
 * debit upgrade flow lives entirely in UpgradeModal + subscription-upgrade.
 */

import React, { useEffect, useState } from 'react';
import { Sparkles, ArrowRight, Users, Loader2 } from 'lucide-react';
import { supabase } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import {
  getPlan, formatPlanPrice, type PlanKey, type AccountType,
} from '../../utils/subscriptions/plans';

export interface PlanStatusCardProps {
  /** The user's active plan_key. null while loading. */
  planKey:        PlanKey | null;
  accountType:    AccountType;
  /** Required for the business seat-count query; ignored for individual. */
  userId:         string;
  /** Opens /pricing (PricingScreen) inside the app shell. */
  onManagePlans:  () => void;
  /** Opens the UpgradeModal targeting the appropriate paid tier. */
  onUpgrade?:     () => void;
}

export function PlanStatusCard({
  planKey, accountType, userId, onManagePlans, onUpgrade,
}: PlanStatusCardProps) {
  const tc = useThemeClasses();

  // Loading skeleton until the parent's subscription fetch resolves.
  if (!planKey) {
    return (
      <div className={`rounded-2xl ${tc.card} border ${tc.cardBorder} px-4 py-4 flex items-center gap-3`}>
        <div className={`w-9 h-9 rounded-full ${tc.bgAlt} animate-pulse`} />
        <div className="flex-1 space-y-1.5">
          <div className={`h-3 w-24 rounded ${tc.bgAlt} animate-pulse`} />
          <div className={`h-2.5 w-32 rounded ${tc.bgAlt} animate-pulse`} />
        </div>
      </div>
    );
  }

  const plan = getPlan(planKey);
  const isPaid = (plan.price_monthly_usd ?? 0) > 0;
  const isEnterprise = plan.is_contact_sales;

  // ── Business: live team-seat usage (null cap = unlimited) ─────────────
  const isBusiness = accountType === 'business';
  const seatCap    = plan.limits.max_team_members;     // number | null
  const [seatsUsed, setSeatsUsed] = useState<number | null>(null);

  useEffect(() => {
    if (!isBusiness) return;
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('count_active_team_seats', {
          p_business_user_id: userId,
        });
        if (!alive) return;
        if (!error && typeof data === 'number') {
          // The owner IS inserted into business_team_members by
          // ensure_starter_subscription, so count_active_team_seats already
          // includes them. No off-by-one correction needed.
          setSeatsUsed(data);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { alive = false; };
  }, [isBusiness, userId]);

  const seatLabel =
    !isBusiness        ? null
  : seatsUsed === null ? 'Loading seats…'
  : seatCap === null   ? `${seatsUsed} seat${seatsUsed === 1 ? '' : 's'} · unlimited`
  :                      `${seatsUsed} of ${seatCap} seats used`;

  return (
    <div
      className={`rounded-2xl border px-4 py-4 transition-colors ${
        isPaid
          ? `${tc.card} ${tc.cardBorder} ring-1 ring-[#C7FF00]/30`
          : `${tc.card} ${tc.cardBorder}`
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Icon disc */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            isPaid ? 'bg-[#C7FF00] text-black' : `${tc.bgAlt} ${tc.textSecondary}`
          }`}
        >
          {isPaid
            ? <Sparkles className="w-4 h-4" />
            : isBusiness ? <Users className="w-4 h-4" /> : <Sparkles className="w-4 h-4 opacity-50" />}
        </div>

        {/* Plan name + price */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className={`text-sm font-semibold ${tc.text} truncate`}>
              {plan.display_name}
              <span className={`text-[10px] ml-1 uppercase tracking-wider ${tc.textMuted}`}>
                {isBusiness ? 'Business' : 'Personal'}
              </span>
            </h3>
            <span className={`text-xs font-medium ${tc.textSecondary} font-mono`}>
              {isEnterprise ? 'Custom pricing' : formatPlanPrice(plan)}
            </span>
          </div>
          {(seatLabel || plan.tagline) && (
            <p className={`text-[11px] ${tc.textMuted} mt-0.5 truncate`}>
              {seatLabel || plan.tagline}
            </p>
          )}
        </div>

        {/* CTA */}
        {!isPaid && !isEnterprise && onUpgrade && (
          <button
            type="button"
            onClick={onUpgrade}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#C7FF00] text-black text-[11px] font-bold flex-shrink-0 hover:brightness-95 transition"
          >
            Upgrade
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
        {(isPaid || isEnterprise) && (
          <button
            type="button"
            onClick={onManagePlans}
            className={`text-[11px] font-semibold ${tc.textSecondary} flex-shrink-0 hover:${tc.text} transition-colors`}
          >
            Manage
          </button>
        )}
      </div>

      {/* Business seat-cap exhaustion hint (only when near/at cap) */}
      {isBusiness && seatCap !== null && seatsUsed !== null && seatsUsed >= seatCap && !isEnterprise && (
        <div className="mt-3 pt-3 border-t border-amber-500/20 flex items-start gap-2">
          <Loader2 className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-px" />
          <p className="text-[11px] text-amber-300/90 leading-snug">
            All {seatCap} seats are in use. Upgrade to add more team members.
          </p>
        </div>
      )}
    </div>
  );
}

export default PlanStatusCard;
