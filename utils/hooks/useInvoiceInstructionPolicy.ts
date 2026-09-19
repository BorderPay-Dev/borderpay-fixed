import {useEffect,useMemo,useState} from 'react';
import {supabase} from '../supabase/client';
export function useInvoiceInstructionPolicy(open:boolean){
 const key=useMemo(()=>({}),[open]);
 const locked={loading:true,required:true,error:''};
 const [state,setState]=useState<{key:object|null;loading:boolean;required:boolean;error:string}>({key:null,...locked});
 useEffect(()=>{if(!open)return;let active=true;
 Promise.resolve(supabase.rpc('predeposit_instruction_policy')).then(({data,error})=>{
  if(!active)return;if(error||typeof data?.required!=='boolean'){setState({key,loading:false,required:true,error:'Unable to check receiving instructions. Please close and try again.'});return;}
  setState({key,loading:false,required:data.required,error:''});
 }).catch(()=>{if(active)setState({key,loading:false,required:true,error:'Unable to check receiving instructions. Please close and try again.'});});
 return()=>{active=false;};},[open,key]);
 // A reopened sheet cannot render a prior opening's authorization, even for one frame.
 return state.key===key?state:locked;
}
