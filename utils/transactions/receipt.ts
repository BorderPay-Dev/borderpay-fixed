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
  destinationRail?: string;
  sourceRail?: string;
  depositId?: string;
  bridgeTransactionId?: string;
  sourceBankName?: string;
  sourceBankAccount?: string;
  sourceBankRoutingNumber?: string;
  sourceBankAddress?: string;
  senderName?: string;
  paymentReferenceText?: string;
  receivingBankName?: string;
  receivingBankAddress?: string;
  receivingBankRoutingNumber?: string;
  receivingAccountName?: string;
  receivingAccountNumber?: string;
  traceId?: string;
  imad?: string;
  uetr?: string;
  claveDeRastreo?: string;
  refundReturnReason?: string;
  refundReturnedAt?: string;
  refundRiskRejectionReason?: string;
  refundCustomerName?: string;
  refundDepositOriginatorName?: string;
  refundDepositBeneficiaryName?: string;
  refundRail?: string;
  refundBeneficiaryName?: string;
  refundReferenceId?: string;
  hasProviderDetails?: boolean;
}

export interface TransactionReceiptTextRow {
  label: string;
  value: string;
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

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export function providerReceiptTextRows(receipt: TransactionReceiptBreakdown): TransactionReceiptTextRow[] {
  const rows: Array<[string, string | undefined]> = [
    ['Bridge transaction ID', receipt.bridgeTransactionId],
    ['Deposit ID', receipt.depositId],
    ['Source payment rail', receipt.sourceRail],
    ['Source bank', receipt.sourceBankName],
    ['Source account name', receipt.senderName],
    ['Source account', receipt.sourceBankAccount],
    ['Source routing number', receipt.sourceBankRoutingNumber],
    ['Source bank address', receipt.sourceBankAddress],
    ['Bank reference', receipt.paymentReferenceText],
    ['Receiving bank', receipt.receivingBankName],
    ['Receiving bank address', receipt.receivingBankAddress],
    ['Receiving routing number', receipt.receivingBankRoutingNumber],
    ['Receiving account name', receipt.receivingAccountName],
    ['Receiving account', receipt.receivingAccountNumber],
    ['Destination rail', receipt.destinationRail],
    ['Destination', receipt.destinationAddress],
    ['Trace ID', receipt.traceId],
    ['IMAD', receipt.imad],
    ['UETR', receipt.uetr],
    ['Clave de rastreo', receipt.claveDeRastreo],
    ['Return reason', receipt.refundReturnReason],
    ['Returned at', receipt.refundReturnedAt],
    ['Risk rejection reason', receipt.refundRiskRejectionReason],
    ['Customer name', receipt.refundCustomerName],
    ['Deposit originator/sender name', receipt.refundDepositOriginatorName],
    ['Deposit beneficiary/recipient name', receipt.refundDepositBeneficiaryName],
    ['Refund rail', receipt.refundRail],
    ['Refund beneficiary name', receipt.refundBeneficiaryName],
    ['Refund reference ID', receipt.refundReferenceId],
  ];
  const seen = new Set<string>();
  return rows.flatMap(([label, raw]) => {
    const value = String(raw || '').trim();
    if (!value || seen.has(`${label}:${value}`)) return [];
    seen.add(`${label}:${value}`);
    return [{ label, value }];
  });
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
  const source = record(receipt?.source || md?.source || raw?.source || payload?.source);
  const sender = record(receipt?.sender || md?.sender || raw?.sender || payload?.sender || source?.sender);
  const originator = record(receipt?.originator || md?.originator || raw?.originator || payload?.originator);
  const destination = record(receipt?.destination || md?.destination || raw?.destination || payload?.destination);
  const sourceBank = record(receipt?.source_bank || source?.bank_details || source?.bank || sender?.bank || originator?.bank);
  const receivingBank = record(receipt?.receiving_bank || destination?.bank_details || destination?.bank);
  const sourceInstructions = record(
    receipt?.source_deposit_instructions || md?.source_deposit_instructions ||
    raw?.source_deposit_instructions || payload?.source_deposit_instructions ||
    raw?.account_details?.source_deposit_instructions || payload?.account_details?.source_deposit_instructions,
  );
  const tracking = record(receipt?.tracking || md?.tracking || raw?.tracking || payload?.tracking || receipt?.payment_tracking);
  const refund = record(md?.refund_details || receipt?.refund || raw?.refund || payload?.refund);
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
  const destinationRail = firstText(
    receipt?.destination_rail,
    receipt?.destination_payment_rail,
    md?.destination_rail,
    raw?.destination_rail,
    payload?.destination_rail,
    destination?.payment_rail,
    destination?.rail,
    destination?.blockchain,
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
  const bridgeTransactionId = firstText(
    md?.bridge_transfer_id,
    md?.transaction_id,
    raw?.bridge_transfer_id,
    raw?.transfer_id,
    raw?.id,
    payload?.bridge_transfer_id,
    payload?.transfer_id,
    payload?.id,
  ) || undefined;

  const sourceBankName = firstText(receipt?.source_bank_name, md?.source_bank_name, sourceBank?.name, source?.bank_name, sender?.bank_name, originator?.bank_name) || undefined;
  const sourceBankAccount = firstText(receipt?.source_bank_account, md?.source_bank_account, sourceBank?.account_number, source?.account_number, source?.account_last_4, sender?.account_number, originator?.account_number) || undefined;
  const sourceBankRoutingNumber = firstText(receipt?.source_bank_routing_number, md?.source_bank_routing_number, sourceBank?.routing_number, source?.routing_number, source?.routing_code) || undefined;
  const sourceBankAddress = firstText(receipt?.source_bank_address, md?.source_bank_address, sourceBank?.address, source?.bank_address) || undefined;
  const senderName = firstText(receipt?.sender_name, md?.sender_name, source?.sender_name, source?.account_name, sender?.name, sender?.account_name, originator?.name, originator?.account_name) || undefined;
  const paymentReferenceText = firstText(receipt?.payment_reference_text, receipt?.reference_text, receipt?.payment_reference, md?.payment_reference_text, md?.reference_text, raw?.reference_text, raw?.payment_reference, raw?.memo, payload?.reference_text, payload?.payment_reference, payload?.memo) || undefined;
  const receivingBankName = firstText(receipt?.receiving_bank_name, md?.receiving_bank_name, receivingBank?.name, destination?.bank_name, sourceInstructions?.bank_name) || undefined;
  const receivingBankAddress = firstText(receipt?.receiving_bank_address, md?.receiving_bank_address, receivingBank?.address, destination?.bank_address, sourceInstructions?.bank_address) || undefined;
  const receivingBankRoutingNumber = firstText(receipt?.receiving_bank_routing_number, md?.receiving_bank_routing_number, receivingBank?.routing_number, destination?.routing_number, sourceInstructions?.routing_number, sourceInstructions?.routing_code) || undefined;
  const receivingAccountName = firstText(receipt?.receiving_account_name, md?.receiving_account_name, destination?.account_name, destination?.beneficiary_name, sourceInstructions?.account_name, sourceInstructions?.beneficiary_name) || undefined;
  const receivingAccountNumber = firstText(receipt?.receiving_account_number, md?.receiving_account_number, destination?.account_number, destination?.iban, sourceInstructions?.account_number, sourceInstructions?.iban) || undefined;
  const traceId = firstText(receipt?.trace_id, receipt?.ach_trace_number, md?.trace_id, md?.ach_trace_number, tracking?.trace_id, tracking?.ach_trace_number) || undefined;
  const imad = firstText(receipt?.imad, receipt?.imad_number, md?.imad, tracking?.imad, tracking?.imad_number) || undefined;
  const uetr = firstText(receipt?.uetr, md?.uetr, tracking?.uetr) || undefined;
  const claveDeRastreo = firstText(receipt?.clave_de_rastreo, md?.clave_de_rastreo, tracking?.clave_de_rastreo) || undefined;
  const refundReturnReason = firstText(refund?.return_reason, refund?.reason, md?.refund_return_reason, md?.return_reason) || undefined;
  const refundReturnedAt = firstText(refund?.returned_at, refund?.refunded_at, md?.refund_returned_at, md?.returned_at) || undefined;
  const refundRiskRejectionReason = firstText(refund?.risk_rejection_reason, refund?.rejection_reason, md?.refund_risk_rejection_reason) || undefined;
  const refundCustomerName = firstText(refund?.customer_name, md?.refund_customer_name) || undefined;
  const refundDepositOriginatorName = firstText(refund?.deposit_originator_name, md?.refund_deposit_originator_name) || undefined;
  const refundDepositBeneficiaryName = firstText(refund?.deposit_beneficiary_name, md?.refund_deposit_beneficiary_name) || undefined;
  const refundRail = firstText(refund?.refund_rail, refund?.rail, md?.refund_rail) || undefined;
  const refundBeneficiaryName = firstText(refund?.refund_beneficiary_name, refund?.beneficiary_name, md?.refund_beneficiary_name) || undefined;
  const refundReferenceId = firstText(refund?.refund_reference_id, refund?.reference_id, refund?.tracking_number, md?.refund_reference_id) || undefined;

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
  const hasProviderDetails = Boolean([
    bridgeTransactionId, depositId, sourceBankName, sourceBankAccount,
    sourceBankRoutingNumber, sourceBankAddress, senderName, paymentReferenceText,
    receivingBankName, receivingBankAddress, receivingBankRoutingNumber,
    receivingAccountName, receivingAccountNumber, traceId, imad, uetr,
    claveDeRastreo, refundReturnReason, refundReturnedAt,
    refundRiskRejectionReason, refundCustomerName,
    refundDepositOriginatorName, refundDepositBeneficiaryName, refundRail,
    refundBeneficiaryName, refundReferenceId,
  ].some(Boolean));

  if (!hasFees && !hasBridgeReceipt && !hasProviderDetails) return null;

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
    destinationRail,
    sourceRail,
    depositId,
    bridgeTransactionId,
    sourceBankName,
    sourceBankAccount,
    sourceBankRoutingNumber,
    sourceBankAddress,
    senderName,
    paymentReferenceText,
    receivingBankName,
    receivingBankAddress,
    receivingBankRoutingNumber,
    receivingAccountName,
    receivingAccountNumber,
    traceId,
    imad,
    uetr,
    claveDeRastreo,
    refundReturnReason,
    refundReturnedAt,
    refundRiskRejectionReason,
    refundCustomerName,
    refundDepositOriginatorName,
    refundDepositBeneficiaryName,
    refundRail,
    refundBeneficiaryName,
    refundReferenceId,
    hasProviderDetails,
  };
}
