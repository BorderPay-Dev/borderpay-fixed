/** Reissue only an unaccepted invitation; claim the timestamp to suppress concurrent sends. */
export async function resendPartnerInvitation(
  db: any,
  requestId: number,
  deliver: (email: string, requestId: number) => Promise<unknown>,
  now = new Date(),
) {
  const fail = (status: number, error: string) => ({ status, body: { success: false, error } });
  if (!Number.isSafeInteger(requestId) || requestId <= 0) return fail(400, "request_id required");
  const { data: invite, error } = await db.from("partner_access_invite_requests")
    .select("id,email,status,invited_at,accepted_at").eq("id", requestId).maybeSingle();
  if (error) throw error;
  if (!invite) return fail(404, "Invite request not found");
  if (invite.status !== "invited" || invite.accepted_at) return fail(409, "Only an unaccepted invitation can be resent");
  if (invite.invited_at && now.getTime() - Date.parse(invite.invited_at) < 60_000) {
    return fail(429, "Please wait one minute before resending this invitation");
  }
  const emailPattern = invite.email.replace(/[\\%_]/g, "\\$&");
  const { data: organization, error: orgError } = await db.from("partner_organizations")
    .select("id").ilike("primary_email", emailPattern).limit(1).maybeSingle();
  if (orgError) throw orgError;
  if (organization) return fail(409, "This partner already has a workspace; use portal sign-in");
  const claimedAt = now.toISOString();
  let claim = db.from("partner_access_invite_requests").update({ invited_at: claimedAt })
    .eq("id", requestId).eq("status", "invited").is("accepted_at", null);
  claim = invite.invited_at ? claim.eq("invited_at", invite.invited_at) : claim.is("invited_at", null);
  const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return fail(409, "This invitation changed or is already being resent; refresh the list");
  try {
    await deliver(invite.email, requestId);
  } catch (error) {
    const { error: rollbackError } = await db.from("partner_access_invite_requests")
      .update({ invited_at: invite.invited_at }).eq("id", requestId)
      .eq("status", "invited").eq("invited_at", claimedAt).is("accepted_at", null);
    if (rollbackError) console.error("partner_invite_resend_timestamp_restore_failed", { request_id: requestId });
    console.error("partner_invite_resend_failed", { request_id: requestId });
    return fail(502, "Invitation delivery could not be confirmed. Refresh before retrying");
  }
  return { status: 200, body: { success: true, status: "invited", invited_at: claimedAt } };
}
