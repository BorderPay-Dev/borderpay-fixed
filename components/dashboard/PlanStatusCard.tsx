/**
 * PlanStatusCard — legacy no-op.
 *
 * Production no longer uses paid-plan or deposit-unlock dashboard prompts.
 * The component remains only to preserve existing imports.
 */

import React from 'react';
import { type PlanKey, type AccountType } from '../../utils/subscriptions/plans';

export interface PlanStatusCardProps {
  /** The user's active plan_key. null while loading. */
  planKey:        PlanKey | null;
  accountType:    AccountType;
  /** Kept for API compatibility; no longer used (no "manage" on a one-time fee). */
  userId:         string;
  /** Legacy no-op callback. */
  onManagePlans:  () => void;
  /** Legacy no-op callback. */
  onUpgrade?:     () => void;
  /** Legacy no-op flag. */
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
