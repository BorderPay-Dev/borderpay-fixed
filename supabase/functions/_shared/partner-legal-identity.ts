import { ISO2_COUNTRIES, ISO3_TO_ISO2 } from "./iso-country-codes.ts";

// Preserve letters in all scripts; never turn two different non-Latin names
// into the same empty string. Ignore only formatting, not legal suffixes.
const comparable = (value: unknown): string => typeof value === "string"
  ? value.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  : "";
const country = (value: unknown): string => {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return ISO2_COUNTRIES.has(code) ? code : ISO3_TO_ISO2[code] || "";
};
// Nigerian company numbers may be entered with or without the CAC "RC"
// prefix (e.g. RC-8048569 and 8048569). Keep all digits, including leading
// zeroes, and do not strip other registry prefixes or prefixes abroad.
const registrationNumber = (value: unknown, incorporationCountry: unknown): string => {
  const normalized = comparable(value);
  return country(incorporationCountry) === "NG" && /^rc[0-9]+$/.test(normalized)
    ? normalized.slice(2)
    : normalized;
};
const labels = {
  legal_name: "legal name",
  registration_number: "registration number",
  country: "country of incorporation",
};
type Field = keyof typeof labels;

export function checkPartnerLegalIdentity(
  entity: Record<string, unknown>, business: Record<string, unknown>,
) {
  const partner = {
    legal_name: comparable(entity.legal_name),
    registration_number: registrationNumber(entity.registration_number, entity.country_of_incorporation),
    country: country(entity.country_of_incorporation),
  };
  const verified = {
    legal_name: comparable(business.company_name),
    registration_number: registrationNumber(business.registration_number, business.country),
    country: country(business.country),
  };
  const fields = Object.keys(labels) as Field[];
  const checks = Object.fromEntries(fields.map((field) => [field,
    Boolean(partner[field] && verified[field] && partner[field] === verified[field]),
  ])) as Record<Field, boolean>;
  const missingPartner = fields.filter((field) => !partner[field]);
  const missingVerified = fields.filter((field) => !verified[field]);
  const mismatched = fields.filter((field) => partner[field] && verified[field] && !checks[field]);
  const list = (items: Field[]) => items.map((field) => labels[field]).join(", ");
  if (missingPartner.length) return {
    ok: false, checks, code: "partner_identity_incomplete", fields: missingPartner,
    error: `Complete and save the partner application's ${list(missingPartner)} in the partner portal, then retry Verify Bridge KYB.`,
  };
  if (missingVerified.length) return {
    ok: false, checks, code: "bridge_business_identity_incomplete", fields: missingVerified,
    error: `The linked BorderPay business record is missing a valid ${list(missingVerified)}. Review it against Bridge before linking Partner KYB.`,
  };
  if (mismatched.length) return {
    ok: false, checks, code: "partner_identity_mismatch", fields: mismatched,
    error: `Partner ${list(mismatched)} does not match the linked Bridge business record. Check the selected Bridge customer and the saved legal details.`,
  };
  return { ok: true, checks };
}
