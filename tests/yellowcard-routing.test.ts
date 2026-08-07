import { resolveYellowCardRouting } from "../supabase/functions/_shared/providers/yellowcard-routing.ts";

const channel = (overrides: Record<string, unknown> = {}) => ({
  id: "channel-1",
  country: "KE",
  currency: "KES",
  channelType: "momo",
  rampType: "withdraw",
  apiStatus: "active",
  min: 1,
  max: 1_000_000,
  ...overrides,
});

const network = (overrides: Record<string, unknown> = {}) => ({
  id: "network-1",
  country: "KE",
  name: "Mobile Wallet",
  accountNumberType: "phone",
  status: "active",
  channelIds: ["channel-1"],
  ...overrides,
});

Deno.test("channelType routing accepts an active country network even when sandbox channelIds drift", () => {
  const result = resolveYellowCardRouting({
    channels: [channel()],
    networks: [network({ channelIds: ["stale-channel-id"] })],
    direction: "payout",
    country: "KE",
    currency: "KES",
    rail: "mobile_money",
    networkId: "network-1",
    amount: 25_620,
  });
  if (!result.selectedChannel || !result.selectedNetwork || !result.networkAvailable) {
    throw new Error(`expected channelType auto-routing, got ${JSON.stringify(result)}`);
  }
});

Deno.test("bank routing treats Yellow Card EFT and P2P channels as bank", () => {
  for (const channelType of ["bank", "eft", "p2p"]) {
    const result = resolveYellowCardRouting({
      channels: [channel({ country: "ET", currency: "USD", channelType })],
      networks: [network({ country: "ET", accountNumberType: "bank" })],
      direction: "payout",
      country: "ET",
      currency: "USD",
      rail: "bank",
    });
    if (!result.channelAvailable || !result.networkAvailable) {
      throw new Error(`expected ${channelType} bank routing`);
    }
  }
});

Deno.test("bank routing accepts Yellow Card account networks and ISO-3 country codes", () => {
  const result = resolveYellowCardRouting({
    channels: [channel({ country: "ETH", currency: "USD", channelType: "bank" })],
    networks: [network({ country: "ETH", accountNumberType: "account" })],
    direction: "payout",
    country: "ET",
    currency: "USD",
    rail: "bank",
  });
  if (!result.channelAvailable || !result.networkAvailable) {
    throw new Error("expected ISO-3 account network to map to the Ethiopia bank corridor");
  }
});

Deno.test("provider availability fails closed for inactive or missing networks", () => {
  const inactive = resolveYellowCardRouting({
    channels: [channel()],
    networks: [network({ status: "inactive" })],
    direction: "payout",
    country: "KE",
    currency: "KES",
    rail: "mobile_money",
  });
  if (!inactive.channelAvailable || inactive.networkAvailable) {
    throw new Error("inactive provider networks must not become executable");
  }
});

Deno.test("provider limits are evaluated across all active auto-routed channels", () => {
  const result = resolveYellowCardRouting({
    channels: [channel({ id: "low", max: 100 }), channel({ id: "high", min: 101, max: 1_000_000 })],
    networks: [network()],
    direction: "payout",
    country: "KE",
    currency: "KES",
    rail: "mobile_money",
    amount: 500,
  });
  if (result.selectedChannel?.id !== "high") throw new Error("expected the amount-compatible channel");
});

Deno.test("routing accepts Yellow Card array and wrapped response shapes", () => {
  const result = resolveYellowCardRouting({
    channels: { data: { channels: [channel()] } },
    networks: { data: { networks: [network()] } },
    direction: "payout",
    country: "KE",
    currency: "KES",
    rail: "mobile_money",
  });
  if (!result.channelAvailable || !result.networkAvailable) {
    throw new Error("wrapped Yellow Card responses were not normalized");
  }
});
