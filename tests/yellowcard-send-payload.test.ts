import {
  buildYellowCardSendPayload,
  redactYellowCardSendPayload,
} from "../supabase/functions/_shared/providers/yellowcard-payload.ts";

const base = () => ({
  sequenceId: "2603f2c2-217e-46ff-b82a-4387924ff5ae",
  channelId: "channel-ke-momo-send",
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
  const payload = buildYellowCardSendPayload(base()) as Record<string, any>;
  if (payload.channelId !== "channel-ke-momo-send") throw new Error("missing exact channelId");
  if ("localAmount" in payload || "amount" in payload) {
    throw new Error("direct-settlement Send must omit amount and localAmount");
  }
  if (payload.channelType) throw new Error("exact corridor Send must not auto-route by channelType");
  if (payload.destination.networkId !== "network-ke-momo") throw new Error("missing exact networkId");
  if (payload.destination.accountType !== "momo") throw new Error("invalid destination accountType");
  if (payload.settlementInfo.cryptoCurrency !== "USDC" || payload.settlementInfo.cryptoNetwork !== "BASE") {
    throw new Error("invalid settlement contract");
  }
});

Deno.test("Yellow Card Send rejects an incomplete corridor body", () => {
  const input = base();
  input.channelId = "";
  let threw = false;
  try {
    buildYellowCardSendPayload(input);
  } catch (error) {
    threw = String(error).includes("yellow_card_missing_channel_id");
  }
  if (!threw) throw new Error("missing channelId must fail closed");
});

Deno.test("Yellow Card Send persistence redacts customer and funding secrets", () => {
  const redacted = redactYellowCardSendPayload(buildYellowCardSendPayload(base())) as Record<string, any>;
  if (redacted.sender.phone !== "[redacted]" || redacted.sender.idNumber !== "[redacted]") {
    throw new Error("sender identity was persisted without redaction");
  }
  if (redacted.destination.accountNumber !== "[redacted]") {
    throw new Error("recipient account was persisted without redaction");
  }
  if (redacted.settlementInfo.refundAddress !== "[redacted]") {
    throw new Error("refund address was persisted without redaction");
  }
});
