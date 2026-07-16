export interface TransactionReceiptBreakdown {
  initialAmount: number;
  developerFeeAmount: number;
  exchangeFeeAmount: number;
  finalAmount: number;
  hasFees: boolean;
}

function finiteAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstAmount(...values: unknown[]): number | null {
  for (const value of values) {
    const n = finiteAmount(value);
    if (n !== null) return n;
    if (value && typeof value === 'object') {
      const nested = finiteAmount((value as Record<string, unknown>).amount);
      if (nested !== null) return nested;
    }
  }
  return null;
}

export function normalizeTransactionReceipt(tx: {
  amount?: unknown;
  metadata?: Record<string, any> | null;
}): TransactionReceiptBreakdown | null {
  const md = tx?.metadata || {};
  const raw = md?.raw && typeof md.raw === 'object' ? md.raw : {};
  const payload = md?.payload && typeof md.payload === 'object' ? md.payload : {};
  const rawReceipt = raw?.receipt && typeof raw.receipt === 'object' ? raw.receipt : {};
  const payloadReceipt = payload?.receipt && typeof payload.receipt === 'object' ? payload.receipt : {};
  const receipt = md?.receipt && typeof md.receipt === 'object'
    ? md.receipt
    : Object.keys(rawReceipt).length > 0
      ? rawReceipt
      : payloadReceipt;

  const developerFeeAmount = Math.abs(firstAmount(
    receipt?.developer_fee_amount,
    receipt?.developer_fee,
    md?.developer_fee_amount,
    md?.developer_fee,
    rawReceipt?.developer_fee_amount,
    rawReceipt?.developer_fee,
    raw?.developer_fee_amount,
    raw?.developer_fee,
    payloadReceipt?.developer_fee_amount,
    payloadReceipt?.developer_fee,
    payload?.developer_fee_amount,
    payload?.developer_fee,
  ) ?? 0);

  const exchangeFeeAmount = Math.abs(firstAmount(
    receipt?.exchange_fee_amount,
    receipt?.exchange_fee,
    md?.exchange_fee_amount,
    md?.exchange_fee,
    rawReceipt?.exchange_fee_amount,
    rawReceipt?.exchange_fee,
    raw?.exchange_fee_amount,
    raw?.exchange_fee,
    payloadReceipt?.exchange_fee_amount,
    payloadReceipt?.exchange_fee,
    payload?.exchange_fee_amount,
    payload?.exchange_fee,
  ) ?? 0);

  const explicitFinal = firstAmount(
    receipt?.final_amount,
    receipt?.net_amount,
    md?.final_amount,
    md?.net_amount,
    md?.net_destination_amount,
    rawReceipt?.final_amount,
    rawReceipt?.net_amount,
    raw?.final_amount,
    raw?.net_amount,
    raw?.net_destination_amount,
    payloadReceipt?.final_amount,
    payloadReceipt?.net_amount,
    payload?.final_amount,
    payload?.net_amount,
    payload?.net_destination_amount,
  );

  const rowAmount = Math.abs(finiteAmount(tx?.amount) ?? 0);
  const initialAmount = firstAmount(
    receipt?.initial_amount,
    receipt?.amount,
    md?.initial_amount,
    md?.gross_amount,
    rawReceipt?.initial_amount,
    rawReceipt?.amount,
    raw?.initial_amount,
    raw?.gross_amount,
    raw?.amount,
    payloadReceipt?.initial_amount,
    payloadReceipt?.amount,
    payload?.initial_amount,
    payload?.gross_amount,
    payload?.amount,
  ) ?? (explicitFinal !== null ? explicitFinal + developerFeeAmount + exchangeFeeAmount : rowAmount);

  const finalAmount = explicitFinal ?? Math.max(0, initialAmount - developerFeeAmount - exchangeFeeAmount);
  const hasFees =
    developerFeeAmount > 0 ||
    exchangeFeeAmount > 0 ||
    Math.abs(initialAmount - finalAmount) > 0.000001;

  if (!hasFees) return null;

  return {
    initialAmount,
    developerFeeAmount,
    exchangeFeeAmount,
    finalAmount,
    hasFees,
  };
}
