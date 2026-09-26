import {kybPortalStatus} from '../../supabase/functions/_shared/kyb-portal-status.ts';
const pilot={app_metadata:{kyb_synthetic_test:true}};
const response=(data:unknown)=>Promise.resolve(new Response(JSON.stringify(data),{status:200}));
Deno.test('draft and partial capture do not change the current verification status',async()=>{for(const rows of [[],[{internal_status:'draft'}],[{internal_status:'needs_information'}]]){if(await kybPortalStatus(pilot,'token',()=>response(rows))!==null)throw Error('premature_status_change');}});
Deno.test('only submitted or readiness-reviewed applications project pending, never approval',async()=>{for(const status of ['in_review','approved'])if(await kybPortalStatus(pilot,'token',()=>response([{internal_status:status}]))!=='under_review')throw Error('wrong_status');});
Deno.test('ordinary users and editable metadata cannot enable the projection',async()=>{for(const user of [{},{user_metadata:{kyb_synthetic_test:true}}])if(await kybPortalStatus(user as {app_metadata?:Record<string,unknown>},'token',()=>{throw Error('unexpected_network');})!==null)throw Error('unauthorized_pilot');});
Deno.test('API outages must not silently reset an existing cached status',async()=>{let failed=false;try{await kybPortalStatus(pilot,'token',()=>Promise.resolve(new Response('{}',{status:503})));}catch{failed=true;}if(!failed)throw Error('outage_hidden');});
