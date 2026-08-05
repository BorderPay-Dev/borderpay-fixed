type FeeRow = {
  product: string;
  currency: string;
  provider_fee_percent: number | string | null;
  provider_fee_fixed: number | string | null;
  borderpay_markup_percent: number | string | null;
  borderpay_markup_fixed: number | string | null;
  min_total: number | string | null;
  max_total: number | string | null;
};

const COUNTRY_SLUGS: Record<string, string> = {
  BJ: "benin", BW: "botswana", BF: "burkina_faso", CM: "cameroon", TD: "chad",
  CG: "congo_brazzaville", CD: "drc", ET: "ethiopia", GA: "gabon", CI: "ivory_coast",
  KE: "kenya", MW: "malawi", ML: "mali", NG: "nigeria", RW: "rwanda",
  SN: "senegal", ZA: "south_africa", TZ: "tanzania", TG: "togo", UG: "uganda", ZM: "zambia",
};

export function yellowCardFeeProduct(
  direction: "receive" | "payout",
  countryCode: string,
  channel: "bank" | "mobile_money",
): string {
  const slug = COUNTRY_SLUGS[String(countryCode || "").toUpperCase()] || "";
  return slug ? `yellow_card_${direction}_${channel}_${slug}` : "";
}

const number = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function quoteYellowCardCustomerFee(rows: FeeRow[], amount: number) {
  const applicable = rows.find((row) => {
    const minimum = row.min_total === null ? 0 : number(row.min_total);
    const maximum = row.max_total === null ? Number.POSITIVE_INFINITY : number(row.max_total);
    return amount >= minimum && amount <= maximum;
  }) || rows[0] || null;
  if (!applicable) return null;
  const providerPercent = number(applicable.provider_fee_percent);
  const providerFixed = number(applicable.provider_fee_fixed);
  const markupPercent = number(applicable.borderpay_markup_percent);
  const markupFixed = number(applicable.borderpay_markup_fixed);
  const customerPercent = providerPercent + markupPercent;
  const customerFixed = providerFixed + markupFixed;
  return {
    currency: String(applicable.currency || "").toUpperCase(),
    provider_percent: providerPercent,
    provider_fixed: providerFixed,
    borderpay_markup_percent: markupPercent,
    borderpay_markup_fixed: markupFixed,
    customer_percent: customerPercent,
    customer_fixed: customerFixed,
    customer_total: (amount * customerPercent) / 100 + customerFixed,
    min_total: applicable.min_total,
    max_total: applicable.max_total,
    source: "fee_schedule",
  };
}

export type { FeeRow as YellowCardFeeRow };
