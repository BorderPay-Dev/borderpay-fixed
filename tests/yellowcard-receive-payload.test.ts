import {
  buildYellowCardDirectSettlementReceivePayload,
  redactYellowCardReceivePayload,
  yellowCardReducedKycEligible,
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
  Deno.test(`Yellow Card production receive uses exact ${settlement.cryptoCurrency}/${settlement.cryptoNetwork} contract`, () => {
    const payload = buildYellowCardDirectSettlementReceivePayload({
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
    assertEqual("forceAccept" in payload, false);
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

Deno.test("Yellow Card production receive fails closed without full KYC", () => {
  assertThrows(() => buildYellowCardDirectSettlementReceivePayload({
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

Deno.test("Yellow Card reduced KYC sends only the documented Tier 0 identity fields", () => {
  const payload = buildYellowCardDirectSettlementReceivePayload({
    sequenceId: "11111111-1111-4111-8111-111111111111",
    channelType: "momo",
    localAmount: 1_000,
    country: "KE",
    currency: "KES",
    reason: "other",
    customerUID: "verified-customer-id",
    kycTier: "reduced",
    recipient: {
      name: "Verified Customer",
      country: "KE",
      email: "verified@example.com",
      phone: "",
      address: "",
      dob: "",
      idNumber: "",
      idType: "",
    },
    source: { accountType: "momo", accountNumber: "+2541111111111", networkId: "network-id" },
    settlementInfo: {
      cryptoCurrency: "USDC",
      cryptoNetwork: "BASE",
      walletAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe",
    },
  }) as any;
  const recipient = payload.recipient as Record<string, unknown>;
  assertEqual(recipient.name, "Verified Customer");
  assertEqual(recipient.country, "KE");
  assertEqual(recipient.email, "verified@example.com");
  for (const forbidden of ["phone", "address", "dob", "idNumber", "idType"]) {
    if (forbidden in recipient) throw new Error(`reduced KYC leaked ${forbidden}`);
  }
});

Deno.test("Yellow Card reduced KYC eligibility is fail closed at every documented boundary", () => {
  const base = {
    direction: "receive" as const,
    currency: "KES",
    usdEquivalent: 19.99,
    missingFullKyc: true,
    coreComplete: true,
  };
  if (!yellowCardReducedKycEligible(base)) throw new Error("eligible Tier 0 receive was rejected");
  for (const currency of ["BWP", "NGN", "ZAR"]) {
    if (yellowCardReducedKycEligible({ ...base, currency })) throw new Error(`${currency} must require full KYC`);
  }
  if (yellowCardReducedKycEligible({ ...base, usdEquivalent: 20 })) throw new Error("USD 20 boundary must require full KYC");
  if (yellowCardReducedKycEligible({ ...base, usdEquivalent: null })) throw new Error("missing rate must require full KYC");
  if (yellowCardReducedKycEligible({ ...base, direction: "payout" })) throw new Error("payout must retain full KYC");
  if (yellowCardReducedKycEligible({ ...base, coreComplete: false })) throw new Error("incomplete core identity must fail closed");
});

Deno.test("Yellow Card receive supports provider channelType auto-routing", () => {
  const payload = buildYellowCardDirectSettlementReceivePayload({
    sequenceId: "53f7c7fa-f2bb-450c-8f6d-9ff0000f0099",
    channelType: "bank",
    localAmount: 1000,
    country: "ET",
    currency: "USD",
    reason: "other",
    customerUID: "user-test",
    recipient: {
      name: "Test User",
    country: "ET",
      phone: "+12222222222",
      address: "Test address",
      dob: "01/02/1990",
      email: "tester@example.com",
      idNumber: "ID-123",
      idType: "license",
    },
    source: { accountType: "bank", accountNumber: "1111111111" },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: "0x1111111111111111111111111111111111111111" },
  });
  assertEqual(payload.channelType, "bank");
  assertEqual(payload.channelId, undefined);
  assertEqual((payload.source as any).networkId, undefined);
});

Deno.test("Yellow Card receive includes a redirect URL for redirect-based channels", () => {
  const payload = buildYellowCardDirectSettlementReceivePayload({
    sequenceId: "11111111-1111-4111-8111-111111111111",
    channelType: "bank",
    localAmount: 5000,
    country: "ZA",
    currency: "ZAR",
    reason: "bills",
    customerUID: "customer-1",
    recipient: {
      name: "Sample Name", country: "ZA", phone: "+27700000000",
      address: "Sample Address", dob: "01/01/1990", email: "sample@example.com",
      idNumber: "0123456789", idType: "license",
    },
    source: { accountType: "bank", accountNumber: "1111111111" },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
    redirectUrl: "https://app.borderpayafrica.com/?screen=receive",
  });
  assertEqual(payload.redirectUrl, "https://app.borderpayafrica.com/?screen=receive");
});

Deno.test("Yellow Card mobile-money receive requires the payer account number", () => {
  assertThrows(() => buildYellowCardDirectSettlementReceivePayload({
    sequenceId: "33333333-3333-4333-8333-333333333333",
    channelType: "momo",
    localAmount: 1_000,
    country: "ZM",
    currency: "ZMW",
    reason: "other",
    customerUID: "verified-zambia-user",
    recipient: {
      name: "Verified Zambia User", country: "ZM", phone: "+260971111111",
      address: "Lusaka", dob: "01/01/1990", email: "verified@example.com",
      idNumber: "ZMB-123", idType: "national_id",
    },
    source: { accountType: "momo", networkId: "zambia-mobile-network" },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }), /yellow_card_missing_source_account_number/);
});

Deno.test("Yellow Card bank receive requires the payer account number", () => {
  assertThrows(() => buildYellowCardDirectSettlementReceivePayload({
    sequenceId: "44444444-4444-4444-8444-444444444444",
    channelType: "bank",
    localAmount: 1_000,
    country: "ZM",
    currency: "ZMW",
    reason: "other",
    customerUID: "verified-zambia-user",
    recipient: {
      name: "Verified Zambia User", country: "ZM", phone: "+260971111111",
      address: "Lusaka", dob: "01/01/1990", email: "verified@example.com",
      idNumber: "ZMB-123", idType: "national_id",
    },
    source: { accountType: "bank" },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }), /yellow_card_missing_source_account_number/);
});

Deno.test("Yellow Card receive rejects KYC from another country", () => {
  assertThrows(() => buildYellowCardDirectSettlementReceivePayload({
    sequenceId: "22222222-2222-4222-8222-222222222222",
    channelType: "bank",
    localAmount: 5000,
    country: "RW",
    currency: "RWF",
    reason: "other",
    customerUID: "customer-1",
    recipient: {
      name: "Kenyan User", country: "KE", phone: "+254700000000",
      address: "Nairobi", dob: "01/01/1990", email: "user@example.com",
      idNumber: "0123456789", idType: "national_id",
    },
    source: { accountType: "bank", accountNumber: "1111111111" },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }), /yellow_card_recipient_country_must_match_receive_country/);
});
