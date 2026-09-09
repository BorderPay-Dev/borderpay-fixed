import { render as renderBusinessAnnouncement } from "../supabase/functions/_shared/email-templates/business/subscription-maintenance-announcement.ts";
import { render as renderIndividualAnnouncement } from "../supabase/functions/_shared/email-templates/individual/subscription-maintenance-announcement.ts";
import { render as renderVerified } from "../supabase/functions/_shared/email-templates/subscription/account-verified.ts";
import { render as renderBusinessKyb } from "../supabase/functions/_shared/email-templates/business/kyb-decision.ts";
import { render as renderIndividualKyc } from "../supabase/functions/_shared/email-templates/individual/kyc-decision.ts";
import { BORDERPAY_BRAND } from "../supabase/functions/_shared/email-templates/layout.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertStringIncludes(value: string, expected: string): void {
  assert(value.includes(expected), `expected string to include ${JSON.stringify(expected)}`);
}

function assertEquals(actual: unknown, expected: unknown): void {
  assert(Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("Business fee announcement is future-dated and account-specific", () => {
  const email = renderBusinessAnnouncement({ customer_name: "Acme Ltd", billing_start_date: "2026-09-30" });
  assertStringIncludes(email.html, "$29.99");
  assertStringIncludes(email.html, "August 2026 maintenance charge remains");
  assertStringIncludes(email.html, "$15.00");
  assertStringIncludes(email.html, "September 1, 2026");
  assert(!email.html.includes("Individual"));
  assert(!email.html.includes("$5"));
});

Deno.test("Individual communication remains five dollars and excludes Business price", () => {
  const email = renderIndividualAnnouncement({ customer_name: "Alex", billing_start_date: "2026-09-30" });
  assertStringIncludes(email.html, "$5 per month");
  assert(!email.html.includes("$29.99"));
});

Deno.test("verified-account email renders decimal Business fee and exact Individual fee", () => {
  const business = renderVerified({ customer_name: "Acme", account_type: "business", monthly_fee: 29.99, billing_start_date: "2026-09-30" });
  const individual = renderVerified({ customer_name: "Alex", account_type: "individual", monthly_fee: 5, billing_start_date: "2026-09-30" });
  assertStringIncludes(business.html, "$29.99/month");
  assertStringIncludes(individual.html, "$5/month");
  assertEquals(business.html.includes("$5/month"), false);
});

Deno.test("approved verification emails include both stores and use device-aware CTA", () => {
  const business = renderBusinessKyb({ company_name: "Acme", decision: "approved" });
  const individual = renderIndividualKyc({ full_name: "Alex", decision: "approved" });
  for (const email of [business, individual]) {
    assertStringIncludes(email.html, BORDERPAY_BRAND.appStoreUrl);
    assertStringIncludes(email.html, BORDERPAY_BRAND.playStoreUrl);
    assertStringIncludes(email.html, BORDERPAY_BRAND.smartAppUrl);
  }
});
