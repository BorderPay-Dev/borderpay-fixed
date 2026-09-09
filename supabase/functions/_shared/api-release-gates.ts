export type ApiTenantMode = "sandbox" | "production";

export interface ApiReleaseGateEnvironment {
  API_PARTNER_PRODUCTION_ENABLED?: string;
  API_PARTNER_PROVIDER_WRITES_ENABLED?: string;
  API_PARTNER_SANDBOX_WRITES_ENABLED?: string;
  API_PARTNER_PROVIDER_ENVIRONMENT?: string;
  API_PARTNER_PRODUCTION_PROMOTION_ENABLED?: string;
  API_PARTNER_MONEY_MOVEMENT_ENABLED?: string;
}

export interface ApiReleaseGateDecision {
  allowed: boolean;
  reason?:
    | "production_api_locked"
    | "provider_writes_locked"
    | "sandbox_writes_locked"
    | "provider_environment_mismatch"
    | "money_movement_locked";
}

const PROVIDER_WRITE_ROUTES = new Set([
  "POST /v1/customers",
  "POST /v1/wallets",
  "POST /v1/virtual-accounts",
  "POST /v1/transfers",
  "POST /v1/payouts",
]);
const MONEY_MOVEMENT_ROUTES = new Set([
  "POST /v1/transfers",
  "POST /v1/payouts",
]);

function enabled(value: string | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "true";
}

export function readApiReleaseGateEnvironment(): ApiReleaseGateEnvironment {
  return {
    API_PARTNER_PRODUCTION_ENABLED:
      Deno.env.get("API_PARTNER_PRODUCTION_ENABLED") ?? undefined,
    API_PARTNER_PROVIDER_WRITES_ENABLED:
      Deno.env.get("API_PARTNER_PROVIDER_WRITES_ENABLED") ?? undefined,
    API_PARTNER_SANDBOX_WRITES_ENABLED:
      Deno.env.get("API_PARTNER_SANDBOX_WRITES_ENABLED") ?? undefined,
    API_PARTNER_PROVIDER_ENVIRONMENT:
      Deno.env.get("API_PARTNER_PROVIDER_ENVIRONMENT") ?? undefined,
    API_PARTNER_PRODUCTION_PROMOTION_ENABLED:
      Deno.env.get("API_PARTNER_PRODUCTION_PROMOTION_ENABLED") ?? undefined,
    API_PARTNER_MONEY_MOVEMENT_ENABLED:
      Deno.env.get("API_PARTNER_MONEY_MOVEMENT_ENABLED") ?? undefined,
  };
}

export function evaluateApiRuntimeReleaseGate(
  mode: ApiTenantMode,
  routeKey: string,
  env: ApiReleaseGateEnvironment,
): ApiReleaseGateDecision {
  if (mode === "production" && !enabled(env.API_PARTNER_PRODUCTION_ENABLED)) {
    return { allowed: false, reason: "production_api_locked" };
  }
  if (!PROVIDER_WRITE_ROUTES.has(routeKey)) return { allowed: true };
  if (!enabled(env.API_PARTNER_PROVIDER_WRITES_ENABLED)) {
    return { allowed: false, reason: "provider_writes_locked" };
  }
  const providerEnvironment = String(env.API_PARTNER_PROVIDER_ENVIRONMENT || "")
    .trim().toLowerCase();
  if (providerEnvironment !== mode) {
    return { allowed: false, reason: "provider_environment_mismatch" };
  }
  if (mode === "sandbox" && !enabled(env.API_PARTNER_SANDBOX_WRITES_ENABLED)) {
    return { allowed: false, reason: "sandbox_writes_locked" };
  }
  if (
    MONEY_MOVEMENT_ROUTES.has(routeKey) &&
    !enabled(env.API_PARTNER_MONEY_MOVEMENT_ENABLED)
  ) {
    return { allowed: false, reason: "money_movement_locked" };
  }
  return { allowed: true };
}

export function productionPromotionAllowed(
  env: ApiReleaseGateEnvironment,
): boolean {
  return enabled(env.API_PARTNER_PRODUCTION_PROMOTION_ENABLED) &&
    enabled(env.API_PARTNER_PRODUCTION_ENABLED) &&
    enabled(env.API_PARTNER_PROVIDER_WRITES_ENABLED) &&
    String(env.API_PARTNER_PROVIDER_ENVIRONMENT || "").trim().toLowerCase() ===
      "production";
}
