const FREE_OR_PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "inbox.com",
  "inbox.eu",
  "fastmail.com",
  "hey.com",
  "tuta.com",
  "tutanota.com",
  "tutanota.de",
  "yandex.com",
  "yandex.ru",
]);

const PERSONAL_DOMAIN_PREFIXES = ["yahoo.", "hotmail.", "live.", "gmx."];
const DISPOSABLE_DOMAIN_MARKERS = [
  "10minutemail",
  "dispostable",
  "fakeinbox",
  "getnada",
  "guerrillamail",
  "maildrop",
  "mailinator",
  "sharklasers",
  "tempmail",
  "throwawaymail",
  "yopmail",
];

export type BusinessEmailDecision = {
  allowed: boolean;
  domain: string | null;
  code: "allowed" | "blocked_identity" | "invalid_email" | "personal_email" | "disposable_email" | "reserved_domain";
};

export function evaluateBusinessEmail(value: unknown, countryCode?: unknown): BusinessEmailDecision {
  const email = String(value || "").trim().toLowerCase();
  const country = String(countryCode || "").trim().toUpperCase();
  if (email === "tst@hacker.com" || /^loadtest_[^@]+@/i.test(email)) {
    return { allowed: false, domain: email.split("@")[1] || null, code: "blocked_identity" };
  }
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { allowed: false, domain: null, code: "invalid_email" };
  }

  const domain = parts[1].replace(/\.$/, "");
  if (
    domain.length > 253 ||
    !domain.includes(".") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
    domain.includes("..")
  ) {
    return { allowed: false, domain, code: "invalid_email" };
  }

  if (
    domain === "example.com" ||
    domain === "example.org" ||
    domain === "example.net" ||
    domain.endsWith(".example") ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".local") ||
    domain.endsWith(".test")
  ) {
    return { allowed: false, domain, code: "reserved_domain" };
  }

  if (DISPOSABLE_DOMAIN_MARKERS.some((marker) => domain === marker || domain.includes(marker))) {
    return { allowed: false, domain, code: "disposable_email" };
  }

  const ukInboxEuException = domain === "inbox.eu" && (country === "GB" || country === "UK");
  if ((!ukInboxEuException && FREE_OR_PERSONAL_DOMAINS.has(domain)) || PERSONAL_DOMAIN_PREFIXES.some((prefix) => domain.startsWith(prefix))) {
    return { allowed: false, domain, code: "personal_email" };
  }

  return { allowed: true, domain, code: "allowed" };
}
