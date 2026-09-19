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
