import {
  calculateYellowCardCustomerFee,
  findYellowCardCommercialRail,
} from "../supabase/functions/_shared/providers/yellowcard-commercial-policy.ts";
import {
  buildYellowCardDirectSettlementReceivePayload,
  buildYellowCardDirectSettlementSendPayload,
} from "../supabase/functions/_shared/providers/yellowcard-payload.ts";
import { resolveYellowCardRouting } from "../supabase/functions/_shared/providers/yellowcard-routing.ts";

const SEND_CHANNEL = "33a82864-6460-43d7-9fc0-911f9bd8d50a";
const RECEIVE_CHANNEL = "2452c27c-7c49-442c-b6f8-cde03f03f9ba";
const API_ONLY_BANK_SEND = "0a9df144-564e-474e-a920-2f636000c4ce";
const API_ONLY_BANK_RECEIVE = "df908115-1cba-4c09-ab21-e9e34f76809e";
const WAVE = "8d18204e-b51f-4554-815d-71586d0dac13";

const channels = [
  { id: SEND_CHANNEL, country: "CI", currency: "XOF", channelType: "momo", rampType: "withdraw", apiStatus: "active", min: 500, max: 1_500_000 },
  { id: RECEIVE_CHANNEL, country: "CI", currency: "XOF", channelType: "momo", rampType: "deposit", apiStatus: "active", min: 500, max: 1_500_000 },
  { id: API_ONLY_BANK_SEND, country: "CI", currency: "XOF", channelType: "bank", rampType: "withdraw", apiStatus: "active", min: 500, max: 0 },
  { id: API_ONLY_BANK_RECEIVE, country: "CI", currency: "XOF", channelType: "bank", rampType: "deposit", apiStatus: "active", min: 500, max: 0 },
];

const networks = [{
  id: WAVE,
  name: "Wave",
  country: "CI",
  accountNumberType: "phone",
  status: "active",
  channelIds: [SEND_CHANNEL, RECEIVE_CHANNEL],
}];

const kyc = {
  name: "Successful Sample Name",
  country: "CI",
  phone: "+12222222222",
  address: "Sample Address",
  dob: "01/01/1990",
  email: "sandbox@borderpayafrica.com",
  idNumber: "0123456789",
  idType: "license",
};

const close = (actual: number | null | undefined, expected: number) =>
  typeof actual === "number" && Math.abs(actual - expected) < 0.000001;

Deno.test("Ivory Coast routes Wave through the exact active send and receive channels", () => {
  for (const [direction, channelId] of [["payout", SEND_CHANNEL], ["receive", RECEIVE_CHANNEL]] as const) {
    const route = resolveYellowCardRouting({ channels, networks, direction, country: "CI", currency: "XOF", rail: "mobile_money", networkId: WAVE, amount: 5_000 });
    if (route.selectedChannel?.id !== channelId || route.selectedNetwork?.id !== WAVE) {
      throw new Error(`wrong Ivory Coast ${direction} route: ${JSON.stringify(route)}`);
    }
  }
});

Deno.test("Ivory Coast excludes API bank channels because the signed PDF authorizes mobile money", () => {
  for (const direction of ["receive", "payout"] as const) {
    if (findYellowCardCommercialRail({ direction, countryCode: "CI", currency: "XOF", channel: "bank" })) {
      throw new Error(`Ivory Coast ${direction} bank route must not be offered`);
    }
  }
});

Deno.test("Ivory Coast enforces Yellow Card Wave limits", () => {
  for (const direction of ["receive", "payout"] as const) {
    const low = resolveYellowCardRouting({ channels, networks, direction, country: "CI", currency: "XOF", rail: "mobile_money", networkId: WAVE, amount: 499 });
    const high = resolveYellowCardRouting({ channels, networks, direction, country: "CI", currency: "XOF", rail: "mobile_money", networkId: WAVE, amount: 1_500_001 });
    if (low.amountAvailable || high.amountAvailable) throw new Error(`Ivory Coast ${direction} limits drifted`);
  }
});

Deno.test("Ivory Coast fees use the signed PDF plus BorderPay markup", () => {
  const receiveRail = findYellowCardCommercialRail({ direction: "receive", countryCode: "CI", currency: "XOF", channel: "mobile_money" });
  const sendRail = findYellowCardCommercialRail({ direction: "payout", countryCode: "CI", currency: "XOF", channel: "mobile_money" });
  if (!receiveRail || !sendRail) throw new Error("Ivory Coast commercial rails missing");
  const receive = calculateYellowCardCustomerFee(receiveRail, 5_000);
  const send = calculateYellowCardCustomerFee(sendRail, 5_000);
  if (!close(receive?.provider_fee_percent, 2.22) || !close(receive?.customer_fee_percent, 4.22) || !close(receive?.customer_amount_local, 211)) {
    throw new Error(`wrong Ivory Coast receive fee: ${JSON.stringify(receive)}`);
  }
  if (!close(send?.provider_fee_percent, 1.82) || !close(send?.customer_fee_percent, 3.82) || !close(send?.customer_amount_local, 191)) {
    throw new Error(`wrong Ivory Coast send fee: ${JSON.stringify(send)}`);
  }
});

Deno.test("Ivory Coast generated bodies contain exact Wave parameters", () => {
  const send = buildYellowCardDirectSettlementSendPayload({
    sequenceId: "55555555-5555-4555-8555-555555555555", channelId: SEND_CHANNEL, localAmount: 5_000,
    country: "CI", currency: "XOF", reason: "other", customerUID: "ivory-coast-tester", sender: kyc,
    destination: { accountName: "Sandbox Recipient", accountNumber: "+2251111111111", accountType: "momo", networkId: WAVE },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", cryptoAmount: 10, refundAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }) as Record<string, any>;
  const receive = buildYellowCardDirectSettlementReceivePayload({
    sequenceId: "66666666-6666-4666-8666-666666666666", channelId: RECEIVE_CHANNEL, localAmount: 5_000,
    country: "CI", currency: "XOF", reason: "other", customerUID: "ivory-coast-tester", recipient: kyc,
    source: { accountType: "momo", accountNumber: "+2251111111111", networkId: WAVE },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }) as Record<string, any>;
  if (send.channelId !== SEND_CHANNEL || send.destination.networkId !== WAVE || "localAmount" in send || "amount" in send) throw new Error(`wrong Ivory Coast send body: ${JSON.stringify(send)}`);
  if (receive.channelId !== RECEIVE_CHANNEL || receive.source.networkId !== WAVE || receive.localAmount !== 5_000 || "amount" in receive) throw new Error(`wrong Ivory Coast receive body: ${JSON.stringify(receive)}`);
});
