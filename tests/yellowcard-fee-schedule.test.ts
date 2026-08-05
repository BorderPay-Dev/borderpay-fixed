import { quoteYellowCardCustomerFee, yellowCardFeeProduct } from "../supabase/functions/_shared/providers/yellowcard-fee-schedule.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("Kenya receive MoMo customer fee stacks provider cost and BorderPay markup", () => {
  const quote = quoteYellowCardCustomerFee([{
    product: "yellow_card_receive_mobile_money_kenya",
    currency: "KES",
    provider_fee_percent: 0.77,
    provider_fee_fixed: 0,
    borderpay_markup_percent: 1.73,
    borderpay_markup_fixed: 0,
    min_total: 0,
    max_total: null,
  }], 5000);
  assert(quote?.customer_percent === 2.5, `expected 2.5%, got ${quote?.customer_percent}`);
  assert(quote?.customer_total === 125, `expected KES 125, got ${quote?.customer_total}`);
});

Deno.test("Yellow Card fee product keys match production fee_schedule", () => {
  assert(yellowCardFeeProduct("receive", "KE", "mobile_money") === "yellow_card_receive_mobile_money_kenya", "Kenya receive product mismatch");
  assert(yellowCardFeeProduct("payout", "CD", "mobile_money") === "yellow_card_payout_mobile_money_drc", "DRC payout product mismatch");
});
