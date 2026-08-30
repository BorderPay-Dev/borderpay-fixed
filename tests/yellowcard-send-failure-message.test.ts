const source = await Deno.readTextFile(
  new URL("../components/send/SendMoneyFlow.tsx", import.meta.url),
);

function assertIncludes(expected: string): void {
  if (!source.includes(expected)) throw new Error(`Missing Send failure contract: ${expected}`);
}

Deno.test("Yellow Card Send explains authoritative KYC evidence blockers without provider leakage", () => {
  assertIncludes("preflightBlockers.includes('kyc_incomplete')");
  assertIncludes("Verified identity document details required for this payout are unavailable. Contact support; do not retry this transaction.");
  assertIncludes("code === 'bridge_identity_evidence_lookup_failed'");
  assertIncludes("We could not verify the identity evidence required for this payout. Contact support; do not retry this transaction.");
  assertIncludes("!/do not retry/i.test(errorMessage)");
});

Deno.test("Yellow Card Send preserves actionable route and network failures", () => {
  assertIncludes("code === 'yellow_card_amount_outside_provider_limits'");
  assertIncludes("preflightBlockers.includes('active_channel_unavailable')");
  assertIncludes("preflightBlockers.includes('payment_network_required')");
});
