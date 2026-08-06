/**
 * Yellow Card commercial availability and pricing source of truth.
 *
 * Source: "Yellow card - Treasury Portal Order Form - Standard Pricing.pdf"
 * Addendum 1, Schedule 4 of the MSA (B2B Payments API), pages 7-10.
 * Document date: 2026-07-08.
 *
 * Provider APIs remain authoritative for runtime channel/network identifiers,
 * transaction limits, quotes and execution status. They must not add countries
 * or rails that are absent from this signed commercial schedule.
 */

export type YellowCardCommercialDirection = "receive" | "payout";
export type YellowCardCommercialChannel = "bank" | "mobile_money";

export interface YellowCardCommercialRail {
  provider: "yellow_card";
  direction: YellowCardCommercialDirection;
  country_code: string;
  destination_currency: string;
  channel: YellowCardCommercialChannel;
  enabled: true;
  requires_bridge_kyc: true;
  priority: number;
  provider_fee_percent: number | null;
  provider_fee_local: number | null;
  minimum_fee_local: number | null;
  maximum_fee_local: number | null;
  pricing_rules: Array<Record<string, string | number | null>>;
  source_document: string;
  source_document_date: string;
}

const SOURCE_DOCUMENT = "Yellow Card Treasury Portal Order Form - Standard Pricing, Addendum 1";
const SOURCE_DOCUMENT_DATE = "2026-07-08";

const COUNTRY_CODES: Record<string, string> = {
  benin: "BJ", botswana: "BW", "burkina faso": "BF", cameroon: "CM", chad: "TD",
  "congo brazzaville": "CG", "republic of the congo": "CG", "dr congo": "CD",
  "democratic republic of the congo": "CD", gabon: "GA", "ivory coast": "CI",
  "côte d’ivoire": "CI", "cote d'ivoire": "CI", kenya: "KE", malawi: "MW", mali: "ML",
  nigeria: "NG", rwanda: "RW", senegal: "SN", "south africa": "ZA", tanzania: "TZ",
  togo: "TG", uganda: "UG", zambia: "ZM", ethiopia: "ET",
};

const ISO_ALPHA3_CODES: Record<string, string> = {
  BEN: "BJ", BWA: "BW", BFA: "BF", CMR: "CM", TCD: "TD", COG: "CG",
  COD: "CD", GAB: "GA", CIV: "CI", KEN: "KE", MWI: "MW", MLI: "ML",
  NGA: "NG", RWA: "RW", SEN: "SN", ZAF: "ZA", TZA: "TZ", TGO: "TG",
  UGA: "UG", ZMB: "ZM", ETH: "ET",
};

export function normalizeYellowCardCountryCode(value: unknown): string {
  const raw = String(value || "").trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  if (/^[A-Za-z]{3}$/.test(raw)) return ISO_ALPHA3_CODES[raw.toUpperCase()] || "";
  return COUNTRY_CODES[raw.toLowerCase()] || "";
}

type RailInput = {
  direction: YellowCardCommercialDirection;
  country: string;
  currency: string;
  channel: YellowCardCommercialChannel;
  feePercent?: number | null;
  feeLocal?: number | null;
  minimumFeeLocal?: number | null;
  maximumFeeLocal?: number | null;
  rules?: Array<Record<string, string | number | null>>;
};

const rail = (input: RailInput): YellowCardCommercialRail => ({
  provider: "yellow_card",
  direction: input.direction,
  country_code: input.country,
  destination_currency: input.currency,
  channel: input.channel,
  enabled: true,
  requires_bridge_kyc: true,
  priority: 100,
  provider_fee_percent: input.feePercent ?? null,
  provider_fee_local: input.feeLocal ?? null,
  minimum_fee_local: input.minimumFeeLocal ?? null,
  maximum_fee_local: input.maximumFeeLocal ?? null,
  pricing_rules: input.rules ?? [],
  source_document: SOURCE_DOCUMENT,
  source_document_date: SOURCE_DOCUMENT_DATE,
});

