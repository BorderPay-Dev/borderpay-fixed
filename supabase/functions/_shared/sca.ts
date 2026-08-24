export type ScaOperation = "wallet_access" | "payment" | "beneficiary_change" | "security_change";

// Emergency rollback. Customer SCA must not be re-enabled until Bridge's EEA
// scope is implemented and approved end to end.
export const CUSTOMER_SCA_ENFORCEMENT_ENABLED = false;

type ScaDatabaseClient = {
  from: (table: string) => any;
  rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

const EEA_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU",
  "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

// The canonical signup selector stores these ISO-3166 alpha-2 values. Values
// outside this set are not treated as proof of non-EEA residency.
const KNOWN_COUNTRY_CODES: ReadonlySet<string> = new Set(
  "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MK MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG NO OM PK PW PS PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SZ SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW".split(" "),
);

export type ScaResidencyRequirement = {
  required: boolean;
  country: string | null;
  reason: "verified_eea_resident" | "non_eea_resident" | "residency_unknown" | "verification_not_approved";
};

const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  AUT: "AT", BEL: "BE", BGR: "BG", HRV: "HR", CYP: "CY", CZE: "CZ", DNK: "DK",
  EST: "EE", FIN: "FI", FRA: "FR", DEU: "DE", GRC: "GR", HUN: "HU", ISL: "IS",
  IRL: "IE", ITA: "IT", LVA: "LV", LIE: "LI", LTU: "LT", LUX: "LU", MLT: "MT",
  NLD: "NL", NOR: "NO", POL: "PL", PRT: "PT", ROU: "RO", SVK: "SK", SVN: "SI",
  ESP: "ES", SWE: "SE",
  AUSTRIA: "AT", BELGIUM: "BE", BULGARIA: "BG", CROATIA: "HR", CYPRUS: "CY",
  CZECHIA: "CZ", "CZECH REPUBLIC": "CZ", DENMARK: "DK", ESTONIA: "EE", FINLAND: "FI",
  FRANCE: "FR", GERMANY: "DE", GREECE: "GR", HUNGARY: "HU", ICELAND: "IS",
  IRELAND: "IE", ITALY: "IT", LATVIA: "LV", LIECHTENSTEIN: "LI", LITHUANIA: "LT",
  LUXEMBOURG: "LU", MALTA: "MT", NETHERLANDS: "NL", NORWAY: "NO", POLAND: "PL",
  PORTUGAL: "PT", ROMANIA: "RO", SLOVAKIA: "SK", SLOVENIA: "SI", SPAIN: "ES", SWEDEN: "SE",
};

function normalizeCountryCode(country: unknown): string | null {
  const raw = String(country || "").trim().toUpperCase();
  if (KNOWN_COUNTRY_CODES.has(raw)) return raw;
  return COUNTRY_ALIASES[raw] ?? null;
}

export function classifyScaResidency(country: unknown): ScaResidencyRequirement {
  const normalized = normalizeCountryCode(country);
  if (!normalized) return { required: false, country: null, reason: "residency_unknown" };
  return EEA_COUNTRY_CODES.has(normalized)
    ? { required: true, country: normalized, reason: "verified_eea_resident" }
    : { required: false, country: normalized, reason: "non_eea_resident" };
}

export async function resolveScaResidencyRequirement(
  supabase: ScaDatabaseClient,
  userId: string,
): Promise<ScaResidencyRequirement> {
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("id,account_type,country,kyc_status,bridge_kyc_status")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile?.id) {
    console.error("sca_residency_profile_lookup_failed", { user_id: userId, code: profileError?.code });
    return { required: false, country: null, reason: "residency_unknown" };
  }

  let country: unknown = profile.country;
  let verified = ["approved", "verified"].includes(String(profile.kyc_status || "").toLowerCase())
    || String(profile.bridge_kyc_status || "").toLowerCase() === "approved";
  if (profile.account_type === "business") {
    const { data: business, error: businessError } = await supabase
      .from("business_profiles")
      .select("country,bridge_kyb_status")
      .eq("user_id", userId)
      .maybeSingle();
    if (businessError) {
      console.error("sca_residency_business_lookup_failed", { user_id: userId, code: businessError.code });
      return { required: false, country: null, reason: "residency_unknown" };
    }
    country = business?.country ?? country;
    verified = String(business?.bridge_kyb_status || "").toLowerCase() === "approved";
  }

  if (!verified) {
    return { required: false, country: normalizeCountryCode(country), reason: "verification_not_approved" };
  }
  return classifyScaResidency(country);
}

const OPERATIONS = new Set<ScaOperation>([
  "wallet_access", "payment", "beneficiary_change", "security_change",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, child]) =>
          child !== undefined
          && !["sca_authorization_id", "pin", "totp", "transaction_pin"].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function assertScaOperation(value: unknown): ScaOperation {
  const operation = String(value || "") as ScaOperation;
  if (!OPERATIONS.has(operation)) throw new Error("invalid_sca_operation");
  return operation;
}

export function scaCanonicalPayload(resource: string, request: unknown): string {
  const normalizedResource = String(resource || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalizedResource)) {
    throw new Error("invalid_sca_resource");
  }
  return JSON.stringify(canonicalize({ resource: normalizedResource, request }));
}

export async function scaPayloadHash(resource: string, request: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(scaCanonicalPayload(resource, request));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function consumeScaAuthorization(params: {
  supabase: ScaDatabaseClient;
  authorizationId: unknown;
  userId: string;
  operation: ScaOperation;
  resource: string;
  request: unknown;
}): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  if (!CUSTOMER_SCA_ENFORCEMENT_ENABLED) return { ok: true };

  // Rollout gate: older signed mobile releases cannot submit an SCA
  // authorization. Keep enforcement off until compatible App Store and Play
  // builds are published; the new web client still performs the full flow.
  // Enabling this secret is a release-control action, not a client flag.
  if (Deno.env.get("UNIVERSAL_SCA_ENFORCEMENT_ENABLED") !== "true") return { ok: true };

  const residency = await resolveScaResidencyRequirement(params.supabase, params.userId);
  if (!residency.required) return { ok: true };

  const authorizationId = String(params.authorizationId || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authorizationId)) {
    return {
      ok: false,
      status: 403,
      body: { success: false, code: "sca_required", error: "Strong customer authentication is required." },
    };
  }

  const payloadHash = await scaPayloadHash(params.resource, params.request);
  const { data, error } = await params.supabase.rpc("consume_sca_authorization", {
    p_authorization_id: authorizationId,
    p_user_id: params.userId,
    p_operation: params.operation,
    p_resource: params.resource,
    p_payload_hash: payloadHash,
  });
  if (error) {
    console.error("sca_consume_lookup_failed", { code: error.code, operation: params.operation, resource: params.resource });
    return {
      ok: false,
      status: 503,
      body: { success: false, code: "sca_unavailable", error: "Strong authentication could not be verified. Nothing was changed." },
    };
  }
  if (data !== true) {
    return {
      ok: false,
      status: 403,
      body: { success: false, code: "sca_invalid", error: "Strong authentication expired, was already used, or does not match this action." },
    };
  }
  return { ok: true };
}
