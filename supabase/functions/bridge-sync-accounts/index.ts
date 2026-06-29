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
import { loadVirtualAccountDeveloperFeePercent } from "../_shared/providers/virtual-account-config.ts";

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

function normalizeDeveloperFeePercent(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Number(n.toFixed(4));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({
      success: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "POST",
    }, 405);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({
      success: false,
      code: "missing_bearer_token",
      error: "Authentication required",
    }, 401);
  }
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) {
    return json({
      success: false,
      code: "invalid_auth_token",
      error: "Unauthorized",
    }, 401);
  }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("account_type, bridge_customer_id, country, phone")
    .eq("id", user.id)
    .maybeSingle();
  const isBusiness = profile?.account_type === "business";
  const customerId = profile?.bridge_customer_id;
  if (!customerId) {
    // Nothing to sync yet — not an error.
    return json({
      success: true,
      code: "sync_accounts_no_customer",
      data: {
        wallets: [],
        virtual_accounts: [],
        required_state: "bridge_customer_created",
      },
    });
  }

  const ownerCols = isBusiness
    ? { user_id: user.id, business_user_id: user.id }
    : { user_id: user.id };
  const canonicalVaDeveloperFee =
    normalizeDeveloperFeePercent(await loadVirtualAccountDeveloperFeePercent(supa));

  // ── Customer profile sync (Bridge source-of-truth) ───────────────────────
  // Keep both user_profiles.country and business_profiles.country hydrated from
  // the Bridge customer object so KYB-approved business provisioning cannot be
  // blocked by null country fields.
  try {
    const customer = await bridgeProvider.getCustomerProfile(customerId);
    const country = String(customer.country ?? "").trim().toUpperCase();
    if (country) {
      const userUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (!profile?.country) userUpdate.country = country;
      if (!profile?.phone && customer.phone) userUpdate.phone = customer.phone;
      if (customer.address_object && Object.values(customer.address_object).some((v) => String(v ?? "").trim().length > 0)) {
        userUpdate.bridge_address_object = customer.address_object;
        const line1 = customer.address_object.street_line_1;
        const line2 = customer.address_object.street_line_2;
        if (line1) userUpdate.address = line2 ? `${line1}, ${line2}` : line1;
        if (customer.address_object.city) userUpdate.city = customer.address_object.city;
        if (customer.address_object.postal_code) userUpdate.postal_code = customer.address_object.postal_code;
      }
      await supa.from("user_profiles").update(userUpdate).eq("id", user.id);

      if (isBusiness) {
        const { data: biz } = await supa
          .from("business_profiles")
          .select("country, company_phone, address, city, state, postal_code")
          .eq("user_id", user.id)
          .maybeSingle();
        const bizUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (!biz?.country) bizUpdate.country = country;
        if (!biz?.company_phone && customer.phone) bizUpdate.company_phone = customer.phone;
        if (customer.address_object?.street_line_1 && !biz?.address) {
          const line1 = customer.address_object.street_line_1;
          const line2 = customer.address_object.street_line_2;
          bizUpdate.address = line2 ? `${line1}, ${line2}` : line1;
        }
        if (customer.address_object?.city && !biz?.city) bizUpdate.city = customer.address_object.city;
        if (customer.address_object?.state && !biz?.state) bizUpdate.state = customer.address_object.state;
        if (customer.address_object?.postal_code && !biz?.postal_code) bizUpdate.postal_code = customer.address_object.postal_code;
        await supa.from("business_profiles").update(bizUpdate).eq("user_id", user.id);
      }
    }
  } catch (e) {
    console.warn(`bridge-sync-accounts customer_profile: ${(e as Error).message}`);
  }

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
      const normalizedCurrency = keepNonEmpty(w.currency, existing?.currency);
      if (!normalizedCurrency) {
        console.warn(`bridge-sync-accounts wallets: skipping wallet ${w.wallet_id} due to empty currency`);
        continue;
      }
      const row = {
        ...ownerCols,
        bridge_customer_id: customerId,
        bridge_wallet_id:   w.wallet_id,
        currency:           normalizedCurrency,
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
  }

  // ── Virtual accounts ───────────────────────────────────────────────────────
  try {
    const bva = await bridgeProvider.listVirtualAccounts(customerId);
    for (const v of bva) {
      if (!v.virtual_account_id) continue;
      const normalizedVaCurrency = String(v.currency || "").trim().toUpperCase();
      if (!normalizedVaCurrency) {
        console.warn(`bridge-sync-accounts virtual_accounts: skipping VA ${v.virtual_account_id} due to empty currency`);
        continue;
      }
      const { data: existing } = await supa.from("bridge_virtual_accounts")
        .select("id,developer_fee_percent").eq("bridge_virtual_account_id", v.virtual_account_id).maybeSingle();
      const row = {
        ...ownerCols,
        bridge_customer_id:        customerId,
        bridge_virtual_account_id: v.virtual_account_id,
        currency:                  normalizedVaCurrency,
        rail:                      v.rail ?? null,
        status:                    v.status ?? "active",
        developer_fee_percent:
          normalizeDeveloperFeePercent(v.developer_fee_percent) ??
          normalizeDeveloperFeePercent(existing?.developer_fee_percent) ??
          canonicalVaDeveloperFee,
        account_details:           v.account_details ?? null,
        updated_at:                new Date().toISOString(),
      };
      if (existing?.id) await supa.from("bridge_virtual_accounts").update(row).eq("id", existing.id);
      else              await supa.from("bridge_virtual_accounts").insert(row);
    }
  } catch (e) {
    console.warn(`bridge-sync-accounts virtual_accounts: ${(e as Error).message}`);
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
    code: "sync_accounts_completed",
    data: { wallets: wallets ?? [], virtual_accounts: virtualAccounts ?? [] },
  });
});
