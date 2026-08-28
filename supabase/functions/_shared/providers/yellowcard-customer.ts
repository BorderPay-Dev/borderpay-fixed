import { bridgeProvider } from "./bridge.ts";
import { normalizeYellowCardCountryCode } from "./yellowcard-commercial-policy.ts";
import type { YellowCardInstitutionKyc, YellowCardRetailKyc } from "./yellowcard-payload.ts";

const text = (value: unknown) => String(value ?? "").trim();

function first(...values: unknown[]): string {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return "";
}
function dob(value: unknown): string {
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  return /^\d{2}\/\d{2}\/\d{4}$/.test(raw) ? raw : "";
}

function address(profile: any, bridge: any): string {
  const provider = bridge?.address_object || {};
  return [
    first(provider.street_line_1, profile?.address),
    first(provider.street_line_2),
    first(provider.city, profile?.city),
    first(provider.state, profile?.state),
    first(provider.postal_code, profile?.postal_code),
  ].filter(Boolean).join(", ");
}

export type YellowCardCanonicalSender =
  | { customerType: "retail"; sender: YellowCardRetailKyc }
  | { customerType: "institution"; sender: YellowCardInstitutionKyc };

/** Load sender identity only from an approved local projection plus Bridge. */
export async function loadYellowCardCanonicalSender(
  supabase: any,
  input: { userId: string; bridgeCustomerId: string; accountType: "individual" | "business" },
): Promise<YellowCardCanonicalSender> {
  const [{ data: profile, error: profileError }, bridge] = await Promise.all([
    supabase.from("user_profiles")
      .select("id,email,full_name,phone,country,address,city,state,postal_code,date_of_birth,id_number,id_type")
      .eq("id", input.userId)
      .maybeSingle(),
    bridgeProvider.getCustomerProfile(input.bridgeCustomerId),
  ]);
  if (profileError || !profile?.id) throw new Error("yellow_card_sender_profile_unavailable");

  if (input.accountType === "business") {
    const { data: business, error } = await supabase.from("business_profiles")
      .select("company_name,registration_number")
      .eq("user_id", input.userId)
      .maybeSingle();
    if (error || !business?.company_name || !business?.registration_number) {
      throw new Error("yellow_card_business_identity_incomplete");
    }
    return {
      customerType: "institution",
      sender: {
        businessName: text(business.company_name),
        businessId: text(business.registration_number),
      },
    };
  }

  const raw: any = bridge.raw || {};
  const sender: YellowCardRetailKyc = {
    name: first(raw.full_name, raw.first_name && raw.last_name ? `${raw.first_name} ${raw.last_name}` : "", profile.full_name),
    country: normalizeYellowCardCountryCode(bridge.country || profile.country),
    phone: first(bridge.phone, profile.phone),
    address: address(profile, bridge),
    dob: dob(bridge.date_of_birth || profile.date_of_birth),
    email: first(raw.email, profile.email).toLowerCase(),
    idNumber: first(bridge.id_number, profile.id_number),
    idType: first(bridge.id_type, profile.id_type),
  };
  if (Object.values(sender).some((value) => !text(value))) {
    throw new Error("yellow_card_retail_identity_incomplete");
  }
  return { customerType: "retail", sender };
}
