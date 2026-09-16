import { assertPartnerInviteRedirect } from "../supabase/functions/_shared/partner-invite-link.ts";
const auth = "https://orwrcpwsffjlvzuraxjc.supabase.co";
const portal = "https://portal.borderpayafrica.com/auth/callback";
function link(target: string) {
  const u = new URL(auth + "/auth/v1/verify");
  u.searchParams.set("token", "test-token-not-real");
  u.searchParams.set("type", "invite");
  u.searchParams.set("redirect_to", target);
  return u.toString();
}
Deno.test("new and existing partner invitations preserve exact portal callback and password setup", () => {
  for (const target of [portal, portal + "?setup=password"]) {
    const value = link(target);
    if (assertPartnerInviteRedirect(value, target, auth) !== value) {
      throw new Error("Link changed");
    }
  }
});
Deno.test("consumer fallback, missing redirects, unexpected origins and lost setup query fail before delivery", () => {
  const expected = portal + "?setup=password";
  for (
    const value of [
      link("https://app.borderpayafrica.com/"),
      link(portal),
      auth + "/auth/v1/verify?token=test-token-not-real",
      link(expected).replace(auth, "https://untrusted.example"),
      link(expected) + "&redirect_to=" + encodeURIComponent(portal),
    ]
  ) {
    let error: Error | undefined;
    try {
      assertPartnerInviteRedirect(value, expected, auth);
    } catch (e) {
      error = e as Error;
    }
    if (!error || error.message.includes("test-token-not-real")) {
      throw new Error("Must reject without exposing credentials");
    }
  }
});
