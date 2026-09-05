type AppCheckPayload = {
  aud?: string | string[];
  exp?: number;
  iat?: number;
  iss?: string;
  sub?: string;
};

type Jwk = JsonWebKey & { kid?: string; alg?: string };

let jwksCache: { expiresAt: number; keys: Jwk[] } | null = null;

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch("https://firebaseappcheck.googleapis.com/v1/jwks");
  if (!response.ok) throw new Error("App Check signing keys unavailable");
  const body = await response.json() as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (!keys.length) throw new Error("App Check signing keys missing");
  const maxAge = Number((response.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || "3600");
  jwksCache = { keys, expiresAt: Date.now() + Math.max(60, maxAge) * 1000 };
  return keys;
}

export function appCheckIsRequired(): boolean {
  return (Deno.env.get("FIREBASE_APP_CHECK_REQUIRED") || "").trim().toLowerCase() === "true";
}

export async function verifyFirebaseAppCheckTokenWithJwks(
  token: string,
  projectNumber: string,
  allowedAppIds: Set<string>,
  keys: Jwk[],
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
    const payload = decodeJson<AppCheckPayload>(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return false;
    const key = keys.find((candidate) => candidate.kid === header.kid);
    if (!key) return false;
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      decodeBase64Url(parts[2]).buffer as ArrayBuffer,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!verified) return false;

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud || ""];
    return payload.iss === `https://firebaseappcheck.googleapis.com/${projectNumber}` &&
      audiences.includes(`projects/${projectNumber}`) &&
      Number(payload.exp || 0) > now &&
      Number(payload.iat || 0) <= now + 60 &&
      allowedAppIds.has(String(payload.sub || ""));
  } catch {
    return false;
  }
}

export async function verifyFirebaseAppCheckToken(token: string): Promise<boolean> {
  const projectNumber = (Deno.env.get("FIREBASE_APP_CHECK_PROJECT_NUMBER") || "").trim();
  const allowedAppIds = new Set(
    (Deno.env.get("FIREBASE_APP_CHECK_ALLOWED_APP_IDS") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!projectNumber || !allowedAppIds.size) return false;
  try {
    return await verifyFirebaseAppCheckTokenWithJwks(token, projectNumber, allowedAppIds, await getJwks());
  } catch {
    return false;
  }
}
