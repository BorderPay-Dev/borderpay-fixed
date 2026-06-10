// flutterwave-banks — list banks for a country (read-only; Phase B foundation).
//
// POST { country: "NG" | "KE" | "GH" | "UG" | ... }. No money movement.
// verify_jwt = true (config.toml). Requires FLUTTERWAVE_SECRET_KEY.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { listBanks, flutterwaveConfigured } from "../_shared/providers/flutterwave.ts";

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
  if (!flutterwaveConfigured())  return json({ success: false, code: "gateway_unavailable", error: "Bank lookup is temporarily unavailable." }, 503);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !userInfo?.user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { country?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const country = String(body.country || "").trim();
  if (!/^[A-Za-z]{2}$/.test(country)) return json({ success: false, error: "A 2-letter country code is required" }, 400);

  const r = await listBanks(country);
  if (!r.ok) return json({ success: false, code: "banks_failed", error: "Could not load banks. Please try again." }, 502);
  // Return only what the UI needs.
  return json({ success: true, data: { banks: r.banks.map(b => ({ code: b.code, name: b.name })) } });
});
