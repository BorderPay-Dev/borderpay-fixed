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

Deno.test("auth signup enforces policy before identity creation and binds single-use tenant authorization", async () => {
  const authSignup = await source("supabase/functions/auth-signup/index.ts");
  const policyCheck = authSignup.indexOf("parseSignupAccountType(account_type)");
  const createIdentity = authSignup.indexOf("supabaseAdmin.auth.admin.createUser");
  assert(policyCheck >= 0 && policyCheck < createIdentity, "account type is not validated before identity creation");
  assert(authSignup.indexOf("consume_api_onboarding_authorization") < createIdentity, "token is not consumed before identity creation");
  assert(authSignup.includes('from("api_tenant_end_users").insert'), "tenant ownership mapping is missing");
  assert(authSignup.includes('from("account_origin_provenance").insert'), "authoritative account origin is missing");
  assert(authSignup.includes('partnerAuthorization ? "partner" : "direct"'), "direct/partner origin is not server-derived");
  assert(!authSignup.includes("body.tenant_id"), "browser-supplied tenant id is trusted");
  assert(!authSignup.includes('req.headers.get("origin")'), "Origin is used as partner authorization");
  const gateway = await source("supabase/functions/public-api-gateway/index.ts");
  assert(gateway.includes('"POST /v1/onboarding-authorizations": "onboarding:write"'), "onboarding API scope is not enforced");
});

Deno.test("direct UI is Business-first and Individual is rendered only from server-authorized choices", async () => {
  const signup = await source("components/auth/SignUpFlow.tsx");
  assert(signup.includes("accountType: 'business'"), "direct signup does not default to Business");
  assert(signup.includes("allowedAccountTypes.includes('individual')"), "Individual is not tenant-conditioned");
  assert(signup.includes("onboarding_token: onboardingToken"), "partner token is not submitted to auth-signup");
});

Deno.test("database and KYC bypass protections are present", async () => {
  const migration = await source("supabase/migrations/20260814090000_tenant_onboarding_security.sql");
  const originMigration = await source("supabase/migrations/20260816090000_account_origin_provenance.sql");
  const kyc = await source("supabase/functions/bridge-kyc-link/index.ts");
  const config = await source("supabase/config.toml");
  assert(migration.includes("api_tenant_end_users"), "tenant end-user mapping migration missing");
  assert(migration.includes("used_at is null") && migration.includes("expires_at > now()"), "single-use/expiry lock missing");
  assert(migration.includes("profiles_owner_select") && !migration.includes("create policy profiles_owner_insert"), "profile insert remains owner-authorized");
  assert(originMigration.includes("origin_kind in ('direct','partner','imported','migrated')"), "account origins are not distinguishable");
  assert(originMigration.includes("account_origin_provenance_immutable"), "account origin is mutable");
  assert(originMigration.includes("revoke all on table public.account_origin_provenance from public, anon, authenticated"), "browser roles can forge account origin");
  assert(kyc.includes("individual_signup_legacy_cutoff") && kyc.includes("onboarding_provenance_required"), "KYC bootstrap cutoff missing");
  assert(config.includes("[auth]") && config.includes("enable_signup = false"), "direct GoTrue signup is not disabled in configuration");
});
