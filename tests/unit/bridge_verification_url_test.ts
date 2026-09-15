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
  let rejected = false;
  try {
    verifiedHostedLink(APP_URL, "https://evil.example/verify");
  } catch {
    rejected = true;
  }
  assert(rejected, "untrusted hosted destination accepted");
});
