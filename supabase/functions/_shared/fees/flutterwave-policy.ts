import { createClient } from "jsr:@supabase/supabase-js@2";

export type FlutterwaveDirection = "receive" | "payout";
export type FlutterwaveChannel = "bank" | "mobile_money";

export interface FlutterwaveFeeQuoteInput {
  direction: FlutterwaveDirection;
  channel: FlutterwaveChannel;
  currency: string;
  amount: number;
}

export interface FlutterwaveFeeQuote {
  product: string;
  currency: string;
  amount: number;
  provider_fee: number;
  borderpay_markup: number;
  total_fee: number;
  effective_multiplier: number;
  hard_cap_multiplier: number | null;
  selected_band: {
    min_total: number;
    max_total: number | null;
    notes: string | null;
  };
}

interface FeeScheduleRow {
  product: string;
  currency: string;
  provider_fee_fixed: number;
  provider_fee_percent: number;
  borderpay_markup_fixed: number;
  borderpay_markup_percent: number;
  min_total: number;
  max_total: number | null;
  notes: string | null;
}

const PRODUCT_BY_ROUTE: Record<string, string> = {
  "receive:bank": "flutterwave_receive_bank",
  "receive:mobile_money": "flutterwave_receive_mobile_money",
  "payout:bank": "flutterwave_payout_bank",
  "payout:mobile_money": "flutterwave_payout_mobile_money",
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function parseNotesMeta(notes: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = String(notes || "").trim();
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const [k, v] = part.split("=").map((s) => s?.trim() || "");
    if (k) out[k] = v;
  }
  return out;
}

export function resolveFlutterwaveProduct(direction: FlutterwaveDirection, channel: FlutterwaveChannel): string {
  return PRODUCT_BY_ROUTE[`${direction}:${channel}`];
}

export async function quoteFlutterwaveFee(
  supa: ReturnType<typeof createClient>,
  input: FlutterwaveFeeQuoteInput,
): Promise<FlutterwaveFeeQuote> {
  const product = resolveFlutterwaveProduct(input.direction, input.channel);
  const currency = input.currency.toUpperCase();
  const amount = Number(input.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("invalid_amount");
  }

  const { data, error } = await supa
    .from("fee_schedule")
    .select("product,currency,provider_fee_fixed,provider_fee_percent,borderpay_markup_fixed,borderpay_markup_percent,min_total,max_total,notes")
    .eq("product", product)
    .eq("currency", currency)
    .order("min_total", { ascending: false });

  if (error) throw new Error(`fee_schedule_query_failed:${error.message}`);

  const rows = (data || []) as FeeScheduleRow[];
  if (rows.length === 0) {
    throw new Error(`fee_schedule_missing:${product}:${currency}`);
  }

  const selected = rows.find((r) => {
    const min = Number(r.min_total || 0);
    const max = r.max_total === null || r.max_total === undefined ? null : Number(r.max_total);
    if (amount < min) return false;
    if (max !== null && amount > max) return false;
    return true;
  });
  if (!selected) {
    throw new Error(`fee_band_not_found:${product}:${currency}:${amount}`);
  }

  const providerFixed = Number(selected.provider_fee_fixed || 0);
  const providerPct = Number(selected.provider_fee_percent || 0);
  const markupFixed = Number(selected.borderpay_markup_fixed || 0);
  const markupPct = Number(selected.borderpay_markup_percent || 0);

  const providerFee = providerFixed + ((providerPct / 100) * amount);
  const rawMarkup = markupFixed + ((markupPct / 100) * amount);
  let totalFee = providerFee + rawMarkup;

  const meta = parseNotesMeta(selected.notes);
  const hardCap = Number(meta.hard_cap_multiplier || "");
  const hardCapMultiplier = Number.isFinite(hardCap) && hardCap > 0 ? hardCap : null;
  if (hardCapMultiplier && providerFee > 0) {
    totalFee = Math.min(totalFee, providerFee * hardCapMultiplier);
  }

  const borderpayMarkup = Math.max(totalFee - providerFee, 0);
  const effectiveMultiplier = providerFee > 0 ? totalFee / providerFee : 0;

  return {
    product,
    currency,
    amount: round2(amount),
    provider_fee: round2(providerFee),
    borderpay_markup: round2(borderpayMarkup),
    total_fee: round2(totalFee),
    effective_multiplier: round2(effectiveMultiplier),
    hard_cap_multiplier: hardCapMultiplier,
    selected_band: {
      min_total: Number(selected.min_total || 0),
      max_total: selected.max_total === null || selected.max_total === undefined ? null : Number(selected.max_total),
      notes: selected.notes || null,
    },
  };
}

