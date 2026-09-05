import assert from "node:assert/strict";
import { getSignupCountriesFromBridge } from "../src/lib/countries.ts";

Deno.test("Bridge ZWE country response exposes Zimbabwe in signup", () => {
  const countries = getSignupCountriesFromBridge([
    { code: null, code3: "ZWE", name: "Zimbabwe" },
  ]);

  assert.equal(countries.length, 1);
  assert.equal(countries[0].code, "ZW");
  assert.equal(countries[0].name, "Zimbabwe");
});

Deno.test("Bridge live countries remain subject to prohibited-country policy", () => {
  const countries = getSignupCountriesFromBridge([
    { code: null, code3: "AFG", name: "Afghanistan" },
    { code: null, code3: "ZWE", name: "Zimbabwe" },
  ]);

  assert.deepEqual(countries.map((country) => country.code), ["ZW"]);
});

Deno.test("country-only signup excludes Ukraine until sub-region screening exists", () => {
  const countries = getSignupCountriesFromBridge([
    { code: "UA", code3: "UKR", name: "Ukraine" },
    { code: "KE", code3: "KEN", name: "Kenya" },
  ]);

  assert.deepEqual(countries.map((country) => country.code), ["KE"]);
});
