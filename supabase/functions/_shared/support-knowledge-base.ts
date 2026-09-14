export const SUPPORT_KNOWLEDGE_VERSION = "2026-09-14.1";

export type SupportKnowledgeEntry = {
  id: string;
  title: string;
  category: "accounts" | "payments" | "fees" | "security" | "compliance" | "support";
  keywords: string[];
  answer: string;
  sourceUrl: string;
};

const WEBSITE = "https://www.borderpayafrica.com";

const BUSINESS_IDENTIFICATION_BY_COUNTRY: Record<string, string> = {
  "afghanistan": "TIN (Tax Identification Number)",
  "albania": "NIPT",
  "algeria": "NIF",
  "andorra": "NRT",
  "angola": "NIF",
  "argentina": "CUIT",
  "armenia": "TIN",
  "aruba": "Census Number (CN)",
  "australia": "ABN, ACN or ARBN",
  "austria": "Firmenbuchnummer (FN) or UID",
  "azerbaijan": "VOEN",
  "bahamas": "TIN",
  "bahrain": "Commercial Registration Number (CRN)",
  "bangladesh": "BIN or VAT number",
  "barbados": "TIN",
  "belgium": "BCE or KBO number",
  "belize": "TIN",
  "bermuda": "Commercial Registration Number (CRN)",
  "bolivia": "NIT or VAT number",
  "bosnia and herzegovina": "ID Broj",
  "botswana": "Commercial Registration Number (CRN)",
  "brazil": "CNPJ or VAT number",
  "bulgaria": "Unified Identification Code (UIC)",
  "cambodia": "TIN or VAT number",
  "cameroon": "NIF or RCCM number",
  "canada": "Business Identification Number (BIN) or VAT number",
  "cayman islands": "Commercial Registration Number (CRN)",
  "chile": "RUT",
  "china": "Unified Social Credit Code (USC)",
  "christmas island": "Australian Business Number (ABN)",
  "colombia": "NIT or RUT",
  "comoros": "NIF",
  "costa rica": "Cédula Jurídica",
  "croatia": "OIB",
  "curacao": "CRIB number",
  "cyprus": "Commercial Registration Number (CRN)",
  "czechia": "IČO",
  "denmark": "CVR number",
  "dominica": "TIN",
  "dominican republic": "RNC",
  "ecuador": "RUC",
  "egypt": "TIN or VAT number",
  "estonia": "Register Code",
  "ethiopia": "TIN",
  "fiji": "TIN",
  "finland": "Business ID (Y-tunnus)",
  "france": "SIREN or SIRET",
  "georgia": "Identification Code",
  "germany": "USt-IdNr or Commercial Registration Number",
  "ghana": "TIN",
  "gibraltar": "Commercial Registration Number (CRN)",
  "greece": "AOM",
  "guatemala": "NIT or VAT number",
  "haiti": "NIF",
  "honduras": "RTN",
  "hong kong": "Business Registration Number (BRN)",
  "hungary": "TIN",
  "iceland": "Identification Number",
  "india": "GSTIN, CIN, PAN or VAT number",
  "indonesia": "NPWP or VAT number",
  "iraq": "TIN",
  "ireland": "CRO number",
  "isle of man": "Commercial Registration Number (CRN)",
  "israel": "Commercial Registration Number (CRN)",
  "italy": "Partita IVA or Codice Fiscale",
  "ivory coast": "NIF",
  "jamaica": "TRN",
  "japan": "Hojin Number",
  "jordan": "TIN",
  "kazakhstan": "BIN",
  "kenya": "PIN or VAT number",
  "kuwait": "Commercial Registration Number (CRN)",
  "kyrgyzstan": "INN",
  "latvia": "Registration Number",
  "laos": "TIN",
  "lebanon": "Commercial Registration Number (CRN)",
  "liberia": "TIN",
  "lithuania": "Company Code",
  "luxembourg": "Matricule",
  "madagascar": "NIF",
  "malawi": "TPIN",
  "malaysia": "SSM or GSTIN",
  "malta": "Commercial Registration Number or VAT number",
  "marshall islands": "Entity Number",
  "mauritania": "NIF",
  "mauritius": "Business Registration Number (BRN)",
  "mexico": "RFC or VAT number",
  "moldova": "IDNO",
  "monaco": "Commercial Registration Number (CRN)",
  "montenegro": "Commercial Registration Number (CRN)",
  "morocco": "Identifiant Fiscal (IF)",
  "mozambique": "PIB",
  "namibia": "VAT number",
  "nepal": "PAN",
  "netherlands": "KVK or VAT number",
  "new zealand": "GST number",
  "nicaragua": "RUC",
  "nigeria": "CAC registration number, TIN or VAT number",
  "north macedonia": "TIN",
  "norway": "Organisation Number (OrgNr)",
  "oman": "Commercial Registration Number (CRN)",
  "pakistan": "NTN",
  "panama": "RUC",
  "peru": "RUC",
  "philippines": "TIN",
  "poland": "NIP or KRS",
  "portugal": "NIF or NIPC",
  "qatar": "Commercial Registration Number (CRN)",
  "romania": "CUI",
  "russia": "INN or OGRN",
  "saint kitts and nevis": "TIN",
  "saint lucia": "TIN",
  "saudi arabia": "Commercial Registration Number (CRN)",
  "senegal": "NINEA",
  "singapore": "UEN",
  "slovakia": "IČO",
  "slovenia": "Matična številka (MS)",
  "south africa": "TIN or VAT number",
  "south korea": "Business Registration Number (BRN)",
  "spain": "NIF or CIF",
  "sri lanka": "Business Registration Number (BRN)",
  "sweden": "Organisationsnummer",
  "switzerland": "UID",
  "thailand": "TIN",
  "tunisia": "Matricule Fiscale",
  "turkey": "VKN",
  "uganda": "TIN",
  "ukraine": "EDRPOU",
  "united arab emirates": "TRN or VAT number",
  "united kingdom": "Company Registration Number (CRN) or VAT number",
  "united states": "EIN",
  "uruguay": "RUT",
  "uzbekistan": "INN",
  "venezuela": "RIF",
  "vietnam": "Tax Code (MST)",
  "yemen": "TIN",
  "zambia": "TPIN",
  "zimbabwe": "Business Partner Number",
};

