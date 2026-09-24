import { bridgeProvider } from "../supabase/functions/_shared/providers/bridge.ts";
import { bridgeOnboardingEnabled, bridgeOnboardingPausedBody } from "../supabase/functions/_shared/launch-gates.ts";
Deno.test("new provider customers cannot be created when onboarding is off", async () => {
  const previous=Deno.env.get("BRIDGE_ONBOARDING_ENABLED");const original=globalThis.fetch;let calls=0;
  globalThis.fetch=()=>{calls++;throw new Error("Unexpected provider request");};
  try {
    for(const value of [undefined,"false","invalid"]) {
      if(value===undefined)Deno.env.delete("BRIDGE_ONBOARDING_ENABLED");else Deno.env.set("BRIDGE_ONBOARDING_ENABLED",value);
      if(bridgeOnboardingEnabled())throw new Error("Gate failed open");
      let denied=false;
      try {await bridgeProvider.createCustomer({account_type:"business",email:"hold-test@example.invalid",company_name:"Synthetic Hold Test",country_code:"GB",borderpay_user_id:"synthetic-only"});}
      catch(e){denied=e.status===503&&e.bridge_code==="bridge_onboarding_paused";}
      if(!denied)throw new Error("Missing onboarding denial");
    }
    if(calls!==0)throw new Error("Provider was contacted");
    if(!bridgeOnboardingPausedBody().error.includes("account is saved"))throw new Error("Unhelpful copy");
  } finally {globalThis.fetch=original;if(previous===undefined)Deno.env.delete("BRIDGE_ONBOARDING_ENABLED");else Deno.env.set("BRIDGE_ONBOARDING_ENABLED",previous);}
});
