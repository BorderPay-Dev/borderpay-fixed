import { evaluateBusinessEmail } from "../../supabase/functions/_shared/business-email-policy.ts";

const blocked = [
  "aagraflvstore@mail.ee",
  "owner@gmail.com",
  "owner@inbox.lv",
  "owner@mail.ru",
  "owner@web.de",
  "owner@libero.it",
];

for (const email of blocked) {
  const result = evaluateBusinessEmail(email, "EE");
  if (result.allowed || result.code !== "personal_email") {
    throw new Error(`Expected public mailbox to be blocked: ${email}`);
  }
}

for (const country of ["GB", "EE", "US", "ZA"]) {
  const result = evaluateBusinessEmail("company@inbox.eu", country);
  if (!result.allowed) throw new Error(`inbox.eu exception failed for ${country}`);
}

const company = evaluateBusinessEmail("finance@registered-company.example.co", "GB");
if (!company.allowed) throw new Error("Custom company domain was blocked");

console.log("business email policy audit: PASS");
