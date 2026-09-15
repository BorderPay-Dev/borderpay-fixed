import React from 'react';
import { providerReceiptTextRows, TransactionReceiptBreakdown } from '../../utils/transactions/receipt';

interface ReceiptProviderDetailsProps {
  receipt: TransactionReceiptBreakdown;
  labelClassName?: string;
  valueClassName?: string;
}

export function ReceiptProviderDetails({
  receipt,
  labelClassName = '',
  valueClassName = '',
}: ReceiptProviderDetailsProps) {
  const coreRows = receipt.hasBridgeReceipt
    ? new Set(['Deposit ID', 'Source payment rail', 'Destination'])
    : new Set<string>();
  const rows = providerReceiptTextRows(receipt).filter(({ label }) => !coreRows.has(label));
  if (rows.length === 0) return null;

  return (
    <>
      {rows.map(({ label, value }) => (
        <React.Fragment key={`${label}:${value}`}>
          <span className={labelClassName}>{label}</span>
          <span className={`text-right font-mono break-all ${valueClassName}`}>{value}</span>
        </React.Fragment>
      ))}
    </>
  );
}
