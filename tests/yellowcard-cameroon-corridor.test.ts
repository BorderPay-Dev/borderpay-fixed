import {
  calculateYellowCardCustomerFee,
  findYellowCardCommercialRail,
} from "../supabase/functions/_shared/providers/yellowcard-commercial-policy.ts";
import {
  buildYellowCardReceivePayload,
  buildYellowCardSendPayload,
} from "../supabase/functions/_shared/providers/yellowcard-payload.ts";
import { resolveYellowCardRouting } from "../supabase/functions/_shared/providers/yellowcard-routing.ts";

const RECEIVE_CHANNEL = "79da4d6e-1c42-4aac-ae7d-422730528f96";
const SEND_CHANNEL = "353b1e71-f6f1-48f5-bc11-26af091c62fd";
const INACTIVE_SEND_CHANNEL = "402fd1e6-935e-45ff-a39d-2a5b7a57f2cc";
const API_ONLY_BANK_SEND = "218a9dfe-5031-46c9-a0a7-1a578cfb2f2d";
const API_ONLY_BANK_RECEIVE = "bd64a5e7-7e16-4459-aaab-4c349bc615d7";
const MOBILE_WALLET = "cc2883ed-e431-444d-9264-8b7c1684b998";

const channels = [
  { id: RECEIVE_CHANNEL, country: "CM", currency: "XAF", channelType: "momo", rampType: "deposit", apiStatus: "active", min: 1_000, max: 1_000_000 },
  { id: SEND_CHANNEL, country: "CM", currency: "XAF", channelType: "momo", rampType: "withdraw", apiStatus: "active", min: 1_000, max: 0 },
  { id: INACTIVE_SEND_CHANNEL, country: "CM", currency: "XAF", channelType: "momo", rampType: "withdraw", apiStatus: "inactive", min: 1_000, max: 1_000_000 },
  { id: API_ONLY_BANK_SEND, country: "CM", currency: "XAF", channelType: "bank", rampType: "withdraw", apiStatus: "active", min: 1_000, max: 1_000_000 },
  { id: API_ONLY_BANK_RECEIVE, country: "CM", currency: "XAF", channelType: "bank", rampType: "deposit", apiStatus: "active", min: 1_000, max: 0 },
];

const networks = [{
  id: MOBILE_WALLET,
  name: "Mobile Wallet",
  country: "CM",
  accountNumberType: "phone",
  status: "active",
  channelIds: [RECEIVE_CHANNEL, SEND_CHANNEL],
}];

const kyc = {
  name: "Successful Sample Name",
  country: "US",
  phone: "+12222222222",
  address: "Sample Address",
  dob: "01/01/1990",
  email: "sandbox@borderpayafrica.com",
  idNumber: "0123456789",
  idType: "license",
};

const close = (actual: number | null | undefined, expected: number) =>
  typeof actual === "number" && Math.abs(actual - expected) < 0.000001;

Deno.test("Cameroon routes only the active linked Mobile Wallet send and receive channels", () => {
  for (const [direction, channelId] of [["payout", SEND_CHANNEL], ["receive", RECEIVE_CHANNEL]] as const) {
    const route = resolveYellowCardRouting({
      channels,
      networks,
      direction,
      country: "CM",
      currency: "XAF",
      rail: "mobile_money",
      networkId: MOBILE_WALLET,
      amount: 5_000,
    });
    if (route.selectedChannel?.id !== channelId || route.selectedNetwork?.id !== MOBILE_WALLET) {
      throw new Error(`wrong Cameroon ${direction} route: ${JSON.stringify(route)}`);
    }
    if (route.channels.some((row) => row.id === INACTIVE_SEND_CHANNEL)) {
      throw new Error("inactive Cameroon channel became executable");
    }
  }
});

Deno.test("Cameroon bank routes returned by the API remain excluded by the signed PDF", () => {
  for (const direction of ["receive", "payout"] as const) {
    if (findYellowCardCommercialRail({ direction, countryCode: "CM", currency: "XAF", channel: "bank" })) {
      throw new Error(`Cameroon ${direction} bank route must not be offered`);
    }
  }
});

