export interface TransactionReceiptBreakdown {
  initialAmount: number;
  developerFeeAmount: number;
  exchangeFeeAmount: number;
  finalAmount: number;
  hasFees: boolean;
  hasBridgeReceipt?: boolean;
  sourceCurrency?: string;
  sourceAmount?: number;
  serviceChargeAmount?: number;
  availableAmount?: number;
  destinationCurrency?: string;
  destinationAmount?: number;
  exchangeRate?: number;
  destinationAddress?: string;
  sourceRail?: string;
  depositId?: string;
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

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
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
  const sourceCurrency = firstText(
    receipt?.source_currency,
    md?.source_currency,
    rawReceipt?.source_currency,
    payloadReceipt?.source_currency,
  )?.toUpperCase();
  const destinationCurrency = firstText(
    receipt?.destination_currency,
    md?.destination_currency,
    rawReceipt?.destination_currency,
    raw?.destination_currency,
    payloadReceipt?.destination_currency,
    payload?.destination_currency,
  )?.toUpperCase();
  const destinationAmount = firstAmount(
    receipt?.destination_amount,
    md?.destination_amount,
    rawReceipt?.destination_amount,
    raw?.destination_amount,
    payloadReceipt?.destination_amount,
    payload?.destination_amount,
  );
  const serviceChargeAmount = Math.abs(firstAmount(
    receipt?.service_charge_amount,
    md?.service_charge_amount,
    rawReceipt?.service_charge_amount,
    payloadReceipt?.service_charge_amount,
  ) ?? 0);
  const availableAmount = firstAmount(
    receipt?.available_amount,
    md?.available_amount,
    rawReceipt?.available_amount,
    payloadReceipt?.available_amount,
  );
  const sourceAmount = firstAmount(
    receipt?.source_amount,
    md?.source_amount,
    rawReceipt?.source_amount,
    payloadReceipt?.source_amount,
  );
  const exchangeRate = firstAmount(
    receipt?.exchange_rate,
    md?.exchange_rate,
    rawReceipt?.exchange_rate,
    raw?.exchange_rate,
    payloadReceipt?.exchange_rate,
    payload?.exchange_rate,
  );
  const destinationAddress = firstText(
    receipt?.destination_address,
    md?.destination_address,
    rawReceipt?.destination_address,
    raw?.destination_address,
    payloadReceipt?.destination_address,
    payload?.destination_address,
  ) || undefined;
  const sourceRail = firstText(
    receipt?.source_rail,
    md?.source_rail,
    rawReceipt?.source_rail,
    payloadReceipt?.source_rail,
  ) || undefined;
  const depositId = firstText(
    receipt?.deposit_id,
    md?.deposit_id,
    rawReceipt?.deposit_id,
    raw?.deposit_id,
    payloadReceipt?.deposit_id,
    payload?.deposit_id,
  ) || undefined;

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
  const hasBridgeReceipt = Boolean(destinationCurrency && destinationAmount !== null && destinationAmount > 0);

  if (!hasFees && !hasBridgeReceipt) return null;

  return {
    initialAmount,
    developerFeeAmount,
    exchangeFeeAmount,
    finalAmount,
    hasFees,
    hasBridgeReceipt,
    sourceCurrency,
    sourceAmount: sourceAmount ?? initialAmount,
    serviceChargeAmount: serviceChargeAmount || developerFeeAmount,
    availableAmount: availableAmount ?? finalAmount,
    destinationCurrency,
    destinationAmount: destinationAmount ?? undefined,
    exchangeRate: exchangeRate ?? undefined,
    destinationAddress,
    sourceRail,
    depositId,
  };
}
