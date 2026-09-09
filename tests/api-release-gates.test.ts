import {
  type ApiReleaseGateEnvironment,
  evaluateApiRuntimeReleaseGate,
  productionPromotionAllowed,
} from "../supabase/functions/_shared/api-release-gates.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("production mode fails closed when release flags are missing or malformed", () => {
  for (
    const env of [{}, { API_PARTNER_PRODUCTION_ENABLED: "yes" }, {
      API_PARTNER_PRODUCTION_ENABLED: "1",
    }]
  ) {
    const decision = evaluateApiRuntimeReleaseGate(
      "production",
      "GET /v1/health",
      env,
    );
    assert(
      !decision.allowed && decision.reason === "production_api_locked",
      "production must default to locked",
    );
  }
});

Deno.test("sandbox health and local control-plane routes remain available", () => {
  assert(
    evaluateApiRuntimeReleaseGate("sandbox", "GET /v1/health", {}).allowed,
    "sandbox health must remain available",
  );
  assert(
    evaluateApiRuntimeReleaseGate(
      "sandbox",
      "POST /v1/onboarding-authorizations",
      {},
    ).allowed,
    "sandbox authorization must remain available",
  );
});

Deno.test("provider writes require the global write gate", () => {
  const decision = evaluateApiRuntimeReleaseGate(
    "sandbox",
    "POST /v1/transfers",
    {
      API_PARTNER_SANDBOX_WRITES_ENABLED: "true",
      API_PARTNER_PROVIDER_ENVIRONMENT: "sandbox",
    },
  );
  assert(
    !decision.allowed && decision.reason === "provider_writes_locked",
    "global provider write gate must fail closed",
  );
});

Deno.test("money movement has an independent fail-closed gate", () => {
  const base: ApiReleaseGateEnvironment = {
    API_PARTNER_PROVIDER_WRITES_ENABLED: "true",
    API_PARTNER_SANDBOX_WRITES_ENABLED: "true",
    API_PARTNER_PROVIDER_ENVIRONMENT: "sandbox",
  };
  const locked = evaluateApiRuntimeReleaseGate(
    "sandbox",
    "POST /v1/transfers",
    base,
  );
  assert(
    !locked.allowed && locked.reason === "money_movement_locked",
    "transfer inherited the general provider-write gate",
  );
  assert(
    evaluateApiRuntimeReleaseGate("sandbox", "POST /v1/customers", base)
      .allowed,
    "non-money provider write was incorrectly blocked",
  );
  assert(
    evaluateApiRuntimeReleaseGate("sandbox", "POST /v1/transfers", {
      ...base,
      API_PARTNER_MONEY_MOVEMENT_ENABLED: "true",
    }).allowed,
    "explicit money-movement approval was ignored",
  );
});

Deno.test("sandbox writes require explicit sandbox approval and sandbox provider credentials", () => {
  const base: ApiReleaseGateEnvironment = {
    API_PARTNER_PROVIDER_WRITES_ENABLED: "true",
    API_PARTNER_SANDBOX_WRITES_ENABLED: "true",
    API_PARTNER_PROVIDER_ENVIRONMENT: "production",
  };
  const mismatch = evaluateApiRuntimeReleaseGate(
    "sandbox",
    "POST /v1/customers",
    base,
  );
  assert(
    !mismatch.allowed && mismatch.reason === "provider_environment_mismatch",
    "production provider credentials must never serve sandbox tenants",
  );

  const approved = evaluateApiRuntimeReleaseGate(
    "sandbox",
    "POST /v1/customers",
    {
      ...base,
      API_PARTNER_PROVIDER_ENVIRONMENT: "sandbox",
    },
  );
  assert(
    approved.allowed,
    "explicit sandbox writes with sandbox provider credentials should pass",
  );
});

Deno.test("production runtime and promotion require every independent gate", () => {
  const complete: ApiReleaseGateEnvironment = {
    API_PARTNER_PRODUCTION_ENABLED: "true",
    API_PARTNER_PROVIDER_WRITES_ENABLED: "true",
    API_PARTNER_PROVIDER_ENVIRONMENT: "production",
    API_PARTNER_PRODUCTION_PROMOTION_ENABLED: "true",
  };
  assert(
    evaluateApiRuntimeReleaseGate("production", "POST /v1/payouts", {
      ...complete,
      API_PARTNER_MONEY_MOVEMENT_ENABLED: "true",
    }).allowed,
    "complete production runtime gate should pass",
  );
  assert(
    productionPromotionAllowed(complete),
    "complete promotion gate should pass",
  );

  for (
    const key of Object.keys(complete) as Array<keyof ApiReleaseGateEnvironment>
  ) {
    const incomplete = { ...complete };
    delete incomplete[key];
    assert(
      !productionPromotionAllowed(incomplete),
      `promotion must fail without ${key}`,
    );
  }
});
