// Read-only Bridge customer reconciliation for the admin projection.
// Bridge is authoritative for customer/KYC/KYB state. This function never
// creates customers, moves money, sends email, or changes provider resources.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BridgeProviderError, bridgeProvider } from "../_shared/providers/bridge.ts";
import {
  type BridgeCustomerState as ProviderState,
  deriveBridgeCustomerStates as deriveProviderStates,
} from "../_shared/bridge-customer-state.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET") ?? "";
const RECONCILE_TOKEN = Deno.env.get("BRIDGE_RECONCILE_TOKEN") ?? "";
const WORKER_TOKEN = Deno.env.get("COMPLIANCE_WORKER_TOKEN") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Owner = {
  user_id: string;
  account_type: "individual" | "business";
  bridge_customer_id: string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function authorized(header: string | null): boolean {
  const token = clean(header).replace(/^Bearer\s+/i, "");
  return timingSafeEqual(token, SERVICE_ROLE) ||
    timingSafeEqual(token, ADMIN_SECRET) ||
    timingSafeEqual(token, RECONCILE_TOKEN) ||
    timingSafeEqual(token, WORKER_TOKEN);
}

function isKnownNonLiveCustomer(customerId: string): boolean {
  return customerId.startsWith("demo_") || customerId.includes("demo_bridge_customer");
}

function canonicalKyc(status: ProviderState): "unverified" | "pending" | "verified" | "rejected" {
  if (status === "approved") return "verified";
  if (status === "rejected") return "rejected";
  if (["under_review", "awaiting_rfi", "needs_edd", "needs_ubos"].includes(status)) return "pending";
  return "unverified";
}

function bridgeKycColumn(status: ProviderState): string {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "under_review") return "under_review";
  if (["awaiting_rfi", "needs_edd", "needs_ubos"].includes(status)) return "pending";
  // This column historically has a narrow DB constraint. Exact incomplete and
  // account lifecycle state lives in bridge_account_status.
  return "not_started";
}

async function loadOwners(limit: number, offset: number): Promise<Owner[]> {
  // Bridge IDs historically landed in either table. Build one deterministic
  // owner list before applying the cursor so business-only mappings are never
  // omitted and a duplicated ID is reconciled only once.
  const [{ data: profiles, error: profileError }, { data: businesses, error: businessError }] = await Promise.all([
    db.from("user_profiles")
      .select("id,account_type,bridge_customer_id,is_admin")
      .not("bridge_customer_id", "is", null)
      .order("id", { ascending: true }),
    db.from("business_profiles")
      .select("user_id,bridge_customer_id")
      .not("bridge_customer_id", "is", null)
      .order("user_id", { ascending: true }),
  ]);
  if (profileError) throw new Error(`user owner query failed: ${profileError.message}`);
  if (businessError) throw new Error(`business owner query failed: ${businessError.message}`);

  const owners = new Map<string, Owner>();
  const adminIds = new Set<string>();
  for (const profile of (profiles || []) as Record<string, unknown>[]) {
    const userId = clean(profile.id);
    const customerId = clean(profile.bridge_customer_id);
    if (profile.is_admin === true) adminIds.add(userId);
    if (!userId || !customerId || profile.is_admin === true || isKnownNonLiveCustomer(customerId)) continue;
    owners.set(userId, {
      user_id: userId,
      account_type: clean(profile.account_type).toLowerCase() === "business" ? "business" : "individual",
      bridge_customer_id: customerId,
    });
  }
  for (const business of (businesses || []) as Record<string, unknown>[]) {
    const userId = clean(business.user_id);
    const customerId = clean(business.bridge_customer_id);
    if (!userId || !customerId || adminIds.has(userId) || isKnownNonLiveCustomer(customerId)) continue;
    owners.set(userId, { user_id: userId, account_type: "business", bridge_customer_id: customerId });
  }

  return [...owners.values()]
    .sort((left, right) => left.user_id.localeCompare(right.user_id))
    .slice(offset, offset + limit);
}

