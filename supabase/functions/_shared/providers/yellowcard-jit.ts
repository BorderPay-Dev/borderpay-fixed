const SETTLEMENT_SCALE = 1_000_000n;
export const YELLOW_CARD_BORDERPAY_FEE_BPS = 200n;
const BPS_SCALE = 10_000n;

function decimalToMinor(value: string | number): bigint {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error("yellow_card_invalid_settlement_amount");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const minor = BigInt(whole) * SETTLEMENT_SCALE + BigInt(fraction.padEnd(6, "0"));
  if (minor <= 0n) throw new Error("yellow_card_invalid_settlement_amount");
  return minor;
}
function minorToDecimal(value: bigint): string {
  const whole = value / SETTLEMENT_SCALE;
  const fraction = String(value % SETTLEMENT_SCALE).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export interface YellowCardJitDebitAmounts {
  settlementAmount: string;
  settlementAmountMinor: bigint;
  borderpayFeeAmount: string;
  borderpayFeeAmountMinor: bigint;
  customerDebitAmount: string;
  customerDebitAmountMinor: bigint;
}

export interface YellowCardJitFundingTransferInput {
  customerId: string;
  bridgeWalletId: string;
  settlementAsset: "USDC" | "USDT";
  settlementNetwork: "BASE" | "TRON";
  settlementAmount: string | number;
  yellowCardFundingAddress: string;
  idempotencyKey: string;
  scaApplied?: boolean;
}

/**
 * Yellow Card must receive the exact direct-settlement amount it quoted.
 * BorderPay's 2% fee is charged on top of that amount and reserved from the
 * same owned Bridge wallet. Provider conversion/network fees are already
 * reflected by Yellow Card and must not be added again here.
 */
export function calculateYellowCardJitDebit(
  settlementAmount: string | number,
): YellowCardJitDebitAmounts {
  const settlementAmountMinor = decimalToMinor(settlementAmount);
  const borderpayFeeAmountMinor =
    (settlementAmountMinor * YELLOW_CARD_BORDERPAY_FEE_BPS + BPS_SCALE / 2n) / BPS_SCALE;
  const customerDebitAmountMinor = settlementAmountMinor + borderpayFeeAmountMinor;
  return {
    settlementAmount: minorToDecimal(settlementAmountMinor),
    settlementAmountMinor,
    borderpayFeeAmount: minorToDecimal(borderpayFeeAmountMinor),
    borderpayFeeAmountMinor,
    customerDebitAmount: minorToDecimal(customerDebitAmountMinor),
    customerDebitAmountMinor,
  };
}

/**
 * Build the Bridge funding leg without reusing BorderPay's ordinary external
 * wallet payout route. The gross debit includes a flat 2% fee, while the
 * exact net amount reserved by Yellow Card is delivered to its one-time
 * funding address.
 */
export function buildYellowCardJitFundingTransfer(input: YellowCardJitFundingTransferInput) {
  const customerId = String(input.customerId || "").trim();
  const walletId = String(input.bridgeWalletId || "").trim();
  const address = String(input.yellowCardFundingAddress || "").trim();
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!customerId || !walletId || !address || idempotencyKey.length < 8) {
    throw new Error("yellow_card_invalid_funding_identity");
  }
  const supported =
    (input.settlementAsset === "USDC" && input.settlementNetwork === "BASE") ||
    (input.settlementAsset === "USDT" && input.settlementNetwork === "TRON");
  if (!supported) throw new Error("yellow_card_unsupported_funding_route");

  const amounts = calculateYellowCardJitDebit(input.settlementAmount);
  return {
    on_behalf_of: customerId,
    source: {
      payment_rail: "bridge_wallet" as const,
      currency: input.settlementAsset,
      bridge_wallet_id: walletId,
      amount: amounts.customerDebitAmount,
    },
    destination: {
      payment_rail: input.settlementNetwork === "BASE" ? "base" as const : "tron" as const,
      currency: input.settlementAsset,
      address,
    },
    developer_fee: { flat_amount: amounts.borderpayFeeAmount },
    ...(input.scaApplied
      ? {
        sca_attestation: {
          outcome: "sca_used" as const,
          channel: "other" as const,
          subchannel: "remote" as const,
        },
      }
      : {}),
    idempotency_key: idempotencyKey,
  };
}
