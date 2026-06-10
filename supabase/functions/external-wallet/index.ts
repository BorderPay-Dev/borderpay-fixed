// external-wallet — manage a user's saved external stablecoin payout addresses.
//
// POST { action: 'add'|'remove'|'list', ... }. verify_jwt = true (config.toml).
//   add    : { label, chain, asset, address }  → validates address per chain
//   remove : { id }                            → soft-removes (status=removed)
//   list   : {}                                → active wallets (also readable via RLS)
//
// No money moves here — withdrawals go through bridge-transfer (gated +
// passcode/biometric). This only stores/validates destinations.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const EVM = new Set(["base", "ethereum", "polygon", "arbitrum", "optimism", "bsc"]);
const SUPPORTED_CHAINS = new Set([...EVM, "tron", "solana"]);
const SUPPORTED_ASSETS = new Set(["USDC", "USDT"]);

function validAddress(chain: string, address: string): boolean {
  const a = (address || "").trim();
  if (EVM.has(chain))      return /^0x[a-fA-F0-9]{40}$/.test(a);
  if (chain === "tron")    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
  if (chain === "solana")  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const action = String(body.action || "list");

  if (action === "list") {
    const { data } = await supa
      .from("external_wallets")
      .select("id, label, chain, asset, address, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    return json({ success: true, data: { wallets: data ?? [] } });
  }

  if (action === "remove") {
    const id = String(body.id || "");
    if (!id) return json({ success: false, error: "id required" }, 400);
    await supa.from("external_wallets")
      .update({ status: "removed" })
      .eq("user_id", user.id)
      .eq("id", id);
    return json({ success: true, data: { removed: true, id } });
  }

  if (action === "add") {
    const label   = String(body.label || "").trim().slice(0, 40);
    const chain   = String(body.chain || "").trim().toLowerCase();
    const asset   = String(body.asset || "").trim().toUpperCase();
    const address = String(body.address || "").trim();

    if (!label)                          return json({ success: false, error: "Add a name for this wallet." }, 400);
    if (!SUPPORTED_CHAINS.has(chain))    return json({ success: false, error: "Unsupported network." }, 400);
    if (!SUPPORTED_ASSETS.has(asset))    return json({ success: false, error: "Unsupported asset." }, 400);
    if (!validAddress(chain, address))   return json({ success: false, error: "That address isn't valid for the selected network." }, 422);

    const { data, error } = await supa.from("external_wallets")
      .upsert({ user_id: user.id, label, chain, asset, address, status: "active" },
              { onConflict: "user_id,chain,address" })
      .select("id, label, chain, asset, address, created_at")
      .maybeSingle();
    if (error) return json({ success: false, error: "Could not save that wallet. Please try again." }, 500);
    return json({ success: true, data: { wallet: data } });
  }

  return json({ success: false, error: "Unknown action" }, 400);
});
