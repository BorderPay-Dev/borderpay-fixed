export type BridgeFiatReturnPolicyInput = {
  requestedAmount: string | number;
  originalAmount: string | number;
  destinationCurrency: string;
  sourceCurrency: string;
  paymentRail: string;
  depositCreatedAt: string;
  now?: Date;
};

export type BridgeFiatReturnPolicy = {
  amount: string;
  amountCents: bigint;
  originalAmountCents: bigint;
  destinationCurrency: "usd";
  sourceCurrency: "usdc" | "usdb";
  paymentRail: "ach" | "fednow" | "wire" | "sepa";
  confirmation: string;
};

function fiatCents(value: string | number, label: string): bigint {
  const text = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`${label} must be a positive fiat amount with at most two decimals`);
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  if (cents <= 0n) throw new Error(`${label} must be positive`);
  return cents;
}

function canonicalRail(value: string): BridgeFiatReturnPolicy["paymentRail"] {
  const rail = value.trim().toLowerCase();
  if (["ach", "ach_push"].includes(rail)) return "ach";
  if (["fednow", "fed_now"].includes(rail)) return "fednow";
  if (["wire", "wire_transfer"].includes(rail)) return "wire";
  if (["sepa", "sepa_credit"].includes(rail)) return "sepa";
  throw new Error("Bridge fiat deposit returns are authorized only for ACH, FedNow, Wire, and SEPA");
}

function formatCents(cents: bigint): string {
  const major = cents / 100n;
  const minor = String(cents % 100n).padStart(2, "0");
  return `${major}.${minor}`;
}

export function assertBridgeFiatReturnPolicy(input: BridgeFiatReturnPolicyInput): BridgeFiatReturnPolicy {
  const destinationCurrency = input.destinationCurrency.trim().toLowerCase();
  if (destinationCurrency !== "usd") {
    throw new Error("non-USD return funding equivalence is not authorized by the current local policy");
  }
  const sourceCurrency = input.sourceCurrency.trim().toLowerCase();
  if (sourceCurrency !== "usdc" && sourceCurrency !== "usdb") {
    throw new Error("return funding source must be USDC or USDB");
  }
  const paymentRail = canonicalRail(input.paymentRail);
  const amountCents = fiatCents(input.requestedAmount, "return amount");
  const originalAmountCents = fiatCents(input.originalAmount, "original deposit amount");
  if ((paymentRail === "ach" || paymentRail === "fednow") && amountCents !== originalAmountCents) {
    throw new Error("ACH/FedNow returns must equal the original deposit amount");
  }
  if ((paymentRail === "wire" || paymentRail === "sepa") && amountCents > originalAmountCents) {
    throw new Error("Wire/SEPA return amount cannot exceed the original deposit amount");
  }
  const depositCreatedAt = new Date(input.depositCreatedAt);
  const now = input.now ?? new Date();
  if (!Number.isFinite(depositCreatedAt.getTime())) {
    throw new Error("deposit lacks an authoritative creation timestamp");
  }
  if (depositCreatedAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new Error("deposit creation timestamp is in the future");
  }
  if (now.getTime() - depositCreatedAt.getTime() > 60 * 24 * 60 * 60 * 1000) {
    throw new Error("deposit is outside Bridge's 60-day return window");
  }
  const amount = formatCents(amountCents);
  return {
    amount,
    amountCents,
    originalAmountCents,
    destinationCurrency: "usd",
    sourceCurrency,
    paymentRail,
    confirmation: `RETURN ${amount} USD TO ORIGINAL SENDER`,
  };
}
