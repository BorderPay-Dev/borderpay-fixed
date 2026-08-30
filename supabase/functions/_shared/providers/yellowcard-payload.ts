export type YellowCardAccountType = "bank" | "momo";
const REDUCED_KYC_EXCLUDED_CURRENCIES = new Set(["BWP", "NGN", "ZAR"]);
export const YELLOW_CARD_REDUCED_KYC_MAX_USD = 20;

export function yellowCardReducedKycEligible(input: {
  direction: "receive" | "payout";
  currency: string;
  usdEquivalent: number | null;
  missingFullKyc: boolean;
  coreComplete: boolean;
}): boolean {
  return input.direction === "receive" &&
    input.missingFullKyc &&
    input.coreComplete &&
    !REDUCED_KYC_EXCLUDED_CURRENCIES.has(String(input.currency || "").trim().toUpperCase()) &&
    input.usdEquivalent !== null &&
    Number.isFinite(input.usdEquivalent) &&
    input.usdEquivalent > 0 &&
    input.usdEquivalent < YELLOW_CARD_REDUCED_KYC_MAX_USD;
}

export type YellowCardSettlement =
  | { cryptoCurrency: "USDC"; cryptoNetwork: "BASE"; walletAddress: string }
  | { cryptoCurrency: "USDT"; cryptoNetwork: "TRC20"; walletAddress: string };

export type YellowCardSendSettlement =
  | { cryptoCurrency: "USDC"; cryptoNetwork: "BASE"; cryptoAmount: number; refundAddress: string }
  | { cryptoCurrency: "USDT"; cryptoNetwork: "TRC20"; cryptoAmount: number; refundAddress: string };

export interface YellowCardRetailKyc {
  name: string;
  country: string;
  phone: string;
  address: string;
  dob: string;
  email: string;
  idNumber: string;
  idType: string;
}

export interface YellowCardInstitutionKyc {
  businessName: string;
  businessId: string;
}

export interface YellowCardReceivePayloadInput {
  sequenceId: string;
  channelId?: string;
  channelType?: YellowCardAccountType;
  localAmount: number;
  country: string;
  currency: string;
  reason: string;
  customerUID: string;
  recipient: YellowCardRetailKyc;
  kycTier?: "full" | "reduced";
  source: {
    accountType: YellowCardAccountType;
    accountNumber?: string;
    networkId?: string;
  };
  settlementInfo: YellowCardSettlement;
  redirectUrl?: string;
}

export interface YellowCardSendPayloadInput {
  sequenceId: string;
  channelId?: string;
  channelType?: YellowCardAccountType;
  localAmount: number;
  country: string;
  currency: string;
  reason: string;
  customerUID: string;
  customerType?: "retail" | "institution";
  sender: YellowCardRetailKyc | YellowCardInstitutionKyc;
  destination: {
    accountName: string;
    accountNumber: string;
    accountType: YellowCardAccountType;
    networkId: string;
  };
  settlementInfo: YellowCardSendSettlement;
}

export interface YellowCardDirectSettlementSendInstruction {
  providerTransactionId: string;
  sequenceId: string;
  cryptoCurrency: "USDC" | "USDT";
  cryptoNetwork: "BASE" | "TRC20";
  cryptoAmount: number;
  walletAddress: string;
  expiresAt: string;
}

const PAYMENT_REASONS = new Set([
  "gift",
  "bills",
  "groceries",
  "travel",
  "health",
  "entertainment",
  "housing",
  "school-fees",
  "other",
]);

function required(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`yellow_card_missing_${field}`);
  return normalized;
}

function retailKyc(
  input: YellowCardRetailKyc,
  prefix: "sender" | "recipient",
  tier: "full" | "reduced" = "full",
) {
  const core = {
    name: required(input.name, `${prefix}_name`),
    country: required(input.country, `${prefix}_country`).toUpperCase(),
    email: required(input.email, `${prefix}_email`).toLowerCase(),
  };
  if (tier === "reduced") return core;
  return {
    ...core,
    phone: required(input.phone, `${prefix}_phone`),
    address: required(input.address, `${prefix}_address`),
    dob: required(input.dob, `${prefix}_dob`),
    idNumber: required(input.idNumber, `${prefix}_id_number`),
    idType: required(input.idType, `${prefix}_id_type`),
  };
}

function institutionKyc(input: YellowCardInstitutionKyc) {
  return {
    businessName: required(input.businessName, "sender_business_name"),
    businessId: required(input.businessId, "sender_business_id"),
  };
}

