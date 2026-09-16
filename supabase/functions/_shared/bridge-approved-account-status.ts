/** Promote only a stale onboarding status; never reopen an account lock. */
export async function syncApprovedBridgeAccountStatus(supabase: { from: (table: string) => any }, userId: string, customerId: string): Promise<void> {
  const { data: profile, error } = await supabase.from("user_profiles")
    .select("account_type,account_status,account_frozen_at,bridge_customer_id,bridge_account_status,bridge_kyc_status,kyc_status")
    .eq("id", userId).maybeSingle();
  if (error) throw new Error("approved_account_status_lookup_failed");
  if (!profile || profile.account_status !== "pending_kyc" || profile.account_frozen_at
    || profile.bridge_account_status !== "active" || profile.bridge_customer_id !== customerId
    || profile.kyc_status !== "verified") return;
  if (profile.account_type === "business") {
    const { data: business, error: businessError } = await supabase.from("business_profiles")
      .select("bridge_customer_id,bridge_kyb_status").eq("user_id", userId).maybeSingle();
    if (businessError) throw new Error("approved_business_status_lookup_failed");
    if (business?.bridge_kyb_status !== "approved"
      || (business.bridge_customer_id ?? profile.bridge_customer_id) !== customerId) return;
  } else if (profile.account_type !== "individual" || profile.bridge_kyc_status !== "approved") return;
  // Repeat lock/status predicates in the write so a concurrent freeze or
  // rejection cannot be overwritten by the earlier approval observation.
  let write = supabase.from("user_profiles").update({ account_status: "active", updated_at: new Date().toISOString() })
    .eq("id", userId).eq("account_status", "pending_kyc").is("account_frozen_at", null)
    .eq("bridge_customer_id", customerId).eq("bridge_account_status", "active").eq("kyc_status", "verified");
  if (profile.account_type === "individual") write = write.eq("bridge_kyc_status", "approved");
  const { error: writeError } = await write;
  if (writeError) throw new Error("approved_account_status_sync_failed");
}
