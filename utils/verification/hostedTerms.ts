/** Interpret only a successful provider-backed response, never browser return alone. */
export function hostedTermsAcceptance(result: {
  success?: boolean;
  data?: { tos_accepted?: boolean; already_approved?: boolean; tos_link_url?: string | null; link_url?: string | null };
} | null | undefined): boolean | null {
  if (!result?.success || !result.data) return null;
  if (result.data.tos_link_url) return false;
  if (result.data.tos_accepted === true || result.data.already_approved === true) return true;
  // The individual endpoint returns the identity link only after accepted ToS.
  if (result.data.link_url) return true;
  return null;
}