const COUNTRY_ALIASES: Record<string, string> = {
  "cote d ivoire": "ivory coast",
  "côte d ivoire": "ivory coast",
  "lao peoples democratic republic": "laos",
  "uae": "united arab emirates",
  "uk": "united kingdom",
  "great britain": "united kingdom",
  "usa": "united states",
  "us": "united states",
  "korea": "south korea",
};

export const SUPPORT_KNOWLEDGE: SupportKnowledgeEntry[] = [
  {
    id: "business-accounts-only",
    title: "Who can open a BorderPay account?",
    category: "accounts",
    keywords: ["open account", "signup", "sign up", "individual", "personal", "business account", "company email", "inbox.eu"],
    answer: "BorderPay currently accepts business accounts. Apply with the legal business name, country of incorporation, and a business email. Company-domain email addresses are accepted; inbox.eu is also allowed. Personal consumer accounts are not currently open for new registration.",
    sourceUrl: `${WEBSITE}/faq`,
  },
  {
    id: "accounts-and-wallets",
    title: "Available business accounts and digital currencies",
    category: "accounts",
    keywords: ["usd account", "eur account", "gbp account", "iban", "sepa", "wallet", "usdc", "usdt", "eurc", "base", "tron"],
    answer: "Eligible verified businesses may receive USD, EUR and GBP account details. Digital-currency availability is shown in the app and can include USDC on Base, EURC on Base for eligible EEA businesses, and USDT on Tron where available. Products depend on the country of incorporation, compliance status and payment-rail availability.",
    sourceUrl: `${WEBSITE}/faq`,
  },
  {
    id: "receiving-money",
    title: "How to receive money",
    category: "payments",
    keywords: ["receive money", "incoming payment", "bank details", "account details", "deposit", "receive eur", "receive usd", "receive gbp"],
    answer: "Open Receive and select an available business account or wallet. Share only the account details or wallet address displayed there. Bank and wallet availability depends on verification, jurisdiction and enabled payment rails.",
    sourceUrl: `${WEBSITE}/faq`,
  },
  {
    id: "sending-money",
    title: "How to send or withdraw",
    category: "payments",
    keywords: ["send money", "withdraw", "payout", "external bank", "external wallet", "beneficiary"],
    answer: "Open Send, choose the available wallet or payout method, select or add the destination, review the amount and fee, and complete the required security confirmation. Only supported networks, currencies and verified destinations are shown.",
    sourceUrl: `${WEBSITE}/faq`,
  },
  {
    id: "transfer-timing",
    title: "Transfer timing and status",
    category: "payments",
    keywords: ["how long", "arrival time", "pending", "processing", "submitted", "completed", "transaction status"],
    answer: "Timing depends on the payment rail, destination and compliance review. The authoritative status appears in Transactions. A pending or in-review payment must not be represented as completed. Account-specific delays are handled by a human support specialist.",
    sourceUrl: `${WEBSITE}/faq`,
  },
  {
    id: "stablecoin-fees",
    title: "Supported same-token wallet transfers",
    category: "fees",
    keywords: ["stablecoin fee", "crypto fee", "usdc fee", "usdt fee", "eurc fee", "same network", "wallet transfer fee"],
    answer: "Supported same-token, same-network digital-currency receives and payouts have no BorderPay transaction fee. The app shows any applicable blockchain, banking, conversion or third-party charge before confirmation. Always confirm the currency and network before sending.",
    sourceUrl: `${WEBSITE}/faq`,
  },
  {
    id: "fee-disclosure",
    title: "Transaction fees",
    category: "fees",
    keywords: ["fee", "fees", "charge", "pricing", "cost", "rate"],
    answer: "Applicable transaction, conversion, network and payment-rail fees are shown before confirmation. Do not rely on an estimated fee outside the confirmation screen because pricing can depend on the product, currency, corridor and account agreement.",
    sourceUrl: `${WEBSITE}/pricing`,
  },
  {
    id: "business-maintenance",
    title: "Business account maintenance fee",
    category: "fees",
    keywords: ["maintenance", "monthly fee", "subscription", "invoice", "29.99", "billing"],
    answer: "The verified Business account maintenance fee is USD 29.99 per month from September 2026. Billing begins after KYB approval and includes the approval month. The invoice and payment status are available in BorderPay.",
    sourceUrl: `${WEBSITE}/pricing`,
  },
  {
    id: "business-verification",
    title: "Business verification process",
    category: "compliance",
    keywords: ["kyb", "business verification", "verify company", "verification time", "under review", "awaiting ubo"],
    answer: "Business verification checks the legal entity, registered address, business purpose, ownership and control persons. Reviews may require additional documents. BorderPay cannot promise approval or an exact completion time, and an account-specific verification decision must be reviewed by support.",
    sourceUrl: `${WEBSITE}/faq`,
  },
  {
    id: "formation-documents",
    title: "Accepted business formation documents",
    category: "compliance",
    keywords: ["formation document", "certificate of incorporation", "articles of incorporation", "articles of organization", "business license", "partnership agreement", "trust deed", "bylaws"],
    answer: "Provide an official formation document appropriate to the entity type: sole proprietorship—business licence, trade-name or DBA registration; partnership—partnership agreement or official partnership certificate; corporation—articles or certificate of incorporation; LLC—articles of organization or certificate of incorporation; nonprofit or foundation—formation certificate/articles plus applicable governance or tax-exempt evidence; trust—trust deed, certificate of trust or notarized trustee affidavit; cooperative—articles, bylaws or membership agreement. Documents must be current, legible and identify the legal entity.",
    sourceUrl: `${WEBSITE}/terms-of-service`,
  },
  {
    id: "ownership-documents",
    title: "Ownership and control-person documents",
    category: "compliance",
    keywords: ["ubo", "beneficial owner", "ownership", "shareholder", "cap table", "control person", "director", "ownership chart"],
    answer: "BorderPay must identify all ultimate beneficial owners holding 25% or more and at least one control person when applicable. Acceptable evidence can include a shareholder register, signed cap table, shareholder or operating agreement, membership ledger, stock certificate, ownership chart, board records, or official filings that account for 100% of ownership. A verified control person may be asked to attest to the ownership structure.",
    sourceUrl: `${WEBSITE}/terms-of-service`,
  },
  {
    id: "standard-kyb-documents",
    title: "Common KYB document checklist",
    category: "compliance",
    keywords: ["documents required", "document checklist", "what documents", "bank statement", "proof of address", "source of funds", "operating licence"],
    answer: "Common KYB evidence includes formation or registration documents, tax or business identification, registered-address evidence, director or control-person identity, ownership evidence, and source-of-funds or operating evidence when requested. A bank statement, financial statement, licence, policies or commercial records may be requested based on the business model and risk review. Only upload genuine, complete and legible documents.",
    sourceUrl: `${WEBSITE}/terms-of-service`,
  },
  {
    id: "high-risk-disclosure",
    title: "High-risk activities that must be disclosed",
    category: "compliance",
    keywords: ["high risk", "money service", "remittance", "lending", "banking", "foreign exchange", "virtual currency", "otc", "escrow", "client funds", "payment processor"],
    answer: "Businesses must disclose high-risk activities, including money services or remittance, lending or banking, foreign-exchange or virtual-currency brokerage/OTC activity, holding client funds or escrow, and third-party payment processing. Disclosure does not guarantee eligibility; enhanced due diligence, licensing evidence or rejection may follow.",
    sourceUrl: `${WEBSITE}/aml-policy`,
  },
  {
    id: "prohibited-activities",
    title: "Prohibited business activities",
    category: "compliance",
    keywords: ["prohibited", "restricted business", "gambling", "casino", "weapons", "cannabis", "pharmaceutical", "tobacco", "adult", "mlm", "money transmission", "digital asset exchange", "luxury goods"],
    answer: "BorderPay does not support unlawful, fraudulent, abusive, deceptive or sanctions-evading activity; games of chance, gambling, sweepstakes or lotteries; weapons; precious metals, jewellery, watches or certain luxury goods; counterfeit goods or intellectual-property infringement; cannabis, tobacco, pharmaceuticals or drug-mimicking substances; adult content or services; multi-level marketing; mixing; bail bonds, collections or safe-deposit-box rental; or unapproved third-party investment, credit, digital-asset exchange, money-service, payment-processing or money-transmission activity. BorderPay may also decline activity that creates elevated legal, financial or payment-network risk.",
    sourceUrl: `${WEBSITE}/terms-of-service`,
  },
  {
    id: "business-identification",
    title: "Business identification numbers",
    category: "compliance",
    keywords: ["tin", "tax id", "tax number", "ein", "vat", "company number", "registration number", "business identification", "crn"],
    answer: "Use the official business or tax identifier issued in the country of incorporation. Common examples include EIN for the United States; CRN or VAT for the United Kingdom; SIREN/SIRET for France; USt-IdNr or commercial registration number for Germany; KVK or VAT for the Netherlands; register code for Estonia; registration number for Latvia; company code for Lithuania; Partita IVA or Codice Fiscale for Italy; CRO number for Ireland; KRS or NIP for Poland; NIF or CIF for Spain; ABN/ACN for Australia; business number for Canada; UEN for Singapore; BRN for Hong Kong; GSTIN/CIN/PAN for India; CAC/TIN for Nigeria; PIN/VAT for Kenya; TIN/VAT for South Africa; and NIF/RCCM for Cameroon. For non-US countries, VAT or another official identifier may be accepted where appropriate. The identifier must match the legal entity and incorporation jurisdiction.",
    sourceUrl: `${WEBSITE}/terms-of-service`,
  },
  {
    id: "account-security",
    title: "PIN, 2FA and account security",
    category: "security",
    keywords: ["pin", "2fa", "totp", "authenticator", "biometric", "security", "sca", "strong authentication"],
    answer: "Use a unique password and enable the available PIN, biometric and authenticator protections. Never share a password, PIN, one-time code or recovery secret. Strong authentication can be required for eligible EEA business wallet actions. BorderPay support will never ask for your complete PIN or authenticator code.",
    sourceUrl: `${WEBSITE}/faq`,
  },
  {
    id: "cards-availability",
    title: "Card availability",
    category: "accounts",
    keywords: ["card", "virtual card", "physical card", "apple pay", "google pay"],
    answer: "Card issuance is not generally active yet. Card features may be visible for product planning, but creation remains unavailable until the card programme and the specific business account are enabled.",
    sourceUrl: `${WEBSITE}/faq`,
  },
  {
    id: "privacy-and-data",
    title: "Privacy and account data",
    category: "security",
    keywords: ["privacy", "personal data", "data deletion", "data request", "security data", "information sharing"],
    answer: "BorderPay processes account, verification and transaction information to provide services, prevent fraud, meet legal obligations and support customers. Data requests and privacy questions can be sent to privacy@borderpayafrica.com. Requests remain subject to legally required compliance and record-retention obligations.",
    sourceUrl: `${WEBSITE}/privacy-policy`,
  },
  {
    id: "contact-support",
    title: "Contacting support",
    category: "support",
    keywords: ["contact", "support", "help", "human", "agent", "ticket", "email"],
    answer: "Use the in-app support conversation to create and track a ticket, or email support@borderpayafrica.com. Keep one issue in one ticket and include the transaction reference when relevant. Never include a password, PIN, authenticator code or recovery secret.",
    sourceUrl: `${WEBSITE}/faq`,
  },
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "do", "for", "from", "how", "i", "in", "is",
  "it", "my", "of", "on", "or", "the", "to", "what", "when", "where", "with",
]);

