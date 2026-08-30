import { canDiscoverAfricanRails, canUseAfricanRails } from "../utils/africanRailsAccess.ts";

Deno.test("authenticated users may discover server-authorized African rails without stale profile fields", () => {
  if (!canDiscoverAfricanRails({ id: "signed-in-user" })) {
    throw new Error("signed-in user was blocked before authoritative policy discovery");
  }
  if (canDiscoverAfricanRails({ id: "" }) || canDiscoverAfricanRails(null)) {
    throw new Error("anonymous user was allowed to discover authenticated rail policy");
  }
});

Deno.test("African Rails visibility requires an approved Bridge identity", () => {
  if (!canUseAfricanRails({ id: "individual", account_type: "individual", bridge_customer_id: "bridge-1", bridge_kyc_status: "approved" })) {
    throw new Error("verified individual blocked");
  }
  if (!canUseAfricanRails({ id: "business", account_type: "business", bridge_customer_id: "bridge-2", bridge_kyb_status: "approved" })) {
    throw new Error("verified business blocked");
  }
  for (const profile of [
    null,
    { id: "pending", account_type: "individual", bridge_customer_id: "bridge-3", bridge_kyc_status: "pending" },
    { id: "missing-customer", account_type: "business", bridge_kyb_status: "approved" },
  ]) {
    if (canUseAfricanRails(profile)) throw new Error(`ineligible profile granted: ${JSON.stringify(profile)}`);
  }
});
