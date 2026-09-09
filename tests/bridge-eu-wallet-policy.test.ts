import {
  bridgeAutomaticWalletsForCountry,
  isBridgeEuropeanUnionCountry,
} from "../supabase/functions/_shared/providers/bridge-country-policy.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("EU-27 customers receive only EURC on Base", () => {
  for (const country of ["FR", "FRA", "DE", "LT", "SE"]) {
    assertEquals(isBridgeEuropeanUnionCountry(country), true, `${country} must be EU`);
    assertEquals(
      bridgeAutomaticWalletsForCountry(country),
      [{ symbol: "EURC", chain: "BASE" }],
      `${country} wallet policy`,
    );
  }
});

Deno.test("UK and non-EU European countries do not receive the EU policy", () => {
  for (const country of ["GB", "NO", "IS", "LI", "CH"]) {
    assertEquals(isBridgeEuropeanUnionCountry(country), false, `${country} must not be EU`);
    assertEquals(
      bridgeAutomaticWalletsForCountry(country),
      [
        { symbol: "USDC", chain: "BASE" },
        { symbol: "USDT", chain: "TRON" },
      ],
      `${country} wallet policy`,
    );
  }
});

Deno.test("existing non-EU wallet policy remains unchanged", () => {
  assertEquals(
    bridgeAutomaticWalletsForCountry("KE"),
    [
      { symbol: "USDC", chain: "BASE" },
      { symbol: "USDT", chain: "TRON" },
    ],
    "Kenya wallet policy",
  );
});
