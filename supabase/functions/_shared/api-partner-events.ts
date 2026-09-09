import type { TenantResourceType } from "./api-tenant-ownership.ts";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => any;
};

type PendingBridgeEvent = {
  event_id: string;
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
};

export type PartnerEventProjection = {
  eventType: string;
  resourceType: TenantResourceType;
  providerResourceId: string;
  payload: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function first(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export function projectBridgePartnerEvent(event: PendingBridgeEvent): PartnerEventProjection | null {
  if (event.source !== "bridge") return null;
  const eventType = String(event.event_type || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(eventType)) return null;
  const envelope = record(event.payload);
  const object = Object.keys(record(envelope.event_object)).length
    ? record(envelope.event_object)
    : Object.keys(record(envelope.data)).length
    ? record(envelope.data)
    : envelope;

  let resourceType: TenantResourceType;
  let providerResourceId = "";
  if (eventType.startsWith("customer.") || eventType.startsWith("kyc_link.") || eventType.startsWith("kyb_link.")) {
    resourceType = "customer";
    providerResourceId = first(object.customer_id, record(object.customer).id, object.id, envelope.event_object_id);
  } else if (eventType.startsWith("virtual_account.")) {
    resourceType = "virtual_account";
    providerResourceId = first(object.virtual_account_id, object.id, envelope.event_object_id);
  } else if (eventType.startsWith("wallet.")) {
    resourceType = "wallet";
    providerResourceId = first(object.wallet_id, object.id, envelope.event_object_id);
  } else if (eventType.startsWith("external_account.")) {
    resourceType = "external_account";
    providerResourceId = first(object.external_account_id, object.id, envelope.event_object_id);
  } else if (eventType.startsWith("transfer.")) {
    resourceType = "transfer";
    providerResourceId = first(object.transfer_id, object.id, envelope.event_object_id);
  } else {
    return null;
  }
  if (!providerResourceId) return null;

  const status = first(object.status, object.state, object.kyc_status, envelope.event_object_status);
  const payload: Record<string, unknown> = {
    resource: { id: providerResourceId, type: resourceType },
  };
  if (status) payload.status = status.toLowerCase();
  const amount = first(object.amount, record(object.source).amount);
  const currency = first(object.currency, record(object.source).currency);
  if (amount) payload.amount = amount;
  if (currency) payload.currency = currency.toUpperCase();
  return { eventType, resourceType, providerResourceId, payload };
}

export async function enqueuePartnerBridgeEvent(
  supabase: SupabaseLike,
  event: PendingBridgeEvent,
): Promise<"enqueued" | "not_partner_owned" | "not_supported"> {
  const projected = projectBridgePartnerEvent(event);
  if (!projected) return "not_supported";
  const { data, error } = await supabase
    .from("api_tenant_provider_resources")
    .select("id,tenant_id,tenant_end_user_id")
    .eq("provider", "bridge")
    .eq("resource_type", projected.resourceType)
    .eq("provider_resource_id", projected.providerResourceId)
    .limit(2);
  if (error) throw new Error(`Partner resource lookup failed: ${error.message ?? "unknown error"}`);
  if (!Array.isArray(data) || data.length === 0) return "not_partner_owned";
  if (data.length !== 1) throw new Error("Partner resource ownership is ambiguous");
  const owner = data[0];
  const { error: enqueueError } = await supabase.rpc("api_webhook_enqueue_event", {
    p_tenant_id: owner.tenant_id,
    p_tenant_end_user_id: owner.tenant_end_user_id,
    p_resource_id: owner.id,
    p_event_type: projected.eventType,
    p_idempotency_key: `provider:${event.event_id}`,
    p_payload: projected.payload,
    p_occurred_at: new Date().toISOString(),
  });
  if (enqueueError) throw new Error(`Partner webhook enqueue failed: ${enqueueError.message ?? "unknown error"}`);
  return "enqueued";
}

export async function enqueueApiResourceEvent(
  supabase: SupabaseLike,
  input: {
    tenantId: string;
    tenantEndUserId: string;
    resourceId: string;
    eventType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.rpc("api_webhook_enqueue_event", {
    p_tenant_id: input.tenantId,
    p_tenant_end_user_id: input.tenantEndUserId,
    p_resource_id: input.resourceId,
    p_event_type: input.eventType,
    p_idempotency_key: input.idempotencyKey,
    p_payload: input.payload,
    p_occurred_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Partner webhook enqueue failed: ${error.message ?? "unknown error"}`);
}
