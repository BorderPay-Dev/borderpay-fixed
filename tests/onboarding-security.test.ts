import {
  allowedAccountTypes,
  isSignupFlagEnabled,
  parseSignupAccountType,
  resolveTenantOnboardingPolicy,
  signOnboardingToken,
  verifyOnboardingToken,
  type OnboardingTokenClaims,
} from "../supabase/functions/_shared/onboarding-policy.ts";
import { validateOnboardingAuthorization } from "../supabase/functions/_shared/api-gateway-validators.ts";
import {
  extractAndScrubOnboardingToken,
  normalizePartnerBranding,
} from "../utils/onboarding/partnerOnboarding.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function source(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(`../${path}`, import.meta.url));
}

const secret = "borderpay-onboarding-test-secret-32-bytes-minimum";
const now = 1_800_000_000;
const claims: OnboardingTokenClaims = {
  iss: "borderpay",
  aud: "partner_onboarding",
  jti: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  api_key_id: "00000000-0000-4000-8000-000000000003",
  external_user_id: "partner-user-1",
  allowed_account_types: ["individual"],
  onboarding_channel: "white_label",
  iat: now - 5,
  exp: now + 300,
};

Deno.test("tenant onboarding policy fails closed when metadata is absent or malformed", () => {
  assert(allowedAccountTypes(resolveTenantOnboardingPolicy(undefined), "api").length === 0, "missing metadata allowed signup");
  assert(allowedAccountTypes(resolveTenantOnboardingPolicy({ onboarding: { individual_signup_enabled: "true" } }), "api").length === 0, "string flag was trusted");
  const enabled = resolveTenantOnboardingPolicy({ onboarding: {
    individual_signup_enabled: true,
    business_signup_enabled: true,
    white_label_signup_enabled: true,
  } });
  assert(allowedAccountTypes(enabled, "white_label").join(",") === "individual,business", "valid tenant policy was not honored");
});

Deno.test("direct signup rejects missing and malformed account types and flags fail closed", () => {
  assert(parseSignupAccountType(undefined) === null, "missing account type was accepted");
  assert(parseSignupAccountType("") === null, "empty account type was accepted");
  assert(parseSignupAccountType("INDIVIDUAL") === null, "malformed account type was normalized");
  assert(parseSignupAccountType("consumer") === null, "unknown account type was accepted");
  assert(parseSignupAccountType("business") === "business", "Business was rejected");
  assert(!isSignupFlagEnabled(undefined), "missing direct flag was enabled");
  assert(!isSignupFlagEnabled(false), "false direct flag was enabled");
  assert(isSignupFlagEnabled("true"), "explicit true direct flag was rejected");
});

Deno.test("partner authorization request rejects wrong channel, account type, and unsafe TTL", () => {
  const valid = validateOnboardingAuthorization({
    external_user_id: "external-1",
    onboarding_channel: "white_label",
    requested_account_types: ["individual"],
    expires_in_seconds: 300,
  });
  assert(valid.ok, "valid partner authorization was rejected");
  assert(!validateOnboardingAuthorization({ external_user_id: "x", onboarding_channel: "browser" }).ok, "untrusted channel was accepted");
  assert(!validateOnboardingAuthorization({ external_user_id: "x", onboarding_channel: "api", requested_account_types: ["admin"] }).ok, "invalid account type was accepted");
  assert(!validateOnboardingAuthorization({ external_user_id: "x", onboarding_channel: "api", expires_in_seconds: 3600 }).ok, "unsafe token TTL was accepted");
});

