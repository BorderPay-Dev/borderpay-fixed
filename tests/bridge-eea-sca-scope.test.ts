import {
  bridgeCustomerScaCountry,
  isBridgeEeaScaCountry,
  normalizeBridgeScaCountry,
} from "../supabase/functions/_shared/bridge-sca-scope.ts";

Deno.test("business SCA uses incorporation country and ignores operation country", () => {
  const customer = {
    raw: {
      data: {
        business: {
          country_of_incorporation: "ITA",
          operating_address: { country: "GBR" },
        },
      },
    },
  };
  const country = bridgeCustomerScaCountry(customer, "business");
  if (country !== "IT" || !isBridgeEeaScaCountry(country)) {
    throw new Error(`expected IT EEA scope, received ${country}`);
  }
});

Deno.test("UK incorporation stays outside EEA even with EEA operation address", () => {
  const customer = {
    raw: {
      business: {
        registered_address: { country: "GBR" },
        operating_address: { country: "FRA" },
      },
    },
  };
  const country = bridgeCustomerScaCountry(customer, "business");
  if (country !== "GB" || isBridgeEeaScaCountry(country)) {
    throw new Error(`expected GB non-EEA scope, received ${country}`);
  }
});

Deno.test("unknown business legal country is never inferred from operation address", () => {
  const customer = { raw: { business: { operating_address: { country: "FRA" } } } };
  if (bridgeCustomerScaCountry(customer, "business") !== null) {
    throw new Error("operating address must not determine business SCA scope");
  }
});

Deno.test("GBR and UKR are distinct normalized countries", () => {
  if (normalizeBridgeScaCountry("GBR") !== "GB") throw new Error("GBR must normalize to GB");
  if (normalizeBridgeScaCountry("UKR") !== "UA") throw new Error("UKR must normalize to UA");
});
