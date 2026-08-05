import {
  buildYellowCardSandboxReceivePayload,
  redactYellowCardReceivePayload,
} from "../supabase/functions/_shared/providers/yellowcard-payload.ts";

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function assertDeepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn: () => unknown, expected: RegExp) {
  try {
    fn();
  } catch (error) {
    if (expected.test(String(error))) return;
    throw error;
  }
  throw new Error("Expected function to throw");
}

for (const settlement of [
  { cryptoCurrency: "USDC" as const, cryptoNetwork: "BASE" as const, walletAddress: "0x1111111111111111111111111111111111111111" },
  { cryptoCurrency: "USDT" as const, cryptoNetwork: "TRC20" as const, walletAddress: "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC" },
]) {
  Deno.test(`Yellow Card sandbox receive uses exact ${settlement.cryptoCurrency}/${settlement.cryptoNetwork} contract`, () => {
    const payload = buildYellowCardSandboxReceivePayload({
      sequenceId: "53f7c7fa-f2bb-450c-8f6d-9ff0000f0099",
      channelId: "channel-test",
      localAmount: 1000,
      country: "KE",
      currency: "KES",
      reason: "other",
      customerUID: "user-test",
      recipient: {
        name: "Test User",
        country: "KE",
        phone: "+254700000000",
        address: "Test address",
        dob: "01/02/1990",
        email: "tester@example.com",
        idNumber: "ID-123",
        idType: "national_id",
      },
      source: { accountType: "momo", accountNumber: "1111111111", networkId: "network-test" },
      settlementInfo: settlement,
    });

    assertEqual(payload.localAmount, 1000);
    assertEqual(payload.forceAccept, true);
    assertEqual(payload.directSettlement, true);
    assertEqual(payload.customerType, "retail");
    assertDeepEqual(payload.settlementInfo, settlement);
    assertEqual((payload as any).amount, undefined);

    const redacted = redactYellowCardReceivePayload(payload as Record<string, any>);
    assertEqual(redacted.recipient.idNumber, "[redacted]");
    assertEqual(redacted.recipient.phone, "[redacted]");
    assertEqual(redacted.source.accountNumber, "[redacted]");
    assertEqual(redacted.settlementInfo.walletAddress, "[redacted]");
  });
}

Deno.test("Yellow Card sandbox receive fails closed without full KYC", () => {
  assertThrows(() => buildYellowCardSandboxReceivePayload({
    sequenceId: "53f7c7fa-f2bb-450c-8f6d-9ff0000f0099",
    channelId: "channel-test",
    localAmount: 1000,
    country: "KE",
    currency: "KES",
    reason: "other",
    customerUID: "user-test",
    recipient: {
      name: "Test User",
      country: "KE",
      phone: "+254700000000",
      address: "Test address",
      dob: "01/02/1990",
      email: "tester@example.com",
      idNumber: "",
      idType: "",
    },
    source: { accountType: "momo", accountNumber: "1111111111", networkId: "network-test" },
    settlementInfo: { cryptoCurrency: "USDT", cryptoNetwork: "TRC20", walletAddress: "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC" },
  }), /yellow_card_missing_recipient_id_number/);
});
