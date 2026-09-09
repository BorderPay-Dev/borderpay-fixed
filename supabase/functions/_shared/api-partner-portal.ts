export const PARTNER_API_KEY_SCOPES = [
  "customers:write",
  "onboarding:write",
  "wallets:write",
  "virtual_accounts:write",
  "transfers:write",
  "payouts:write",
  "webhooks:write",
] as const;

const allowedScopes = new Set<string>(PARTNER_API_KEY_SCOPES);

export function normalizePartnerApiKeyScopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("At least one API scope is required");
  }
  const scopes = [...new Set(value.map((item) => String(item ?? "").trim()))]
    .filter(Boolean);
  if (scopes.length === 0 || scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new Error("One or more API scopes are not allowed");
  }
  return scopes;
}

export function normalizePartnerKeyLabel(value: unknown): string | null {
  const label = String(value ?? "").trim();
  if (!label) return null;
  if (label.length > 80) throw new Error("API key label is too long");
  return label;
}

export function requireOwnedResourceId(value: unknown, field: string): string {
  const id = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`${field} is invalid`);
  }
  return id;
}

export function newPartnerApiKey(mode: "sandbox" | "production"): {
  plain: string;
  prefix: string;
} {
  const tag = mode === "production" ? "live" : "test";
  const token = crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "");
  const plain = `bpk_${tag}_${token}`;
  return { plain, prefix: plain.slice(0, 14) };
}

export async function partnerSha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
