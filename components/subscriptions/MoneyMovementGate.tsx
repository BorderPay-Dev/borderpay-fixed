import React from 'react';

interface MoneyMovementGateProps {
  planKey?: string | null;
  onUpgrade?: () => void;
  feature?: string;
  children: React.ReactNode;
}

export function MoneyMovementGate({ children }: MoneyMovementGateProps) {
  return <>{children}</>;
}

export default MoneyMovementGate;
