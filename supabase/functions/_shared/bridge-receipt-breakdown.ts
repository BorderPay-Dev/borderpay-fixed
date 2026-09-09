const CURRENCY_SCALE = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
  USDB: 6,
  EURC: 6
};
function toMinorUnits(amount, currency) {
  const scale = CURRENCY_SCALE[currency.toUpperCase()];
  if (scale === undefined) return null;
  if (amount && typeof amount === "object") {
    return toMinorUnits(amount.amount, currency);
  }
  const raw = typeof amount === "string" ? amount.trim() : typeof amount === "number" && Number.isFinite(amount) ? amount.toString() : "";
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const absolute = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = absolute.split(".");
  const padded = (fraction + "0".repeat(scale)).slice(0, scale);
  const minor = BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded || "0");
  return negative ? -minor : minor;
}
function firstAmount(source, currency, keys) {
  for (const key of keys){
    const parsed = toMinorUnits(source[key], currency);
    if (parsed !== null) return parsed < 0n ? -parsed : parsed;
  }
  return null;
}
/**
 * Derive Bridge money-in amounts without subtracting a developer fee twice.
 * Bridge activity payloads may expose the already-net amount at the top level,
 * while the receipt carries authoritative incoming/fee/outgoing components.
 */ export function bridgeReceiptBreakdown(payload, currency) {
  const body = payload && typeof payload === "object" ? payload : {};
  const receipt = body.receipt && typeof body.receipt === "object" ? body.receipt : {};
  const developerFeeMinor = firstAmount(receipt, currency, [
    "developer_fee_amount",
    "developer_fee",
    "service_charge_amount"
  ]) ?? firstAmount(body, currency, [
    "developer_fee_amount",
    "developerFeeAmount",
    "developer_fee",
    "developerFee"
  ]) ?? 0n;
  const exchangeFeeMinor = firstAmount(receipt, currency, [
    "exchange_fee_amount",
    "exchange_fee"
  ]) ?? firstAmount(body, currency, [
    "exchange_fee_amount",
    "exchangeFeeAmount",
    "exchange_fee",
    "exchangeFee"
  ]) ?? 0n;
  const explicitGrossMinor = firstAmount(receipt, currency, [
    "initial_amount",
    "incoming_amount",
    "source_amount"
  ]) ?? firstAmount(body, currency, [
    "initial_amount",
    "incoming_amount",
    "source_amount"
  ]);
  const availableMinor = firstAmount(receipt, currency, [
    "subtotal_amount",
    "available_amount"
  ]) ?? firstAmount(body, currency, [
    "subtotal_amount",
    "available_amount"
  ]);
  const topLevelAmountMinor = toMinorUnits(body.amount, currency);
  if (explicitGrossMinor === null && availableMinor === null && topLevelAmountMinor === null) return null;
  // Bridge's pre-conversion fiat VA events (`funds_received` and `in_review`)
  // use both top-level `amount` and `subtotal_amount` for the gross incoming
  // fiat amount. The developer fee has not yet been reflected in those fields.
  // Later `payment_submitted` / `payment_processed` events include a receipt
  // whose initial/subtotal legs remain authoritative and take the normal path
  // below. Do not apply this rule to generic events: their top-level amount may
  // already be net, which is why the fallback below deliberately treats it so.
  const activityType = String(body.type ?? body.status ?? "").trim().toLowerCase();
  const preConversionFiatVa = String(body.product_type ?? "").trim().toLowerCase() === "virtual_account" && [
    "funds_received",
    "in_review"
  ].includes(activityType) && Object.keys(receipt).length === 0;
  if (preConversionFiatVa) {
    const grossMinor = topLevelAmountMinor ?? availableMinor;
    if (grossMinor === null) return null;
    if (availableMinor !== null && topLevelAmountMinor !== null && availableMinor !== topLevelAmountMinor) {
      throw new Error("bridge_webhook_receipt_amounts_inconsistent");
    }
    const netMinor = grossMinor - developerFeeMinor - exchangeFeeMinor;
    if (netMinor < 0n) throw new Error("bridge_webhook_receipt_amounts_inconsistent");
    return {
      grossMinor,
      developerFeeMinor,
      exchangeFeeMinor,
      netMinor
    };
  }
  // Prefer the receipt's two explicit legs. When one leg is missing, derive it
  // arithmetically from the captured fee components. Top-level amount is used
  // only as a last-resort net value because Bridge may already have deducted
  // the developer fee there.
  const totalFees = developerFeeMinor + exchangeFeeMinor;
  const computedNet = explicitGrossMinor === null ? null : explicitGrossMinor - totalFees;
  if (computedNet !== null && availableMinor !== null && computedNet !== availableMinor) {
    throw new Error("bridge_webhook_receipt_amounts_inconsistent");
  }
  const netMinor = availableMinor ?? computedNet ?? topLevelAmountMinor;
  const grossMinor = explicitGrossMinor ?? netMinor + totalFees;
  if (grossMinor < totalFees || netMinor < 0n) {
    throw new Error("bridge_webhook_receipt_amounts_inconsistent");
  }
  return {
    grossMinor,
    developerFeeMinor,
    exchangeFeeMinor,
    netMinor
  };
}
