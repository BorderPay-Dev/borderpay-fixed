import {
  BRIDGE_EEA_SCA_COUNTRIES,
  bridgeCustomerScaCountry,
  bridgeEeaScaEnforcementEnabled,
  isBridgeEeaScaCountry,
  isActiveBridgeCustodialWallet,
  normalizeBridgeScaCountry,
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

Deno.test("SCA starts only when a non-terminal Bridge custodial wallet exists", () => {
  assertEquals(isActiveBridgeCustodialWallet({ wallet_id: "wal_active", status: "active" }), true);
  assertEquals(isActiveBridgeCustodialWallet({ wallet_id: "wal_legacy" }), true);
  for (const status of ["closed", "deleted", "disabled", "deactivated", "inactive"]) {
    assertEquals(isActiveBridgeCustodialWallet({ wallet_id: "wal_terminal", status }), false, status);
  }
  assertEquals(isActiveBridgeCustodialWallet({ wallet_id: "", status: "active" }), false);
});

Deno.test("EEA SCA country normalization is deterministic", () => {
  assertEquals(normalizeBridgeScaCountry(" fra "), "FR");
  assertEquals(normalizeBridgeScaCountry("no"), "NO");
  assertEquals(normalizeBridgeScaCountry(""), null);
});

Deno.test("business SCA uses incorporation country and never operating address", () => {
  assertEquals(bridgeCustomerScaCountry({ raw: { country_of_incorporation: "GB", operating_address: { country: "FR" } }, country: "FR" }, "business"), "GB");
  assertEquals(isBridgeEeaScaCountry(bridgeCustomerScaCountry({ raw: { country_of_incorporation: "GB", operating_address: { country: "FR" } }, country: "FR" }, "business")), false);
  assertEquals(bridgeCustomerScaCountry({ raw: { business: { country_of_incorporation: "LV", operating_address: { country: "GB" } } } }, "business"), "LV");
  assertEquals(bridgeCustomerScaCountry({ raw: { operating_address: { country: "FR" }, country: "FR" }, country: "FR" }, "business"), null);
  assertEquals(bridgeCustomerScaCountry({ raw: { registered_address: { country: "FR" }, operating_address: { country: "GB" } } }, "business"), "FR");
});

Deno.test("individual SCA uses residence country", () => {
  assertEquals(bridgeCustomerScaCountry({ raw: { residential_address: { country: "FR" }, country_of_incorporation: "GB" }, country: "GB" }, "individual"), "FR");
});

Deno.test("SCA rollout remains disabled unless explicitly enabled", () => {
  const previous = Deno.env.get("BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED");
  try {
    Deno.env.delete("BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED");
    assertEquals(bridgeEeaScaEnforcementEnabled(), false, "missing flag");
    Deno.env.set("BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED", "false");
    assertEquals(bridgeEeaScaEnforcementEnabled(), false, "false flag");
    Deno.env.set("BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED", "true");
    assertEquals(bridgeEeaScaEnforcementEnabled(), true, "true flag");
  } finally {
    if (previous === undefined) Deno.env.delete("BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED");
    else Deno.env.set("BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED", previous);
  }
});
