export type BridgeAccountType = "individual" | "business";

export type BridgeIdentityContext = {
  account_type: BridgeAccountType;
  country: string | null;
  bridge_customer_id: string | null;
  verification_status: string | null;
};

export type BridgeIdentityInvariantFailure = {
  code: "identity_invariant_violation";
  reason:
    | "profile_missing"
    | "operator_account_excluded"
    | "approved_without_customer_id"
    | "customer_id_unmapped"
    | "customer_id_ambiguous"
    | "customer_id_owned_by_other_user";
  error: string;
  details?: Record<string, unknown>;
  summary: {
    code: "identity_invariant_violation";
    reason: BridgeIdentityInvariantFailure["reason"];
  };
};

type SupaLike = { from: (table: string) => any };
const ISO3_TO_ISO2: Record<string, string> = {
  KEN: "KE", NGA: "NG", GHA: "GH", UGA: "UG", TZA: "TZ", RWA: "RW", ZAF: "ZA",
  USA: "US", GBR: "GB", IRL: "IE", FRA: "FR", DEU: "DE", ESP: "ES", ITA: "IT",
  NLD: "NL", BEL: "BE", PRT: "PT", AUT: "AT", POL: "PL", SWE: "SE", NOR: "NO",
  DNK: "DK", CHE: "CH", CAN: "CA", AUS: "AU", NZL: "NZ", BRA: "BR", MEX: "MX",
  COL: "CO", CIV: "CI", COG: "CG", COD: "CD", JPN: "JP", CHN: "CN", ARE: "AE",
  IND: "IN", SGP: "SG",
};

function normalizeCountryCode(value: unknown): string | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  if (/^[A-Z]{3}$/.test(raw)) return ISO3_TO_ISO2[raw] ?? null;
  return null;
}

function fail(
  reason: BridgeIdentityInvariantFailure["reason"],
  error: string,
  details?: Record<string, unknown>,
): BridgeIdentityInvariantFailure {
  return {
    code: "identity_invariant_violation",
    reason,
    error,
    details,
    summary: {
      code: "identity_invariant_violation",
      reason,
    },
  };
}

/**
 * Loads canonical Bridge identity context for a signed-in user and validates the
 * root invariant:
 *   - approved entities must have bridge_customer_id
 *   - bridge_customer_id must map to exactly one owner in local projections
 *   - mapped owner must be the authenticated user
 */
export async function loadAndAssertBridgeIdentityInvariant(
  supa: SupaLike,
  userId: string,
): Promise<{ ok: true; context: BridgeIdentityContext } | { ok: false; failure: BridgeIdentityInvariantFailure }> {
  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, account_type, country, bridge_customer_id, bridge_kyc_status")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.id) {
    return { ok: false, failure: fail("profile_missing", "User profile not found.") };
  }

  const account_type: BridgeAccountType = profile.account_type === "business" ? "business" : "individual";
  let country: string | null = normalizeCountryCode(profile.country);
  let bridge_customer_id: string | null = profile.bridge_customer_id ?? null;
  let verification_status: string | null = profile.bridge_kyc_status ?? null;

  if (account_type === "business") {
    const { data: biz } = await supa
      .from("business_profiles")
      .select("user_id, country, bridge_customer_id, bridge_kyb_status")
      .eq("user_id", userId)
      .maybeSingle();
    country = normalizeCountryCode(biz?.country) ?? country;
    verification_status = biz?.bridge_kyb_status ?? verification_status;
    bridge_customer_id = biz?.bridge_customer_id ?? bridge_customer_id;
  }

  if (verification_status === "approved" && !bridge_customer_id) {
    return {
      ok: false,
      failure: fail(
        "approved_without_customer_id",
        "Approved entity is missing bridge_customer_id.",
        { account_type, user_id: userId },
      ),
    };
  }

  if (bridge_customer_id) {
    const { data: operatorRow } = await supa
      .from("operator_bridge_accounts")
      .select("bridge_customer_id")
      .eq("bridge_customer_id", bridge_customer_id)
      .eq("active", true)
      .maybeSingle();
    if (operatorRow?.bridge_customer_id) {
      return {
        ok: false,
        failure: fail(
          "operator_account_excluded",
          "Bridge operator/admin account is excluded from customer lifecycle operations.",
          { bridge_customer_id: bridge_customer_id, user_id: userId, account_type },
        ),
      };
    }

    const [{ data: bizRows }, { data: userRows }] = await Promise.all([
      supa.from("business_profiles").select("user_id").eq("bridge_customer_id", bridge_customer_id).limit(2),
      supa.from("user_profiles").select("id, account_type").eq("bridge_customer_id", bridge_customer_id).limit(2),
    ]);

    const bizOwners = Array.isArray(bizRows) ? bizRows.map((r: any) => String(r.user_id)) : [];
    const userOwners = Array.isArray(userRows) ? userRows.map((r: any) => String(r.id)) : [];
    const owners = [...bizOwners, ...userOwners];

    if (owners.length === 0) {
      return {
        ok: false,
        failure: fail(
          "customer_id_unmapped",
          "bridge_customer_id does not map to any local owner row.",
          { bridge_customer_id: bridge_customer_id },
        ),
      };
    }
    if (owners.length > 1) {
      return {
        ok: false,
        failure: fail(
          "customer_id_ambiguous",
          "bridge_customer_id maps to multiple local owners.",
          { bridge_customer_id: bridge_customer_id, owners },
        ),
      };
    }
    if (owners[0] !== userId) {
      return {
        ok: false,
        failure: fail(
          "customer_id_owned_by_other_user",
          "bridge_customer_id is mapped to a different user.",
          { bridge_customer_id: bridge_customer_id, owner_user_id: owners[0], caller_user_id: userId },
        ),
      };
    }
  }

  return {
    ok: true,
    context: { account_type, country, bridge_customer_id, verification_status },
  };
}
