export type BridgeWalletActivityDirection = "credit" | "debit";

/**
 * Bridge wallet activity types observed in signed production webhooks.
 * Keep this explicit: unknown financial activity must fail closed upstream.
 */
export function explicitBridgeWalletActivityDirection(
  payload: unknown,
): BridgeWalletActivityDirection | null {
  const type = String((payload as Record<string, unknown> | null)?.type ?? "")
    .trim()
    .toLowerCase();
  if (type === "direct_deposit" || type === "deposit") return "credit";
  if (type === "withdrawal") return "debit";
  return null;
}
