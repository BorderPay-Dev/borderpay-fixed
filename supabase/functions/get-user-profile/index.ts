// get-user-profile — provider-neutral; email_confirmed
// derived from auth.users.email_confirmed_at.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError && profileError.code !== "PGRST116") {
      return new Response(JSON.stringify({ error: `Failed to fetch profile: ${profileError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    const { data: securityData } = await supabase
      .from("user_security")
      .select("pin_set, two_factor_enabled")
      .eq("user_id", user.id)
      .maybeSingle();

    // Business KYB status lives on business_profiles (not user_profiles). Fetch it
    // for business accounts so the payload carries the same Bridge status fields
    // the frontend deriveKycStatus() expects (bridge_kyc_status / bridge_account_status
    // come from user_profiles above; bridge_kyb_status from here).
    const accountType = profile?.account_type || userData?.account_type || "individual";
    let bridgeKybStatus: string | null = null;
    if (accountType === "business") {
      const { data: biz } = await supabase
        .from("business_profiles")
        .select("bridge_kyb_status")
        .eq("user_id", user.id)
        .maybeSingle();
      bridgeKybStatus = biz?.bridge_kyb_status ?? null;
    }

    // The single source of truth for email-confirmed state is
    // auth.users.email_confirmed_at. Anything else (cached profile rows,
    // metadata flags) can lag behind the verification webhook.
    const emailConfirmed   = !!user.email_confirmed_at;
    const emailConfirmedAt = user.email_confirmed_at || null;
    const localAccountStatus = String(profile?.account_status || "").trim().toLowerCase();
    const providerAccountStatus = String(profile?.bridge_account_status || "").trim().toLowerCase();
    const blockedStatuses = new Set(["frozen", "paused", "suspended", "offboarded", "deactivated", "closed"]);
    const accountAccessRestricted = blockedStatuses.has(localAccountStatus) || blockedStatuses.has(providerAccountStatus);

    return new Response(JSON.stringify({
      success: true,
      data: {
        user: {
          id:                  user.id,
          email:               user.email,
          email_confirmed:     emailConfirmed,
          email_confirmed_at:  emailConfirmedAt,
          full_name:           profile?.full_name || userData?.full_name || null,
          phone:               profile?.phone || userData?.phone || null,
          country:             profile?.country || userData?.country || null,
          account_type:        accountType,
          kyc_status:          profile?.kyc_status || userData?.kyc_status || "unverified",
          kyc_level:           profile?.kyc_level || 0,
          wallet_activated:    userData?.wallet_activated || false,
          bridge_customer_id:  profile?.bridge_customer_id || null,
          bridge_kyc_status:   profile?.bridge_kyc_status || null,
          bridge_account_status: accountAccessRestricted ? "paused" : (profile?.bridge_account_status || null),
          bridge_provider_account_status: profile?.bridge_account_status || null,
          bridge_account_paused_at: profile?.bridge_account_paused_at || null,
          account_status: profile?.account_status || null,
          account_frozen_at: profile?.account_frozen_at || null,
          account_frozen_reason: profile?.account_frozen_reason || null,
          account_access_restricted: accountAccessRestricted,
          bridge_kyb_status:   bridgeKybStatus,
          address:             profile?.address || null,
          city:                profile?.city || null,
          state:               profile?.state || null,
          postal_code:         profile?.postal_code || null,
          date_of_birth:       profile?.date_of_birth || null,
          language:            profile?.language || "en",
          profile_picture_url: profile?.profile_picture_url || null,
          address_verification_status: profile?.address_verification_status || "none",
          pin_set:             securityData?.pin_set || false,
          two_factor_enabled:  securityData?.two_factor_enabled || false,
          last_sign_in_at:     user.last_sign_in_at || null,
          created_at:          profile?.created_at || userData?.created_at,
          updated_at:          profile?.updated_at || userData?.updated_at,
        },
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
