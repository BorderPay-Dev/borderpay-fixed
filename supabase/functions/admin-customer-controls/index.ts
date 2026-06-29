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

  if (action === "inspect_customer_assets") {
    return json({
      success: true,
      code: "customer_assets_ready",
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
    return json({
      success: true,
      code: "cards_locked_globally",
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
      await supa
        .from("wallets")
        .update({ status: "closed", updated_at: new Date().toISOString() })
        .eq("bridge_virtual_account_id", vaId);
      results.push({ bridge_virtual_account_id: vaId, status: "revoked" });
    }
    return json({
      success: true,
      code: "virtual_accounts_revoke_completed",
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
    await supa
      .from("wallets")
      .update({ status: "closed", updated_at: new Date().toISOString() })
      .in("bridge_wallet_id", walletIds);
  }
  return json({
    success: true,
    code: "stablecoin_wallets_revoke_completed",
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
