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
    | "approved_without_customer_id"
    | "customer_id_unmapped"
    | "customer_id_ambiguous"
    | "customer_id_owned_by_other_user";
  error: string;
  details?: Record<string, unknown>;
};

type SupaLike = { from: (table: string) => any };

function fail(
  reason: BridgeIdentityInvariantFailure["reason"],
  error: string,
  details?: Record<string, unknown>,
): BridgeIdentityInvariantFailure {
  return { code: "identity_invariant_violation", reason, error, details };
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
  let country: string | null = profile.country ?? null;
  let bridge_customer_id: string | null = profile.bridge_customer_id ?? null;
  let verification_status: string | null = profile.bridge_kyc_status ?? null;

  if (account_type === "business") {
    const { data: biz } = await supa
      .from("business_profiles")
      .select("user_id, country, bridge_customer_id, bridge_kyb_status")
      .eq("user_id", userId)
      .maybeSingle();
    country = biz?.country ?? country;
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
    const [{ data: bizRows }, { data: userRows }] = await Promise.all([
      supa.from("business_profiles").select("user_id").eq("bridge_customer_id", bridge_customer_id).limit(2),
      supa.from("user_profiles").select("id, account_type").eq("bridge_customer_id", bridge_customer_id).limit(2),
    ]);

    const bizOwners = Array.isArray(bizRows) ? bizRows.map((r: any) => String(r.user_id)) : [];
    const userOwners = Array.isArray(userRows) ? userRows.map((r: any) => String(r.id)) : [];
    const ownerRows = [...bizOwners, ...userOwners];
    const owners = Array.from(new Set(ownerRows));

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
          { bridge_customer_id: bridge_customer_id, owners, owner_rows: ownerRows },
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
