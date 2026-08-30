import {
  calculateYellowCardCustomerFee,
  findYellowCardCommercialRail,
} from "../supabase/functions/_shared/providers/yellowcard-commercial-policy.ts";
import {
  buildYellowCardDirectSettlementReceivePayload,
  buildYellowCardDirectSettlementSendPayload,
} from "../supabase/functions/_shared/providers/yellowcard-payload.ts";
import { resolveYellowCardRouting } from "../supabase/functions/_shared/providers/yellowcard-routing.ts";

const SEND_P2P = "fe8f4989-3bf6-41ca-9621-ffe2bc127569";
const RECEIVE_P2P = "af944f0c-ba70-47c7-86dc-1bad5a6ab4e4";
const API_BANK_SEND = "2f156ffd-d4c6-477d-b0a2-02c646efd7a9";
const ACCESS_BANK = "5f1af11b-305f-4420-8fce-65ed2725a409";

const channels = [
  { id: SEND_P2P, country: "NG", currency: "NGN", channelType: "p2p", rampType: "withdraw", apiStatus: "active", min: 1_800, max: 30_000_000 },
  { id: RECEIVE_P2P, country: "NG", currency: "NGN", channelType: "p2p", rampType: "deposit", apiStatus: "active", min: 2_500, max: 5_000_000 },
  { id: API_BANK_SEND, country: "NG", currency: "NGN", channelType: "bank", rampType: "withdraw", apiStatus: "active", min: 0, max: 0 },
];

const networks = [{
  id: ACCESS_BANK,
  name: "Access Bank",
  code: "044",
  country: "NG",
  accountNumberType: "bank",
  status: "active",
  channelIds: [SEND_P2P, RECEIVE_P2P, API_BANK_SEND],
}];

const kyc = {
  name: "Nigeria Test User", country: "NG", phone: "+2341111111111",
  address: "Sample Address", dob: "01/01/1990", email: "sandbox@borderpayafrica.com",
  idNumber: "0123456789", idType: "license",
};

const close = (actual: number | null | undefined, expected: number) =>
  typeof actual === "number" && Math.abs(actual - expected) < 0.000001;

Deno.test("Nigeria bank routes through the exact P2P send and receive channels", () => {
  for (const [direction, channelId] of [["payout", SEND_P2P], ["receive", RECEIVE_P2P]] as const) {
    const route = resolveYellowCardRouting({ channels, networks, direction, country: "NG", currency: "NGN", rail: "bank", networkId: ACCESS_BANK, amount: 5_000 });
    if (route.selectedChannel?.id !== channelId || route.selectedNetwork?.id !== ACCESS_BANK) {
      throw new Error(`wrong Nigeria ${direction} route: ${JSON.stringify(route)}`);
    }
  }
});

Deno.test("Nigeria 5000 NGN certification amount is inside both P2P channel limits", () => {
  const send = channels.find((row) => row.id === SEND_P2P);
  const receive = channels.find((row) => row.id === RECEIVE_P2P);
  if (!send || !receive || 5_000 < send.min || 5_000 > send.max || 5_000 < receive.min || 5_000 > receive.max) {
    throw new Error("Nigeria certification amount is outside the P2P provider limits");
  }
});

Deno.test("Nigeria fees use the signed PDF plus BorderPay markup", () => {
  const receiveRail = findYellowCardCommercialRail({ direction: "receive", countryCode: "NG", currency: "NGN", channel: "bank" });
  const sendRail = findYellowCardCommercialRail({ direction: "payout", countryCode: "NG", currency: "NGN", channel: "bank" });
  if (!receiveRail || !sendRail) throw new Error("Nigeria pricing missing");
  const receive = calculateYellowCardCustomerFee(receiveRail, 5_000);
  const send = calculateYellowCardCustomerFee(sendRail, 5_000);
  if (!close(receive?.provider_fee_percent, 0.89) || !close(receive?.customer_fee_percent, 2.89) || !close(receive?.provider_amount_local, 100) || !close(receive?.borderpay_amount_local, 50) || !close(receive?.customer_amount_local, 150)) {
    throw new Error(`wrong Nigeria receive fee: ${JSON.stringify(receive)}`);
  }
  if (!close(send?.provider_fee_local, 103.75) || !close(send?.customer_fee_local, 155.625) || !close(send?.borderpay_amount_local, 51.875) || !close(send?.customer_amount_local, 155.625)) {
    throw new Error(`wrong Nigeria send fee: ${JSON.stringify(send)}`);
  }
});

Deno.test("Nigeria generated bodies contain the exact P2P bank route", () => {
  const send = buildYellowCardDirectSettlementSendPayload({
    sequenceId: "99999999-9999-4999-8999-999999999999", channelId: SEND_P2P, localAmount: 5_000,
    country: "NG", currency: "NGN", reason: "other", customerUID: "nigeria-tester", sender: kyc,
    destination: { accountName: "Sandbox Recipient", accountNumber: "1111111111", accountType: "bank", networkId: ACCESS_BANK },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", cryptoAmount: 10, refundAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }) as Record<string, any>;
  const receive = buildYellowCardDirectSettlementReceivePayload({
    sequenceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", channelId: RECEIVE_P2P, localAmount: 5_000,
    country: "NG", currency: "NGN", reason: "other", customerUID: "nigeria-tester", recipient: kyc,
    source: { accountType: "bank", accountNumber: "1111111111", networkId: ACCESS_BANK },
    settlementInfo: { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
  }) as Record<string, any>;
  if (send.channelId !== SEND_P2P || send.destination.networkId !== ACCESS_BANK || "localAmount" in send || "amount" in send) throw new Error(`wrong Nigeria send body: ${JSON.stringify(send)}`);
  if (receive.channelId !== RECEIVE_P2P || receive.source.networkId !== ACCESS_BANK || receive.localAmount !== 5_000 || "amount" in receive) throw new Error(`wrong Nigeria receive body: ${JSON.stringify(receive)}`);
});
