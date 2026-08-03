export function bridgeTransferCustomerId(payload: unknown): string | null {
  const transfer = payload as Record<string, unknown> | null;
  if (!transfer) return null;

  const customer = transfer.customer as Record<string, unknown> | null;
  const source = transfer.source as Record<string, unknown> | null;
  const destination = transfer.destination as Record<string, unknown> | null;
  const candidate =
    transfer.customer_id ??
    customer?.id ??
    transfer.on_behalf_of ??
    source?.customer_id ??
    destination?.customer_id;

  const normalized = String(candidate ?? "").trim();
  return normalized || null;
}