Deno.test("Cameroon applies provider limits exactly", () => {
  const receiveLow = resolveYellowCardRouting({ channels, networks, direction: "receive", country: "CM", currency: "XAF", rail: "mobile_money", networkId: MOBILE_WALLET, amount: 999 });
  const receiveHigh = resolveYellowCardRouting({ channels, networks, direction: "receive", country: "CM", currency: "XAF", rail: "mobile_money", networkId: MOBILE_WALLET, amount: 1_000_001 });
  const sendLow = resolveYellowCardRouting({ channels, networks, direction: "payout", country: "CM", currency: "XAF", rail: "mobile_money", networkId: MOBILE_WALLET, amount: 999 });
  const sendHigh = resolveYellowCardRouting({ channels, networks, direction: "payout", country: "CM", currency: "XAF", rail: "mobile_money", networkId: MOBILE_WALLET, amount: 2_000_000 });
  if (receiveLow.amountAvailable || receiveHigh.amountAvailable || sendLow.amountAvailable || !sendHigh.amountAvailable) {
    throw new Error("Cameroon amount limits drifted");
  }
});

Deno.test("Cameroon fees use PDF pricing plus BorderPay markup and doubled minimum", () => {
  const receiveRail = findYellowCardCommercialRail({ direction: "receive", countryCode: "CM", currency: "XAF", channel: "mobile_money" });
  const sendRail = findYellowCardCommercialRail({ direction: "payout", countryCode: "CM", currency: "XAF", channel: "mobile_money" });
  if (!receiveRail || !sendRail) throw new Error("Cameroon commercial rails missing");
  const receive = calculateYellowCardCustomerFee(receiveRail, 5_000);
  const send = calculateYellowCardCustomerFee(sendRail, 5_000);
  if (!close(receive?.provider_fee_percent, 1.82) || !close(receive?.customer_fee_percent, 3.82) || !close(receive?.customer_amount_local, 191)) {
    throw new Error(`wrong Cameroon receive fee: ${JSON.stringify(receive)}`);
  }
  if (!close(send?.provider_fee_percent, 1.02) || !close(send?.customer_fee_percent, 3.02) || !close(send?.customer_minimum_fee_local, 1_312) || !close(send?.customer_amount_local, 1_312)) {
    throw new Error(`wrong Cameroon send fee: ${JSON.stringify(send)}`);
  }
});

Deno.test("Cameroon generated send and receive bodies contain exact route parameters", () => {
  const send = buildYellowCardSendPayload({
    sequenceId: "33333333-3333-4333-8333-333333333333",
    channelId: SEND_CHANNEL,
    localAmount: 5_000,
    country: "CM",
    currency: "XAF",
    reason: "other",
    customerUID: "cameroon-tester",
    sender: kyc,
    destination: { accountName: "Sandbox Recipient", accountNumber: "+2371111111111", accountType: "momo", networkId: MOBILE_WALLET },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", cryptoAmount: 10, refundAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }) as Record<string, any>;
  const receive = buildYellowCardReceivePayload({
    sequenceId: "44444444-4444-4444-8444-444444444444",
    channelId: RECEIVE_CHANNEL,
    localAmount: 5_000,
    country: "CM",
    currency: "XAF",
    reason: "other",
    customerUID: "cameroon-tester",
    recipient: kyc,
    source: { accountType: "momo", accountNumber: "+2371111111111", networkId: MOBILE_WALLET },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }) as Record<string, any>;
  if (send.channelId !== SEND_CHANNEL || send.destination.networkId !== MOBILE_WALLET || "localAmount" in send || "amount" in send) {
    throw new Error(`wrong Cameroon send body: ${JSON.stringify(send)}`);
  }
  if (receive.channelId !== RECEIVE_CHANNEL || receive.source.networkId !== MOBILE_WALLET || receive.localAmount !== 5_000 || "amount" in receive) {
    throw new Error(`wrong Cameroon receive body: ${JSON.stringify(receive)}`);
  }
});