function normalizedTokens(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9@.]+/g, " ").split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function countryIdentificationEntry(query: string): SupportKnowledgeEntry | null {
  const normalized = ` ${query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  if (!/\b(tin|tax|ein|vat|registration|company number|business id|identifier)\b/.test(normalized)) {
    return null;
  }
  const candidates = [
    ...Object.keys(BUSINESS_IDENTIFICATION_BY_COUNTRY),
    ...Object.keys(COUNTRY_ALIASES),
  ].sort((left, right) => right.length - left.length);
  const matched = candidates.find((country) => normalized.includes(` ${country} `));
  if (!matched) return null;
  const canonicalCountry = COUNTRY_ALIASES[matched] || matched;
  const identifier = BUSINESS_IDENTIFICATION_BY_COUNTRY[canonicalCountry];
  if (!identifier) return null;
  const countryLabel = canonicalCountry.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    id: `business-identification-${canonicalCountry.replace(/\s+/g, "-")}`,
    title: `Business identification for ${countryLabel}`,
    category: "compliance",
    keywords: [matched, canonicalCountry, "business identification", "tax number"],
    answer: `For a business incorporated in ${countryLabel}, the accepted identification type is ${identifier}. The number must be official, current and match the legal entity and country of incorporation. A compliance review may request supporting registration or tax evidence.`,
    sourceUrl: `${WEBSITE}/terms-of-service`,
  };
}

export function retrieveSupportKnowledge(query: string, limit = 4): SupportKnowledgeEntry[] {
  const normalized = query.toLowerCase();
  const queryTokens = new Set(normalizedTokens(query));
  const countryEntry = countryIdentificationEntry(query);
  const matches = SUPPORT_KNOWLEDGE.map((entry) => {
    const titleTokens = normalizedTokens(entry.title);
    const keywordTokens = normalizedTokens(entry.keywords.join(" "));
    let score = 0;
    for (const phrase of entry.keywords) {
      if (phrase.length > 2 && normalized.includes(phrase.toLowerCase())) score += 8;
    }
    for (const token of titleTokens) if (queryTokens.has(token)) score += 3;
    for (const token of keywordTokens) if (queryTokens.has(token)) score += 1;
    return { entry, score };
  }).filter((result) => result.score >= 2)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .map((result) => result.entry);
  const combined = countryEntry
    ? [countryEntry, ...matches.filter((entry) => entry.id !== "business-identification")]
    : matches;
  return combined.slice(0, Math.max(1, Math.min(limit, 6)));
}

export function renderSupportKnowledge(entries: SupportKnowledgeEntry[]): string {
  return entries.map((entry) => [
    `[${entry.id}] ${entry.title}`,
    entry.answer,
    `Approved source: ${entry.sourceUrl}`,
  ].join("\n")).join("\n\n");
}

export function knowledgeSources(entries: SupportKnowledgeEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.sourceUrl))];
}