async function closeRemovedCustomer(owner: Owner, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  const now = new Date().toISOString();
  const { error: profileError } = await db.from("user_profiles").update({
    bridge_account_status: "offboarded",
    bridge_verification_status: "offboarded",
    kyc_status: "unverified",
    updated_at: now,
  }).eq("id", owner.user_id);
  if (profileError) throw new Error(`profile offboard failed: ${profileError.message}`);

  const updates = await Promise.all([
    db.from("bridge_virtual_accounts").update({ status: "closed", updated_at: now }).eq("bridge_customer_id", owner.bridge_customer_id),
    db.from("bridge_wallets").update({ status: "closed", updated_at: now }).eq("bridge_customer_id", owner.bridge_customer_id),
    db.from("bridge_external_accounts").update({ status: "deleted", active: false, updated_at: now }).eq("bridge_customer_id", owner.bridge_customer_id),
  ]);
  const failure = updates.find((entry) => entry.error);
  if (failure?.error) throw new Error(`provider resource closure failed: ${failure.error.message}`);
}

async function persistLiveCustomer(owner: Owner, customerRaw: unknown, dryRun: boolean) {
  const states = deriveProviderStates(customerRaw, owner.account_type);
  if (dryRun) return states;
  const now = new Date().toISOString();
  const canonical = canonicalKyc(states.verification_status);
  const profilePatch: Record<string, unknown> = {
    bridge_account_status: states.account_status,
    bridge_verification_status: states.verification_status,
    bridge_kyc_status: bridgeKycColumn(states.verification_status),
    kyc_status: canonical,
    bridge_kyc_completed_at: states.verification_status === "approved" ? now : null,
    updated_at: now,
  };
  const { error: profileError } = await db.from("user_profiles").update(profilePatch).eq("id", owner.user_id);
  if (profileError) throw new Error(`profile status update failed: ${profileError.message}`);

  if (owner.account_type === "business") {
    const { error } = await db.from("business_profiles").update({
      bridge_kyb_status: bridgeKycColumn(states.verification_status),
      bridge_kyb_completed_at: states.verification_status === "approved" ? now : null,
      updated_at: now,
    }).eq("user_id", owner.user_id);
    if (error) throw new Error(`business status update failed: ${error.message}`);
  }
  return states;
}

async function reconcileOwner(owner: Owner, dryRun: boolean) {
  try {
    const customer = await bridgeProvider.getCustomerProfile(owner.bridge_customer_id);
    const states = await persistLiveCustomer(owner, customer.raw, dryRun);
    return { ...owner, outcome: "synced", ...states };
  } catch (error) {
    if (error instanceof BridgeProviderError && error.status === 404) {
      await closeRemovedCustomer(owner, dryRun);
      return {
        ...owner,
        outcome: "removed",
        account_status: "offboarded",
        verification_status: "offboarded",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ...owner, outcome: "error", error: message };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  if (!authorized(request.headers.get("Authorization"))) return json({ success: false, error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* default batch */ }
  const limit = Math.max(1, Math.min(25, Number(body.limit ?? 20)));
  const offset = Math.max(0, Number(body.offset ?? 0));
  const dryRun = body.dry_run !== false;
  const owners = await loadOwners(limit, offset);
  const results = [];
  for (const owner of owners) results.push(await reconcileOwner(owner, dryRun));

  const summary = results.reduce((acc, row) => {
    if (row.outcome === "synced") acc.synced += 1;
    else if (row.outcome === "removed") acc.removed += 1;
    else acc.errors += 1;
    return acc;
  }, { owners: owners.length, synced: 0, removed: 0, errors: 0, offset, limit, dry_run: dryRun });

  return json({
    success: summary.errors === 0,
    code: "bridge_customer_reconciliation_complete",
    has_more: owners.length === limit,
    next_offset: offset + owners.length,
    summary,
    results,
  });
});
