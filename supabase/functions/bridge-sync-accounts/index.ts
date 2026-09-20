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

import {redactBankCoordinates,requiresInvoiceInstructions} from "../_shared/predeposit-access.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { selectVaLinkedBaseWallet } from "../../../utils/financial/vaLinkedWalletPresentation.ts";
import { bridgeProvider } from "../_shared/providers/bridge.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const baseJson = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control":"no-store" } });

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

function normalizeBridgeVaStatus(value: unknown): "active" | "suspended" | "closed" {
  const status = String(value ?? "").trim().toLowerCase();
  if (["closed", "deleted", "disabled", "deactivated", "inactive"].includes(status)) return "closed";
  if (["suspended", "paused"].includes(status)) return "suspended";
  return "active";
}

function normalizeDeveloperFeePercent(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Number(n.toFixed(4));
}

Deno.serve(async (req) => {
 let invoiceRequired=false,invoiceOwner:string|null=null;
 const json=async(b:unknown,s=200)=>{
  if(!invoiceOwner)return baseJson(b,s);
  try{const current=await requiresInvoiceInstructions(supa,invoiceOwner);return baseJson(invoiceRequired||current?redactBankCoordinates(b):b,s);}
  catch{return baseJson({success:false,error:"Receiving instruction policy is unavailable"},503);}
 };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
  invoiceOwner=user.id;
  try { invoiceRequired=await requiresInvoiceInstructions(supa,user.id); }catch{return json({success:false,error:"Receiving instruction policy is unavailable"},503);}

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

  let providerVas: Awaited<ReturnType<typeof bridgeProvider.listVirtualAccounts>> | null = null;

  // Resolve both live resources before persisting routing. Older clients read
  // destination IDs but did not fetch wallet addresses.
  const [vaRead, walletRead] = await Promise.allSettled([
    bridgeProvider.listVirtualAccounts(customerId),
    bridgeProvider.listWallets(customerId),
  ]);
  const liveCanonicalBase = vaRead.status === "fulfilled" && walletRead.status === "fulfilled"
    ? selectVaLinkedBaseWallet(walletRead.value.map(w => ({ ...w, status: w.status || "active" })), vaRead.value)
    : null;

  // ── Virtual accounts ───────────────────────────────────────────────────────
  try {
    if (vaRead.status === "rejected") throw vaRead.reason;
    const bva = vaRead.value;
    providerVas = bva;
    for (const v of bva) {
      if (!v.virtual_account_id) continue;
      const { data: existing } = await supa.from("bridge_virtual_accounts")
        .select("id,account_details").eq("bridge_virtual_account_id", v.virtual_account_id).maybeSingle();
      const existingDetails = existing?.account_details && typeof existing.account_details === "object"
        ? existing.account_details as Record<string, unknown>
        : {};
      const providerDetails = v.account_details && typeof v.account_details === "object"
        ? v.account_details as Record<string, unknown>
        : {};
      // The latest API destination is authoritative, including an explicit null.
      const providerDestination = providerDetails.destination ?? null;
      const destination = providerDestination && typeof providerDestination === "object"
        ? providerDestination as Record<string, unknown> : null;
      const addressMatches = destination && liveCanonicalBase &&
        String(destination.address || "").trim().toLowerCase() === String(liveCanonicalBase.address || "").trim().toLowerCase() &&
        String(destination.address || "").trim() !== "";
      const derivedId = destination && !destination.bridge_wallet_id && addressMatches &&
        String(destination.payment_rail || "").toLowerCase() === "base" &&
        ["usdc", "eurc"].includes(String(destination.currency || "").toLowerCase())
        ? liveCanonicalBase.wallet_id : null;
      const normalizedDestination = derivedId
        ? { ...destination, bridge_wallet_id: derivedId } : providerDestination;
      const row = {
        ...ownerCols,
        bridge_customer_id:        customerId,
        bridge_virtual_account_id: v.virtual_account_id,
        currency:                  v.currency,
        rail:                      normalizeBridgeVaRail(v.rail),
        status:                    normalizeBridgeVaStatus(v.status),
        ...(normalizeDeveloperFeePercent(v.developer_fee_percent) !== null
          ? { developer_fee_percent: normalizeDeveloperFeePercent(v.developer_fee_percent) }
          : {}),
        account_details:           {
          ...existingDetails,
          ...providerDetails,
          destination: normalizedDestination,
          // Keep the exact API response separate from legacy normalized routing.
          bridge_provider_raw: providerDetails,
          bridge_sync_raw: { ...providerDetails, destination: normalizedDestination },
          wallet_binding: derivedId ? {
            source: "provider_wallet_address_match",
            bridge_wallet_id: derivedId,
            bridge_customer_id: customerId,
          } : null,
        },
        updated_at:                new Date().toISOString(),
      };
      const saved = existing?.id
        ? await supa.from("bridge_virtual_accounts").update(row).eq("id", existing.id)
        : await supa.from("bridge_virtual_accounts").insert(row);
      if (saved.error) throw new Error("Virtual account projection could not be saved");
    }
  } catch (e) {
    console.warn(`bridge-sync-accounts virtual_accounts: ${(e as Error).message}`);
    warnings.push("virtual_account_sync_failed");
  }

  // ── Wallets ───────────────────────────────────────────────────────────────
  try {
    if (walletRead.status === "rejected") throw walletRead.reason;
    const bw = walletRead.value;
    const canonicalBase = providerVas === null ? null : selectVaLinkedBaseWallet(
      bw.map(w => ({ ...w, status: w.status || "active" })), providerVas,
    );
    for (const w of bw) {
      // Only the API-confirmed VA destination is mirrored for Base. Historical
      // unlinked resources stay at Bridge and are never fetched individually.
      if (w.chain.toLowerCase() === "base" && w.wallet_id !== canonicalBase?.wallet_id) continue;
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
        status:             w.status || "active",
        updated_at:         new Date().toISOString(),
      };
      const saved = existing?.id
        ? await supa.from("bridge_wallets").update(row).eq("id", existing.id)
        : await supa.from("bridge_wallets").insert(row);
      if (saved.error) throw new Error("Wallet projection could not be saved");
    }
  } catch (e) {
    // Preserve the previous projection and surface a soft note.
    console.warn(`bridge-sync-accounts wallets: ${(e as Error).message}`);
    warnings.push("wallet_sync_failed");
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

  const canonicalBase = providerVas === null ? null : selectVaLinkedBaseWallet(wallets, providerVas);
  const customerWallets = (wallets ?? []).filter((wallet) =>
    wallet.bridge_wallet_id === canonicalBase?.bridge_wallet_id &&
    String(wallet.chain || "").toLowerCase() === "base" &&
    ["USDC", "EURC"].includes(String(wallet.currency || "").toUpperCase())
  );
  return json({
    success: true,
    data: { wallets: customerWallets, virtual_accounts: virtualAccounts ?? [], warnings },
  });
});
