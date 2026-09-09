import {
  bridgeEeaWalletSecurityRequired,
  loadWalletSecurityEnrollment,
} from "../supabase/functions/_shared/wallet-security-enrollment.ts";

function assertEquals(actual: unknown, expected: unknown, label = "value") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function fakeSupabase(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error }),
        }),
      }),
    }),
  };
}

Deno.test("wallet enrollment requires real PIN hash and encrypted active TOTP", async () => {
  const enrolled = await loadWalletSecurityEnrollment(fakeSupabase({
    pin_set: true,
    pin_hash_v2: "v2$salt$hash",
    pin_hash: null,
    two_factor_enabled: true,
    two_factor_secret_encrypted: "\\x010203",
  }), "user-1");
  assertEquals(enrolled.enrolled, true);
  assertEquals(enrolled.required, true);
  assertEquals(enrolled.missing, []);
});

Deno.test("wallet enrollment rejects inconsistent factor flags", async () => {
  const missing = await loadWalletSecurityEnrollment(fakeSupabase({
    pin_set: true,
    pin_hash_v2: null,
    pin_hash: null,
    two_factor_enabled: true,
    two_factor_secret_encrypted: null,
  }), "user-2");
  assertEquals(missing.enrolled, false);
  assertEquals(missing.missing, ["transaction_pin", "authenticator"]);
});

Deno.test("wallet enrollment lookup fails closed", async () => {
  let failed = false;
  try {
    await loadWalletSecurityEnrollment(fakeSupabase(null, { message: "unavailable" }), "user-3");
  } catch {
    failed = true;
  }
  assertEquals(failed, true);
});

Deno.test("wallet security enrollment applies only to the exact EEA-30", () => {
  const eea30 = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
    "GR", "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL",
    "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  ];
  for (const country of eea30) assertEquals(bridgeEeaWalletSecurityRequired(country), true, country);
  for (const country of ["GB", "CH", "US", "CA", "KE", "NG", "NZ", "AU", "ZA", "AE"]) {
    assertEquals(bridgeEeaWalletSecurityRequired(country), false, country);
  }
});
