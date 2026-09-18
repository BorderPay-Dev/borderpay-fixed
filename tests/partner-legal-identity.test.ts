import { checkPartnerLegalIdentity as check } from "../supabase/functions/_shared/partner-legal-identity.ts";

const business = { company_name: "Example Limited", registration_number: "RC-1234", country: "NG" };
const entity = { legal_name: "Example Limited", registration_number: "RC-1234", country_of_incorporation: "NG" };
function assert(value: unknown) { if (!value) throw new Error("Assertion failed"); }

Deno.test("empty partner application reports the three missing fields", () => {
  const result = check({}, business);
  assert(!result.ok && result.code === "partner_identity_incomplete" && result.fields?.length === 3);
  assert(Object.values(result.checks).every((value) => value === false));
});
Deno.test("two empty records cannot satisfy legal identity", () => {
  assert(!check({}, {}).ok);
  assert(!check({ ...entity, registration_number: "---" }, { ...business, registration_number: "" }).ok);
});
Deno.test("formatting and valid ISO country aliases match without truncation", () => {
  assert(check({ ...entity, legal_name: " EXAMPLE LIMITED ", registration_number: "RC 1234", country_of_incorporation: "NGA" }, business).ok);
  assert(!check({ ...entity, country_of_incorporation: "NGA" }, { ...business, country: "NA" }).ok);
  assert(!check({ ...entity, country_of_incorporation: "NG-invalid" }, business).ok);
});
Deno.test("different name or registration identifies the actual mismatch", () => {
  const result = check({ ...entity, registration_number: "RC-5678" }, business);
  assert(!result.ok && result.code === "partner_identity_mismatch" && result.fields?.join() === "registration_number");
  assert(!check({ ...entity, legal_name: "Example Holdings Limited" }, business).ok);
});
Deno.test("incomplete source record cannot approve a partner", () => {
  const result = check(entity, { ...business, registration_number: null });
  assert(!result.ok && result.code === "bridge_business_identity_incomplete");
});
Deno.test("non-Latin names remain distinguishable", () => {
  assert(check({ ...entity, legal_name: "公司甲" }, { ...business, company_name: "公司甲" }).ok);
  assert(!check({ ...entity, legal_name: "公司甲" }, { ...business, company_name: "公司乙" }).ok);
});

Deno.test("Nigerian RC prefix is optional for the same registration digits", () => {
  for (const entered of ["1234", "RC1234", "RC-1234", "rc 1234"]) {
    assert(check({ ...entity, registration_number: entered, country_of_incorporation: "NGA" },
      { ...business, registration_number: "RC-1234" }).ok);
  }
  assert(check({ ...entity, registration_number: "RC-1234" },
    { ...business, registration_number: "1234" }).ok);
});
Deno.test("prefix normalization preserves different digits, registry types and leading zeroes", () => {
  for (const entered of ["1235", "BN1234", "IT1234", "01234"]) {
    const result = check({ ...entity, registration_number: entered },
      { ...business, registration_number: "RC-1234" });
    assert(!result.ok && result.code === "partner_identity_mismatch" && result.fields?.includes("registration_number"));
  }
});
Deno.test("RC prefix normalization never applies outside Nigeria or bypasses other identity checks", () => {
  for (const jurisdiction of ["GB", "FR", "KE"]) {
    assert(!check({ ...entity, registration_number: "1234", country_of_incorporation: jurisdiction },
      { ...business, country: jurisdiction }).ok);
  }
  assert(!check({ ...entity, legal_name: "Different Limited", registration_number: "1234" }, business).ok);
  assert(!check({ ...entity, country_of_incorporation: "GB", registration_number: "1234" }, business).ok);
});
