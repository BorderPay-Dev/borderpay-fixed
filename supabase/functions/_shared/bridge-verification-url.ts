const PERSONA_HOST = "bridge.withpersona.com";

export function verificationRedirectUrl(
  appUrl: string,
  candidate?: string,
): string {
  const app = new URL(appUrl);
  const fallback = `${app.origin}/?screen=kyc`;
  if (!candidate) return fallback;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "https:" && parsed.origin === app.origin) {
      parsed.pathname = "/";
      parsed.search = "";
      parsed.searchParams.set("screen", "kyc");
      parsed.hash = "";
      return parsed.toString();
    }
  } catch {
    // Native origins such as capacitor://localhost are intentionally rejected.
  }
  return fallback;
}

export function verifiedHostedLink(appUrl: string, targetUrl: string): string {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    throw new Error("Invalid hosted verification URL");
  }

  const host = target.hostname.toLowerCase();
  if (
    target.protocol !== "https:" ||
    (host !== PERSONA_HOST && !host.endsWith(`.${PERSONA_HOST}`))
  ) {
    throw new Error("Untrusted hosted verification URL");
  }

  // Bridge can return an existing Persona link carrying the callback used
  // when it was first created. Normalize the URL delivered to every client.
  target.searchParams.delete("redirect_uri");
  target.searchParams.set("redirect-uri", verificationRedirectUrl(appUrl));
  return target.toString();
}
