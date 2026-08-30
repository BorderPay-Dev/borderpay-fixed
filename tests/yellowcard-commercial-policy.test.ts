import {
  findYellowCardCommercialRail,
  listYellowCardCommercialRails,
} from "../supabase/functions/_shared/providers/yellowcard-commercial-policy.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("Yellow Card 2026 document is the only African send catalog", () => {
  const rows = listYellowCardCommercialRails("payout");
  const countries = [...new Set(rows.map((row) => row.country_code))].sort();
  assert(countries.length === 21, `expected 21 Yellow Card send countries, got ${countries.length}`);
  assert(countries.includes("CD"), "DR Congo must be present for send");
  assert(!countries.includes("GH"), "Ghana is not in the July 8, 2026 Yellow Card send schedule");
  assert(rows.every((row) => row.provider === "yellow_card"), "legacy providers must not enter the catalog");
});

Deno.test("DR Congo is send-only mobile money in the Yellow Card document", () => {
  assert(Boolean(findYellowCardCommercialRail({
    direction: "payout", countryCode: "CD", currency: "CDF", channel: "mobile_money",
  })), "DR Congo mobile money send rail missing");
  assert(!findYellowCardCommercialRail({
    direction: "payout", countryCode: "CD", currency: "CDF", channel: "bank",
  }), "DR Congo bank send must not be invented");
  assert(listYellowCardCommercialRails("receive", "CD").length === 0, "DR Congo receive is not contracted");
});

Deno.test("receive catalog can only return the account region", () => {
  const kenya = listYellowCardCommercialRails("receive", "KE");
  assert(kenya.length === 2, "Kenya must expose bank and mobile money receive rails");
  assert(kenya.every((row) => row.country_code === "KE"), "Kenya receive leaked another country");
  const nigeria = listYellowCardCommercialRails("receive", "NG");
  assert(nigeria.length === 1 && nigeria[0].channel === "bank", "Nigeria receive must be bank only");
  assert(listYellowCardCommercialRails("receive", "GB").length === 0, "UK accounts must not receive via African rails");
});

Deno.test("signed schedule exposes all contracted countries without inventing receive rails", () => {
  const receive = [...new Set(listYellowCardCommercialRails("receive").map((row) => row.country_code))];
  const send = [...new Set(listYellowCardCommercialRails("payout").map((row) => row.country_code))];
  assert(receive.length === 19, `expected 19 signed Receive countries, got ${receive.length}`);
  assert(send.length === 21, `expected 21 signed Send countries, got ${send.length}`);
  assert(!receive.includes("CD") && !receive.includes("ET"), "Send-only countries leaked into Receive");
});
