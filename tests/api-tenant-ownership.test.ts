import {
  assertTenantResource,
  providerReferencesForTransfer,
  resolveTenantEndUser,
  TenantOwnershipError,
} from "../supabase/functions/_shared/api-tenant-ownership.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("transfer provider references include every supported provider id", () => {
  const refs = providerReferencesForTransfer({
    source: {
      customer_id: "cus_1",
      bridge_wallet_id: "wal_1",
      external_account_id: "ext_1",
    },
    destination: {
      bridge_wallet_id: "wal_2",
      external_account_id: "ext_2",
      deposit_id: "dep_1",
    },
  });
  assert(
    refs.length === 6,
    "a provider identifier escaped ownership collection",
  );
  assert(
    refs.some((r) =>
      r.resourceType === "customer" && r.providerResourceId === "cus_1"
    ),
    "customer id missing",
  );
  assert(
    refs.some((r) =>
      r.resourceType === "deposit" && r.providerResourceId === "dep_1"
    ),
    "deposit id missing",
  );
});

Deno.test("unknown and cross-tenant provider resources fail closed", async () => {
  const supa = {
    from: () => {
      throw new Error("not used");
    },
    rpc: async () => ({ data: [], error: null }),
  };
  let failure: unknown;
  try {
    await assertTenantResource(
      supa,
      "tenant-a",
      "wallet",
      "wallet-from-tenant-b",
    );
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof TenantOwnershipError,
    "unknown resource did not fail",
  );
  assert(failure.status === 403, "unknown resource did not return forbidden");
});

Deno.test("ownership lookup errors fail closed", async () => {
  const supa = {
    from: () => {
      throw new Error("not used");
    },
    rpc: async () => ({
      data: null,
      error: { message: "database unavailable" },
    }),
  };
  let failure: unknown;
  try {
    await assertTenantResource(supa, "tenant-a", "customer", "cus_1");
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof TenantOwnershipError, "lookup error was ignored");
  assert(failure.status === 500, "lookup error was not treated as unavailable");
});

Deno.test("customer external reference resolves only inside tenant and account type", async () => {
  const calls: Array<[string, unknown]> = [];
  const builder: any = {
    select: (value: string) => {
      calls.push(["select", value]);
      return builder;
    },
    eq: (field: string, value: unknown) => {
      calls.push([field, value]);
      return builder;
    },
    maybeSingle: async () => ({
      data: {
        id: "mapping-a",
        user_id: "internal-user-a",
        account_type: "business",
      },
      error: null,
    }),
  };
  const supa = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  const resolved = await resolveTenantEndUser(
    supa,
    "tenant-a",
    "partner-ref",
    "business",
  );
  assert(
    resolved.userId === "internal-user-a",
    "mutable external id was passed through",
  );
  assert(
    calls.some(([field, value]) =>
      field === "tenant_id" && value === "tenant-a"
    ),
    "tenant predicate missing",
  );
  assert(
    calls.some(([field, value]) =>
      field === "external_user_id" && value === "partner-ref"
    ),
    "external id predicate missing",
  );
  assert(
    calls.some(([field, value]) =>
      field === "account_type" && value === "business"
    ),
    "account type predicate missing",
  );
});
