import {
  calculateYellowCardCustomerFee,
  findYellowCardCommercialRail,
  YELLOW_CARD_COMMERCIAL_RAILS_2026,
} from "../supabase/functions/_shared/providers/yellowcard-commercial-policy.ts";
import { convertYellowCardLocalFeeToFunding } from "../utils/fees/yellowCardMath.ts";

function fee(direction: "receive" | "payout", countryCode: string, currency: string, channel: "bank" | "mobile_money", amount: number) {
  const rail = findYellowCardCommercialRail({ direction, countryCode, currency, channel });
  if (!rail) throw new Error("missing test rail");
  return calculateYellowCardCustomerFee(rail, amount);
}

Deno.test("commercial policy contains all 70 signed Africa pricing rows without duplicate rails", () => {
  const signedRows = YELLOW_CARD_COMMERCIAL_RAILS_2026.reduce(
    (total, rail) => total + Math.max(1, rail.pricing_rules.length),
    0,
  );
  const keys = YELLOW_CARD_COMMERCIAL_RAILS_2026.map((rail) =>
    `${rail.direction}:${rail.country_code}:${rail.destination_currency}:${rail.channel}`
  );
  if (signedRows !== 70 || keys.length !== 55 || new Set(keys).size !== keys.length) {
    throw new Error(`commercial policy coverage drift: rows=${signedRows}, rails=${keys.length}`);
  }
});

Deno.test("adds two percentage points to pure percentage pricing", () => {
  const result = fee("receive", "KE", "KES", "mobile_money", 5_000);
  if (!result) throw new Error("missing fee");
  if (result.customer_fee_percent !== 2.77 || result.customer_amount_local !== 138.5) {
    throw new Error(`unexpected Kenya MoMo receive fee: ${JSON.stringify(result)}`);
  }
});

Deno.test("adds half of the provider fixed local-currency fee", () => {
  const result = fee("payout", "KE", "KES", "mobile_money", 1_000);
  if (!result) throw new Error("missing fee");
  if (result.provider_amount_local !== 126 || result.borderpay_amount_local !== 63 ||
      result.customer_fee_local !== 189 || result.customer_amount_local !== 189) {
    throw new Error(`unexpected Kenya MoMo payout fee: ${JSON.stringify(result)}`);
  }
});

Deno.test("adds half of provider minimum and maximum amounts", () => {
  const minimum = fee("receive", "KE", "KES", "bank", 50_000);
  if (minimum !== null) throw new Error("Kenya bank pricing must not be inferred outside its signed >250,000 band");
  const capped = fee("receive", "KE", "KES", "bank", 300_000);
  if (!capped) throw new Error("missing capped fee");
  if (capped.provider_amount_local !== 1_500 || capped.borderpay_amount_local !== 750 ||
      capped.customer_fee_percent !== 3 || capped.customer_minimum_fee_local !== 1_125 ||
      capped.customer_maximum_fee_local !== 2_250 || capped.customer_amount_local !== 2_250) {
    throw new Error(`unexpected Kenya bank receive fee: ${JSON.stringify(capped)}`);
  }
});

Deno.test("selects signed fixed-fee amount bands", () => {
  const result = fee("receive", "BW", "BWP", "bank", 150_000);
  if (!result) throw new Error("missing Botswana fee");
  if (result.provider_amount_local !== 300 || result.borderpay_amount_local !== 150 || result.customer_amount_local !== 450) {
    throw new Error(`unexpected Botswana receive fee: ${JSON.stringify(result)}`);
  }
});

Deno.test("uses the later signed band at an overlapping boundary", () => {
  const result = fee("receive", "MW", "MWK", "bank", 40_000_000);
  if (!result) throw new Error("missing Malawi boundary fee");
  if (result.provider_amount_local !== 1_000 || result.borderpay_amount_local !== 500 || result.customer_amount_local !== 1_500) {
    throw new Error(`unexpected Malawi boundary fee: ${JSON.stringify(result)}`);
  }
});

Deno.test("converts the complete local customer fee into source-wallet currency", () => {
  const sourceFee = convertYellowCardLocalFeeToFunding(189, 1_000, 8);
  if (sourceFee !== 1.512) throw new Error(`unexpected source fee: ${sourceFee}`);
  if (convertYellowCardLocalFeeToFunding(189, 0, 8) !== 0) throw new Error("invalid quote must fail closed");
});
