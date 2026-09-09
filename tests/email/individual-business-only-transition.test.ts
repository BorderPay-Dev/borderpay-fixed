import { render } from "../../supabase/functions/_shared/email-templates/individual/business-only-transition.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const email = render({ full_name: "Amina Doe", effective_date: "August 24, 2026" });
const combined = `${email.subject}\n${email.html}\n${email.text}`;

assert(combined.includes("August 24, 2026"), "effective date must be explicit");
assert(combined.includes("existing Individual account"), "existing Individual access must be preserved");
assert(combined.includes("available only to businesses"), "new direct signup policy must be clear");
assert(combined.includes("authorized BorderPay partners"), "partner Individual onboarding must remain clear");
assert(!/deleted? after (two|2) months?/i.test(combined), "unimplemented 60-day deletion must not be claimed");
assert(!/will be (deleted|closed) if .*inactive/i.test(combined), "automatic inactivity closure must not be claimed");

const escaped = render({ effective_date: '<script>alert("x")</script>' });
assert(!escaped.html.includes("<script>"), "effective date must be HTML-escaped");

console.log("individual business-only transition template: PASS");
