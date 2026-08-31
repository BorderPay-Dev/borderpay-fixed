import {
  BRIDGE_EEA_SCA_COUNTRIES,
  isBridgeEeaScaCountry,
  normalizeBridgeScaCountry,
  resolveLocalBridgeScaScope,
} from "../supabase/functions/_shared/bridge-sca-scope.ts";

function assertEquals(actual: unknown, expected: unknown, label = "value") {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test("EEA SCA scope includes EFTA EEA states and excludes UK and Switzerland", () => {
  const expected = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
    "GR", "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL",
    "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  ];
  assertEquals(
    JSON.stringify([...BRIDGE_EEA_SCA_COUNTRIES].sort()),
    JSON.stringify(expected.sort()),
    "exact EEA country set",
  );
  for (const country of ["AT", "FR", "DE", "IS", "LI", "NO", "NOR", "ISL", "LIE"]) {
    assertEquals(isBridgeEeaScaCountry(country), true, country);
  }
  for (const country of ["GB", "GBR", "CH", "CHE", "US", "KE"]) {
    assertEquals(isBridgeEeaScaCountry(country), false, country);
  }
});

Deno.test("EEA SCA country normalization is deterministic", () => {
  assertEquals(normalizeBridgeScaCountry(" fra "), "FR");
  assertEquals(normalizeBridgeScaCountry("no"), "NO");
  assertEquals(normalizeBridgeScaCountry(""), null);
});

Deno.test("verified non-EEA accounts bypass provider-dependent SCA scope", () => {
  const us = resolveLocalBridgeScaScope("approved", "US");
  assertEquals(us?.status, "not_required");
  assertEquals(us?.reason, "non_eea");
  assertEquals(us?.country, "US");

  const kenya = resolveLocalBridgeScaScope("approved", "KEN");
  assertEquals(kenya?.status, "not_required");
  assertEquals(kenya?.reason, "non_eea");

  assertEquals(resolveLocalBridgeScaScope("approved", "FR"), null, "EEA continues to provider confirmation");
  assertEquals(resolveLocalBridgeScaScope("approved", null), null, "missing country continues to provider confirmation");
});
