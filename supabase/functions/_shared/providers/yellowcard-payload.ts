export type YellowCardAccountType = "bank" | "momo";
export type YellowCardSettlement =
  | { cryptoCurrency: "USDC"; cryptoNetwork: "BASE"; walletAddress: string }
  | { cryptoCurrency: "USDT"; cryptoNetwork: "TRC20"; walletAddress: string };

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

export interface YellowCardReceivePayloadInput {
  sequenceId: string;
  channelId: string;
  localAmount: number;
  country: string;
  currency: string;
  reason: string;
  customerUID: string;
  recipient: YellowCardRetailKyc;
  source: {
    accountType: YellowCardAccountType;
    accountNumber?: string;
    networkId?: string;
  };
  settlementInfo: YellowCardSettlement;
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

export function buildYellowCardSandboxReceivePayload(
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

  const recipient = {
    name: required(input.recipient.name, "recipient_name"),
    country: required(input.recipient.country, "recipient_country").toUpperCase(),
    phone: required(input.recipient.phone, "recipient_phone"),
    address: required(input.recipient.address, "recipient_address"),
    dob: required(input.recipient.dob, "recipient_dob"),
    email: required(input.recipient.email, "recipient_email").toLowerCase(),
    idNumber: required(input.recipient.idNumber, "recipient_id_number"),
    idType: required(input.recipient.idType, "recipient_id_type"),
  };

  const settlementInfo = {
    cryptoCurrency: input.settlementInfo.cryptoCurrency,
    cryptoNetwork: input.settlementInfo.cryptoNetwork,
    walletAddress: required(input.settlementInfo.walletAddress, "settlement_wallet_address"),
  };
  const supportedSettlement =
    (settlementInfo.cryptoCurrency === "USDC" && settlementInfo.cryptoNetwork === "BASE") ||
    (settlementInfo.cryptoCurrency === "USDT" && settlementInfo.cryptoNetwork === "TRC20");
  if (!supportedSettlement) throw new Error("yellow_card_unsupported_settlement_route");

  return {
    channelId: required(input.channelId, "channel_id"),
    sequenceId: required(input.sequenceId, "sequence_id"),
    localAmount,
    reason,
    recipient,
    source: {
      accountType,
      ...(input.source.accountNumber
        ? { accountNumber: required(input.source.accountNumber, "source_account_number") }
        : {}),
      ...(input.source.networkId
        ? { networkId: required(input.source.networkId, "network_id") }
        : {}),
    },
    forceAccept: true,
    customerType: "retail",
    customerUID: required(input.customerUID, "customer_uid"),
    country: required(input.country, "country").toUpperCase(),
    currency: required(input.currency, "currency").toUpperCase(),
    directSettlement: true,
    settlementInfo,
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
