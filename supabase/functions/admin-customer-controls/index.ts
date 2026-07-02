import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeFetch } from "../_shared/providers/bridge-client.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type Action =
  | "inspect_customer_assets"
  | "revoke_virtual_accounts"
  | "revoke_stablecoin_wallets"
  | "revoke_cards";

function norm(v: unknown): string {
  return String(v || "").trim();
}

function isProtectedInternalEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  if (e === "founder@borderpayafrica.com") return false;
  return e.endsWith("@borderpayafrica.com");
}

async function auditAdminAction(input: {
  actorId: string;
  actionType: string;
  targetResource: string;
  requestId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}) {
  await supa.from("admin_action_audit").insert({
    actor_id: input.actorId,
    role: "admin",
    action_type: input.actionType,
    target_resource: input.targetResource,
    before_state: input.beforeState ?? null,
    after_state: input.afterState ?? null,
    request_id: input.requestId,
  });
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false as const, status: 401, code: "missing_bearer_token", error: "Authentication required" };
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user) return { ok: false as const, status: 401, code: "invalid_auth_token", error: "Unauthorized" };
  const { data: profile } = await supa
    .from("user_profiles")
    .select("id,is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false as const, status: 403, code: "admin_only", error: "Admin access required" };
  return { ok: true as const, userId: user.id };
}

