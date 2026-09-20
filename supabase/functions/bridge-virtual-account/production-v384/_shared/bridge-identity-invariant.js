// Preserved production v384 module. See PROVENANCE.json before changing this graph.
function fail(reason, error, details) {
    return { code: "identity_invariant_violation", reason, error, details };
}
export async function loadAndAssertBridgeIdentityInvariant(supa, userId) {
    const { data: profile, error: profileError } = await supa
        .from("user_profiles")
        .select("id, account_type, country, bridge_customer_id, bridge_kyc_status")
        .eq("id", userId)
        .maybeSingle();
    if (profileError) {
        return { ok: false, failure: fail("profile_lookup_failed", "User profile lookup failed.", { code: profileError.code }) };
    }
    if (!profile?.id)
        return { ok: false, failure: fail("profile_missing", "User profile not found.") };
    const account_type = profile.account_type === "business" ? "business" : "individual";
    let country = profile.country ?? null;
    let bridge_customer_id = profile.bridge_customer_id ?? null;
    let verification_status = profile.bridge_kyc_status ?? null;
    if (account_type === "business") {
        const { data: business, error: businessError } = await supa
            .from("business_profiles")
            .select("user_id, country, bridge_customer_id, bridge_kyb_status")
            .eq("user_id", userId)
            .maybeSingle();
        if (businessError) {
            return { ok: false, failure: fail("business_profile_lookup_failed", "Business profile lookup failed.", { code: businessError.code }) };
        }
        country = business?.country ?? country;
        verification_status = business?.bridge_kyb_status ?? verification_status;
        bridge_customer_id = business?.bridge_customer_id ?? bridge_customer_id;
    }
    if (verification_status === "approved" && !bridge_customer_id) {
        return { ok: false, failure: fail("approved_without_customer_id", "Approved entity is missing bridge_customer_id.", { account_type, user_id: userId }) };
    }
    if (bridge_customer_id) {
        const [businessOwnersResult, userOwnersResult] = await Promise.all([
            supa.from("business_profiles").select("user_id").eq("bridge_customer_id", bridge_customer_id).limit(2),
            supa.from("user_profiles").select("id, account_type").eq("bridge_customer_id", bridge_customer_id).limit(2),
        ]);
        if (businessOwnersResult.error || userOwnersResult.error) {
            return { ok: false, failure: fail("ownership_lookup_failed", "Bridge customer ownership lookup failed.", {
                    business_code: businessOwnersResult.error?.code,
                    user_code: userOwnersResult.error?.code,
                }) };
        }
        const businessOwners = Array.isArray(businessOwnersResult.data)
            ? businessOwnersResult.data.map((row) => String(row.user_id))
            : [];
        const userOwners = Array.isArray(userOwnersResult.data)
            ? userOwnersResult.data.map((row) => String(row.id))
            : [];
        const owners = Array.from(new Set([...businessOwners, ...userOwners]));
        if (owners.length === 0)
            return { ok: false, failure: fail("customer_id_unmapped", "bridge_customer_id does not map to any local owner row.", { bridge_customer_id }) };
        if (owners.length > 1)
            return { ok: false, failure: fail("customer_id_ambiguous", "bridge_customer_id maps to multiple local owners.", { bridge_customer_id, owners }) };
        if (owners[0] !== userId)
            return { ok: false, failure: fail("customer_id_owned_by_other_user", "bridge_customer_id is mapped to a different user.", { bridge_customer_id, owner_user_id: owners[0], caller_user_id: userId }) };
    }
    return { ok: true, context: { account_type, country, bridge_customer_id, verification_status } };
}
