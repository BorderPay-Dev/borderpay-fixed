import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { render as renderBusiness } from "../../supabase/functions/_shared/email-templates/business/african-rails-live.ts";
import { render as renderIndividual } from "../../supabase/functions/_shared/email-templates/individual/african-rails-live.ts";

Deno.test("African rails business announcement is accurate and operator-ready", () => {
  const email = renderBusiness({ company_name: "Example Ltd" });
  assertEquals(email.subject, "African payment rails are now live on BorderPay");
  assertStringIncludes(email.text, "Example Ltd");
  assertStringIncludes(email.text, "current provider availability");
  assertStringIncludes(email.text, "https://www.borderpayafrica.com/api/open-borderpay");
});

Deno.test("African rails individual announcement is accurate and operator-ready", () => {
  const email = renderIndividual({ full_name: "Valentine Adhiambo" });
  assertEquals(email.subject, "African payment rails are now live on BorderPay");
  assertStringIncludes(email.text, "Hello Valentine");
  assertStringIncludes(email.text, "verified country");
  assertStringIncludes(email.text, "Rail availability can change");
});
