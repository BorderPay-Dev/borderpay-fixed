import React,{useEffect,useRef,useState} from 'react';
import {Browser} from '@capacitor/browser';
import {Capacitor} from '@capacitor/core';
import {FileText,Plus,Trash2,LockKeyhole,Download,RefreshCw,CheckCircle2} from 'lucide-react';
import {backendAPI} from '../../utils/api/backendAPI';
import {useThemeClasses} from '../../utils/i18n/ThemeLanguageContext';
import {FloatingBackButton} from '../common/FloatingBackButton';
import './InvoiceHub.css';

const empty=()=>({currency:'USD',receiving_account_id:'',buyer:{legal_name:'',type:'company',address:'',country:'',tax_id:''},
 remitter:{legal_name:'',type:'company',relationship:''},category:'digital_services',order_source:'direct_b2b',order_platform:'',order_reference:'',tracking_numbers:[],
 items:[{description:'',quantity:1,unit_amount_minor:0,deliverable_reference:''}],source_of_funds:'',fund_utilization:'',discovery_channel:'',cross_border_justification:'',commercial_end_use:'',
 contract_path:'generated',agreement_version:'',signature_consent:false,document_ids:[],instalments:{expected_count:1,commercial_reason:''}});
const labels:Record<string,string>={executed_contract:'Signed contract / statement of work',purchase_order:'Purchase order',buyer_business_proof:'Buyer registration / tax proof',end_use_declaration:'Commercial end-use declaration',logistics:'Logistics / bill of lading',source_of_funds:'Source of funds',order_dashboard:'Store or CRM dashboard screenshot',platform_order_export:'Official order export PDF',warehouse_receipt:'Warehouse / fulfillment receipt',dispatch_log:'Dispatch log / packing slip'};
const reasonText:Record<string,string>={
 receiving_account_invalid:'Select an active receiving account matching the invoice currency.',gbp_b2b_only:'GBP requires a corporate buyer and corporate sender.',
 buyer_details_missing:'Complete the buyer’s legal name, billing address, country and tax ID.',remitter_mismatch:'The sender differs from the buyer. Attach an executed agreement explaining the relationship.',
 vague_description:'Describe each deliverable in detail and include an order or delivery reference.',source_of_funds_missing:'Explain where the buyer’s payment funds come from.',fund_utilization_missing:'Explain how your business will use this payment.',
 cross_border_context_missing:'Explain how the buyer found you and why they are buying internationally.',logistics_missing:'Attach logistics or physical possession evidence.',
 contract_entity_mismatch:'The contract’s buyer or seller does not match the invoice.',contract_value_mismatch:'The contract amount or currency differs from the invoice.',
 contract_signatures_missing:'The custom contract must include both parties’ signatures.',contract_scope_missing:'The contract must explain the commercial scope.',
 contract_execution_unverified:'Compliance must verify the contract’s execution.',order_mismatch:'The order proof does not match the invoice buyer, items, currency or total.',
 order_context_missing:'Include order history, checkout time, payment and fulfillment status, and available IP/device context.',fulfillment_proof_missing:'Attach verified warehouse/dispatch evidence or logistics tracking.',
 evidence_unverified:'Your uploaded evidence needs review.',order_extraction_unavailable:'The order proof needs manual review.',contract_extraction_unavailable:'The contract needs manual review.',
 ai_unavailable:'Automated review is unavailable. Compliance review is required.',jurisdiction_policy_missing:'Compliance review is required before payment details are released.',
 policy_changed:'Review requirements changed. Save and submit a new invoice revision.',screening_unavailable:'Your invoice needs compliance review.',
};
function Field({label,value,onChange,multiline=false,type='text',required=false,help}:any){const id=React.useId();return <label className="ih-field" htmlFor={id}><span>{label}{required?' *':''}</span>{multiline?<textarea id={id} rows={3} value={value} onChange={e=>onChange(e.target.value)} required={required}/>:<input id={id} type={type} value={value} onChange={e=>onChange(e.target.value)} required={required}/>} {help&&<small>{help}</small>}</label>}
function Select({label,value,onChange,options}:any){const id=React.useId();return <label className="ih-field" htmlFor={id}><span>{label}</span><select id={id} value={value} onChange={e=>onChange(e.target.value)}>{options.map((o:any)=><option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></label>}
function Amount({value,onChange}:any){const [text,setText]=useState((value/100).toFixed(2));useEffect(()=>setText((value/100).toFixed(2)),[value]);return <Field label="Unit price" value={text} onChange={(v:string)=>{setText(v);if(/^\d+(\.\d{0,2})?$/.test(v)){const [a,b='']=v.split('.');const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));if(n<=BigInt(Number.MAX_SAFE_INTEGER))onChange(Number(n));}}}/>;}
function SignaturePad({onSave,busy}:any){const canvas=useRef<HTMLCanvasElement>(null),drawing=useRef(false);const [dirty,setDirty]=useState(false);
 const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{const r=e.currentTarget.getBoundingClientRect();return [(e.clientX-r.left)*600/r.width,(e.clientY-r.top)*180/r.height];};
 return <div><p className="ih-muted">Draw your signature using your finger, stylus or mouse.</p><canvas ref={canvas} width={600} height={180} className="ih-signature" aria-label="Draw merchant signature"
 onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drawing.current=true;const c=e.currentTarget.getContext('2d')!;c.strokeStyle='#101518';c.lineWidth=2;c.lineCap='round';c.beginPath();const [x,y]=point(e);c.moveTo(x,y);}}
 onPointerMove={e=>{if(!drawing.current)return;const [x,y]=point(e);const c=e.currentTarget.getContext('2d')!;c.lineTo(x,y);c.stroke();setDirty(true);}}
 onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}}/>
 <div className="ih-actions"><button type="button" onClick={()=>{canvas.current?.getContext('2d')?.clearRect(0,0,600,180);setDirty(false);}}>Clear</button>
 <button type="button" disabled={!dirty||busy} onClick={()=>canvas.current?.toBlob(b=>b&&onSave(new File([b],'signature.png',{type:'image/png'})),'image/png')}>Save signature</button></div></div>;
}
export default function InvoiceHub({onBack}:{onBack:()=>void}){
 const tc=useThemeClasses();const [data,setData]=useState<any>(null),[form,setForm]=useState<any>(empty),[draft,setDraft]=useState<any>(null);
 const [number,setNumber]=useState(''),[tab,setTab]=useState('invoice'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState<any>(null),[brand,setBrand]=useState<any>({signer_name:'',logo_asset_id:null,signature_asset_id:null});
 const lock=useRef(false),live=useRef(true);
 const call=async(action:string,payload:any={})=>{const r:any=await backendAPI.predeposit.request(action,payload);if(!r.success)throw Error(r.error||'Unable to complete this request');return r.data;};
 const refresh=async()=>{const d=await call('bootstrap');if(live.current){setData(d);if(d.branding)setBrand(d.branding);}return d;};
 useEffect(()=>{live.current=true;refresh().catch(e=>setError(e.message));return()=>{live.current=false;};},[]);
 const run=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){if(live.current)setError(e instanceof Error?e.message:'Please try again');}finally{lock.current=false;if(live.current)setBusy(false);}};
 useEffect(()=>{if(!selected||!['queued','screening'].includes(selected.status))return;let cancel=false;const t=setTimeout(()=>call('get_invoice',{invoice_id:selected.id}).then(d=>{if(!cancel)setSelected(d);}).catch(e=>{if(!cancel)setError(e.message);}),5000);return()=>{cancel=true;clearTimeout(t);};},[selected]);
 const set=(key:string,value:any)=>setForm((f:any)=>({...f,[key]:value}));
 const nested=(key:string,field:string,value:any)=>setForm((f:any)=>({...f,[key]:{...f[key],[field]:value}}));
 const save=async()=>{const d=await call('save_draft',{id:draft?.id,version:draft?.version,invoice_number:number,payload:form});setDraft(d);return d;};
 const upload=async(file:File,kind:string)=>{const r:any=await backendAPI.predeposit.upload(file,kind);if(!r.success)throw Error(r.error||'Upload failed');const a=r.data;
  if(['logo','signature'].includes(kind)){setBrand((b:any)=>({...b,[kind+'_asset_id']:a.id}));setNotice('Upload saved. Save branding to apply it.');}
  else{setForm((f:any)=>({...f,document_ids:[...f.document_ids,a.id]}));setNotice('Evidence uploaded. Save and generate to submit it for review.');}
  const d=await call('bootstrap');setData(d);return a;};
 const download=async()=>{const result=await call('download',{invoice_id:selected.id});const u=new URL(result.url);if(u.protocol!=='https:')throw Error('Invalid secure download');
  if(Capacitor.isNativePlatform())await Browser.open({url:u.toString(),presentationStyle:'fullscreen'});else{const a=document.createElement('a');a.href=u.toString();a.rel='noopener';a.target='_blank';a.click();}
 };
 const types=[['company','Company'],['sole_proprietor','Sole proprietor'],['individual','Individual'],['government','Government / public body']];
 const updateItem=(index:number,key:string,value:any)=>setForm((f:any)=>({...f,items:f.items.map((i:any,n:number)=>n===index?{...i,[key]:value}:i)}));
 const total=form.items.reduce((a:number,i:any)=>a+i.quantity*i.unit_amount_minor,0);
 return <main className={'invoice-hub '+tc.bg+' '+tc.text} data-light={tc.isLight}><FloatingBackButton onBack={onBack}/>
 <header className="ih-header"><p className="ih-eyebrow">BUSINESS TOOLS</p><h1>Invoice & Agreement Hub</h1><p className="ih-muted">Prepare your invoice and evidence, then share approved payment instructions.</p></header>
 {error&&<div role="alert" className="ih-error">{error}<button type="button" onClick={()=>run(async()=>{await refresh();})}>Retry</button></div>}
 {notice&&<p role="status" className="ih-notice">{notice}</p>}
 {!data?<p role="status">Loading your invoicing workspace…</p>:!data.enabled?<section className="ih-card"><h2>Invoicing is being prepared</h2><p>We will make this workspace available when the review service is ready.</p></section>:<>
 <nav className="ih-tabs" aria-label="Invoicing modules">{[['invoice','Invoice builder'],['contract','B2B agreement'],['branding','Branding & signature']].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
 <fieldset disabled={busy} className="ih-workspace">
 {tab==='branding'?<section className="ih-card"><h2>Company branding & signature</h2><p className="ih-muted">Your verified company name appears on every document. A saved signature is applied only when you authorize that invoice.</p>
 <Field label="Authorized signer's name" value={brand.signer_name} onChange={(v:string)=>setBrand({...brand,signer_name:v})}/>
 <label className="ih-upload">Company logo · PNG or JPEG<input type="file" accept="image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)run(async()=>{await upload(f,'logo');});e.target.value='';}}/></label>{brand.logo_asset_id&&<p className="ih-muted">Logo uploaded</p>}
 <SignaturePad busy={busy} onSave={(f:File)=>run(async()=>{await upload(f,'signature');})}/>{brand.signature_asset_id&&<p className="ih-muted">Signature uploaded</p>}
 <label className="ih-upload">Or upload your signature image<input type="file" accept="image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)run(async()=>{await upload(f,'signature');});e.target.value='';}}/></label>
 <button className="ih-primary" type="button" onClick={()=>run(async()=>{await call('save_branding',brand);setNotice('Branding and signature saved.');})}>Save branding</button></section>:<>
 {tab==='invoice'&&<><section className="ih-card"><div className="ih-section-heading"><h2>Invoice details</h2><button type="button" onClick={()=>{setDraft(null);setNumber('');setForm(empty());setSelected(null);}}>New invoice</button></div>
 {data.drafts.length>0&&<Select label="Continue a saved draft" value={draft?.id||''} onChange={(v:string)=>{const d=data.drafts.find((x:any)=>x.id===v);if(d){setDraft(d);setNumber(d.invoice_number);setForm(d.payload);setSelected(null);}}} options={[['','Select draft'],...data.drafts.map((d:any)=>[d.id,d.invoice_number])]}/>}
 <div className="ih-grid"><Field label="Invoice reference" value={number} onChange={setNumber} required/><Select label="Receiving account" value={form.receiving_account_id} onChange={(id:string)=>{const a=data.accounts.find((a:any)=>a.id===id);setForm({...form,receiving_account_id:id,currency:a?.currency||form.currency});}} options={[['','Choose USD, EUR or GBP'],...data.accounts.map((a:any)=>[a.id,a.label])]}/></div>
 {data.account_warning&&<p className="ih-notice">{data.account_warning}</p>}<p className="ih-muted"><LockKeyhole size={14}/> Bank details remain locked until this invoice is approved.</p>{form.currency==='GBP'&&<p className="ih-notice">GBP is strictly B2B. The payment must come from the named corporate buyer.</p>}
 </section><section className="ih-card"><h2>Buyer & expected sender</h2><div className="ih-grid">
 <Field label="Buyer's legal name" value={form.buyer.legal_name} onChange={(v:string)=>nested('buyer','legal_name',v)} required/>
 <Select label="Buyer type" value={form.buyer.type} onChange={(v:string)=>nested('buyer','type',v)} options={types}/>
 <Field label="Billing address" value={form.buyer.address} onChange={(v:string)=>nested('buyer','address',v)} required/>
 <Field label="Buyer country (2-letter code)" value={form.buyer.country} onChange={(v:string)=>nested('buyer','country',v.toUpperCase().slice(0,2))} help="For example GB, FR or US" required/>
 <Field label="Tax / VAT / registration ID" value={form.buyer.tax_id} onChange={(v:string)=>nested('buyer','tax_id',v)} required/>
 <Field label="Bank sender's legal name" value={form.remitter.legal_name} onChange={(v:string)=>nested('remitter','legal_name',v)} required/>
 <Select label="Sender type" value={form.remitter.type} onChange={(v:string)=>nested('remitter','type',v)} options={types}/><Field label="Commercial relationship" value={form.remitter.relationship} onChange={(v:string)=>nested('remitter','relationship',v)} required/>
 </div><button type="button" onClick={()=>set('remitter',{...form.remitter,legal_name:form.buyer.legal_name,type:form.buyer.type})}>Use buyer as sender</button></section>
 <section className="ih-card"><h2>Itemized billing</h2><Select label="What are you supplying?" value={form.category} onChange={(v:string)=>set('category',v)} options={[['digital_services','Digital / SaaS / services'],['physical_goods','Physical goods / wholesale']]}/>
 {form.items.map((i:any,n:number)=><div className="ih-item" key={n}><div className="ih-section-heading"><h3>Item {n+1}</h3>{form.items.length>1&&<button type="button" aria-label={'Remove item '+(n+1)} onClick={()=>set('items',form.items.filter((_:any,k:number)=>k!==n))}><Trash2 size={18}/></button>}</div>
 <Field label="Detailed commercial description" multiline value={i.description} onChange={(v:string)=>updateItem(n,'description',v)} help="Include the deliverable, service period or product specification. Avoid descriptions such as Services or Consulting."/>
 <div className="ih-grid"><Field label="Delivery / item reference" value={i.deliverable_reference} onChange={(v:string)=>updateItem(n,'deliverable_reference',v)}/><Field label="Quantity" type="number" value={i.quantity} onChange={(v:string)=>updateItem(n,'quantity',Number(v))}/><Amount value={i.unit_amount_minor} onChange={(v:number)=>updateItem(n,'unit_amount_minor',v)}/></div></div>)}
 <button type="button" onClick={()=>set('items',[...form.items,{description:'',quantity:1,unit_amount_minor:0,deliverable_reference:''}])}><Plus size={18}/> Add item</button>
 <p className="ih-total">Invoice total <strong>{Number.isSafeInteger(total)?(total/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'Check amounts'} {form.currency}</strong></p>
 </section><section className="ih-card"><h2>Commercial context</h2><Field label="Source of the buyer's funds" multiline value={form.source_of_funds} onChange={(v:string)=>set('source_of_funds',v)}/><Field label="How your business will use these funds" multiline value={form.fund_utilization} onChange={(v:string)=>set('fund_utilization',v)}/>
 {(form.buyer.country!==data.merchant?.incorporation_country)&&<><Field label="How did the buyer find your business?" multiline value={form.discovery_channel} onChange={(v:string)=>set('discovery_channel',v)}/><Field label="Why is the buyer sourcing internationally?" multiline value={form.cross_border_justification} onChange={(v:string)=>set('cross_border_justification',v)}/></>}
 {form.buyer.type!=='company'&&<Field label="Commercial end use: resale, manufacturing or internal use" multiline value={form.commercial_end_use} onChange={(v:string)=>set('commercial_end_use',v)}/>}
 <Field label="Expected number of payments" type="number" value={form.instalments.expected_count} onChange={(v:string)=>nested('instalments','expected_count',Number(v))}/>
 {form.instalments.expected_count>1&&<Field label="Commercial reason for installments" multiline value={form.instalments.commercial_reason} onChange={(v:string)=>nested('instalments','commercial_reason',v)}/>}
 </section><section className="ih-card"><h2>Order evidence</h2><Select label="Order source" value={form.order_source} onChange={(v:string)=>set('order_source',v)} options={[['direct_b2b','Direct B2B contract'],['ecommerce','E-commerce / online store'],['crm','CRM invoice']]}/>
 {form.order_source!=='direct_b2b'&&<><div className="ih-grid"><Field label="Platform / store name" value={form.order_platform} onChange={(v:string)=>set('order_platform',v)}/><Field label="Order reference" value={form.order_reference} onChange={(v:string)=>set('order_reference',v)}/></div><p className="ih-muted">Upload a dashboard screenshot or official export with the buyer, items, total, currency, order history, checkout time, payment and fulfillment status, and IP/device context.</p></>}
 {form.category==='physical_goods'&&<><p className="ih-notice">Physical goods require logistics or possession proof and warehouse/dispatch evidence or verified tracking.</p><Field label="Carrier tracking numbers (one per line)" multiline value={form.tracking_numbers.join('\n')} onChange={(v:string)=>set('tracking_numbers',v.split('\n').map(s=>s.trim()).filter(Boolean))}/></>}
 <div className="ih-grid">{Object.entries(labels).map(([kind,label])=><label key={kind} className="ih-upload">{label}<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)run(async()=>{await upload(f,kind);});e.target.value='';}}/></label>)}</div>
 <p className="ih-muted">PDF, PNG or JPEG · up to 20 MB per file. Attach only evidence needed for this invoice.</p>
 {data.assets.filter((a:any)=>!['logo','signature','signed_agreement'].includes(a.kind)).map((a:any)=><label className="ih-check" key={a.id}><input type="checkbox" checked={form.document_ids.includes(a.id)} onChange={e=>set('document_ids',e.target.checked?[...form.document_ids,a.id]:form.document_ids.filter((id:string)=>id!==a.id))}/>{labels[a.kind]||a.kind} · {new Date(a.created_at).toLocaleDateString()} · {a.id.slice(0,8)}</label>)}
 </section></>}
 {tab==='contract'&&<section className="ih-card"><h2>Commercial agreement</h2><Select label="Contract workflow" value={form.contract_path} onChange={(v:string)=>set('contract_path',v)} options={[['generated','Generate a B2B agreement'],['custom','Use my signed contract / SOW']]}/>
 {form.contract_path==='generated'?<><Select label="Approved agreement template" value={form.agreement_version} onChange={(v:string)=>set('agreement_version',v)} options={[['','Select a template'],...data.templates.map((t:any)=>[t.version,t.title+' · '+t.version])]}/>
 <pre className="ih-terms">{data.templates.find((t:any)=>t.version===form.agreement_version)?.body||'Select a template to review its terms. Buyer, seller, invoice amount and currency will be filled from your invoice.'}</pre>
 <label className="ih-check"><input type="checkbox" checked={form.signature_consent} onChange={e=>set('signature_consent',e.target.checked)}/>I have read these terms and authorize my saved signature for this invoice’s agreement.</label>
 {!brand.signature_asset_id&&<button type="button" onClick={()=>setTab('branding')}>Set up signature</button>}</>:<><p>Upload the executed contract or statement of work under Order evidence. Its parties, currency, financial value, scope and signatures will be checked against this invoice.</p><button type="button" onClick={()=>setTab('invoice')}>Attach contract</button></>}
 </section>}
 <div className="ih-actions ih-sticky"><button type="button" onClick={()=>run(async()=>{await save();await refresh();setNotice('Draft saved.');})}>Save draft</button>
 <button className="ih-primary" type="button" onClick={()=>run(async()=>{const d=await save();const invoice=await call('submit',{draft_id:d.id,version:d.version});setSelected(invoice);await refresh();setNotice('Invoice submitted for review.');})}><FileText size={18}/>{busy?'Please wait…':'Generate invoice'}</button></div>
 </>}
 </fieldset>
 <section className="ih-card"><div className="ih-section-heading"><h2>Your invoices</h2><button type="button" disabled={busy} onClick={()=>run(async()=>{await refresh();})} aria-label="Refresh invoices"><RefreshCw size={18}/></button></div>
 {data.invoices.length===0?<p className="ih-muted">Your submitted invoices will appear here.</p>:data.invoices.map((i:any)=><button className="ih-invoice-row" key={i.id} type="button" disabled={busy} onClick={()=>run(async()=>setSelected(await call('get_invoice',{invoice_id:i.id})))}><span>{i.invoice_number}<small>Revision {i.revision} · {i.currency}</small></span><span>{i.status.replaceAll('_',' ')}</span></button>)}
 {selected&&<div className="ih-review" aria-live="polite"><h3>{selected.invoice_number||number} · {selected.status.replaceAll('_',' ')}</h3>
 {['queued','screening'].includes(selected.status)&&<p>Review is processing. You can leave this screen and return later.</p>}
 {(selected.reasons||[]).length>0&&<ul>{selected.reasons.map((r:string)=><li key={r}>{reasonText[r]||r.replaceAll('_',' ')}</li>)}</ul>}
 {(selected.findings||[]).map((f:any,n:number)=><p key={n}>{f.explanation}</p>)}
 {selected.status==='approved'?<><p><CheckCircle2 size={18}/> Approved for this invoice revision.</p><button type="button" className="ih-primary" disabled={busy} onClick={()=>run(download)}><Download size={18}/> Download invoice & payment details</button></>:<p className="ih-muted"><LockKeyhole size={16}/> Payment details are locked. Correct the draft and submit a new revision when requested.</p>}
 </div>}</section></>}
 </main>;
}
