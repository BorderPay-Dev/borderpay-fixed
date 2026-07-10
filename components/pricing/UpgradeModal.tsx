/**
 * UpgradeModal — retired compatibility shim.
 *
 * BorderPay production has no paid plans, activation fees, first-fund gates, or
 * subscription upgrades. Keep this component export so stale imports compile,
 * but never render a paywall and never call subscription edge functions.
 */

import React, { useEffect } from 'react';
import { type PlanKey } from '../../utils/subscriptions/plans';

export interface UpgradeModalProps {
  open: boolean;
  planKey: PlanKey;
  userId: string;
  isBusinessAccount: boolean;
  onClose: () => void;
  onUpgraded?: (result: { plan_key: string; period_end: string }) => void;
}

export function UpgradeModal({
  open,
  planKey,
  userId,
  isBusinessAccount,
  onClose,
  onUpgraded,
}: UpgradeModalProps) {
  void planKey;
  void userId;
  void isBusinessAccount;
  void onUpgraded;

  useEffect(() => {
    if (open) onClose();
  }, [open, onClose]);

  return null;
}

export default UpgradeModal;
