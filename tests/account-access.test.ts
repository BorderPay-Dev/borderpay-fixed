import { getFinancialAccessBlock } from "../supabase/functions/_shared/account-access.ts";

function fakeSupabase(result: { data: Record<string, unknown> | null; error: { message: string } | null }) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
  };
  return { from: () => query };
}

Deno.test("Bridge paused status blocks an otherwise active account", async () => {
  const block = await getFinancialAccessBlock(fakeSupabase({
    data: {
      account_status: "active",
      bridge_account_status: "paused",
      bridge_account_paused_at: "2026-08-19T00:00:00Z",
    },
    error: null,
  }), "user-1");
  if (block?.code !== "account_frozen" || block.account_status !== "paused") {
    throw new Error("Bridge pause did not fail closed");
  }
});

Deno.test("active local and Bridge statuses retain normal access", async () => {
  const block = await getFinancialAccessBlock(fakeSupabase({
    data: { account_status: "active", bridge_account_status: "active" },
    error: null,
  }), "user-2");
  if (block !== null) throw new Error("legitimate active account was blocked");
});

Deno.test("status lookup error or missing profile fails closed", async () => {
  for (const result of [
    { data: null, error: { message: "lookup failed" } },
    { data: null, error: null },
  ]) {
    const block = await getFinancialAccessBlock(fakeSupabase(result), "user-3");
    if (block?.account_status !== "access_check_failed") {
      throw new Error("unverifiable account status did not fail closed");
    }
  }
});
