import { verifyFirebaseAppCheckTokenWithJwks } from "../supabase/functions/_shared/firebase-app-check.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function fixture(payload: Record<string, unknown>) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const kid = "test-key";
  const head = encode({ alg: "RS256", kid });
  const body = encode(payload);
  const input = `${head}.${body}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  const encodedSignature = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { token: `${input}.${encodedSignature}`, keys: [{ ...jwk, kid, alg: "RS256" }] };
}

Deno.test("Firebase App Check accepts only the configured project and app", async () => {
  const now = 1_800_000_000;
  const valid = await fixture({
    iss: "https://firebaseappcheck.googleapis.com/741995539698",
    aud: ["projects/741995539698"],
    sub: "1:741995539698:android:allowed",
    iat: now - 5,
    exp: now + 300,
  });
  const allowed = new Set(["1:741995539698:android:allowed"]);
  assert(await verifyFirebaseAppCheckTokenWithJwks(valid.token, "741995539698", allowed, valid.keys, now), "valid token rejected");
  assert(!await verifyFirebaseAppCheckTokenWithJwks(valid.token, "wrong-project", allowed, valid.keys, now), "wrong project accepted");
  assert(!await verifyFirebaseAppCheckTokenWithJwks(valid.token, "741995539698", new Set(["wrong-app"]), valid.keys, now), "wrong app accepted");
});

Deno.test("Firebase App Check rejects expired and tampered tokens", async () => {
  const now = 1_800_000_000;
  const expired = await fixture({
    iss: "https://firebaseappcheck.googleapis.com/741995539698",
    aud: "projects/741995539698",
    sub: "ios-app",
    iat: now - 600,
    exp: now - 1,
  });
  const allowed = new Set(["ios-app"]);
  assert(!await verifyFirebaseAppCheckTokenWithJwks(expired.token, "741995539698", allowed, expired.keys, now), "expired token accepted");
  const tampered = expired.token.slice(0, -1) + (expired.token.endsWith("A") ? "B" : "A");
  assert(!await verifyFirebaseAppCheckTokenWithJwks(tampered, "741995539698", allowed, expired.keys, now), "tampered token accepted");
});
