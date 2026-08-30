import {
  isYellowCardSandboxCountryEnabled,
  YELLOW_CARD_SANDBOX_ENABLED_COUNTRIES,
} from "../supabase/functions/_shared/providers/yellowcard-sandbox-scope.ts";

Deno.test("Yellow Card sandbox scope exactly matches account-team enablement", () => {
  const expected = ["NG", "CG", "CI", "RW", "KE", "ZA", "CM", "ZM", "UG", "TZ", "BW", "BJ"];
  if (JSON.stringify(YELLOW_CARD_SANDBOX_ENABLED_COUNTRIES) !== JSON.stringify(expected)) {
    throw new Error(`sandbox enablement drift: ${JSON.stringify(YELLOW_CARD_SANDBOX_ENABLED_COUNTRIES)}`);
  }
});

Deno.test("Burkina Faso, DRC and pending Ethiopia fail closed in sandbox", () => {
  for (const country of ["BF", "CD", "ET"]) {
    if (isYellowCardSandboxCountryEnabled(country)) {
      throw new Error(`${country} must not be executable in BorderPay's Yellow Card sandbox account`);
    }
  }
});

Deno.test("newly enabled Benin and Congo Brazzaville are in sandbox scope", () => {
  for (const country of ["BJ", "CG"]) {
    if (!isYellowCardSandboxCountryEnabled(country)) throw new Error(`${country} must be enabled`);
  }
});
