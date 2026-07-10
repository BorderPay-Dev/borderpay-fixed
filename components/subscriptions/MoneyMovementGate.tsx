/**
 * MoneyMovementGate — retired compatibility wrapper.
 *
 * Production no longer gates KYC/KYB, wallet access, or money movement behind
 * paid plans, first-fund requirements, activation fees, or subscriptions.
 */

import React from 'react';

interface MoneyMovementGateProps {
  planKey?: string | null;
  onUpgrade?: () => void;
  feature?: string;
  children: React.ReactNode;
}

export function MoneyMovementGate({ planKey, onUpgrade, feature, children }: MoneyMovementGateProps) {
  void planKey;
  void onUpgrade;
  void feature;
  return <>{children}</>;
}

export default MoneyMovementGate;
