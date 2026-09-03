export type OnboardingAccountType = "individual" | "business";
export type OnboardingChannel = "api" | "white_label";

export interface TenantOnboardingPolicy {
  individual_signup_enabled: boolean;
  business_signup_enabled: boolean;
  white_label_signup_enabled: boolean;
}

export interface OnboardingTokenClaims {
  iss: "borderpay";
  aud: "partner_onboarding";
  jti: string;
  tenant_id: string;
  api_key_id: string;
  external_user_id: string;
  allowed_account_types: OnboardingAccountType[];
  onboarding_channel: OnboardingChannel;
  iat: number;
  exp: number;
}

export function parseSignupAccountType(value: unknown): OnboardingAccountType | null {
  return value === "individual" || value === "business" ? value : null;
}

export function isSignupFlagEnabled(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function resolveTenantOnboardingPolicy(metadata: unknown): TenantOnboardingPolicy {
  const root = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const raw = root.onboarding && typeof root.onboarding === "object"
    ? root.onboarding as Record<string, unknown>
    : {};
  return {
    individual_signup_enabled: raw.individual_signup_enabled === true,
    business_signup_enabled: raw.business_signup_enabled === true,
    white_label_signup_enabled: raw.white_label_signup_enabled === true,
  };
}

export function allowedAccountTypes(
  policy: TenantOnboardingPolicy,
  channel: OnboardingChannel,
): OnboardingAccountType[] {
  if (channel === "white_label" && !policy.white_label_signup_enabled) return [];
  const result: OnboardingAccountType[] = [];
  if (policy.individual_signup_enabled) result.push("individual");
  if (policy.business_signup_enabled) result.push("business");
  return result;
}

export async function signOnboardingToken(
  claims: OnboardingTokenClaims,
  secret: string,
): Promise<string> {
  if (secret.length < 32) throw new Error("ONBOARDING_TOKEN_SIGNING_SECRET must be at least 32 characters");
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), encoder.encode(input));
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyOnboardingToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<OnboardingTokenClaims> {
  if (secret.length < 32) throw new Error("Onboarding token verification is not configured");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid onboarding token");
  const [header, payload, signature] = parts;
  const headerJson = JSON.parse(new TextDecoder().decode(base64UrlDecode(header)));
  if (headerJson?.alg !== "HS256" || headerJson?.typ !== "JWT") throw new Error("Invalid onboarding token header");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, ["verify"]),
    base64UrlDecode(signature).buffer as ArrayBuffer,
    encoder.encode(`${header}.${payload}`),
  );
  if (!valid) throw new Error("Invalid onboarding token signature");

  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as OnboardingTokenClaims;
  if (claims.iss !== "borderpay" || claims.aud !== "partner_onboarding") throw new Error("Invalid onboarding token audience");
  if (!claims.jti || !claims.tenant_id || !claims.api_key_id || !claims.external_user_id) throw new Error("Incomplete onboarding token");
  if (!Array.isArray(claims.allowed_account_types) || claims.allowed_account_types.length === 0) throw new Error("No account type authorized");
  if (claims.allowed_account_types.some((type) => type !== "individual" && type !== "business")) throw new Error("Invalid authorized account type");
  if (claims.onboarding_channel !== "api" && claims.onboarding_channel !== "white_label") throw new Error("Invalid onboarding channel");
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds) throw new Error("Onboarding token expired");
  if (!Number.isFinite(claims.iat) || claims.iat > nowSeconds + 60) throw new Error("Invalid onboarding token issue time");
  return claims;
}
