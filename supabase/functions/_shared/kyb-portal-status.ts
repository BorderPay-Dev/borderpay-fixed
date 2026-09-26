// Existing clients consume bridge_kyb_status as their display status. This projection
// does not write provider fields, create a provider customer or approve the business.
export async function kybPortalStatus(user: {app_metadata?: Record<string,unknown>}, token:string, transport:typeof fetch=fetch):Promise<'under_review'|null>{
 if(user.app_metadata?.kyb_synthetic_test!==true)return null;
 const r=await transport('https://kyb.borderpayvelocity.xyz/api/applications',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('verification_status_unavailable');
 const applications=await r.json();if(!Array.isArray(applications))throw Error('verification_status_unavailable');
 // Draft creation, opening, document uploads and person checks never produce this state.
 // A later internal readiness assessment also never becomes an external approval.
 return applications.some(a=>['in_review','approved'].includes(a.internal_status))?'under_review':null;
}
