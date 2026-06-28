import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-affiliate-sync-secret",
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

function trimText(v: unknown, max = 400): string {
  return String(v || "").trim().slice(0, max);
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const shared = (Deno.env.get("AFFILIATE_SYNC_SECRET") || "").trim();
  const headerSecret = trimText(req.headers.get("x-affiliate-sync-secret"), 500);
  if (shared && headerSecret && shared === headerSecret) return true;

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !authData?.user) return false;
  const { data: admin } = await supa.rpc("is_borderpay_admin");
  return !!admin;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  if (!(await isAuthorized(req))) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action = trimText(body?.action, 64);
  if (!action) return json({ success: false, error: "action is required" }, 400);

  if (action === "confirm_payout") {
    const affiliateId = trimText(body?.affiliate_id, 80);
    const affiliateEmail = trimText(body?.affiliate_email, 320).toLowerCase();
    const payoutReference = trimText(body?.payout_reference, 160) || null;
    const currency = trimText(body?.currency, 16).toUpperCase() || "USD";
    const explicitRewardIds = Array.isArray(body?.reward_ids)
      ? body.reward_ids.map((x: unknown) => trimText(x, 80)).filter(Boolean)
      : [];

    if (!affiliateId && !affiliateEmail) {
      return json({ success: false, error: "affiliate_id or affiliate_email is required" }, 400);
    }

    let affiliateQuery = supa.from("affiliates").select("*").limit(1);
    if (affiliateId) affiliateQuery = affiliateQuery.eq("id", affiliateId);
    else affiliateQuery = affiliateQuery.eq("email", affiliateEmail);
    const { data: affiliateRows, error: affErr } = await affiliateQuery;
    if (affErr) return json({ success: false, error: affErr.message }, 500);
    const affiliate = (affiliateRows || [])[0];
    if (!affiliate) return json({ success: false, error: "Affiliate not found" }, 404);

    const nowIso = new Date().toISOString();

    let rewardsQuery = supa
      .from("rewards")
      .select("id, amount, status")
      .eq("affiliate_id", affiliate.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(500);
    if (explicitRewardIds.length > 0) {
      rewardsQuery = supa
        .from("rewards")
        .select("id, amount, status")
        .in("id", explicitRewardIds)
        .eq("affiliate_id", affiliate.id)
        .eq("status", "pending")
        .limit(500);
    }
    const { data: pendingRewards, error: pendingErr } = await rewardsQuery;
    if (pendingErr) return json({ success: false, error: pendingErr.message }, 500);

    const rewardIds = (pendingRewards || []).map((r: any) => r.id);
    const paidAmount = (pendingRewards || []).reduce((s: number, r: any) => s + toNumber(r.amount), 0);

    if (rewardIds.length > 0) {
      const { error: payErr } = await supa
        .from("rewards")
        .update({
          status: "paid",
          paid_at: nowIso,
          description: payoutReference
            ? `${trimText((pendingRewards?.[0] as any)?.description, 400) || "Affiliate payout"} · ref:${payoutReference}`
            : undefined,
        })
        .in("id", rewardIds);
      if (payErr) return json({ success: false, error: payErr.message }, 500);
    }

    const paidPrev = toNumber(affiliate.paid_earnings);
    const pendingPrev = toNumber(affiliate.pending_earnings);
    const { error: affUpdateErr } = await supa
      .from("affiliates")
      .update({
        paid_earnings: paidPrev + paidAmount,
        pending_earnings: Math.max(0, pendingPrev - paidAmount),
        updated_at: nowIso,
      })
      .eq("id", affiliate.id);
    if (affUpdateErr) return json({ success: false, error: affUpdateErr.message }, 500);

    const { data: profile } = await supa
      .from("user_profiles")
      .select("id")
      .eq("email", String(affiliate.email || "").toLowerCase())
      .maybeSingle();
    if (profile?.id) {
      await supa.from("notifications").insert({
        user_id: profile.id,
        type: "transaction",
        title: "Affiliate payout completed",
        body: `Your affiliate payout of ${paidAmount.toFixed(2)} ${currency} has been confirmed.`,
        metadata: {
          source: "affiliate",
          affiliate_id: affiliate.id,
          payout_reference: payoutReference,
          reward_ids: rewardIds,
          amount: paidAmount,
          currency,
        },
      });
    }

    return json({
      success: true,
      data: {
        affiliate_id: affiliate.id,
        affiliate_email: affiliate.email,
        rewards_paid_count: rewardIds.length,
        rewards_paid_amount: paidAmount,
        payout_reference: payoutReference,
      },
    });
  }

  return json({ success: false, error: "Unsupported action" }, 400);
});

