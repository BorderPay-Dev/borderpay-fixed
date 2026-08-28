export type ScaOperation = "wallet_access" | "payment" | "beneficiary_change" | "security_change";
import { resolveBridgeScaScope } from "./bridge-sca-scope.ts";

type ScaDatabaseClient = {
  from: (table: string) => any;
  rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

const OPERATIONS = new Set<ScaOperation>([
  "wallet_access", "payment", "beneficiary_change", "security_change",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, child]) =>
          child !== undefined
          && !["sca_authorization_id", "password", "pin", "totp", "transaction_pin"].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function assertScaOperation(value: unknown): ScaOperation {
  const operation = String(value || "") as ScaOperation;
  if (!OPERATIONS.has(operation)) throw new Error("invalid_sca_operation");
  return operation;
}

export function scaCanonicalPayload(resource: string, request: unknown): string {
  const normalizedResource = String(resource || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalizedResource)) {
    throw new Error("invalid_sca_resource");
  }
  return JSON.stringify(canonicalize({ resource: normalizedResource, request }));
}

export async function scaPayloadHash(resource: string, request: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(scaCanonicalPayload(resource, request));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function consumeScaAuthorization(params: {
  supabase: ScaDatabaseClient;
  authorizationId: unknown;
  userId: string;
  operation: ScaOperation;
  resource: string;
  request: unknown;
}): Promise<{ ok: true; required: boolean } | { ok: false; status: number; body: Record<string, unknown> }> {
  const scope = await resolveBridgeScaScope(params.supabase, params.userId);
  if (scope.status === "not_required") return { ok: true, required: false };
  if (scope.status === "unknown") {
    return {
      ok: false,
      status: 503,
      body: { success: false, code: "sca_scope_unavailable", error: "We could not determine the regulatory authentication requirement. Nothing was changed." },
    };
  }

  // Bridge prohibits EEA testing before QA approval. Keep the server rollout
  // switch off until Bridge approves the submitted implementation package.
  if (Deno.env.get("BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED") !== "true") {
    return {
      ok: false,
      status: 503,
      body: { success: false, code: "sca_approval_pending", error: "This EEA wallet action is unavailable while strong-authentication approval is pending." },
    };
  }

  const authorizationId = String(params.authorizationId || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authorizationId)) {
    return {
      ok: false,
      status: 403,
      body: { success: false, code: "sca_required", error: "Strong customer authentication is required." },
    };
  }

  const payloadHash = await scaPayloadHash(params.resource, params.request);
  const { data, error } = await params.supabase.rpc("consume_sca_authorization", {
    p_authorization_id: authorizationId,
    p_user_id: params.userId,
    p_operation: params.operation,
    p_resource: params.resource,
    p_payload_hash: payloadHash,
  });
  if (error) {
    console.error("sca_consume_lookup_failed", { code: error.code, operation: params.operation, resource: params.resource });
    return {
      ok: false,
      status: 503,
      body: { success: false, code: "sca_unavailable", error: "Strong authentication could not be verified. Nothing was changed." },
    };
  }
  if (data !== true) {
    return {
      ok: false,
      status: 403,
      body: { success: false, code: "sca_invalid", error: "Strong authentication expired, was already used, or does not match this action." },
    };
  }
  return { ok: true, required: true };
}
