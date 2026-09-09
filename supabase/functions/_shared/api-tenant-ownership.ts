export type TenantResourceType =
  | "customer"
  | "wallet"
  | "virtual_account"
  | "external_account"
  | "deposit"
  | "transfer";

type SupabaseLike = {
  from: (table: string) => any;
  // Supabase RPC builders are PromiseLike rather than concrete Promises.
  rpc: (name: string, args: Record<string, unknown>) => any;
};

export class TenantOwnershipError extends Error {
  readonly code: "tenant_resource_forbidden" | "tenant_ownership_unavailable";
  readonly status: 403 | 500;

  constructor(
    code: "tenant_resource_forbidden" | "tenant_ownership_unavailable",
    message: string,
    status: 403 | 500,
  ) {
    super(message);
    this.name = "TenantOwnershipError";
    this.code = code;
    this.status = status;
  }
}

export type TenantEndUser = {
  id: string;
  userId: string;
  accountType: "individual" | "business";
};

export type OwnedResource = {
  resourceId: string;
  tenantEndUserId: string;
};

export async function resolveTenantEndUser(
  supa: SupabaseLike,
  tenantId: string,
  externalUserId: string,
  expectedAccountType: "individual" | "business",
): Promise<TenantEndUser> {
  const { data, error } = await supa
    .from("api_tenant_end_users")
    .select("id, user_id, account_type")
    .eq("tenant_id", tenantId)
    .eq("external_user_id", externalUserId)
    .eq("account_type", expectedAccountType)
    .maybeSingle();
  if (error) {
    throw new TenantOwnershipError(
      "tenant_ownership_unavailable",
      `Tenant end-user lookup failed: ${error.message ?? "unknown error"}`,
      500,
    );
  }
  if (!data?.id || !data?.user_id) {
    throw new TenantOwnershipError(
      "tenant_resource_forbidden",
      "The requested end user is not owned by this tenant",
      403,
    );
  }
  return {
    id: String(data.id),
    userId: String(data.user_id),
    accountType: String(data.account_type) as "individual" | "business",
  };
}

export async function assertTenantResource(
  supa: SupabaseLike,
  tenantId: string,
  resourceType: TenantResourceType,
  providerResourceId: string,
): Promise<OwnedResource> {
  const { data, error } = await supa.rpc("api_gateway_assert_tenant_resource", {
    p_tenant_id: tenantId,
    p_provider: "bridge",
    p_resource_type: resourceType,
    p_provider_resource_id: providerResourceId,
  });
  if (error) {
    throw new TenantOwnershipError(
      "tenant_ownership_unavailable",
      `Provider-resource lookup failed: ${error.message ?? "unknown error"}`,
      500,
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.resource_id || !row?.tenant_end_user_id) {
    throw new TenantOwnershipError(
      "tenant_resource_forbidden",
      "The provider resource is unknown or belongs to another tenant",
      403,
    );
  }
  return {
    resourceId: String(row.resource_id),
    tenantEndUserId: String(row.tenant_end_user_id),
  };
}

export async function registerTenantResource(
  supa: SupabaseLike,
  input: {
    tenantId: string;
    tenantEndUserId: string;
    apiKeyId: string;
    resourceType: TenantResourceType;
    providerResourceId: string;
    parentResourceId?: string;
    providerStatus?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const { data, error } = await supa.rpc(
    "api_gateway_register_tenant_resource",
    {
      p_tenant_id: input.tenantId,
      p_tenant_end_user_id: input.tenantEndUserId,
      p_api_key_id: input.apiKeyId,
      p_provider: "bridge",
      p_resource_type: input.resourceType,
      p_provider_resource_id: input.providerResourceId,
      p_parent_resource_id: input.parentResourceId ?? null,
      p_provider_status: input.providerStatus ?? null,
      p_metadata: input.metadata ?? {},
    },
  );
  if (error || !data) {
    throw new TenantOwnershipError(
      "tenant_ownership_unavailable",
      `Provider-resource registration failed: ${
        error?.message ?? "empty result"
      }`,
      500,
    );
  }
  return String(data);
}

export async function resolveTenantEndUserById(
  supa: SupabaseLike,
  tenantId: string,
  tenantEndUserId: string,
): Promise<TenantEndUser> {
  const { data, error } = await supa
    .from("api_tenant_end_users")
    .select("id, user_id, account_type")
    .eq("tenant_id", tenantId)
    .eq("id", tenantEndUserId)
    .maybeSingle();
  if (error) {
    throw new TenantOwnershipError(
      "tenant_ownership_unavailable",
      `Tenant end-user lookup failed: ${error.message ?? "unknown error"}`,
      500,
    );
  }
  if (
    !data?.id || !data?.user_id ||
    !["individual", "business"].includes(String(data.account_type))
  ) {
    throw new TenantOwnershipError(
      "tenant_resource_forbidden",
      "The provider resource has no authoritative tenant end user",
      403,
    );
  }
  return {
    id: String(data.id),
    userId: String(data.user_id),
    accountType: String(data.account_type) as "individual" | "business",
  };
}

export async function resolveCustomerForTenantEndUser(
  supa: SupabaseLike,
  tenantId: string,
  tenantEndUserId: string,
): Promise<string> {
  const { data, error } = await supa
    .from("api_tenant_provider_resources")
    .select("provider_resource_id")
    .eq("tenant_id", tenantId)
    .eq("tenant_end_user_id", tenantEndUserId)
    .eq("provider", "bridge")
    .eq("resource_type", "customer")
    .limit(2);
  if (error) {
    throw new TenantOwnershipError(
      "tenant_ownership_unavailable",
      `Customer ownership lookup failed: ${error.message ?? "unknown error"}`,
      500,
    );
  }
  if (
    !Array.isArray(data) || data.length !== 1 || !data[0]?.provider_resource_id
  ) {
    throw new TenantOwnershipError(
      "tenant_resource_forbidden",
      "Exactly one owned provider customer is required",
      403,
    );
  }
  return String(data[0].provider_resource_id);
}

export type ProviderReference = {
  side: "source" | "destination";
  resourceType: TenantResourceType;
  providerResourceId: string;
};

export function providerReferencesForTransfer(input: {
  source: Record<string, unknown>;
  destination: Record<string, unknown>;
}): ProviderReference[] {
  const refs: ProviderReference[] = [];
  const add = (
    side: "source" | "destination",
    resourceType: TenantResourceType,
    value: unknown,
  ) => {
    const id = typeof value === "string" ? value.trim() : "";
    if (id) refs.push({ side, resourceType, providerResourceId: id });
  };
  add("source", "customer", input.source.customer_id);
  add("source", "wallet", input.source.bridge_wallet_id);
  add("source", "external_account", input.source.external_account_id);
  add("destination", "wallet", input.destination.bridge_wallet_id);
  add("destination", "external_account", input.destination.external_account_id);
  add("destination", "deposit", input.destination.deposit_id);
  return refs;
}