async function resolveTarget(input: { target_user_id?: string; target_email?: string }) {
  const userId = norm(input.target_user_id);
  const email = norm(input.target_email).toLowerCase();
  let q = supa
    .from("user_profiles")
    .select("id,email,account_type,bridge_customer_id")
    .limit(1);
  if (userId) q = q.eq("id", userId);
  else if (email) q = q.eq("email", email);
  else return null;
  const { data } = await q.maybeSingle();
  return data || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ success: false, code: "method_not_allowed", error: "POST only" }, 405);
  }

  const admin = await requireAdmin(req);
  if (!admin.ok) return json({ success: false, code: admin.code, error: admin.error }, admin.status);

  let body: any = {};
  try { body = await req.json(); } catch {
    return json({ success: false, code: "invalid_json_payload", error: "Invalid JSON payload" }, 400);
  }

  const action = norm(body?.action) as Action;
  const dryRun = body?.dry_run === true;
  if (!action) return json({ success: false, code: "action_required", error: "action is required" }, 400);
  if (!["inspect_customer_assets", "revoke_virtual_accounts", "revoke_stablecoin_wallets", "revoke_cards"].includes(action)) {
    return json({ success: false, code: "invalid_action", error: "Unsupported action" }, 400);
  }

  const target = await resolveTarget({
    target_user_id: body?.target_user_id,
    target_email: body?.target_email,
  });
  if (!target) return json({ success: false, code: "target_not_found", error: "Customer profile not found" }, 404);
  const targetEmail = String(target.email || "").toLowerCase();
  if (isProtectedInternalEmail(targetEmail) && action !== "inspect_customer_assets") {
    return json({
      success: false,
      code: "protected_internal_account",
      error: "This account is protected from revoke operations",
    }, 403);
  }
  if (!target.bridge_customer_id && action !== "inspect_customer_assets") {
    return json({
      success: false,
      code: "bridge_customer_required",
      error: "Target customer has no Bridge identity",
    }, 400);
  }

  const { data: vaRows } = await supa
    .from("bridge_virtual_accounts")
    .select("id,bridge_virtual_account_id,currency,status,updated_at")
    .or(`user_id.eq.${target.id},business_user_id.eq.${target.id}`)
    .order("updated_at", { ascending: false });

  const { data: walletRows } = await supa
    .from("bridge_wallets")
    .select("id,bridge_wallet_id,currency,chain,address,status,updated_at")
    .or(`user_id.eq.${target.id},business_user_id.eq.${target.id}`)
    .order("updated_at", { ascending: false });

  const requestId = crypto.randomUUID();

  if (action === "inspect_customer_assets") {
    await auditAdminAction({
      actorId: admin.userId,
      actionType: "inspect_customer_assets",
      targetResource: `user:${target.id}`,
      requestId,
      beforeState: {
        virtual_accounts: (vaRows || []).length,
        stablecoin_wallets: (walletRows || []).length,
      },
      afterState: {
        inspected: true,
      },
    });
    return json({
      success: true,
      code: "customer_assets_ready",
      request_id: requestId,
      data: {
        target,
        virtual_accounts: vaRows || [],
        stablecoin_wallets: walletRows || [],
        cards: [],
        dry_run: dryRun,
        notes: [
          "Cards are globally locked in BorderPay runtime; card revoke is not currently required.",
        ],
      },
    });
  }

  if (action === "revoke_cards") {
    await auditAdminAction({
      actorId: admin.userId,
      actionType: "revoke_cards",
      targetResource: `user:${target.id}`,
      requestId,
      beforeState: { cards_locked_globally: true },
      afterState: { cards_revoked: false, reason: "cards_locked_globally" },
    });
    return json({
      success: true,
      code: "cards_locked_globally",
      request_id: requestId,
      data: {
        target_user_id: target.id,
        dry_run: dryRun,
        notes: [
          "Cards are globally locked in BorderPay runtime.",
          "No provider-level card revocation call was executed.",
        ],
      },
    });
  }

  if (action === "revoke_virtual_accounts") {
    const active = (vaRows || []).filter((r: any) => String(r.status || "active").toLowerCase() === "active");
    const results: Array<Record<string, unknown>> = [];
    for (const va of active) {
      const vaId = String(va.bridge_virtual_account_id || "");
      if (!vaId) continue;
      if (dryRun) {
        results.push({ bridge_virtual_account_id: vaId, status: "would_revoke" });
        continue;
      }
      const provider = await bridgeFetch({
        method: "POST",
        path: `/v0/virtual_accounts/${encodeURIComponent(vaId)}/deactivate`,
        idempotencyKey: `borderpay:admin:va:deactivate:${vaId}`,
      });
      if (!provider.ok) {
        results.push({
          bridge_virtual_account_id: vaId,
          status: "provider_failed",
          bridge_status: provider.status || null,
          bridge_request_id: provider.request_id || null,
        });
        continue;
      }
      await supa
        .from("bridge_virtual_accounts")
        .update({ status: "closed", updated_at: new Date().toISOString() })
        .eq("bridge_virtual_account_id", vaId);
      results.push({ bridge_virtual_account_id: vaId, status: "revoked" });
    }
    await auditAdminAction({
      actorId: admin.userId,
      actionType: "revoke_virtual_accounts",
      targetResource: `user:${target.id}`,
      requestId,
      beforeState: { active_virtual_accounts: active.length, dry_run: dryRun },
      afterState: {
        processed: active.length,
        revoked: results.filter((r) => r.status === "revoked").length,
        provider_failed: results.filter((r) => r.status === "provider_failed").length,
        would_revoke: results.filter((r) => r.status === "would_revoke").length,
      },
    });
    return json({
      success: true,
      code: "virtual_accounts_revoke_completed",
      request_id: requestId,
      data: { target_user_id: target.id, dry_run: dryRun, processed: active.length, results },
    });
  }

  // Stablecoin wallets: no public Bridge delete/deactivate wallet endpoint in the
  // current BorderPay-integrated scope, so we close local access deterministically.
  const activeWallets = (walletRows || []).filter((r: any) => String(r.status || "active").toLowerCase() === "active");
  const walletIds = activeWallets.map((w: any) => String(w.bridge_wallet_id || "")).filter(Boolean);
  if (walletIds.length > 0 && !dryRun) {
    await supa
      .from("bridge_wallets")
      .update({ status: "closed", updated_at: new Date().toISOString() })
      .in("bridge_wallet_id", walletIds);
  }
  await auditAdminAction({
    actorId: admin.userId,
    actionType: "revoke_stablecoin_wallets",
    targetResource: `user:${target.id}`,
    requestId,
    beforeState: { active_stablecoin_wallets: activeWallets.length, dry_run: dryRun },
    afterState: { processed: activeWallets.length, revoked_local_access: !dryRun },
  });
  return json({
    success: true,
    code: "stablecoin_wallets_revoke_completed",
    request_id: requestId,
    data: {
      target_user_id: target.id,
      dry_run: dryRun,
      processed: activeWallets.length,
      notes: [
        "Stablecoin wallet access closed locally.",
        "Provider-level wallet deletion/deactivation is not exposed in current integrated Bridge wallet scope.",
      ],
    },
  });
});
