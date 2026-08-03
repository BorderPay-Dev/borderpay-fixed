/**
 * Bridge transfer networks are identified by `payment_rail`. `chain` is an
 * internal routing hint and is invalid in both POST /v0/transfers endpoints.
 */
export function stripBridgeTransferChainFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const source = { ...((body.source ?? {}) as Record<string, unknown>) };
  const destination = { ...((body.destination ?? {}) as Record<string, unknown>) };
  delete source.chain;
  delete destination.chain;
  return { ...body, source, destination };
}
