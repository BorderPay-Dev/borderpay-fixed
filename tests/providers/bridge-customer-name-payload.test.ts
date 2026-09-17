Deno.env.set('BRIDGE_API_KEY','test-only-not-a-provider-key');
const { bridgeProvider } = await import('../../supabase/functions/_shared/providers/bridge.ts');
Deno.test('customer creation sends original and transliterated business names with stable idempotency',async()=>{
 const original=globalThis.fetch;
 const calls:Array<{body:any;headers:Headers}>=[];
 globalThis.fetch=async (_url,init)=>{calls.push({body:JSON.parse(String(init?.body)),headers:new Headers(init?.headers)});return Response.json({id:'test-customer'});};
 try{
  const result=await bridgeProvider.createCustomer({account_type:'business',email:'test@example.com',company_name:'Oskar Jagieła',country_code:'PL',borderpay_user_id:'test-owner'});
  if(result.provider_id!=='test-customer'||calls.length!==1)throw Error('creation result');
  const {body,headers}=calls[0];
  if(body.business_legal_name!=='Oskar Jagieła'||body.transliterated_business_legal_name!=='Oskar Jagiela')throw Error('missing original/transliterated names');
  if(headers.get('Idempotency-Key')!=='borderpay:customer:test-owner')throw Error('idempotency changed');
  await bridgeProvider.createCustomer({account_type:'individual',email:'person@example.com',full_name:'Test Person',country_code:'GB',borderpay_user_id:'test-person'});
  if('transliterated_business_legal_name' in calls[1].body)throw Error('business field leaked to individual');
 }finally{globalThis.fetch=original;}
});
