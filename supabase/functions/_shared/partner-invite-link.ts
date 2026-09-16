/** Supabase may fall back to its consumer Site URL when a redirect is not allowed. */
export function assertPartnerInviteRedirect(
  actionLink: string,
  expectedRedirect: string,
  supabaseUrl: string,
): string {
  const error = () =>
    new Error(
      "Partner invitation redirect is misconfigured. Configure the portal callback URLs in Supabase Auth before sending invitations.",
    );
  try {
    const link = new URL(actionLink);
    const target = new URL(expectedRedirect);
    if (
      target.origin !== "https://portal.borderpayafrica.com" ||
      target.pathname !== "/auth/callback" ||
      link.protocol !== "https:" ||
      link.origin !== new URL(supabaseUrl).origin ||
      link.pathname !== "/auth/v1/verify" || link.username || link.password ||
      link.searchParams.getAll("redirect_to").length !== 1 ||
      link.searchParams.get("redirect_to") !== expectedRedirect
    ) throw error();
    return actionLink;
  } catch {
    throw error();
  } // Never expose action-link tokens in logs/errors.
}
