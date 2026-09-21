import { renderTemplate } from "../supabase/functions/_shared/email-templates/index.ts";
Deno.test("transition notice renders for business accounts without changing payment instructions", () => {
  for (const template of ["business.banking_transition"] as const) {
    const email = renderTemplate(template, { full_name: "<script>alert(1)</script> User", action_url: "https://attacker.invalid" });
    if (email.html.includes("<script>") || email.html.includes("attacker.invalid")) throw new Error("unsafe interpolation");
    for (const body of [email.html, email.text]) {
      for (const required of ["details marked deactivated", "does not automatically transfer existing balances", "verification and approval requirements", "https://app.borderpayafrica.com"]) {
        if (!body.includes(required)) throw new Error("missing transition instruction: " + required);
      }
    }
  }
});

Deno.test("individual transition template is unavailable", () => {
  let rejected = false;
  try {
    renderTemplate("individual.banking_transition" as Parameters<typeof renderTemplate>[0], {});
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Business transition must not be available to individuals");
});
