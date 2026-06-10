// flutterwave-resolve-account — verify a bank account number → holder name
// (read-only; Phase B foundation). No money movement.
//
// POST { account_number, bank_code }. verify_jwt = true (config.toml).
// Requires FLUTTERWAVE_SECRET_KEY.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveAccount, flutterwaveConfigured } from "../_shared/providers/flutterwave.ts";

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
  if (!flutterwaveConfigured())  return json({ success: false, code: "gateway_unavailable", error: "Account lookup is temporarily unavailable." }, 503);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !userInfo?.user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { account_number?: string; bank_code?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const acct = String(body.account_number || "").trim();
  const bank = String(body.bank_code || "").trim();
  if (!acct || !bank) return json({ success: false, error: "account_number and bank_code are required" }, 400);

  const r = await resolveAccount(acct, bank);
  if (!r.ok) return json({ success: false, code: "resolve_failed", error: "Could not verify that account. Check the details and try again." }, 422);
  return json({ success: true, data: { account_name: r.account_name } });
});
