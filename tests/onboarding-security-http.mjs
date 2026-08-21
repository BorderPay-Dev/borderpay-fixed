import { createHash, randomUUID } from "node:crypto";

const API = process.env.API_URL;
const ANON = process.env.ANON_KEY || process.env.PUBLISHABLE_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY || process.env.SECRET_KEY;

if (!API || !ANON || !SERVICE) {
  throw new Error("API_URL, ANON_KEY/PUBLISHABLE_KEY and SERVICE_ROLE_KEY/SECRET_KEY are required");
}
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(API)) {
  throw new Error(`refusing non-local Supabase URL: ${API}`);
}

const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const password = "Local-Test-Password-2026!";
const tests = [];

function record(name, condition, evidence) {
  if (!condition) throw new Error(`${name}: ${evidence}`);
  tests.push({ name, evidence });
  console.log(`[PASS ${String(tests.length).padStart(2, "0")}] ${name}`);
}

async function http(path, { method = "GET", key = ANON, token, body, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        apikey: key,
        authorization: `Bearer ${token || key}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: response.status, json, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

async function serviceRest(tableAndQuery, { method = "GET", body, prefer = "return=representation" } = {}) {
  return await http(`/rest/v1/${tableAndQuery}`, {
    method,
    key: SERVICE,
    body,
    headers: { Prefer: prefer },
  });
}

async function userRest(tableAndQuery, token, { method = "GET", body } = {}) {
  return await http(`/rest/v1/${tableAndQuery}`, { method, key: ANON, token, body });
}

async function adminCreate(email, metadata = {}) {
  const response = await http("/auth/v1/admin/users", {
    method: "POST",
    key: SERVICE,
    body: { email, password, email_confirm: true, user_metadata: metadata },
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`admin create failed (${response.status}): ${JSON.stringify(response.json)}`);
  }
  return response.json;
}

async function login(email) {
  return await http("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
}

async function edge(name, body, options = {}) {
  return await http(`/functions/v1/${name}`, { method: "POST", body, ...options });
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function tokenClaims(token) {
  const part = token.split(".")[1];
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function issuePartnerToken(rawKey, externalUserId, requested = ["individual"]) {
  return await edge("public-api-gateway", {
    method: "POST",
    route: "/v1/onboarding-authorizations",
    external_user_id: externalUserId,
    onboarding_channel: "white_label",
    requested_account_types: requested,
    expires_in_seconds: 300,
  }, {
    token: rawKey,
    headers: {
      "x-forwarded-for": "127.0.0.1",
      "idempotency-key": `onboard-${randomUUID()}`,
    },
  });
}

const directConfig = await edge("onboarding-config", {});
record(
  "Direct onboarding configuration exposes Business only",
  directConfig.status === 200 &&
    JSON.stringify(directConfig.json?.data?.allowed_account_types) === JSON.stringify(["business"]),
  JSON.stringify(directConfig.json),
);

const existingEmail = `existing-${run}@example.test`;
const existing = await adminCreate(existingEmail, {
  full_name: "Existing Individual",
  account_type: "individual",
  country: "KE",
});

for (const [table, body] of [
  ["users", {
    id: existing.id, email: existingEmail, full_name: "Existing Individual",
    account_type: "individual", kyc_status: "verified", wallet_activated: true,
  }],
  ["user_profiles", {
    id: existing.id, email: existingEmail, full_name: "Existing Individual",
    country: "KE", account_type: "individual", kyc_status: "verified",
    bridge_kyc_status: "approved", bridge_account_status: "active",
  }],
  ["bridge_wallets", {
    user_id: existing.id, bridge_customer_id: `customer-${run}`,
    bridge_wallet_id: `wallet-${run}`, currency: "usdc", chain: "base",
    address: `0x${hash(run).slice(0, 40)}`, status: "active",
  }],
  ["bridge_transfers", {
    user_id: existing.id, bridge_transfer_id: `transfer-${run}`,
    source_type: "wallet", destination_type: "external_wallet",
    amount: 10, currency: "USDC", state: "succeeded",
  }],
]) {
  const seeded = await serviceRest(table, { method: "POST", body });
  if (seeded.status < 200 || seeded.status >= 300) {
    throw new Error(`seed ${table} failed (${seeded.status}): ${JSON.stringify(seeded.json)}`);
  }
}

const existingLogin = await login(existingEmail);
const existingToken = existingLogin.json?.access_token;
record("Existing individual authenticates and receives a session", existingLogin.status === 200 && !!existingToken, `status=${existingLogin.status}`);

const existingProfile = await userRest(`user_profiles?id=eq.${existing.id}&select=id,account_type,kyc_status,bridge_kyc_status`, existingToken);
record("Existing individual can access profile", existingProfile.status === 200 && existingProfile.json?.[0]?.account_type === "individual", `status=${existingProfile.status}`);

const existingWallet = await userRest(`bridge_wallets?user_id=eq.${existing.id}&select=bridge_wallet_id,status`, existingToken);
record("Existing individual can access wallet", existingWallet.status === 200 && existingWallet.json?.[0]?.status === "active", `status=${existingWallet.status}`);

record("Existing individual KYC state remains intact", existingProfile.json?.[0]?.kyc_status === "verified" && existingProfile.json?.[0]?.bridge_kyc_status === "approved", JSON.stringify(existingProfile.json?.[0]));

const existingTransfers = await userRest(`bridge_transfers?user_id=eq.${existing.id}&select=bridge_transfer_id,state`, existingToken);
record("Existing individual can access transactions", existingTransfers.status === 200 && existingTransfers.json?.[0]?.state === "succeeded", `status=${existingTransfers.status}`);

const goTrueEmail = `gotrue-${run}@example.test`;
const goTrueSignup = await http("/auth/v1/signup", {
  method: "POST",
  body: { email: goTrueEmail, password, data: { account_type: "individual" } },
});
const listedAfterGoTrue = await http("/auth/v1/admin/users?page=1&per_page=1000", { key: SERVICE });
record(
  "Direct GoTrue signup is rejected without creating an identity",
  goTrueSignup.status >= 400 && !(listedAfterGoTrue.json?.users || []).some((u) => u.email === goTrueEmail),
  `status=${goTrueSignup.status}`,
);

const directIndividualEmail = `direct-individual-${run}@example.test`;
const directIndividual = await edge("auth-signup", {
  email: directIndividualEmail, password, full_name: "Old Mobile Client",
  country_code: "KE", account_type: "individual",
});
record("Direct/old-client Individual signup is rejected", directIndividual.status === 403 && directIndividual.json?.code === "individual_signup_unavailable", JSON.stringify(directIndividual.json));

const missingType = await edge("auth-signup", { email: `missing-${run}@example.test`, password, full_name: "Missing Type" });
const malformedType = await edge("auth-signup", { email: `malformed-${run}@example.test`, password, full_name: "Malformed Type", account_type: "INDIVIDUAL" });
record("Missing and malformed account_type are rejected", missingType.status === 400 && malformedType.status === 400, `missing=${missingType.status}, malformed=${malformedType.status}`);

const suppliedContext = await edge("auth-signup", {
  email: `context-${run}@example.test`, password, full_name: "Context Override",
  country_code: "KE", account_type: "individual", tenant_id: randomUUID(), external_user_id: "forged",
});
record("Browser-supplied tenant ownership is rejected", suppliedContext.status === 403 && suppliedContext.json?.code === "untrusted_onboarding_context", JSON.stringify(suppliedContext.json));

const originSpoof = await edge("auth-signup", {
  email: `origin-${run}@example.test`, password, full_name: "Origin Spoof",
  country_code: "KE", account_type: "individual",
}, { headers: { Origin: "https://partner.example", Host: "partner.example" } });
record("Origin and hostname cannot authorize Individual signup", originSpoof.status === 403 && originSpoof.json?.code === "individual_signup_unavailable", JSON.stringify(originSpoof.json));

const businessEmail = `business-${run}@example.test`;
const businessSignup = await edge("auth-signup", {
  email: businessEmail, password, full_name: "Direct Business Owner",
  country_code: "KE", account_type: "business", company_name: "HTTP Test Ltd",
}, { headers: { "x-forwarded-for": "10.10.0.12" } });
const businessId = businessSignup.json?.data?.user?.id;
record("Direct Business signup succeeds", businessSignup.status === 200 && businessSignup.json?.success === true && !!businessId, JSON.stringify(businessSignup.json));

const [businessProfile, businessMirror] = await Promise.all([
  serviceRest(`user_profiles?id=eq.${businessId}&select=id,account_type`),
  serviceRest(`business_profiles?user_id=eq.${businessId}&select=user_id,company_name`),
]);
record("Business identity and profile persist with Business account type", businessProfile.json?.[0]?.account_type === "business" && businessMirror.json?.[0]?.company_name === "HTTP Test Ltd", `profile=${JSON.stringify(businessProfile.json)}`);

const [businessSubscription, businessEmailToken] = await Promise.all([
  serviceRest(`user_subscriptions?or=(user_id.eq.${businessId},business_user_id.eq.${businessId})&select=user_id,business_user_id,plan_key`),
  serviceRest(`email_verification_tokens?user_id=eq.${businessId}&select=user_id,purpose`),
]);
record("Business subscription and verification records are created", businessSubscription.json?.length === 1 && businessEmailToken.json?.length === 1, `subscription=${businessSubscription.json?.length}, email_token=${businessEmailToken.json?.length}`);

const tenantA = randomUUID();
const tenantB = randomUUID();
const keyAId = randomUUID();
const keyBId = randomUUID();
const rawKeyA = `bpk_local_A_${hash(run).slice(0, 40)}`;
const rawKeyB = `bpk_local_B_${hash(`${run}-b`).slice(0, 40)}`;
const tenantPolicy = {
  onboarding: {
    individual_signup_enabled: true,
    business_signup_enabled: true,
    white_label_signup_enabled: true,
  },
};
for (const body of [
  { id: tenantA, tenant_name: `Tenant A ${run}`, default_mode: "sandbox", is_active: true, metadata: tenantPolicy },
  { id: tenantB, tenant_name: `Tenant B ${run}`, default_mode: "sandbox", is_active: true, metadata: tenantPolicy },
]) {
  const inserted = await serviceRest("api_tenants", { method: "POST", body });
  if (inserted.status >= 300) throw new Error(`tenant seed failed: ${JSON.stringify(inserted.json)}`);
}
for (const body of [
  { id: keyAId, tenant_id: tenantA, key_prefix: `bpkA_${run}`.slice(0, 40), key_hash: hash(rawKeyA), scopes: ["onboarding:write"], is_active: true },
  { id: keyBId, tenant_id: tenantB, key_prefix: `bpkB_${run}`.slice(0, 40), key_hash: hash(rawKeyB), scopes: [], is_active: true },
]) {
  const inserted = await serviceRest("api_keys", { method: "POST", body });
  if (inserted.status >= 300) throw new Error(`API key seed failed: ${JSON.stringify(inserted.json)}`);
}

const partnerAuthorization = await issuePartnerToken(rawKeyA, `external-success-${run}`);
const partnerToken = partnerAuthorization.json?.data?.onboarding_token;
record("Authorized partner receives a signed onboarding token", partnerAuthorization.status === 201 && !!partnerToken, JSON.stringify(partnerAuthorization.json));

const partnerConfig = await edge("onboarding-config", { onboarding_token: partnerToken });
record("Partner token resolves tenant-authorized Individual configuration", partnerConfig.status === 200 && partnerConfig.json?.data?.allowed_account_types?.includes("individual"), JSON.stringify(partnerConfig.json));

const partnerEmail = `partner-${run}@example.test`;
const partnerSignup = await edge("auth-signup", {
  email: partnerEmail, password, full_name: "Partner Individual",
  country_code: "KE", account_type: "individual", onboarding_token: partnerToken,
}, { headers: { "x-forwarded-for": "10.10.0.17" } });
const partnerUserId = partnerSignup.json?.data?.user?.id;
record("White-label Individual signup succeeds", partnerSignup.status === 200 && partnerSignup.json?.success === true && !!partnerUserId, JSON.stringify(partnerSignup.json));

const partnerMapping = await serviceRest(`api_tenant_end_users?user_id=eq.${partnerUserId}&select=tenant_id,external_user_id,account_type,onboarding_channel`);
record("Tenant mapping records owner and external_user_id", partnerMapping.json?.[0]?.tenant_id === tenantA && partnerMapping.json?.[0]?.external_user_id === `external-success-${run}`, JSON.stringify(partnerMapping.json));

const claims = tokenClaims(partnerToken);
const [partnerAudit, consumedAuthorization] = await Promise.all([
  serviceRest(`api_onboarding_audit?authorization_id=eq.${claims.jti}&select=event_type,user_id`),
  serviceRest(`api_onboarding_authorizations?id=eq.${claims.jti}&select=used_at,used_by_user_id`),
]);
record("Partner audit is written and authorization is consumed", partnerAudit.json?.some((r) => r.event_type === "signup_completed") && !!consumedAuthorization.json?.[0]?.used_at && consumedAuthorization.json?.[0]?.used_by_user_id === partnerUserId, `audit=${JSON.stringify(partnerAudit.json)}`);

const replay = await edge("auth-signup", {
  email: `replay-${run}@example.test`, password, full_name: "Replay",
  country_code: "KE", account_type: "individual", onboarding_token: partnerToken,
}, { headers: { "x-forwarded-for": "10.10.0.20" } });
record("Single-use onboarding token rejects reuse", replay.status === 403 && replay.json?.code === "onboarding_authorization_unavailable", JSON.stringify(replay.json));

const tamperAuthorization = await issuePartnerToken(rawKeyA, `external-tamper-${run}`);
const tamperToken = tamperAuthorization.json?.data?.onboarding_token;
const tampered = `${tamperToken.slice(0, -1)}${tamperToken.endsWith("A") ? "B" : "A"}`;
const [tamperedResult, malformedResult] = await Promise.all([
  edge("onboarding-config", { onboarding_token: tampered }),
  edge("onboarding-config", { onboarding_token: "not-a-jwt" }),
]);
record("Modified and malformed tokens are rejected", tamperedResult.status === 403 && malformedResult.status === 403, `tampered=${tamperedResult.status}, malformed=${malformedResult.status}`);

const expiredAuthorization = await issuePartnerToken(rawKeyA, `external-expired-${run}`);
const expiredToken = expiredAuthorization.json?.data?.onboarding_token;
const expiredClaims = tokenClaims(expiredToken);
const expiredStored = await serviceRest(`api_onboarding_authorizations?external_user_id=eq.external-expired-${run}&select=id`);
if (expiredStored.json?.[0]?.id !== expiredClaims.jti) throw new Error("expired-token fixture is not bound to signed jti");
const expiredPatched = await serviceRest(`api_onboarding_authorizations?id=eq.${expiredStored.json[0].id}`, {
  method: "PATCH",
  body: {
    created_at: new Date(Date.now() - 300_000).toISOString(),
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  },
});
if (expiredPatched.status !== 200 || expiredPatched.json?.length !== 1) {
  throw new Error(`expired-token fixture update failed: status=${expiredPatched.status} body=${JSON.stringify(expiredPatched.json)}`);
}
const expiredResult = await edge("onboarding-config", { onboarding_token: expiredToken });
record("Expired onboarding token is rejected", expiredResult.status === 403, JSON.stringify(expiredResult.json));

const wrongTypeAuthorization = await issuePartnerToken(rawKeyA, `external-type-${run}`);
const wrongTypeToken = wrongTypeAuthorization.json?.data?.onboarding_token;
const wrongTypeResult = await edge("auth-signup", {
  email: `wrong-type-${run}@example.test`, password, full_name: "Wrong Type",
  country_code: "KE", account_type: "business", company_name: "Wrong Ltd",
  onboarding_token: wrongTypeToken,
});
const wrongScopeResult = await issuePartnerToken(rawKeyB, `external-scope-${run}`);
record("Wrong account type and missing API scope are rejected", wrongTypeResult.status === 403 && wrongScopeResult.status === 403, `type=${wrongTypeResult.status}, scope=${wrongScopeResult.status}`);

const crossAuthorization = await issuePartnerToken(rawKeyA, `external-cross-${run}`);
const crossToken = crossAuthorization.json?.data?.onboarding_token;
const crossClaims = tokenClaims(crossToken);
const crossStored = await serviceRest(`api_onboarding_authorizations?external_user_id=eq.external-cross-${run}&select=id`);
if (crossStored.json?.[0]?.id !== crossClaims.jti) throw new Error("cross-tenant fixture is not bound to signed jti");
const crossPatched = await serviceRest(`api_onboarding_authorizations?id=eq.${crossStored.json[0].id}`, {
  method: "PATCH",
  body: { tenant_id: tenantB },
});
if (crossPatched.status !== 200 || crossPatched.json?.length !== 1) {
  throw new Error(`cross-tenant fixture update failed: status=${crossPatched.status} body=${JSON.stringify(crossPatched.json)}`);
}
const crossResult = await edge("onboarding-config", { onboarding_token: crossToken });
record("Tenant A token cannot be reassigned to Tenant B", crossResult.status === 403, JSON.stringify(crossResult.json));

const forbiddenProfileId = randomUUID();
const directProfileInsert = await userRest("user_profiles", existingToken, {
  method: "POST",
  body: { id: forbiddenProfileId, email: `rls-${run}@example.test`, account_type: "individual" },
});
record("Authenticated user cannot directly insert another profile", directProfileInsert.status >= 400, `status=${directProfileInsert.status}`);

const unauthorizedEmail = `unauthorized-${run}@example.test`;
const unauthorized = await adminCreate(unauthorizedEmail, { full_name: "Unauthorized Identity", account_type: "individual", country: "KE" });
const unauthorizedLogin = await login(unauthorizedEmail);
const unauthorizedKyc = await edge("bridge-kyc-link", {}, { token: unauthorizedLogin.json?.access_token });
const existingKyc = await edge("bridge-kyc-link", {}, { token: existingToken });
const unauthorizedProfile = await serviceRest(`user_profiles?id=eq.${unauthorized.id}&select=id`);
record(
  "KYC bootstrap bypass is blocked while an existing Individual remains compatible",
  unauthorizedKyc.status === 403 && unauthorizedKyc.json?.code === "onboarding_provenance_required" &&
    unauthorizedProfile.json?.length === 0 && existingKyc.status === 200 && existingKyc.json?.data?.already_approved === true,
  `unauthorized=${JSON.stringify(unauthorizedKyc.json)}, existing=${JSON.stringify(existingKyc.json)}`,
);

if (tests.length !== 26) {
  throw new Error(`expected exactly 26 HTTP tests, recorded ${tests.length}`);
}

console.log(`\nHTTP onboarding integration: ${tests.length}/26 passed`);