export function buildYellowCardDirectSettlementSendPayload(
  input: YellowCardSendPayloadInput,
): Record<string, unknown> {
  const localAmount = Number(input.localAmount);
  if (!Number.isFinite(localAmount) || !Number.isInteger(localAmount) || localAmount <= 0) {
    throw new Error("yellow_card_invalid_local_amount");
  }
  const cryptoAmount = Number(input.settlementInfo.cryptoAmount);
  if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
    throw new Error("yellow_card_invalid_crypto_amount");
  }
  const reason = required(input.reason, "reason").toLowerCase();
  if (!PAYMENT_REASONS.has(reason)) throw new Error("yellow_card_invalid_reason");
  const accountType = input.destination.accountType;
  if (accountType !== "bank" && accountType !== "momo") {
    throw new Error("yellow_card_invalid_account_type");
  }
  const settlementInfo = {
    cryptoCurrency: input.settlementInfo.cryptoCurrency,
    cryptoNetwork: input.settlementInfo.cryptoNetwork,
    cryptoAmount,
    refundAddress: required(input.settlementInfo.refundAddress, "refund_address"),
  };
  const supportedSettlement =
    (settlementInfo.cryptoCurrency === "USDC" && settlementInfo.cryptoNetwork === "BASE") ||
    (settlementInfo.cryptoCurrency === "USDT" && settlementInfo.cryptoNetwork === "TRC20");
  if (!supportedSettlement) throw new Error("yellow_card_unsupported_settlement_route");

  const channelId = String(input.channelId || "").trim();
  const channelType = input.channelType;
  if (!channelId && channelType !== "bank" && channelType !== "momo") {
    throw new Error("yellow_card_missing_channel_routing");
  }

  const customerType = input.customerType === "institution" ? "institution" : "retail";
  return {
    ...(channelType ? { channelType } : { channelId }),
    sequenceId: required(input.sequenceId, "sequence_id"),
    // Yellow Card direct-settlement Send derives the transfer amount from
    // settlementInfo.cryptoAmount. Its API rejects both amount and
    // localAmount when directSettlement is true.
    reason,
    sender: customerType === "institution"
      ? institutionKyc(input.sender as YellowCardInstitutionKyc)
      : retailKyc(input.sender as YellowCardRetailKyc, "sender"),
    destination: {
      accountName: required(input.destination.accountName, "destination_account_name"),
      accountNumber: required(input.destination.accountNumber, "destination_account_number"),
      accountType,
      networkId: required(input.destination.networkId, "network_id"),
    },
    customerType,
    customerUID: required(input.customerUID, "customer_uid"),
    country: required(input.country, "country").toUpperCase(),
    currency: required(input.currency, "currency").toUpperCase(),
    directSettlement: true,
    settlementInfo,
  };
}

/**
 * Validate the funding instruction returned after creating a production
 * direct-settlement Send. No treasury transfer may be created from an
 * unvalidated response: the sequence, asset, network and amount must all
 * match the intent that BorderPay reserved.
 */
export function parseYellowCardDirectSettlementSendInstruction(
  response: unknown,
  expected: Pick<YellowCardSendPayloadInput, "sequenceId" | "settlementInfo">,
  nowMs = Date.now(),
): YellowCardDirectSettlementSendInstruction {
  const envelope = response && typeof response === "object" && !Array.isArray(response)
    ? response as Record<string, any>
    : {};
  const body = envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, any>
    : envelope;
  const settlement = body.settlementInfo && typeof body.settlementInfo === "object"
    ? body.settlementInfo as Record<string, any>
    : {};
  const providerTransactionId = required(body.id, "provider_transaction_id");
  const sequenceId = required(body.sequenceId, "sequence_id");
  const cryptoCurrency = required(settlement.cryptoCurrency, "crypto_currency").toUpperCase();
  const cryptoNetwork = required(settlement.cryptoNetwork, "crypto_network").toUpperCase();
  const walletAddress = required(settlement.walletAddress, "funding_wallet_address");
  const expiresAt = required(settlement.expiresAt, "funding_expiry");
  const cryptoAmount = Number(settlement.cryptoAmount);

  if (sequenceId !== expected.sequenceId) throw new Error("yellow_card_sequence_mismatch");
  if (cryptoCurrency !== expected.settlementInfo.cryptoCurrency) {
    throw new Error("yellow_card_settlement_asset_mismatch");
  }
  if (cryptoNetwork !== expected.settlementInfo.cryptoNetwork) {
    throw new Error("yellow_card_settlement_network_mismatch");
  }
  if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
    throw new Error("yellow_card_invalid_funding_amount");
  }
  const expectedMinor = BigInt(Math.round(Number(expected.settlementInfo.cryptoAmount) * 1_000_000));
  const returnedMinor = BigInt(Math.round(cryptoAmount * 1_000_000));
  if (expectedMinor !== returnedMinor) throw new Error("yellow_card_funding_amount_mismatch");

  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) {
    throw new Error("yellow_card_funding_instruction_expired");
  }

  return {
    providerTransactionId,
    sequenceId,
    cryptoCurrency: cryptoCurrency as "USDC" | "USDT",
    cryptoNetwork: cryptoNetwork as "BASE" | "TRC20",
    cryptoAmount,
    walletAddress,
    expiresAt: new Date(expiryMs).toISOString(),
  };
}

