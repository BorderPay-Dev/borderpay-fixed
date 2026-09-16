/** Match the explicit wallet-amount rejection, never arbitrary validation errors. */
export function isBridgeInsufficientWalletBalance(error: unknown): boolean {
  const detail = error as { status?: number; bridge_code?: string; raw_text?: string } | null;
  if (detail?.status !== 400 || detail.bridge_code !== "invalid_parameters" || !detail.raw_text) return false;
  try {
    const body = JSON.parse(detail.raw_text);
    return body?.source?.location === "body"
      && body?.source?.key?.amount === "is higher than the balance of the wallet";
  } catch {
    return false;
  }
}
