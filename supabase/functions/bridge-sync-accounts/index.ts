// bridge-sync-accounts — pull the customer's wallets + virtual accounts from
// Bridge and mirror them into the tables the app reads (bridge_wallets,
// bridge_virtual_accounts). READ-ONLY at Bridge (GET only) — no money movement.
//
// Why this exists: creates can succeed at Bridge but fail to persist locally,
// and accounts created on the Bridge dashboard are otherwise invisible in-app.
// The dashboard calls this on load so what the user sees always matches Bridge.
//
// POST {} → { success, data: { wallets: [...], virtual_accounts: [...] } }

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

  const ownerCols = isBusiness
    ? { user_id: user.id, business_user_id: user.id }
    : { user_id: user.id };

  let wallets: any[] = [];
  let vas: any[] = [];

  // ── Wallets ───────────────────────────────────────────────────────────────
  try {
    const bw = await bridgeProvider.listWallets(customerId);
    for (const w of bw) {
      if (!w.wallet_id) continue;
      const { data: existing } = await supa.from("bridge_wallets")
        .select("id").eq("bridge_wallet_id", w.wallet_id).maybeSingle();
      const row = {
        ...ownerCols,
        bridge_customer_id: customerId,
        bridge_wallet_id:   w.wallet_id,
        currency:           w.currency,
        chain:              w.chain,
        address:            w.address,
        status:             "active",
        updated_at:         new Date().toISOString(),
      };
      if (existing?.id) await supa.from("bridge_wallets").update(row).eq("id", existing.id);
      else              await supa.from("bridge_wallets").insert(row);
    }
    wallets = bw;
  } catch (e) {
    // Non-fatal: still try VAs, surface a soft note.
    console.warn(`bridge-sync-accounts wallets: ${(e as Error).message}`);
  }

  // ── Virtual accounts ───────────────────────────────────────────────────────
  try {
    const bva = await bridgeProvider.listVirtualAccounts(customerId);
    for (const v of bva) {
      if (!v.virtual_account_id) continue;
      const { data: existing } = await supa.from("bridge_virtual_accounts")
        .select("id").eq("bridge_virtual_account_id", v.virtual_account_id).maybeSingle();
      const row = {
        ...ownerCols,
        bridge_customer_id:        customerId,
        bridge_virtual_account_id: v.virtual_account_id,
        currency:                  v.currency,
        rail:                      v.rail ?? null,
        status:                    v.status ?? "active",
        account_details:           v.account_details ?? null,
        updated_at:                new Date().toISOString(),
      };
      if (existing?.id) await supa.from("bridge_virtual_accounts").update(row).eq("id", existing.id);
      else              await supa.from("bridge_virtual_accounts").insert(row);
    }
    vas = bva;
  } catch (e) {
    console.warn(`bridge-sync-accounts virtual_accounts: ${(e as Error).message}`);
  }

  return json({ success: true, data: { wallets, virtual_accounts: vas } });
});