export function buildYellowCardDirectSettlementReceivePayload(
  input: YellowCardReceivePayloadInput,
): Record<string, unknown> {
  const localAmount = Number(input.localAmount);
  if (!Number.isFinite(localAmount) || !Number.isInteger(localAmount) || localAmount <= 0) {
    throw new Error("yellow_card_invalid_local_amount");
  }
  const reason = required(input.reason, "reason").toLowerCase();
  if (!PAYMENT_REASONS.has(reason)) throw new Error("yellow_card_invalid_reason");

  const accountType = input.source.accountType;
  if (accountType !== "bank" && accountType !== "momo") {
    throw new Error("yellow_card_invalid_account_type");
  }
  if (accountType === "momo" && !String(input.source.networkId || "").trim()) {
    throw new Error("yellow_card_missing_network_id");
  }
  if (!String(input.source.accountNumber || "").trim()) {
    throw new Error("yellow_card_missing_source_account_number");
  }

  const recipient = retailKyc(input.recipient, "recipient", input.kycTier);
  const country = required(input.country, "country").toUpperCase();
  if (recipient.country !== country) {
    throw new Error("yellow_card_recipient_country_must_match_receive_country");
  }

  const settlementInfo = {
    cryptoCurrency: input.settlementInfo.cryptoCurrency,
    cryptoNetwork: input.settlementInfo.cryptoNetwork,
    walletAddress: required(input.settlementInfo.walletAddress, "settlement_wallet_address"),
  };
  const supportedSettlement =
    (settlementInfo.cryptoCurrency === "USDC" && settlementInfo.cryptoNetwork === "BASE") ||
    (settlementInfo.cryptoCurrency === "USDT" && settlementInfo.cryptoNetwork === "TRC20");
  if (!supportedSettlement) throw new Error("yellow_card_unsupported_settlement_route");

  const channelId = String(input.channelId || "").trim();
  const channelType = input.channelType;
  if (!channelId && channelType !== "bank" && channelType !== "momo") {
    throw new Error("yellow_card_missing_channel_routing");
  }

  return {
    ...(channelId ? { channelId } : { channelType }),
    sequenceId: required(input.sequenceId, "sequence_id"),
    localAmount,
    reason,
    recipient,
    source: {
      accountType,
      accountNumber: required(input.source.accountNumber, "source_account_number"),
      ...(input.source.networkId
        ? { networkId: required(input.source.networkId, "network_id") }
        : {}),
    },
    customerType: "retail",
    customerUID: required(input.customerUID, "customer_uid"),
    country,
    currency: required(input.currency, "currency").toUpperCase(),
    directSettlement: true,
    settlementInfo,
    ...(input.redirectUrl ? { redirectUrl: required(input.redirectUrl, "redirect_url") } : {}),
  };
}

export function redactYellowCardReceivePayload(payload: Record<string, any>) {
  return {
    ...payload,
    recipient: payload.recipient
      ? {
        ...payload.recipient,
        phone: payload.recipient.phone ? "[redacted]" : undefined,
        address: payload.recipient.address ? "[redacted]" : undefined,
        dob: payload.recipient.dob ? "[redacted]" : undefined,
        email: payload.recipient.email ? "[redacted]" : undefined,
        idNumber: payload.recipient.idNumber ? "[redacted]" : undefined,
      }
      : undefined,
    source: payload.source
      ? { ...payload.source, accountNumber: payload.source.accountNumber ? "[redacted]" : undefined }
      : undefined,
    settlementInfo: payload.settlementInfo
      ? { ...payload.settlementInfo, walletAddress: "[redacted]" }
      : undefined,
  };
}
