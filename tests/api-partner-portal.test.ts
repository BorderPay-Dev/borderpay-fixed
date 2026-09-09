import {
  newPartnerApiKey,
  normalizePartnerApiKeyScopes,
  normalizePartnerKeyLabel,
  requireOwnedResourceId,
} from "../supabase/functions/_shared/api-partner-portal.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, received ${a}`);
}

function assertThrows(fn: () => unknown, contains: string): void {
  try {
    fn();
  } catch (error) {
    assert(String(error).includes(contains), `expected error containing ${contains}`);
    return;
  }
  throw new Error("expected function to throw");
}

Deno.test("partner API scopes are explicit and wildcard access is rejected", () => {
  assertEquals(normalizePartnerApiKeyScopes(["customers:write", "customers:write", "onboarding:write"]), [
    "customers:write",
    "onboarding:write",
  ]);
  assertThrows(() => normalizePartnerApiKeyScopes(["*"]), "not allowed");
  assertThrows(() => normalizePartnerApiKeyScopes(["admin:write"]), "not allowed");
  assertThrows(() => normalizePartnerApiKeyScopes([]), "required");
});

Deno.test("partner credential inputs are bounded", () => {
  assertEquals(normalizePartnerKeyLabel("  Production server  "), "Production server");
  assertEquals(normalizePartnerKeyLabel(""), null);
  assertThrows(() => normalizePartnerKeyLabel("x".repeat(81)), "too long");
  assertEquals(
    requireOwnedResourceId("123e4567-e89b-42d3-a456-426614174000", "key_id"),
    "123e4567-e89b-42d3-a456-426614174000",
  );
  assertThrows(() => requireOwnedResourceId("not-a-uuid", "key_id"), "invalid");
});

Deno.test("generated API keys match tenant mode and contain sufficient entropy", () => {
  const sandbox = newPartnerApiKey("sandbox");
  const production = newPartnerApiKey("production");
  assert(sandbox.plain.startsWith("bpk_test_"));
  assert(production.plain.startsWith("bpk_live_"));
  assert(sandbox.plain.length >= 70);
  assert(production.plain !== sandbox.plain);
  assertEquals(sandbox.prefix, sandbox.plain.slice(0, 14));
});

Deno.test("portal derives tenant from authenticated user and scopes every resource mutation", async () => {
  const source = await Deno.readTextFile("supabase/functions/api-partner-portal/index.ts");
  assert(source.includes('token === serviceRole'));
  assert(source.includes('.eq("business_user_id", userId)'));
  assert(!source.includes("body.tenant_id"));
  assert(!source.includes("body?.tenant_id"));

  for (const marker of [
    '.eq("id", keyId).eq("tenant_id", tenant.id)',
    '.eq("id", id).eq("tenant_id", tenant.id)',
  ]) assert(source.includes(marker), `missing ownership guard: ${marker}`);

  const tenantLookup = source.indexOf('.eq("business_user_id", userId)');
  const bodyParse = source.indexOf("body = await req.json()");
  assert(tenantLookup >= 0 && bodyParse > tenantLookup, "ownership must be resolved before request actions");
});

Deno.test("partner portal cannot change operator-controlled tenant policy", async () => {
  const source = await Deno.readTextFile("supabase/functions/api-partner-portal/index.ts");
  for (const forbidden of [
    '"upsert_tenant"',
    '"emergency_rollback_tenant"',
    'default_mode:',
    'beta_access_enabled:',
    'business_user_id:',
  ]) assert(!source.includes(forbidden), `portal unexpectedly exposes ${forbidden}`);
});
