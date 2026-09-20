import assert from "node:assert/strict";
import {renderTemplate} from "../supabase/functions/_shared/email-templates/index.ts";
Deno.test("optional invoicing appears in approval emails and the business broadcast, not rejection notices",()=>{
 for(const key of ["business.invoice_contract_hub","business.kyb_decision","business.account_activated"] as const){
  const r=renderTemplate(key,{company_name:"Example Ltd",decision:"approved"});
  assert.match(r.text,/optional Invoice & Contract Hub/);
  assert.match(r.html,/corporate-to-corporate/);
  assert.match(r.text,/does not add an invoice-approval requirement/);
 }
 const rejection=renderTemplate("business.kyb_decision",{company_name:"Example Ltd",decision:"rejected"});
 assert.doesNotMatch(rejection.text,/Invoice & Contract Hub/);
 assert.doesNotMatch(rejection.html,/Invoice & Contract Hub/);
});
