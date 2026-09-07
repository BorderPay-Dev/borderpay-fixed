function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const source = await Deno.readTextFile(
  new URL("../supabase/functions/flutterwave-subscription-collection/index.ts", import.meta.url),
);
const config = await Deno.readTextFile(new URL("../supabase/config.toml", import.meta.url));

Deno.test("maintenance webhook supports v3 and v4 signatures without changing the v3 API", () => {
  assert(source.includes('const FLW_API = "https://api.flutterwave.com/v3"'), "v3 payment API must remain unchanged");
  assert(source.includes('req.headers.get("verif-hash")'), "v3 webhook signature must remain supported");
  assert(source.includes('req.headers.get("flutterwave-signature")'), "v4 webhook signature header must be recognized");
  assert(source.includes('Deno.env.get("FLUTTERWAVE_V4_WEBHOOK_SECRET_HASH")'), "v4 must use a separate secret");
  assert(source.includes('{ name: "HMAC", hash: "SHA-256" }'), "v4 signature must use HMAC-SHA256");
  assert(source.includes("new TextEncoder().encode(rawBody)"), "signature must cover the untouched request body");
  assert(source.includes('payment?.tx_ref ?? payment?.reference ?? payment?.txRef'), "v3/v4 references must normalize explicitly");
  assert(source.includes("complete_external_subscription_invoice"), "verified payments must retain the atomic completion RPC");
  assert(source.includes('reason: "invalid_signature"'), "signature failures must emit safe diagnostics");
  assert(source.includes("v4_signature_length"), "diagnostics may log signature length but not the secret value");
  assert(!source.includes("v4_signature: v4Signature"), "diagnostics must never log the signature value");
  assert(source.includes("reference_matches:"), "provider verification mismatch must be diagnosable without logging references");
  assert(source.includes('reason: "missing_recognized_signature_header"'), "unrecognized webhook headers must be diagnosable");
  assert(source.includes("relevant_header_names"), "only relevant header names may be logged");
  assert(
    config.includes("[functions.flutterwave-subscription-collection]\nverify_jwt = false"),
    "the signed provider webhook must remain reachable without a Supabase JWT",
  );
});
