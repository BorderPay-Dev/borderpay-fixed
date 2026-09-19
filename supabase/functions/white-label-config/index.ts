import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  httpsUrl,
  loadPublishedWhiteLabel,
} from "../_shared/white-label-config.ts";
import {
  allowedAccountTypes,
  resolveTenantOnboardingPolicy,
} from "../_shared/onboarding-policy.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
Deno.serve(async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "GET") return json({ error: "GET only" }, 405);
  try {
    const origin = httpsUrl(new URL(req.url).searchParams.get("origin"), true);
    const release = await loadPublishedWhiteLabel(db, { origin });
    if (!release) {
      return json({ error: "This customer app is not available yet." }, 404);
    }
    // Optional authenticated check uses the verified user, never a supplied user ID.
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user) return json({ error: "Sign in again." }, 401);
      const { data: owner, error: oe } = await db.from(
        "account_origin_provenance",
      ).select("tenant_id").eq("user_id", data.user.id).maybeSingle();
      if (oe) return json({ error: "Account ownership unavailable." }, 503);
      if (owner?.tenant_id !== release.tenant_id) {
        return json({
          error: "This account belongs to a different customer app.",
        }, 403);
      }
    }
    if (new URL(req.url).searchParams.get("format") === "manifest") {
      return json({
        id: origin + "/",
        name: release.brand.brand_name,
        short_name: release.brand.brand_name.slice(0, 24),
        start_url: origin + "/",
        scope: origin + "/",
        display: "standalone",
        background_color: "#0B0E11",
        theme_color: release.brand.primary_color,
        icons: [{ src: release.brand.logo_url, sizes: "any", purpose: "any" }],
      });
    }
    return json({
      brand: release.brand,
      revision: release.revision,
      allowed_account_types: allowedAccountTypes(
        resolveTenantOnboardingPolicy(release.metadata),
        "white_label",
      ),
    });
  } catch {
    return json({
      error: "Customer app configuration is unavailable. Please try again.",
    }, 503);
  }
});
