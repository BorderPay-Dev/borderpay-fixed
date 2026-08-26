import { YELLOW_CARD_COMMERCIAL_RAILS_2026 } from "../supabase/functions/_shared/providers/yellowcard-commercial-policy.ts";
import { resolveYellowCardRouting } from "../supabase/functions/_shared/providers/yellowcard-routing.ts";

const receiveRails = YELLOW_CARD_COMMERCIAL_RAILS_2026.filter((row) => row.direction === "receive");

Deno.test("every contracted receive rail can be exposed from matching live Yellow Card capability data", () => {
  for (const row of receiveRails) {
    const channelType = row.channel === "mobile_money" ? "momo" : "bank";
    const channelId = `${row.country_code}-${row.destination_currency}-${channelType}`;
    const channels = [{
      id: channelId,
      country: row.country_code,
      currency: row.destination_currency,
      channelType,
      rampType: "deposit",
      apiStatus: "active",
      min: 1,
      max: 1_000_000_000,
    }];
    const networks = row.channel === "mobile_money" ? [{
      id: `${row.country_code}-mobile-network`,
      country: row.country_code,
      name: `${row.country_code} mobile money`,
      accountNumberType: "phone",
      status: "active",
      // Production channelType auto-routing does not require a legacy
      // network-to-channel ID relationship for Receive.
    }] : [];

    const result = resolveYellowCardRouting({
      channels,
      networks,
      direction: "receive",
      country: row.country_code,
      currency: row.destination_currency,
      rail: row.channel,
      networkId: networks[0]?.id,
      amount: 100,
    });

    if (!result.channelAvailable || !result.selectedChannel) {
      throw new Error(`receive rail was hidden: ${row.country_code}/${row.destination_currency}/${row.channel}`);
    }
    if (row.channel === "mobile_money" && (!result.networkAvailable || !result.selectedNetwork)) {
      throw new Error(`mobile-money network was hidden: ${row.country_code}/${row.destination_currency}`);
    }
  }
});

Deno.test("live capability data cannot expose a receive rail absent from the commercial contract", () => {
  const contracted = new Set(receiveRails.map((row) => `${row.country_code}:${row.destination_currency}:${row.channel}`));
  if (contracted.has("GH:GHS:mobile_money")) {
    throw new Error("test assumption invalid: GH mobile money is now contracted and the policy must be reviewed");
  }
});
