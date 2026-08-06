// bridge-sync-accounts — pull the customer's wallets + virtual accounts from
// Bridge and mirror them into the tables the app reads (bridge_wallets,
// bridge_virtual_accounts). READ-ONLY at Bridge (GET only) — no money movement.
//
// Why this exists: creates can succeed at Bridge but fail to persist locally,
// and accounts created on the Bridge dashboard are otherwise invisible in-app.
// The dashboard calls this on load so what the user sees always matches Bridge.
//
// POST {} → { success, data: { wallets: [...], virtual_accounts: [...] } }
//
// Contract rule: response is sourced from BorderPay internal tables only.
// We never expose provider response shape directly to product surfaces.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalizeBridgeVaRail(value: unknown): string | null {
  const rail = String(value ?? "").trim().toLowerCase();
  if (!rail) return null;
  if (rail === "ach") return "ach_push";
  if (["ach_push", "ach_pull", "wire", "sepa", "faster_payments"].includes(rail)) return rail;
  return null;
}

function normalizeBridgeVaStatus(value: unknown): "active" | "suspended" | "deactivated" | "closed" {
  const status = String(value ?? "").trim().toLowerCase();
  if (["deactivated", "inactive"].includes(status)) return "deactivated";
  if (["closed", "deleted", "disabled"].includes(status)) return "closed";
  if (["suspended", "paused"].includes(status)) return "suspended";
  return "active";
}

function normalizeDeveloperFeePercent(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Number(n.toFixed(4));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: profile } = await supa
    .from("user_profiles")
    .select("account_type, bridge_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const isBusiness = profile?.account_type === "business";
  const customerId = profile?.bridge_customer_id;
  if (!customerId) {
    // Nothing to sync yet — not an error.
    return json({ success: true, data: { wallets: [], virtual_accounts: [] } });
  }

  const ownerCols: { user_id: string; business_user_id: string | null } = isBusiness
    ? { user_id: user.id, business_user_id: user.id }
    : { user_id: user.id, business_user_id: null };
  const warnings: string[] = [];

  // ── Wallets ───────────────────────────────────────────────────────────────
  try {
    const bw = await bridgeProvider.listWallets(customerId);
    for (const w of bw) {
      if (!w.wallet_id) continue;
      const { data: existing } = await supa.from("bridge_wallets")
        .select("id, currency, chain, address").eq("bridge_wallet_id", w.wallet_id).maybeSingle();
      // Defense in depth: NEVER overwrite a non-empty field with an empty one.
      // The provider's wallet listing has occasionally been observed to return
      // entries without a currency value; honoring that would wipe the local
      // label (and now also trip the bridge_wallets_currency_nonempty CHECK).
      const keepNonEmpty = (next: string, prev?: string | null) =>
        (next && String(next).trim().length > 0) ? next : (prev ?? "");
      const row = {
        ...ownerCols,
        bridge_customer_id: customerId,
        bridge_wallet_id:   w.wallet_id,
        currency:           keepNonEmpty(w.currency, existing?.currency) || "USDC",
        chain:              keepNonEmpty(w.chain,    existing?.chain),
        address:            keepNonEmpty(w.address,  existing?.address),
        status:             "active",
        updated_at:         new Date().toISOString(),
      };
      if (existing?.id) await supa.from("bridge_wallets").update(row).eq("id", existing.id);
      else              await supa.from("bridge_wallets").insert(row);
    }
  } catch (e) {
    // Non-fatal: still try VAs, surface a soft note.
    console.warn(`bridge-sync-accounts wallets: ${(e as Error).message}`);
    warnings.push("wallet_sync_failed");
  }

  // ── Virtual accounts ───────────────────────────────────────────────────────
  try {
    const bva = await bridgeProvider.listVirtualAccounts(customerId);
    for (const v of bva) {
      if (!v.virtual_account_id) continue;
      const { data: existing } = await supa.from("bridge_virtual_accounts")
        .select("id,account_details,activated_at,status").eq("bridge_virtual_account_id", v.virtual_account_id).maybeSingle();
      const existingDetails = existing?.account_details && typeof existing.account_details === "object"
        ? existing.account_details as Record<string, unknown>
        : {};
      const providerDetails = v.account_details && typeof v.account_details === "object"
        ? v.account_details as Record<string, unknown>
        : {};
      const preservedDestination = existingDetails.destination && typeof existingDetails.destination === "object"
        ? existingDetails.destination
        : providerDetails.destination;
      const normalizedStatus = normalizeBridgeVaStatus(v.status);
      const reactivatedBySupport = existing?.status === "deactivated" && normalizedStatus === "active";
      const row = {
        ...ownerCols,
        bridge_customer_id:        customerId,
        bridge_virtual_account_id: v.virtual_account_id,
        currency:                  v.currency,
        rail:                      normalizeBridgeVaRail(v.rail),
        status:                    normalizedStatus,
        activated_at:              reactivatedBySupport ? new Date().toISOString() : existing?.activated_at ||
          (v.created_at && !Number.isNaN(Date.parse(v.created_at)) ? v.created_at : new Date().toISOString()),
        ...(reactivatedBySupport ? { deactivated_at: null, deactivation_reason: null } : {}),
        ...(normalizeDeveloperFeePercent(v.developer_fee_percent) !== null
          ? { developer_fee_percent: normalizeDeveloperFeePercent(v.developer_fee_percent) }
          : {}),
        account_details:           {
          ...existingDetails,
          ...providerDetails,
          ...(preservedDestination ? { destination: preservedDestination } : {}),
          bridge_sync_raw: providerDetails,
        },
        updated_at:                new Date().toISOString(),
      };
      if (existing?.id) await supa.from("bridge_virtual_accounts").update(row).eq("id", existing.id);
      else              await supa.from("bridge_virtual_accounts").insert(row);
    }
  } catch (e) {
    console.warn(`bridge-sync-accounts virtual_accounts: ${(e as Error).message}`);
    warnings.push("virtual_account_sync_failed");
  }

  // Return internal normalized state (not provider payload) so UI/product
  // logic depends only on BorderPay's own schema.
  const wq = supa
    .from("bridge_wallets")
    .select("bridge_wallet_id,currency,chain,address,status,updated_at")
    .order("updated_at", { ascending: false });
  const vq = supa
    .from("bridge_virtual_accounts")
    .select("bridge_virtual_account_id,currency,rail,status,account_details,updated_at")
    .order("updated_at", { ascending: false });
  const [{ data: wallets }, { data: virtualAccounts }] = isBusiness
    ? await Promise.all([
        wq.eq("business_user_id", user.id),
        vq.eq("business_user_id", user.id),
      ])
    : await Promise.all([
        wq.eq("user_id", user.id),
        vq.eq("user_id", user.id),
      ]);

  return json({
    success: true,
    data: { wallets: wallets ?? [], virtual_accounts: virtualAccounts ?? [], warnings },
  });
});
