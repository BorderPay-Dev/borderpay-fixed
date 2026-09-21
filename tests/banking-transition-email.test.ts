import { renderTemplate } from "../supabase/functions/_shared/email-templates/index.ts";
Deno.test("October notices render safely with distinct active and restricted messaging", () => {
  for (const template of ["business.banking_transition_active", "business.banking_transition_restricted"] as const) {
    const email = renderTemplate(template, { full_name: "<script>alert(1)</script> User", transition_status: "frozen", action_url: "https://attacker.invalid" });
    if (email.html.includes("<script>") || email.html.includes("attacker.invalid")) throw new Error("unsafe interpolation");
    for (const body of [email.html, email.text]) {
      if (!body.includes("October 2026") || body.includes("this month")) throw new Error("wrong rollout date");
      if (!body.includes("https://app.borderpayafrica.com")) throw new Error("missing CTA");
    }
  }
  const active = renderTemplate("business.banking_transition_active", {});
  if (!active.text.includes("business’s legal name") || !active.text.includes("do not currently have USD access")) throw new Error("missing expanded USD access");
  if (active.text.includes("currently marked frozen")) throw new Error("active received restricted copy");
});
Deno.test("restricted notice gives each status its own paragraph", () => {
  const cases = { frozen: "currently marked frozen", rejected: "previous business application was not approved", paused: "currently paused", suspended: "currently suspended", offboarded: "closed or offboarded" };
  for (const [status, expected] of Object.entries(cases)) {
    const result = renderTemplate("business.banking_transition_restricted", { transition_status: status });
    if (!result.text.includes(expected)) throw new Error("wrong status copy: " + status);
    if (!result.text.includes("does not automatically lift current restrictions")) throw new Error("missing continuity instruction");
  }
});
Deno.test("legacy, individual and missing-status notices cannot render", () => {
  for (const [template, props] of [
    ["business.banking_transition", {}],
    ["individual.banking_transition_active", {}],
    ["individual.banking_transition_restricted", {}],
    ["business.banking_transition_restricted", {}],
    ["business.banking_transition_restricted", { transition_status: "active" }],
  ] as const) {
    let rejected = false;
    try { renderTemplate(template as Parameters<typeof renderTemplate>[0], props); } catch { rejected = true; }
    if (!rejected) throw new Error("unsafe notice rendered: " + template);
  }
});