export const YELLOW_CARD_COMMERCIAL_RAILS_2026: readonly YellowCardCommercialRail[] = [
  // Africa collections (receives / local top ups), Order Form pages 7-8.
  rail({ direction: "receive", country: "BJ", currency: "XOF", channel: "mobile_money", feePercent: 2.22 }),
  rail({ direction: "receive", country: "BW", currency: "BWP", channel: "bank", feePercent: 0.25, minimumFeeLocal: 1, rules: [
    { range: "5000-134999 BWP", fee_percent: 0.25, minimum_fee_local: 1 },
    { range: "135000-1000000 BWP", fee_local: 300 },
  ] }),
  rail({ direction: "receive", country: "BW", currency: "BWP", channel: "mobile_money", feePercent: 2.55, minimumFeeLocal: 1, rules: [{ range: "<=10000 BWP", fee_percent: 2.55, minimum_fee_local: 1 }] }),
  rail({ direction: "receive", country: "BF", currency: "XOF", channel: "mobile_money", feePercent: 2.52 }),
  rail({ direction: "receive", country: "CM", currency: "XAF", channel: "mobile_money", feePercent: 1.82 }),
  rail({ direction: "receive", country: "TD", currency: "XAF", channel: "mobile_money", feePercent: 3.22 }),
  rail({ direction: "receive", country: "CG", currency: "XAF", channel: "mobile_money", feePercent: 3.22 }),
  rail({ direction: "receive", country: "GA", currency: "XAF", channel: "bank", feePercent: 2, minimumFeeLocal: 1, rules: [
    { range: "<5700000 XAF", fee_percent: 2, minimum_fee_local: 1 },
    { range: ">=5700000 XAF", fee_local: 1000, minimum_fee_local: 1000 },
  ] }),
  rail({ direction: "receive", country: "GA", currency: "XAF", channel: "mobile_money", feePercent: 3.22 }),
  rail({ direction: "receive", country: "CI", currency: "XOF", channel: "mobile_money", feePercent: 2.22, minimumFeeLocal: 1 }),
  rail({ direction: "receive", country: "KE", currency: "KES", channel: "bank", feePercent: 1, minimumFeeLocal: 750, maximumFeeLocal: 1500, rules: [{ range: ">250000 KES", fee_percent: 1, minimum_fee_local: 750, maximum_fee_local: 1500 }] }),
  rail({ direction: "receive", country: "KE", currency: "KES", channel: "mobile_money", feePercent: 0.77, minimumFeeLocal: 1 }),
  rail({ direction: "receive", country: "MW", currency: "MWK", channel: "bank", feePercent: 0.25, minimumFeeLocal: 750, maximumFeeLocal: 3000, rules: [
    { range: "500000-40000000 MWK", fee_percent: 0.25, minimum_fee_local: 750, maximum_fee_local: 3000 },
    { range: ">=40000000 MWK", fee_local: 1000 },
  ] }),
  rail({ direction: "receive", country: "MW", currency: "MWK", channel: "mobile_money", feePercent: 3.35, minimumFeeLocal: 1 }),
  rail({ direction: "receive", country: "ML", currency: "XOF", channel: "mobile_money", feePercent: 2.22 }),
  rail({ direction: "receive", country: "NG", currency: "NGN", channel: "bank", feePercent: 0.89, minimumFeeLocal: 100 }),
  rail({ direction: "receive", country: "RW", currency: "RWF", channel: "bank", feePercent: 1, minimumFeeLocal: 1000, maximumFeeLocal: 30000, rules: [
    { range: "1500-15000000 RWF", fee_percent: 1, minimum_fee_local: 1000, maximum_fee_local: 30000 },
    { range: ">=15000000 RWF", fee_local: 1000 },
  ] }),
  rail({ direction: "receive", country: "RW", currency: "RWF", channel: "mobile_money", feePercent: 3.02, minimumFeeLocal: 300 }),
  rail({ direction: "receive", country: "SN", currency: "XOF", channel: "mobile_money", feePercent: 2.22 }),
  rail({ direction: "receive", country: "ZA", currency: "ZAR", channel: "bank", feePercent: 0.97 }),
  rail({ direction: "receive", country: "TZ", currency: "TZS", channel: "bank", feePercent: 0.5, minimumFeeLocal: 25000, maximumFeeLocal: 50000, rules: [
    { range: "5000000-25000000 TZS", fee_percent: 0.5, minimum_fee_local: 25000, maximum_fee_local: 50000 },
    { range: ">=25000000 TZS", fee_percent: 0.25, minimum_fee_local: 62500, maximum_fee_local: 75000 },
  ] }),
  rail({ direction: "receive", country: "TZ", currency: "TZS", channel: "mobile_money", feePercent: 1.5, minimumFeeLocal: 2000, rules: [
    { range: "<300000 TZS", fee_percent: 1.5, minimum_fee_local: 2000 },
    { range: ">=300000 TZS", fee_percent: 1, minimum_fee_local: 3000 },
  ] }),
  rail({ direction: "receive", country: "TG", currency: "XOF", channel: "mobile_money", feePercent: 4.22 }),
  rail({ direction: "receive", country: "UG", currency: "UGX", channel: "bank", feePercent: 1, minimumFeeLocal: 5000, maximumFeeLocal: 50000, rules: [
    { range: "5000000-35000000 UGX", fee_percent: 1, minimum_fee_local: 5000, maximum_fee_local: 50000 },
    { range: ">=35000000 UGX", fee_local: 35000 },
  ] }),
  rail({ direction: "receive", country: "UG", currency: "UGX", channel: "mobile_money", feePercent: 2.5 }),
  rail({ direction: "receive", country: "ZM", currency: "ZMW", channel: "bank", feePercent: 0.25, minimumFeeLocal: 62.5, rules: [
    { range: "25000-1000000 ZMW", fee_percent: 0.25, minimum_fee_local: 62.5 },
    { range: ">1000000 ZMW", fee_local: 150 },
  ] }),
  rail({ direction: "receive", country: "ZM", currency: "ZMW", channel: "mobile_money", feePercent: 2.22, minimumFeeLocal: 0.5 }),

  // Africa disbursements (sends), Order Form pages 8-9.
  rail({ direction: "payout", country: "BJ", currency: "XOF", channel: "mobile_money", feePercent: 1.82 }),
  rail({ direction: "payout", country: "BW", currency: "BWP", channel: "bank", feePercent: 0.25, minimumFeeLocal: 10, rules: [
    { range: "<=10000 BWP", fee_percent: 0.25, minimum_fee_local: 10 },
    { range: ">=135000 BWP", fee_local: 300 },
  ] }),
  rail({ direction: "payout", country: "BW", currency: "BWP", channel: "mobile_money", feePercent: 1.5, minimumFeeLocal: 1, rules: [{ range: "<=10000 BWP", fee_percent: 1.5, minimum_fee_local: 1 }] }),
  rail({ direction: "payout", country: "BF", currency: "XOF", channel: "mobile_money", feePercent: 1.82 }),
  rail({ direction: "payout", country: "CM", currency: "XAF", channel: "mobile_money", feePercent: 1.02, minimumFeeLocal: 656 }),
  rail({ direction: "payout", country: "TD", currency: "XAF", channel: "mobile_money", minimumFeeLocal: 656 }),
  rail({ direction: "payout", country: "CG", currency: "XAF", channel: "mobile_money", minimumFeeLocal: 656 }),
  rail({ direction: "payout", country: "CD", currency: "CDF", channel: "mobile_money", feePercent: 0.75, minimumFeeLocal: 1 }),
  rail({ direction: "payout", country: "ET", currency: "USD", channel: "bank", feePercent: 0.25, minimumFeeLocal: 20 }),
  rail({ direction: "payout", country: "GA", currency: "XAF", channel: "mobile_money", feePercent: 2.52 }),
  rail({ direction: "payout", country: "CI", currency: "XOF", channel: "mobile_money", feePercent: 1.82 }),
  rail({ direction: "payout", country: "KE", currency: "KES", channel: "bank", feePercent: 2.9 }),
  rail({ direction: "payout", country: "KE", currency: "KES", channel: "mobile_money", feeLocal: 126 }),
  rail({ direction: "payout", country: "MW", currency: "MWK", channel: "bank", feePercent: 0.25, minimumFeeLocal: 750, maximumFeeLocal: 3000, rules: [
    { range: "500000-40000000 MWK", fee_percent: 0.25, minimum_fee_local: 750, maximum_fee_local: 3000 },
    { range: ">=40000000 MWK", fee_local: 1000 },
  ] }),
  rail({ direction: "payout", country: "MW", currency: "MWK", channel: "mobile_money", feePercent: 2.5, minimumFeeLocal: 100 }),
  rail({ direction: "payout", country: "ML", currency: "XOF", channel: "mobile_money", feePercent: 2.02 }),
  rail({ direction: "payout", country: "NG", currency: "NGN", channel: "bank", feeLocal: 103.75 }),
  rail({ direction: "payout", country: "RW", currency: "RWF", channel: "bank", feePercent: 0.5, minimumFeeLocal: 3000, maximumFeeLocal: 30000, rules: [
    { range: "<15000000 RWF", fee_percent: 0.5, minimum_fee_local: 3000, maximum_fee_local: 30000 },
    { range: ">=15000000 RWF", fee_local: 3000 },
  ] }),
  rail({ direction: "payout", country: "RW", currency: "RWF", channel: "mobile_money", feePercent: 3.02, minimumFeeLocal: 1 }),
  rail({ direction: "payout", country: "SN", currency: "XOF", channel: "mobile_money", feePercent: 1.82, minimumFeeLocal: 1 }),
  rail({ direction: "payout", country: "ZA", currency: "ZAR", channel: "bank", feePercent: 1.58, minimumFeeLocal: 4.5 }),
  rail({ direction: "payout", country: "TZ", currency: "TZS", channel: "bank", feePercent: 0.5, minimumFeeLocal: 25000, maximumFeeLocal: 50000, rules: [
    { range: "5000000-25000000 TZS", fee_percent: 0.5, minimum_fee_local: 25000, maximum_fee_local: 50000 },
    { range: ">25000000 TZS", fee_percent: 0.25, minimum_fee_local: 50000, maximum_fee_local: 75000 },
  ] }),
  rail({ direction: "payout", country: "TZ", currency: "TZS", channel: "mobile_money", feePercent: 1.5, minimumFeeLocal: 2000, rules: [
    { range: "2500-300000 TZS", fee_percent: 1.5, minimum_fee_local: 2000 },
    { range: ">=300000 TZS", fee_percent: 1, minimum_fee_local: 3000 },
  ] }),
  rail({ direction: "payout", country: "TG", currency: "XOF", channel: "mobile_money", feePercent: 1.82 }),
  rail({ direction: "payout", country: "UG", currency: "UGX", channel: "bank", feePercent: 1, minimumFeeLocal: 5000, maximumFeeLocal: 50000, rules: [
    { range: "5000000-35000000 UGX", fee_percent: 1, minimum_fee_local: 5000, maximum_fee_local: 50000 },
    { range: ">35000000 UGX", fee_local: 35000 },
  ] }),
  rail({ direction: "payout", country: "UG", currency: "UGX", channel: "mobile_money", feePercent: 1.25, minimumFeeLocal: 2000 }),
  rail({ direction: "payout", country: "ZM", currency: "ZMW", channel: "bank", feePercent: 0.5, minimumFeeLocal: 50, rules: [
    { range: "25000-1000000 ZMW", fee_percent: 0.5, minimum_fee_local: 50 },
    { range: ">=1000000 ZMW", fee_percent: 0.25, minimum_fee_local: 50 },
  ] }),
  rail({ direction: "payout", country: "ZM", currency: "ZMW", channel: "mobile_money", feeLocal: 35 }),
] as const;

export function listYellowCardCommercialRails(
  direction: YellowCardCommercialDirection,
  countryCode?: string | null,
): YellowCardCommercialRail[] {
  const country = String(countryCode || "").trim().toUpperCase();
  return YELLOW_CARD_COMMERCIAL_RAILS_2026.filter((row) =>
    row.direction === direction && (!country || row.country_code === country)
  );
}

export function findYellowCardCommercialRail(input: {
  direction: YellowCardCommercialDirection;
  countryCode: string;
  currency: string;
  channel: YellowCardCommercialChannel;
}): YellowCardCommercialRail | null {
  const country = String(input.countryCode || "").trim().toUpperCase();
  const currency = String(input.currency || "").trim().toUpperCase();
  return listYellowCardCommercialRails(input.direction, country).find((row) =>
    row.destination_currency === currency && row.channel === input.channel
  ) || null;
}
