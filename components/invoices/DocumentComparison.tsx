import React,{useEffect,useRef,useState} from 'react';
import {backendAPI} from '../../utils/api/backendAPI';

export default function DocumentComparison({enabled}:{enabled:boolean}){
 const [invoice,setInvoice]=useState<any>(null),[contract,setContract]=useState<any>(null);
 const [checks,setChecks]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),lock=useRef(false),request=useRef(crypto.randomUUID());
 const call=async(action:string,payload:any={})=>{const r:any=await backendAPI.predeposit.request(action,payload);if(!r.success)throw Error(r.error||'Could not complete document review. Please try again.');return r.data;};
 const refresh=async()=>{const rows=await call('list_document_checks');if(alive.current)setChecks(rows);};
 useEffect(()=>{alive.current=true;let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{await refresh();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Unable to load reviews.');}if(alive.current)timer=setTimeout(poll,5000);};
  if(enabled)void poll();return()=>{alive.current=false;clearTimeout(timer);};
 },[enabled]);
 const run=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Please try again.');}finally{lock.current=false;if(alive.current)setBusy(false);}};
 const upload=async(file:File,kind:string)=>{
  if(kind==='merchant_invoice'&&file.type!=='application/pdf')throw Error('Please select your invoice as a PDF.');
  if(file.size>20*1024*1024)throw Error('Please upload a document smaller than 20 MB.');
  const r:any=await backendAPI.predeposit.upload(file,kind);if(!r.success)throw Error(r.error||'Upload failed. Please try again.');
  if(alive.current){const value={...r.data,name:file.name};if(kind==='merchant_invoice')setInvoice(value);else setContract(value);request.current=crypto.randomUUID();}
 };
 const start=()=>run(async()=>{
  if(!invoice||!contract)throw Error('Please upload both your invoice PDF and the contract before starting the review.');
  await call('review_documents',{invoice_asset_id:invoice.id,contract_asset_id:contract.id,request_id:request.current});
  await refresh();
 });
 const titles:Record<string,string>={queued:'Waiting for document review',reviewing:'Reviewing your documents',matched:'Document details match',needs_attention:'Suggested corrections',unavailable:'Review could not finish'};
 return <section className="ih-card" aria-labelledby="document-comparison-title">
  <h2 id="document-comparison-title">Review my existing invoice &amp; contract</h2>
  <p className="ih-muted">Already have your paperwork? Upload both documents. We compare them directly—you do not need to recreate the invoice in BorderPay.</p>
  <p className="ih-muted">For verified businesses with active receiving accounts. This optional check does not block your payments or change your documents.</p>
  {error&&<p role="alert" className="ih-error">{error}</p>}
  <div className="ih-grid">
   <label className="ih-upload">Your invoice PDF<input type="file" disabled={!enabled||busy} accept="application/pdf" onChange={e=>{const f=e.target.files?.[0];if(f)void run(()=>upload(f,'merchant_invoice'));e.target.value='';}}/>{invoice&&<span className="ih-muted">{invoice.name}</span>}</label>
   <label className="ih-upload">Your contract or statement of work<input type="file" disabled={!enabled||busy} accept="application/pdf,image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)void run(()=>upload(f,'executed_contract'));e.target.value='';}}/>{contract&&<span className="ih-muted">{contract.name}</span>}</label>
  </div>
  <p className="ih-muted">Up to 20 MB per file. Include all relevant pages, amounts, currency and execution details.</p>
  <button type="button" className="ih-primary" disabled={!enabled||busy} onClick={start}>{busy?'Please wait…':'Compare my documents'}</button>
  <div aria-live="polite">
   {checks.map(row=><article key={row.id} className="ih-review" style={{marginTop:24,overflowWrap:'anywhere'}}>
    <h3>{titles[row.status]||'Document review'}</h3>
    <p className="ih-muted">{new Date(row.created_at).toLocaleString()}</p>
    {['queued','reviewing'].includes(row.status)&&<p className="ih-muted">You can leave this screen and return later. The review continues in the background.</p>}
    {row.result?.fields&&<div className="ih-grid">{(['invoice','contract'] as const).map(kind=><div key={kind}><h4>{kind==='invoice'?'Invoice':'Contract'}</h4><p className="ih-muted">{row.result.fields[kind].seller.value||'Seller unreadable'} → {row.result.fields[kind].buyer.value||'Buyer unreadable'}<br/>{row.result.fields[kind].currency.value||'Currency unclear'} {row.result.fields[kind].total.value||'Amount unclear'}</p></div>)}</div>}
    {(row.result?.findings||[]).length>0&&<ul>{row.result.findings.map((f:any,i:number)=><li key={i} style={{marginTop:12}}>{f.explanation}</li>)}</ul>}
    {['matched','needs_attention','unavailable'].includes(row.status)&&<p className="ih-muted">This is an automated document comparison, not certification of authenticity, signer identity or bank acceptance. Correct your source files and upload a new pair for another review.</p>}
   </article>)}
  </div>
 </section>;
}
