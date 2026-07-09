/**
 * PlanStatusCard — Wise-style activation prompt for the signed-in dashboard.
 *
 * Behaviour (individual + business):
 *   • While the account is NOT activated yet, this shows a single, friendly
 *     "Fund your wallet" card whose CTA opens the Fund Wallet sheet
 *     (verify ID → unlock multi-currency accounts + wallet).
 *   • Once the account IS activated, the card renders NOTHING and disappears
 *     entirely — exactly like the setup checklist vanishes at 4/4. There is no
 *     persistent "Starter" tier and nothing to "manage" on a one-time fee.
 *
 * Provider neutrality: this card knows nothing about Bridge. The activation /
 * wallet-debit flow lives entirely in UpgradeModal + subscription-upgrade.
 */

import React from 'react';
import { type PlanKey, type AccountType } from '../../utils/subscriptions/plans';

export interface PlanStatusCardProps {
  /** The user's active plan_key. null while loading. */
  planKey:        PlanKey | null;
  accountType:    AccountType;
  /** Kept for API compatibility; no longer used (no "manage" on a one-time fee). */
  userId:         string;
  /** Opens activation/upgrade flow — fallback CTA target. */
  onManagePlans:  () => void;
  /** Opens the activation flow (UpgradeModal) for the appropriate tier. */
  onUpgrade?:     () => void;
  /** Hide activation prompt once user already has any VA (USD/EUR/GBP). */
  hasVirtualAccounts?: boolean;
}

export function PlanStatusCard({
  planKey, accountType, onManagePlans, onUpgrade, hasVirtualAccounts = false,
}: PlanStatusCardProps) {
  void planKey;
  void accountType;
  void onManagePlans;
  void onUpgrade;
  void hasVirtualAccounts;
  return null;
}

export default PlanStatusCard;
