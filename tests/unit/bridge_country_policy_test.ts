/**
 * Deno unit tests for the authoritative Bridge country policy module.
 *
 * Run with: deno test tests/unit/bridge_country_policy_test.ts
 *
 * These tests don't hit the network, the DB, or Bridge — they verify
 * the pure-function contract of the policy module.
 *
 * Round-11 P2 follow-up — Issue #4 item 2: added the fail-loud assertion
 * for `bridgeCountryBlockResponse` so a future caller can't silently
 * misuse the function on a Controlled or Supported country.
 */

import { assertEquals, assertThrows, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isBridgeProhibited,
  isBridgeUnavailable,
  isBridgeControlled,
  isBridgeBlocked,
  bridgeCountryTier,
  bridgeCountryBlockResponse,
} from "../../supabase/functions/_shared/providers/bridge-country-policy.ts";

// ── Tier classification ────────────────────────────────────────────────

Deno.test("isBridgeProhibited recognises sanctions-tier codes", () => {
  assert(isBridgeProhibited("CD"));   // DRC
  assert(isBridgeProhibited("IR"));   // Iran
  assert(isBridgeProhibited("KP"));   // DPRK
  assert(isBridgeProhibited("ru"));   // case-insensitive
  assert(!isBridgeProhibited("NG"));  // Nigeria is Controlled, not Prohibited
  assert(!isBridgeProhibited("US"));  // Supported
  assert(!isBridgeProhibited(""));    // empty
  assert(!isBridgeProhibited(null));  // null
});

Deno.test("isBridgeUnavailable recognises commercial-unavailability codes", () => {
  assert(isBridgeUnavailable("DZ"));  // Algeria
  assert(isBridgeUnavailable("BI"));  // Burundi
  assert(isBridgeUnavailable("CN"));  // China
  assert(isBridgeUnavailable("JP"));  // Japan
  assert(isBridgeUnavailable("TN"));  // Tunisia
  assert(isBridgeUnavailable("jp"));  // case-insensitive
  assert(!isBridgeUnavailable("CD")); // DRC is Prohibited, not Unavailable
  assert(!isBridgeUnavailable("NG")); // Nigeria is Controlled
});

Deno.test("isBridgeControlled recognises high-risk codes", () => {
  assert(isBridgeControlled("NG"));   // Nigeria
  assert(isBridgeControlled("KE"));   // Kenya
  assert(isBridgeControlled("ZA"));   // South Africa
  assert(isBridgeControlled("UA"));   // Ukraine
  assert(!isBridgeControlled("CD"));  // DRC is Prohibited
  assert(!isBridgeControlled("JP"));  // Japan is Unavailable
  assert(!isBridgeControlled("US"));  // Supported
});

Deno.test("isBridgeBlocked is the OR of Prohibited + Unavailable", () => {
  assert(isBridgeBlocked("CD"));      // Prohibited
  assert(isBridgeBlocked("JP"));      // Unavailable
  assert(!isBridgeBlocked("NG"));     // Controlled passes the gate
  assert(!isBridgeBlocked("US"));     // Supported passes
  assert(!isBridgeBlocked(""));
  assert(!isBridgeBlocked(null));
});

Deno.test("bridgeCountryTier returns the right tier name", () => {
  assertEquals(bridgeCountryTier("CD"),  "prohibited");
  assertEquals(bridgeCountryTier("JP"),  "unavailable");
  assertEquals(bridgeCountryTier("NG"),  "controlled");
  assertEquals(bridgeCountryTier("US"),  "supported");
  assertEquals(bridgeCountryTier(""),    "supported");
  assertEquals(bridgeCountryTier(null),  "supported");
});

// ── bridgeCountryBlockResponse: blocked-tier contract ──────────────────

Deno.test("bridgeCountryBlockResponse returns reason='prohibited' for sanctions codes", () => {
  const r = bridgeCountryBlockResponse("CD");
  assertEquals(r.success, false);
  assertEquals(r.code, "country_not_supported");
  assertEquals(r.country, "CD");
  assertEquals(r.reason, "prohibited");
  assert(r.error.includes("DRC"));                                         // friendly name
  assert(r.error.includes("not available through our regulated banking")); // sanctions copy
});

Deno.test("bridgeCountryBlockResponse returns reason='prohibited' for non-DRC sanctions codes", () => {
  const r = bridgeCountryBlockResponse("IR");
  assertEquals(r.reason, "prohibited");
  assert(r.error.includes("Iran"));
  assert(r.error.includes("not available through our regulated banking"));
});

Deno.test("bridgeCountryBlockResponse returns reason='unavailable' for commercial codes", () => {
  const r = bridgeCountryBlockResponse("JP");
  assertEquals(r.success, false);
  assertEquals(r.code, "country_not_supported");
  assertEquals(r.country, "JP");
  assertEquals(r.reason, "unavailable");
  assert(r.error.includes("Japan"));                                       // friendly name
  assert(r.error.includes("not currently serviceable"));                   // unavailable copy
});

Deno.test("bridgeCountryBlockResponse uppercases the country field", () => {
  const r = bridgeCountryBlockResponse("jp");
  assertEquals(r.country, "JP");
});

// ── Fail-loud behaviour: Issue #4 item 2 ───────────────────────────────

Deno.test("bridgeCountryBlockResponse THROWS for Controlled-tier code (misuse)", () => {
  assertThrows(
    () => bridgeCountryBlockResponse("NG"),
    Error,
    "non-blocked country",
  );
  assertThrows(
    () => bridgeCountryBlockResponse("KE"),
    Error,
    "non-blocked country",
  );
});

Deno.test("bridgeCountryBlockResponse THROWS for Supported-tier code (misuse)", () => {
  assertThrows(
    () => bridgeCountryBlockResponse("US"),
    Error,
    "non-blocked country",
  );
  assertThrows(
    () => bridgeCountryBlockResponse("GH"),
    Error,
    "non-blocked country",
  );
});

Deno.test("bridgeCountryBlockResponse error message names the bad tier + code", () => {
  const err = assertThrows(() => bridgeCountryBlockResponse("NG"), Error);
  assert((err as Error).message.includes("tier=controlled"));
  assert((err as Error).message.includes("code=NG"));
  assert((err as Error).message.includes("isBridgeBlocked"));  // points the dev at the right gate
});
