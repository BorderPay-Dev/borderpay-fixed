import {
  verificationRedirectUrl,
  verifiedHostedLink,
} from "../../supabase/functions/_shared/bridge-verification-url.ts";

const APP_URL = "https://app.borderpayafrica.com";
const ANDROID_URL =
  "https://bridge.withpersona.com/verify?fields%5Bdeveloper_id%5D=a220141a-cb98-4502-bc73-35626f397f2d&fields%5Bemail_address%5D=dpo%40borderpayafrica.com&fields%5Biqt_token%5D=3bpmDX&inquiry-template-id=itmpl_wKuJEFST4JKViF2zcfmNJJJs&redirect-uri=capacitor%3A%2F%2Flocalhost%2F%3Fscreen%3Dkyc&reference-id=79483308-3354-4497-b490-5eaaaa661484";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertThrows(action: () => unknown, message: string): void {
  let rejected = false;
  try {
    action();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

function personaUrl(
  callback: string,
  referenceId = "platform-reference",
): string {
  const target = new URL("https://bridge.withpersona.com/verify");
  target.searchParams.set("fields[email_address]", "qa@borderpayafrica.com");
  target.searchParams.set("redirect-uri", callback);
  target.searchParams.set("reference-id", referenceId);
  return target.toString();
}

Deno.test("rewrites the exact Android Persona callback", () => {
  const result = new URL(verifiedHostedLink(APP_URL, ANDROID_URL));
  assert(result.hostname === "bridge.withpersona.com", "provider host changed");
  assert(
    result.searchParams.get("redirect-uri") === `${APP_URL}/?screen=kyc`,
    "callback was not normalized",
  );
  assert(!result.toString().includes("capacitor"), "native callback leaked");
  assert(
    result.searchParams.get("reference-id") ===
      "79483308-3354-4497-b490-5eaaaa661484",
    "reference id changed",
  );
});

Deno.test("rejects native and foreign callback candidates", () => {
  assert(
    verificationRedirectUrl(APP_URL, "capacitor://localhost/?screen=kyc") ===
      `${APP_URL}/?screen=kyc`,
    "native origin accepted",
  );
  assert(
    verificationRedirectUrl(APP_URL, "https://evil.example/?screen=kyc") ===
      `${APP_URL}/?screen=kyc`,
    "foreign callback accepted",
  );
});

Deno.test("rejects non-Persona hosted destinations", () => {
  assertThrows(
    () => verifiedHostedLink(APP_URL, "https://evil.example/verify"),
    "untrusted hosted destination accepted",
  );
});

// Five independent Android gates.
Deno.test("[Android 1/5] rejects a Capacitor callback candidate", () => {
  assert(
    verificationRedirectUrl(APP_URL, "capacitor://localhost/?screen=kyc") ===
      `${APP_URL}/?screen=kyc`,
    "Capacitor callback was accepted",
  );
});

Deno.test("[Android 2/5] rejects an Android localhost HTTPS callback", () => {
  assert(
    verificationRedirectUrl(APP_URL, "https://localhost/?screen=kyc") ===
      `${APP_URL}/?screen=kyc`,
    "Android localhost callback was accepted",
  );
});

Deno.test("[Android 3/5] rewrites the reported failing Persona URL", () => {
  const result = new URL(verifiedHostedLink(APP_URL, ANDROID_URL));
  assert(
    result.searchParams.get("redirect-uri") === `${APP_URL}/?screen=kyc`,
    "reported Android URL retained its native callback",
  );
});

Deno.test("[Android 4/5] preserves the provider reference identifier", () => {
  const result = new URL(verifiedHostedLink(APP_URL, ANDROID_URL));
  assert(
    result.searchParams.get("reference-id") ===
      "79483308-3354-4497-b490-5eaaaa661484",
    "Android rewrite changed the provider reference",
  );
});

Deno.test("[Android 5/5] removes a legacy underscore callback", () => {
  const target = new URL(personaUrl("capacitor://localhost/?screen=kyc"));
  target.searchParams.set("redirect_uri", "capacitor://localhost/?screen=kyc");
  const result = new URL(verifiedHostedLink(APP_URL, target.toString()));
  assert(!result.searchParams.has("redirect_uri"), "legacy callback survived");
  assert(!result.toString().includes("capacitor"), "native scheme leaked");
});

// Five independent iPhone gates.
Deno.test("[iPhone 1/5] rejects a Capacitor callback candidate", () => {
  assert(
    verificationRedirectUrl(APP_URL, "capacitor://localhost/?screen=kyc") ===
      `${APP_URL}/?screen=kyc`,
    "iPhone Capacitor callback was accepted",
  );
});

Deno.test("[iPhone 2/5] rejects an Ionic custom-scheme callback", () => {
  assert(
    verificationRedirectUrl(APP_URL, "ionic://localhost/?screen=kyc") ===
      `${APP_URL}/?screen=kyc`,
    "iPhone custom-scheme callback was accepted",
  );
});

Deno.test("[iPhone 3/5] rewrites a cached native callback in Persona", () => {
  const result = new URL(
    verifiedHostedLink(APP_URL, personaUrl("capacitor://localhost/kyc")),
  );
  assert(
    result.searchParams.get("redirect-uri") === `${APP_URL}/?screen=kyc`,
    "cached iPhone callback survived",
  );
});

Deno.test("[iPhone 4/5] keeps the hosted verification URL on HTTPS", () => {
  const result = new URL(
    verifiedHostedLink(APP_URL, personaUrl("capacitor://localhost/kyc")),
  );
  assert(result.protocol === "https:", "iPhone handoff is not HTTPS");
});

Deno.test("[iPhone 5/5] preserves verification identity fields", () => {
  const result = new URL(
    verifiedHostedLink(
      APP_URL,
      personaUrl("capacitor://localhost/kyc", "ios-reference"),
    ),
  );
  assert(
    result.searchParams.get("reference-id") === "ios-reference",
    "iPhone rewrite changed identity fields",
  );
});

// Five independent installed-PWA gates.
Deno.test("[PWA 1/5] accepts the production HTTPS origin", () => {
  assert(
    verificationRedirectUrl(APP_URL, `${APP_URL}/?screen=kyc`) ===
      `${APP_URL}/?screen=kyc`,
    "production PWA origin was rejected",
  );
});

Deno.test("[PWA 2/5] normalizes a stale application path", () => {
  assert(
    verificationRedirectUrl(APP_URL, `${APP_URL}/verification/return`) ===
      `${APP_URL}/?screen=kyc`,
    "PWA callback path was not normalized",
  );
});

Deno.test("[PWA 3/5] strips unrelated callback query parameters", () => {
  const result = new URL(
    verificationRedirectUrl(APP_URL, `${APP_URL}/?screen=old&token=secret`),
  );
  assert(result.searchParams.get("screen") === "kyc", "PWA screen is wrong");
  assert(!result.searchParams.has("token"), "PWA callback retained extra data");
});

Deno.test("[PWA 4/5] rejects the production host on a foreign port", () => {
  assert(
    verificationRedirectUrl(APP_URL, `${APP_URL}:444/?screen=kyc`) ===
      `${APP_URL}/?screen=kyc`,
    "foreign-port PWA origin was accepted",
  );
});

Deno.test("[PWA 5/5] emits exactly one canonical screen parameter", () => {
  const result = new URL(
    verificationRedirectUrl(APP_URL, `${APP_URL}/?screen=old&screen=other`),
  );
  assert(
    result.searchParams.getAll("screen").length === 1 &&
      result.searchParams.get("screen") === "kyc",
    "PWA callback is not canonical",
  );
});

// Five independent browser-web gates.
Deno.test("[Web 1/5] rejects a foreign HTTPS callback", () => {
  assert(
    verificationRedirectUrl(APP_URL, "https://evil.example/?screen=kyc") ===
      `${APP_URL}/?screen=kyc`,
    "foreign web callback was accepted",
  );
});

Deno.test("[Web 2/5] rejects an attacker subdomain callback", () => {
  assert(
    verificationRedirectUrl(
      APP_URL,
      "https://app.borderpayafrica.com.evil.example/?screen=kyc",
    ) === `${APP_URL}/?screen=kyc`,
    "attacker subdomain was accepted",
  );
});

Deno.test("[Web 3/5] rejects an insecure production-host callback", () => {
  assert(
    verificationRedirectUrl(
      APP_URL,
      "http://app.borderpayafrica.com/?screen=kyc",
    ) === `${APP_URL}/?screen=kyc`,
    "insecure web callback was accepted",
  );
});

Deno.test("[Web 4/5] rejects a non-Persona hosted destination", () => {
  assertThrows(
    () => verifiedHostedLink(APP_URL, "https://verify.evil.example/start"),
    "untrusted web handoff destination was accepted",
  );
});

Deno.test("[Web 5/5] accepts an HTTPS Persona subdomain", () => {
  const target = personaUrl(`${APP_URL}/?screen=kyc`).replace(
    "bridge.withpersona.com",
    "tenant.bridge.withpersona.com",
  );
  const result = new URL(verifiedHostedLink(APP_URL, target));
  assert(
    result.hostname === "tenant.bridge.withpersona.com" &&
      result.protocol === "https:",
    "trusted Persona subdomain was rejected",
  );
});
