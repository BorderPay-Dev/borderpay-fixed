import { isAfricanRailsTesterEmail } from "../supabase/functions/_shared/african-rails-access.ts";

Deno.test("African Rails access is limited to the three approved tester emails", () => {
  const allowed = [
    "adhiamboadhiambo22@gmail.com",
    "appreview.individual@borderpayafrica.com",
    "appreview.business@borderpayafrica.com",
  ];
  for (const email of allowed) {
    if (!isAfricanRailsTesterEmail(email)) throw new Error(`approved tester blocked: ${email}`);
  }
  for (const email of ["live.user@example.com", "customer@borderpayafrica.com", "", null]) {
    if (isAfricanRailsTesterEmail(email)) throw new Error(`live user incorrectly granted: ${email}`);
  }
});
