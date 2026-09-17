import { assertPartnerInviteRedirect } from "./partner-invite-link.ts";

const isExistingUserError = (error: unknown) => {
  const message = String((error as { message?: unknown })?.message || error || "").toLowerCase();
  return message.includes("already been registered") || message.includes("already registered") || message.includes("already exists");
};

export async function createPartnerAccessLink(db: any, email: string, supabaseUrl: string) {
  const passwordSetupRedirect = "https://portal.borderpayafrica.com/auth/callback?setup=password";
  const existingAccountRedirect = "https://portal.borderpayafrica.com/auth/callback";
  const invited = await db.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: passwordSetupRedirect },
  });
  if (!invited.error && invited.data?.properties?.action_link) {
    return { actionLink: assertPartnerInviteRedirect(invited.data.properties.action_link, passwordSetupRedirect, supabaseUrl), userId: invited.data.user?.id || null, existingAccount: false };
  }
  if (!isExistingUserError(invited.error)) throw invited.error || new Error("Invite link generation failed");

  const existing = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: existingAccountRedirect },
  });
  if (existing.error || !existing.data?.properties?.action_link) throw existing.error || new Error("Existing-user access link generation failed");
  return { actionLink: assertPartnerInviteRedirect(existing.data.properties.action_link, existingAccountRedirect, supabaseUrl), userId: existing.data.user?.id || null, existingAccount: true };
}

