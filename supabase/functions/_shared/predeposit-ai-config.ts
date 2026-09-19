import type {AzureConfig} from "./predeposit-azure.ts";
/** Invoice-specific configuration; never inherit another product's model gateway. */
export async function loadInvoiceAiConfig(db:any):Promise<AzureConfig>{
 const result=await db.rpc("predeposit_ai_config");
 if(result.error)throw Error("Invoice AI configuration unavailable");
 const config=result.data||{};
 return {endpoint:String(config.endpoint||"").trim(),deployment:String(config.deployment||"").trim(),
  apiVersion:String(config.apiVersion||"2024-10-21").trim(),apiKey:String(config.apiKey||"").trim()};
}
