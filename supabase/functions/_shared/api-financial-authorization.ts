type SupabaseLike = { from: (table: string) => any };

export class ApiFinancialAuthorizationError extends Error {
  constructor(
    readonly code: "forbidden" | "invalid_request" | "provider_unavailable",
    message: string,
    readonly status: 400 | 402 | 403 | 503,
  ) {
    super(message);
    this.name = "ApiFinancialAuthorizationError";
  }
}

function decimalUnits(value: unknown, scale: number): bigint | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,12})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const padded = (fraction + "0".repeat(scale)).slice(0, scale);
  const units = BigInt(whole) * (10n ** BigInt(scale)) + BigInt(padded || "0");
  return units > 0n ? units : null;
}

export function authorizeSingleTransferAmount(
  amount: string,
  capUsd: string | null,
): { amount: string; cap: string } {
  if (!capUsd) {
    throw new ApiFinancialAuthorizationError(
      "forbidden",
      "Money movement is unavailable because this tenant has no approved transfer cap",
      403,
    );
  }
  const amountUnits = decimalUnits(amount, 12);
  const capUnits = decimalUnits(capUsd, 12);
  if (amountUnits === null) {
    throw new ApiFinancialAuthorizationError(
      "invalid_request",
      "source.amount must be a positive decimal string",
      400,
    );
  }
  if (capUnits === null) {
    throw new ApiFinancialAuthorizationError(
      "forbidden",
      "The tenant transfer cap is invalid",
      403,
    );
  }
  if (amountUnits > capUnits) {
    throw new ApiFinancialAuthorizationError(
      "forbidden",
      `Transfer amount exceeds the tenant cap of ${capUsd} USD`,
      403,
    );
  }
  return { amount, cap: capUsd };
}

export function fixedFeeForPercent(
  amount: string,
  basisPoints: number,
): string {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new Error("basisPoints must be a non-negative integer");
  }
  const scale = 12;
  const amountUnits = decimalUnits(amount, scale);
  if (amountUnits === null) throw new Error("invalid fee amount");
  const denominator = 10_000n * (10n ** BigInt(scale));
  const numerator = amountUnits * BigInt(basisPoints) * 100n;
  const cents = (numerator + denominator / 2n) / denominator;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export async function assertSpendableWalletBalance(
  supa: SupabaseLike,
  userId: string,
  currency: "USDC" | "USDT",
  amount: string,
): Promise<void> {
  const { data, error } = await supa
    .from("bridge_balance_ledger")
    .select("amount_minor,direction")
    .or(`user_id.eq.${userId},business_user_id.eq.${userId}`)
    .eq("entity_type", "wallet")
    .eq("currency", currency);
  if (error) {
    throw new ApiFinancialAuthorizationError(
      "provider_unavailable",
      "Wallet balance authorization is temporarily unavailable",
      503,
    );
  }
  const available = (data ?? []).reduce(
    (sum: bigint, row: Record<string, unknown>) => {
      const raw = BigInt(String(row.amount_minor ?? "0"));
      const absolute = raw < 0n ? -raw : raw;
      return String(row.direction).toLowerCase() === "debit"
        ? sum - absolute
        : sum + absolute;
    },
    0n,
  );
  const required = decimalUnits(amount, 6);
  if (required === null) {
    throw new ApiFinancialAuthorizationError(
      "invalid_request",
      "source.amount is invalid",
      400,
    );
  }
  if (available < required) {
    throw new ApiFinancialAuthorizationError(
      "forbidden",
      `Insufficient ${currency} balance`,
      402,
    );
  }
}
