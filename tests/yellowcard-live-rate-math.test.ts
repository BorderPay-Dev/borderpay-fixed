import { yellowCardDestinationAmount } from "../supabase/functions/_shared/providers/yellowcard-rate.ts";

Deno.test("Yellow Card Receive converts local fiat into USD digital dollars", () => {
  const amount = yellowCardDestinationAmount(10_000, 25, "receive");
  if (amount !== 400) throw new Error(`expected 400 digital dollars, got ${amount}`);
});

Deno.test("Yellow Card payout converts USD digital dollars into local fiat", () => {
  const amount = yellowCardDestinationAmount(400, 25, "payout");
  if (amount !== 10_000) throw new Error(`expected 10000 local units, got ${amount}`);
});

Deno.test("Yellow Card quote math rejects invalid rates", () => {
  let rejected = false;
  try {
    yellowCardDestinationAmount(10_000, 0, "receive");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("zero rate was accepted");
});
