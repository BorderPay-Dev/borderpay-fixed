// Retired by internal subscription billing on 2026-08-07.
// This endpoint intentionally performs no reads, debits, or provider calls.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(JSON.stringify({
  success: false,
  code: "legacy_billing_retired",
  error: "This billing collector has been replaced by BorderPay internal subscription billing.",
}), { status: 410, headers: { "Content-Type": "application/json" } }));
