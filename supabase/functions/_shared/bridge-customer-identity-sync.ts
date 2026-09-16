import { bridgeProvider as defaultBridgeProvider } from "./providers/bridge.ts";
import { bridgeCustomerScaCountry, normalizeBridgeScaCountry } from "./bridge-sca-scope.ts";

function normalizeCountryCode(value: unknown): string | null {
  const s = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

export async function syncBridgeCustomerIdentity(
  supabase: { from: (table: string) => any },
  bridgeProvider: Pick<typeof defaultBridgeProvider, "getCustomerProfile">,
  bridgeCustomerId: string,
  owner: { resolved: string; account_type: "individual" | "business" },
): Promise<void> {
  const [{ data: userProfile, error: userError }, { data: businessProfile, error: businessError }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("country, bridge_customer_id, phone, date_of_birth, id_number, id_type, bridge_address_object, bridge_identity_metadata")
      .eq("id", owner.resolved)
      .maybeSingle(),
    owner.account_type === "business"
      ? supabase
          .from("business_profiles")
          .select("country, bridge_customer_id, company_phone, address, city, state, postal_code, bridge_identity_metadata")
          .eq("user_id", owner.resolved)
          .maybeSingle()
      : Promise.resolve({ data: null as any, error: null }),
  ]);

  if (userError || businessError) throw new Error("customer_identity_lookup_failed");
  if (owner.account_type === "business" && (!businessProfile ||
    (businessProfile.bridge_customer_id ?? userProfile?.bridge_customer_id) !== bridgeCustomerId)) {
    throw new Error("business_identity_customer_mismatch");
  }
  const userCountry = normalizeCountryCode(userProfile?.country);
  const businessCountry = normalizeBridgeScaCountry(businessProfile?.country);
  const needsUserIdentity =
    !userProfile?.date_of_birth ||
    !userProfile?.id_number ||
    !userProfile?.id_type;
  // Business incorporation must be reconciled even when signup populated a
  // country or earlier identity metadata. Only individuals may skip this read.
  if (owner.account_type === "individual" && userCountry && !needsUserIdentity) return;

  let customer: Awaited<ReturnType<typeof bridgeProvider.getCustomerProfile>> | null = null;
  try {
    customer = await bridgeProvider.getCustomerProfile(bridgeCustomerId);
  } catch (e) {
    if (owner.account_type === "business") throw new Error("business_incorporation_sync_unavailable", { cause: e });
    // Historical individual mappings retain their existing best-effort sync.
    console.warn(`country-sync skipped customer=${bridgeCustomerId}: ${(e as Error).message}`);
    return;
  }
  const bridgeCountry = normalizeCountryCode(customer.country ?? customer.address_object?.country);

  const userUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (!userCountry && bridgeCountry) userUpdate.country = bridgeCountry;
  if (!userProfile?.phone && customer.phone) userUpdate.phone = customer.phone;
  if (!userProfile?.date_of_birth && customer.date_of_birth) userUpdate.date_of_birth = customer.date_of_birth;
  if (!userProfile?.id_number && customer.id_number) userUpdate.id_number = customer.id_number;
  if (!userProfile?.id_type && customer.id_type) userUpdate.id_type = customer.id_type;
  if (
    customer.id_number ||
    customer.id_type ||
    customer.date_of_birth ||
    customer.identity_metadata.id_number_present
  ) {
    userUpdate.bridge_identity_metadata = {
      ...(userProfile?.bridge_identity_metadata && typeof userProfile.bridge_identity_metadata === "object"
        ? userProfile.bridge_identity_metadata
        : {}),
      ...customer.identity_metadata,
    };
    userUpdate.bridge_identity_synced_at = new Date().toISOString();
  }
  if (customer.address_object && Object.values(customer.address_object).some((v) => String(v ?? "").trim().length > 0)) {
    userUpdate.bridge_address_object = customer.address_object;
    if (!userProfile?.country && bridgeCountry) userUpdate.country = bridgeCountry;
    const line1 = customer.address_object.street_line_1;
    const line2 = customer.address_object.street_line_2;
    if (line1) userUpdate.address = line2 ? `${line1}, ${line2}` : line1;
    if (customer.address_object.city) userUpdate.city = customer.address_object.city;
    if (customer.address_object.postal_code) userUpdate.postal_code = customer.address_object.postal_code;
  }
  if (Object.keys(userUpdate).length > 1) {
    await supabase.from("user_profiles").update(userUpdate).eq("id", owner.resolved);
  }

  if (owner.account_type === "business") {
    const bizUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    // Bridge's generic customer.country/address may describe operations or
    // residence. Only legal incorporation / registered-address fields qualify.
    const incorporationCountry = bridgeCustomerScaCountry(customer, "business");
    if (incorporationCountry && incorporationCountry !== businessCountry) {
      bizUpdate.country = incorporationCountry;
    }
    if (!businessProfile?.company_phone && customer.phone) bizUpdate.company_phone = customer.phone;
    if (
      customer.id_number ||
      customer.id_type ||
      customer.date_of_birth ||
      customer.identity_metadata.id_number_present
    ) {
      bizUpdate.bridge_identity_metadata = {
        ...(businessProfile?.bridge_identity_metadata && typeof businessProfile.bridge_identity_metadata === "object"
          ? businessProfile.bridge_identity_metadata
          : {}),
        ...customer.identity_metadata,
      };
      bizUpdate.bridge_identity_synced_at = new Date().toISOString();
    }
    if (incorporationCountry) {
      bizUpdate.bridge_identity_metadata = {
        ...(businessProfile?.bridge_identity_metadata ?? {}),
        ...(bizUpdate.bridge_identity_metadata as Record<string, unknown> ?? {}),
        incorporation_country: incorporationCountry,
        incorporation_country_source: "bridge_customer_api_legal_country",
      };
      bizUpdate.bridge_identity_synced_at = new Date().toISOString();
    }
    if (customer.address_object?.street_line_1 && !businessProfile?.address) {
      const line1 = customer.address_object.street_line_1;
      const line2 = customer.address_object.street_line_2;
      bizUpdate.address = line2 ? `${line1}, ${line2}` : line1;
    }
    if (customer.address_object?.city && !businessProfile?.city) bizUpdate.city = customer.address_object.city;
    if (customer.address_object?.state && !businessProfile?.state) bizUpdate.state = customer.address_object.state;
    if (customer.address_object?.postal_code && !businessProfile?.postal_code) bizUpdate.postal_code = customer.address_object.postal_code;
    if (Object.keys(bizUpdate).length > 1) {
      let write = supabase.from("business_profiles").update(bizUpdate).eq("user_id", owner.resolved);
      // Initial KYB linking may still have the customer on user_profiles only.
      // Guard the observed mapping so a concurrent reassignment cannot be changed.
      write = businessProfile.bridge_customer_id == null
        ? write.is("bridge_customer_id", null)
        : write.eq("bridge_customer_id", bridgeCustomerId);
      const { data: syncedBusiness, error: businessSyncError } = await write.select("user_id").maybeSingle();
      if (businessSyncError || !syncedBusiness) throw new Error("business_incorporation_sync_failed", { cause: businessSyncError });
    }
  }
}

