import { liquidationAddressDeveloperFeeFields } from "../supabase/functions/_shared/providers/bridge.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("USDC/Base liquidation route sends Bridge's custom developer fee field", () => {
  const fields = liquidationAddressDeveloperFeeFields("base", "1");
  assert(fields.custom_developer_fee_percent === "1", "Base route must carry the 1% custom fee");
  assert(!("developer_fee_percent" in fields), "Base route must not use the stale fee field");
});

Deno.test("USDT/Tron liquidation route omits developer fee fields", () => {
  const fields = liquidationAddressDeveloperFeeFields("tron", "1");
  assert(Object.keys(fields).length === 0, "Tron route must not carry a rejected developer fee");
});
