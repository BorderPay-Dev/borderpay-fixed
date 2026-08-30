import {
  buildYellowCardDirectSettlementSendPayload,
  parseYellowCardDirectSettlementSendInstruction,
} from "../supabase/functions/_shared/providers/yellowcard-payload.ts";

const base = () => ({
  sequenceId: "2603f2c2-217e-46ff-b82a-4387924ff5ae",
  channelType: "momo" as const,
  localAmount: 12_810,
  country: "KE",
  currency: "KES",
  reason: "other",
  customerUID: "tester-user-id",
  sender: {
    name: "Successful Sample Name",
    country: "KE",
    phone: "+254700000000",
    address: "Sample Address",
    dob: "01/01/1990",
    email: "sandbox@borderpayafrica.com",
    idNumber: "0123456789",
    idType: "license",
  },
  destination: {
    accountName: "Sandbox Recipient",
    accountNumber: "+2541111111111",
    accountType: "momo" as const,
    networkId: "network-ke-momo",
  },
  settlementInfo: {
    cryptoCurrency: "USDC" as const,
    cryptoNetwork: "BASE" as const,
    cryptoAmount: 100,
    refundAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe",
  },
});

Deno.test("Yellow Card Send payload follows the exact selected corridor", () => {
  const payload = buildYellowCardDirectSettlementSendPayload(base()) as Record<string, any>;
  if ("forceAccept" in payload) throw new Error("simulator-only forceAccept leaked into production Send");
  if (payload.channelType !== "momo") throw new Error("missing provider-selected channelType");
  if ("localAmount" in payload || "amount" in payload) {
    throw new Error("direct-settlement Send must omit amount and localAmount");
  }
  if (payload.channelId) throw new Error("Send must not pin provider channelId");
  if (payload.destination.networkId !== "network-ke-momo") throw new Error("missing exact networkId");
  if (payload.destination.accountType !== "momo") throw new Error("invalid destination accountType");
  if (payload.settlementInfo.cryptoCurrency !== "USDC" || payload.settlementInfo.cryptoNetwork !== "BASE") {
    throw new Error("invalid settlement contract");
  }
});

Deno.test("Yellow Card Send rejects an incomplete corridor body", () => {
  const input = base();
  delete (input as any).channelType;
  let threw = false;
  try {
    buildYellowCardDirectSettlementSendPayload(input);
  } catch (error) {
    threw = String(error).includes("yellow_card_missing_channel_routing");
  }
  if (!threw) throw new Error("missing channel routing must fail closed");
});

Deno.test("Yellow Card business Send uses institution identity", () => {
  const payload = buildYellowCardDirectSettlementSendPayload({
    ...base(),
    customerType: "institution",
    sender: { businessName: "Example Limited", businessId: "REG-123" },
  }) as Record<string, any>;
  if (payload.customerType !== "institution") throw new Error("business sender classified as retail");
  if (payload.sender.businessName !== "Example Limited" || payload.sender.businessId !== "REG-123") {
    throw new Error("institution identity missing");
  }
  if ("dob" in payload.sender || "idNumber" in payload.sender) {
    throw new Error("retail identity leaked into institution payload");
  }
});

Deno.test("Yellow Card funding instruction must match the reserved Send intent", () => {
  const input = base();
  const instruction = parseYellowCardDirectSettlementSendInstruction({
    id: "provider-send-1",
    sequenceId: input.sequenceId,
    settlementInfo: {
      cryptoCurrency: "USDC",
      cryptoNetwork: "BASE",
      cryptoAmount: 100,
      walletAddress: "0x1111111111111111111111111111111111111111",
      expiresAt: "2030-01-01T00:00:00.000Z",
    },
  }, input, Date.parse("2026-08-27T00:00:00.000Z"));
  if (instruction.providerTransactionId !== "provider-send-1") throw new Error("provider id missing");
  if (instruction.walletAddress !== "0x1111111111111111111111111111111111111111") {
    throw new Error("funding destination missing");
  }
});

Deno.test("Yellow Card funding instruction fails closed on mismatched correlation or amount", () => {
  const input = base();
  for (const response of [
    {
      id: "provider-send-1",
      sequenceId: "wrong-sequence",
      settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", cryptoAmount: 100, walletAddress: "0x1", expiresAt: "2030-01-01T00:00:00Z" },
    },
    {
      id: "provider-send-1",
      sequenceId: input.sequenceId,
      settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", cryptoAmount: 99, walletAddress: "0x1", expiresAt: "2030-01-01T00:00:00Z" },
    },
  ]) {
    let threw = false;
    try {
      parseYellowCardDirectSettlementSendInstruction(response, input, Date.parse("2026-08-27T00:00:00Z"));
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("mismatched provider instruction must be rejected");
  }
});
