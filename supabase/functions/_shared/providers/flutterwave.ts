/**
 * Flutterwave provider client (shared by activation / payouts / collections).
 *
 * Secrets (set by operator as Supabase function secrets — NEVER in source):
 *   • FLUTTERWAVE_SECRET_KEY    — Bearer key for the v3 API (production).
 *   • FLUTTERWAVE_WEBHOOK_HASH  — the "Secret hash" configured in the Flutterwave
 *                                 dashboard; Flutterwave sends it back in the
 *                                 `verif-hash` header on every webhook.
 *
 * Partner-neutrality: callers must NOT forward Flutterwave's raw errors to end
 * users (friendlyError already scrubs the word "flutterwave" as a backstop).
 */

const FLW_BASE = "https://api.flutterwave.com/v3";

export function flutterwaveConfigured(): boolean {
  return !!(Deno.env.get("FLUTTERWAVE_SECRET_KEY") || "").trim();
}

function secret(): string {
  const k = (Deno.env.get("FLUTTERWAVE_SECRET_KEY") || "").trim();
  if (!k) throw new Error("FLUTTERWAVE_SECRET_KEY not set");
  return k;
}

/**
 * Verify the webhook `verif-hash` header against the configured secret hash.
 * Length-aware constant-time compare. Returns false if either side is missing.
 */
export function verifyWebhookSignature(headerHash: string | null | undefined): boolean {
  const expected = (Deno.env.get("FLUTTERWAVE_WEBHOOK_HASH") || "").trim();
  const got = (headerHash || "").trim();
  if (!expected || !got || expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export interface CreatePaymentInput {
  tx_ref:       string;
  amount:       number;            // major units (e.g. 9.99)
  currency:     string;            // "USD"
  redirect_url: string;
  customer:     { email: string; name?: string };
  meta?:        Record<string, unknown>;
  title?:       string;
  /** Comma-separated methods to show (e.g. "card"). Omitted → provider default. */
  payment_options?: string;
}

/** Create a Standard hosted-checkout payment. Returns the hosted payment link. */
export async function createPayment(p: CreatePaymentInput): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${FLW_BASE}/payments`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${secret()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_ref:       p.tx_ref,
        amount:       p.amount,
        currency:     p.currency,
        redirect_url: p.redirect_url,
        customer:     p.customer,
        meta:         p.meta ?? {},
        ...(p.payment_options ? { payment_options: p.payment_options } : {}),
        customizations: { title: p.title || "BorderPay Africa", description: "Account activation" },
      }),
    });
    const data = await res.json().catch(() => ({}));
    const link = data?.data?.link;
    if (!res.ok || data?.status !== "success" || !link) {
      return { ok: false, error: data?.message || `payment_create_failed_${res.status}` };
    }
    return { ok: true, link };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** List banks for a country (read-only). e.g. country = "NG" | "KE" | "GH" | "UG". */
export async function listBanks(country: string): Promise<{ ok: true; banks: Array<{ id: number; code: string; name: string }> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${FLW_BASE}/banks/${encodeURIComponent(country.toUpperCase())}`, {
      headers: { "Authorization": `Bearer ${secret()}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.status !== "success" || !Array.isArray(data?.data)) {
      return { ok: false, error: data?.message || `banks_failed_${res.status}` };
    }
    return { ok: true, banks: data.data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Resolve a bank account number → account holder name (read-only validation). */
export async function resolveAccount(accountNumber: string, bankCode: string): Promise<{ ok: true; account_name: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${FLW_BASE}/accounts/resolve`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${secret()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ account_number: accountNumber, account_bank: bankCode }),
    });
    const data = await res.json().catch(() => ({}));
    const name = data?.data?.account_name;
    if (!res.ok || data?.status !== "success" || !name) {
      return { ok: false, error: data?.message || `resolve_failed_${res.status}` };
    }
    return { ok: true, account_name: name };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface VerifiedTx {
  ok:       boolean;
  status:   string;     // "successful" | ...
  amount:   number;     // major units
  currency: string;
  tx_ref:   string;
  flw_id:   string;
  error?:   string;
}

/** Server-side verify a transaction by Flutterwave id (the source of truth). */
export async function verifyTransaction(flwTxId: string | number): Promise<VerifiedTx> {
  try {
    const res = await fetch(`${FLW_BASE}/transactions/${encodeURIComponent(String(flwTxId))}/verify`, {
      headers: { "Authorization": `Bearer ${secret()}` },
    });
    const data = await res.json().catch(() => ({}));
    const d = data?.data ?? {};
    return {
      ok:       res.ok && data?.status === "success",
      status:   String(d?.status ?? "unknown"),
      amount:   Number(d?.amount ?? 0),
      currency: String(d?.currency ?? ""),
      tx_ref:   String(d?.tx_ref ?? ""),
      flw_id:   String(d?.id ?? flwTxId),
      error:    res.ok ? undefined : (data?.message || `verify_failed_${res.status}`),
    };
  } catch (e) {
    return { ok: false, status: "error", amount: 0, currency: "", tx_ref: "", flw_id: String(flwTxId), error: (e as Error).message };
  }
}
