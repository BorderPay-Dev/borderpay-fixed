import {
  calculateYellowCardCustomerFee,
  findYellowCardCommercialRail,
} from "../supabase/functions/_shared/providers/yellowcard-commercial-policy.ts";
import {
  buildYellowCardDirectSettlementReceivePayload,
  buildYellowCardDirectSettlementSendPayload,
} from "../supabase/functions/_shared/providers/yellowcard-payload.ts";
import { resolveYellowCardRouting } from "../supabase/functions/_shared/providers/yellowcard-routing.ts";

const SEND_MOMO = "695c718c-aab7-4670-b81f-b1da6191f37f";
const RECEIVE_MOMO = "4f740b63-f327-481e-afe4-79ae4d4d9f9c";
const SEND_BANK = "05ec29bc-a6c0-4045-8ef1-8701fa991d12";
const RECEIVE_BANK = "71764ae2-6620-4e9d-9474-4c94877366b9";
const MOBILE_WALLET = "a67435ea-450e-46b7-9138-4eb4f7c12c1b";

const channels = [
  { id: SEND_MOMO, country: "RW", currency: "RWF", channelType: "momo", rampType: "withdraw", apiStatus: "active", min: 1_500, max: 0 },
  { id: RECEIVE_MOMO, country: "RW", currency: "RWF", channelType: "momo", rampType: "deposit", apiStatus: "active", min: 1_500, max: 0 },
  { id: SEND_BANK, country: "RW", currency: "RWF", channelType: "bank", rampType: "withdraw", apiStatus: "active", min: 1_500, max: 0 },
  { id: RECEIVE_BANK, country: "RW", currency: "RWF", channelType: "bank", rampType: "deposit", apiStatus: "active", min: 1_500, max: 0 },
];

const networks = [{
  id: MOBILE_WALLET,
  name: "Mobile Wallet",
  country: "RW",
  accountNumberType: "phone",
  status: "active",
  channelIds: [SEND_MOMO, RECEIVE_MOMO],
}];

const kyc = {
  name: "Rwanda Test User", country: "RW", phone: "+250111111111",
  address: "Sample Address", dob: "01/01/1990", email: "sandbox@borderpayafrica.com",
  idNumber: "0123456789", idType: "license",
};

const close = (actual: number | null | undefined, expected: number) =>
  typeof actual === "number" && Math.abs(actual - expected) < 0.000001;

Deno.test("Rwanda mobile money uses the exact linked send and receive channels", () => {
  for (const [direction, channelId] of [["payout", SEND_MOMO], ["receive", RECEIVE_MOMO]] as const) {
    const route = resolveYellowCardRouting({ channels, networks, direction, country: "RW", currency: "RWF", rail: "mobile_money", networkId: MOBILE_WALLET, amount: 5_000 });
    if (route.selectedChannel?.id !== channelId || route.selectedNetwork?.id !== MOBILE_WALLET) {
      throw new Error(`wrong Rwanda ${direction} route: ${JSON.stringify(route)}`);
    }
  }
});

Deno.test("Rwanda bank is not declared executable without a linked bank network", () => {
  const send = resolveYellowCardRouting({ channels, networks, direction: "payout", country: "RW", currency: "RWF", rail: "bank", amount: 5_000 });
  if (send.selectedNetwork || !send.selectedChannel) throw new Error(`unexpected Rwanda bank discovery: ${JSON.stringify(send)}`);
});

Deno.test("Rwanda mobile money enforces the 1500 RWF provider minimum", () => {
  for (const direction of ["receive", "payout"] as const) {
    const low = resolveYellowCardRouting({ channels, networks, direction, country: "RW", currency: "RWF", rail: "mobile_money", networkId: MOBILE_WALLET, amount: 1_499 });
    const valid = resolveYellowCardRouting({ channels, networks, direction, country: "RW", currency: "RWF", rail: "mobile_money", networkId: MOBILE_WALLET, amount: 5_000 });
    if (low.amountAvailable || !valid.amountAvailable) throw new Error(`Rwanda ${direction} limits drifted`);
  }
});

Deno.test("Rwanda mobile-money fees use the PDF plus BorderPay markup", () => {
  const receiveRail = findYellowCardCommercialRail({ direction: "receive", countryCode: "RW", currency: "RWF", channel: "mobile_money" });
  const sendRail = findYellowCardCommercialRail({ direction: "payout", countryCode: "RW", currency: "RWF", channel: "mobile_money" });
  if (!receiveRail || !sendRail) throw new Error("Rwanda mobile-money pricing missing");
  const receive = calculateYellowCardCustomerFee(receiveRail, 5_000);
  const send = calculateYellowCardCustomerFee(sendRail, 5_000);
  if (!close(receive?.provider_fee_percent, 3.02) || !close(receive?.customer_fee_percent, 5.02) || !close(receive?.provider_amount_local, 300) || !close(receive?.borderpay_amount_local, 150) || !close(receive?.customer_amount_local, 450)) {
    throw new Error(`wrong Rwanda receive fee: ${JSON.stringify(receive)}`);
  }
  if (!close(send?.provider_fee_percent, 3.02) || !close(send?.customer_fee_percent, 5.02) || !close(send?.customer_amount_local, 251)) {
    throw new Error(`wrong Rwanda send fee: ${JSON.stringify(send)}`);
  }
});

Deno.test("Rwanda mobile-money bodies contain the exact provider route", () => {
  const send = buildYellowCardDirectSettlementSendPayload({
    sequenceId: "77777777-7777-4777-8777-777777777777", channelId: SEND_MOMO, localAmount: 5_000,
    country: "RW", currency: "RWF", reason: "other", customerUID: "rwanda-tester", sender: kyc,
    destination: { accountName: "Sandbox Recipient", accountNumber: "+2501111111111", accountType: "momo", networkId: MOBILE_WALLET },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", cryptoAmount: 10, refundAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }) as Record<string, any>;
  const receive = buildYellowCardDirectSettlementReceivePayload({
    sequenceId: "88888888-8888-4888-8888-888888888888", channelId: RECEIVE_MOMO, localAmount: 5_000,
    country: "RW", currency: "RWF", reason: "other", customerUID: "rwanda-tester", recipient: kyc,
    source: { accountType: "momo", accountNumber: "+2501111111111", networkId: MOBILE_WALLET },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }) as Record<string, any>;
  if (send.channelId !== SEND_MOMO || send.destination.networkId !== MOBILE_WALLET || "localAmount" in send || "amount" in send) throw new Error(`wrong Rwanda send body: ${JSON.stringify(send)}`);
  if (receive.channelId !== RECEIVE_MOMO || receive.source.networkId !== MOBILE_WALLET || receive.localAmount !== 5_000 || "amount" in receive) throw new Error(`wrong Rwanda receive body: ${JSON.stringify(receive)}`);
});