Deno.test("signed onboarding tokens reject tampering, expiry and the wrong account type", async () => {
  const token = await signOnboardingToken(claims, secret);
  const verified = await verifyOnboardingToken(token, secret, now);
  assert(verified.tenant_id === claims.tenant_id, "tenant claim changed");
  assert(!verified.allowed_account_types.includes("business"), "unauthorized account type appeared");

  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1].slice(0, -1)}A.${parts[2]}`;
  let rejected = false;
  try { await verifyOnboardingToken(tampered, secret, now); } catch { rejected = true; }
  assert(rejected, "tampered token was accepted");

  rejected = false;
  try { await verifyOnboardingToken(token, secret, claims.exp); } catch { rejected = true; }
  assert(rejected, "expired token was accepted");
});

Deno.test("partner bearer links use fragments and are scrubbed before rendering", async () => {
  const gateway = await source("supabase/functions/public-api-gateway/index.ts");
  assert(gateway.includes("/signup#onboarding_token="), "gateway still emits the bearer in the query string");
  assert(!gateway.includes("/signup?onboarding_token="), "query-string bearer link remains");

  const fragment = extractAndScrubOnboardingToken("https://app.example/signup?campaign=x#onboarding_token=signed.token.value");
  assert(fragment.token === "signed.token.value", "fragment token was not captured");
  assert(fragment.sanitizedPath === "/signup?campaign=x", "fragment token was not scrubbed");

  const legacy = extractAndScrubOnboardingToken("https://app.example/signup?onboarding_token=legacy-token&campaign=x");
  assert(legacy.token === "legacy-token", "legacy query token was not captured");
  assert(legacy.sanitizedPath === "/signup?campaign=x", "legacy query token was not scrubbed");
});

Deno.test("white-label branding is explicit and sanitized", async () => {
  const valid = normalizePartnerBranding({
    branding_enabled: true,
    name: "Partner Africa",
    logo_url: "https://cdn.partner.example/logo.png",
    primary_color: "#12ab34",
  });
  assert(valid?.name === "Partner Africa", "valid partner name was rejected");
  assert(valid?.primaryColor === "#12AB34", "brand color was not normalized");
  assert(normalizePartnerBranding({ branding_enabled: false, name: "Partner" }) === null, "disabled branding was rendered");
  const unsafe = normalizePartnerBranding({
    branding_enabled: true,
    name: "Partner",
    logo_url: "https://127.0.0.1/logo.png",
  });
  assert(unsafe?.logoUrl === null, "IP-literal logo URL was accepted");

  const config = await source("supabase/functions/onboarding-config/index.ts");
  assert(config.includes("whiteLabel.app_name"), "documented app_name branding field is not consumed");
  assert(config.includes("safeBrandLogoUrl"), "server does not sanitize partner logo URLs");
});

Deno.test("auth signup enforces policy before identity creation and binds single-use tenant authorization", async () => {
  const authSignup = await source("supabase/functions/auth-signup/index.ts");
  const policyCheck = authSignup.indexOf("parseSignupAccountType(account_type)");
  const createIdentity = authSignup.indexOf("supabaseAdmin.auth.admin.createUser");
  assert(policyCheck >= 0 && policyCheck < createIdentity, "account type is not validated before identity creation");
  assert(authSignup.indexOf("consume_api_onboarding_authorization") < createIdentity, "token is not consumed before identity creation");
  assert(authSignup.includes('from("api_tenant_end_users").insert'), "tenant ownership mapping is missing");
  assert(!authSignup.includes("body.tenant_id"), "browser-supplied tenant id is trusted");
  assert(!authSignup.includes('req.headers.get("origin")'), "Origin is used as partner authorization");
  const gateway = await source("supabase/functions/public-api-gateway/index.ts");
  assert(gateway.includes('"POST /v1/onboarding-authorizations": "onboarding:write"'), "onboarding API scope is not enforced");
  assert(gateway.includes("if (auditError)"), "authorization issuance can succeed without its audit record");
  assert(authSignup.includes("if (completionAuditError)"), "partner signup can succeed without its completion audit");
  assert(authSignup.includes("!markedAuthorization?.id"), "authorization completion does not verify an updated row");
});

Deno.test("direct UI is Business-first and Individual is rendered only from server-authorized choices", async () => {
  const signup = await source("components/auth/SignUpFlow.tsx");
  assert(signup.includes("accountType: 'business'"), "direct signup does not default to Business");
  assert(signup.includes("useState(Boolean(onboardingToken))"), "direct signup unnecessarily waits for partner account options");
  assert(signup.includes("setOnboardingConfigLoading(Boolean(onboardingToken))"), "direct config refresh shows partner loading state");
  assert(!signup.includes("Loading account options"), "signup exposes an unnecessary account-option loading message");
  assert(signup.includes("allowedAccountTypes.includes('individual')"), "Individual is not tenant-conditioned");
  assert(signup.includes("onboarding_token: onboardingToken"), "partner token is not submitted to auth-signup");
  assert(signup.includes("normalizePartnerBranding"), "partner branding is not rendered from server configuration");
});

Deno.test("database and KYC bypass protections are present", async () => {
  const migration = await source("supabase/migrations/20260814090000_tenant_onboarding_security.sql");
  const kyc = await source("supabase/functions/bridge-kyc-link/index.ts");
  const config = await source("supabase/config.toml");
  assert(migration.includes("api_tenant_end_users"), "tenant end-user mapping migration missing");
  assert(migration.includes("used_at is null") && migration.includes("expires_at > now()"), "single-use/expiry lock missing");
  assert(migration.includes("profiles_owner_select") && !migration.includes("create policy profiles_owner_insert"), "profile insert remains owner-authorized");
  assert(kyc.includes("individual_signup_legacy_cutoff") && kyc.includes("onboarding_provenance_required"), "KYC bootstrap cutoff missing");
  assert(config.includes("[auth]") && config.includes("enable_signup = false"), "direct GoTrue signup is not disabled in configuration");
});

Deno.test("authoritative signup records immutable direct or partner origin fail closed", async () => {
  const signup = await source("supabase/functions/auth-signup/index.ts");
  const migration = await source("supabase/migrations/20260816090000_account_origin_provenance.sql");
  assert(signup.includes('.from("account_origin_provenance").insert'), "signup must write authoritative origin");
  assert(signup.includes('partnerAuthorization ? "partner" : "direct"'), "origin must derive from server authorization");
  assert(signup.includes('return rollbackAuthUser(`account origin provenance insert failed:'), "origin failure must rollback signup");
  assert(!signup.includes("body.onboarding_channel"), "browser channel must not become provenance authority");
  assert(migration.includes("origin_kind in ('direct','partner','imported','migrated')"), "origin kinds must distinguish imports");
  assert(migration.includes("account_origin_provenance_immutable"), "origin rows must be immutable");
  assert(migration.includes("revoke all on table public.account_origin_provenance from public, anon, authenticated"), "browser roles must not forge origin");
});

Deno.test("business signup follows verified billing lifecycle and seeds team owner directly", async () => {
  const signup = await source("supabase/functions/auth-signup/index.ts");
  assert(!signup.includes('"ensure_starter_subscription"'), "signup calls removed user_subscriptions RPC");
  assert(signup.includes('.from("business_team_members")'), "business owner membership is not persisted");
  assert(signup.includes('role: "owner"'), "team seed lacks owner role");
  assert(signup.includes('status: "active"'), "team seed is not active");
  assert(
    signup.indexOf('.from("business_team_members")') < signup.indexOf('from("account_origin_provenance").insert'),
    "owner membership must complete before immutable provenance",
  );
});
