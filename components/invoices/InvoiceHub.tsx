import {agreementType, isConsumerSale, agreementSaleError, isPlatformOrder, AGREEMENT_LABELS} from '../../supabase/functions/_shared/predeposit-agreement';
import React,{useEffect,useRef,useState} from 'react';
import {Browser} from '@capacitor/browser';
import {Capacitor} from '@capacitor/core';
import {FileText,Plus,Trash2,LockKeyhole,Download,RefreshCw,CheckCircle2} from 'lucide-react';
import {backendAPI} from '../../utils/api/backendAPI';
import {useThemeClasses} from '../../utils/i18n/ThemeLanguageContext';
import {FloatingBackButton} from '../common/FloatingBackButton';
import './InvoiceHub.css';
import DocumentComparison from './DocumentComparison';

const empty=()=>({agreement_type:'b2b',consumer_terms:{delivery:'',cancellations_returns:'',support_contact:'',additional_charges:''},currency:'USD',receiving_account_id:'',buyer:{legal_name:'',type:'company',address:'',country:'',tax_id:''},
 remitter:{legal_name:'',type:'company',relationship:''},category:'digital_services',order_source:'direct_b2b',order_platform:'',order_reference:'',tracking_numbers:[],
 items:[{description:'',quantity:1,unit_amount_minor:0,deliverable_reference:''}],source_of_funds:'',fund_utilization:'',discovery_channel:'',cross_border_justification:'',commercial_end_use:'',
 contract_path:'generated',agreement_version:'',signature_consent:false,document_ids:[],instalments:{expected_count:1,commercial_reason:''}});
const labels:Record<string,string>={executed_contract:'Signed contract / statement of work',purchase_order:'Purchase order',buyer_business_proof:'Buyer registration / tax proof',end_use_declaration:'Commercial end-use declaration',logistics:'Logistics / bill of lading',source_of_funds:'Source of funds',order_dashboard:'Store or CRM dashboard screenshot',platform_order_export:'Official order export PDF',warehouse_receipt:'Warehouse / fulfillment receipt',dispatch_log:'Dispatch log / packing slip'};
const reasonText:Record<string,string>={
 receiving_account_invalid:'Select an active receiving account matching the invoice currency.',gbp_b2b_only:'GBP requires a corporate buyer and corporate sender.',
 agreement_type_mismatch:'Select an individual consumer for D2C or B2C, or use B2B for a business buyer.',consumer_terms_missing:'Complete delivery, cancellation / returns, support contact and additional charges in Agreement.',
 buyer_details_missing:'Complete the buyer’s name, billing address and country, plus tax ID for a business buyer.',remitter_mismatch:'The sender differs from the buyer. Attach an executed agreement explaining the relationship.',
 vague_description:'Describe each deliverable in detail and include an order or delivery reference.',source_of_funds_missing:'Explain where the buyer’s payment funds come from.',fund_utilization_missing:'Explain how your business will use this payment.',
 cross_border_context_missing:'Explain how the buyer found you and why they are buying internationally.',logistics_missing:'Attach logistics or physical possession evidence.',
 contract_entity_mismatch:'The contract’s buyer or seller does not match the invoice.',contract_value_mismatch:'The contract amount or currency differs from the invoice.',
 contract_signatures_missing:'The custom contract must include both parties’ signatures.',contract_scope_missing:'The contract must explain the commercial scope.',
 contract_execution_unverified:'Compliance must verify the contract’s execution.',order_mismatch:'The order proof does not match the invoice buyer, items, currency or total.',
 order_context_missing:'Include order history, checkout time, payment and fulfillment status, and available IP/device context.',fulfillment_proof_missing:'Attach verified warehouse/dispatch evidence or logistics tracking.',
 evidence_unverified:'Your uploaded evidence needs review.',order_extraction_unavailable:'The order proof needs manual review.',contract_extraction_unavailable:'The contract needs manual review.',
 ai_unavailable:'Automated review is unavailable. Compliance review is required.',jurisdiction_policy_missing:'Compliance review is required before payment details are released.',
 manual_review_required:'Your invoice is available to download. Compliance will review the supporting evidence.',
 policy_changed:'Review requirements changed. Save and submit a new invoice revision.',screening_unavailable:'Your invoice needs compliance review.',
};
const initialWorkspace=()=>({enabled:null as boolean|null,payment_review_required:null,accounts:[],templates:[],drafts:[],invoices:[],assets:[],merchant:null,account_warning:''});
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
 const tc=useThemeClasses();const [data,setData]=useState<any>(initialWorkspace),[form,setForm]=useState<any>(empty),[draft,setDraft]=useState<any>(null);
 const [number,setNumber]=useState(''),[tab,setTab]=useState('invoice'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState<any>(null),[brand,setBrand]=useState<any>({signer_name:'',logo_asset_id:null,signature_asset_id:null});
 const errorBox=useRef<HTMLDivElement>(null);
 const lock=useRef(false),live=useRef(true),loadGeneration=useRef(0),accountGeneration=useRef(0),accountsVerified=useRef(false),brandEdits=useRef(new Set<string>());
 const [accountsRefreshing,setAccountsRefreshing]=useState(false);
 const call=async(action:string,payload:any={})=>{const r:any=await backendAPI.predeposit.request(action,payload);if(!r.success)throw Error(r.error||'Unable to complete this request');return r.data;};
 const refreshAccounts=async()=>{
  const request=++accountGeneration.current;setAccountsRefreshing(true);
  try{const d=await call('accounts');if(!live.current||request!==accountGeneration.current)return;
   if(d.accounts_verified===true){accountsVerified.current=true;setData((p:any)=>({...p,accounts:d.accounts,account_warning:''}));}
   else setData((p:any)=>({...p,account_warning:d.account_warning}));
  }catch{if(live.current&&request===accountGeneration.current)setData((p:any)=>({...p,account_warning:'Account availability could not be refreshed. You can continue preparing your invoice.'}));}
  finally{if(live.current&&request===accountGeneration.current)setAccountsRefreshing(false);}
 };
 const refresh=async(checkAccounts=false)=>{
  const request=++loadGeneration.current,d=await call('bootstrap');
  if(live.current&&request===loadGeneration.current){
   setData((p:any)=>({...initialWorkspace(),...d,accounts:accountsVerified.current?p.accounts:(d.accounts||[])}));
   if(d.branding)setBrand((p:any)=>({...p,...Object.fromEntries(Object.entries(d.branding).filter(([key])=>!brandEdits.current.has(key)))}));
   if(checkAccounts&&d.enabled===true)void refreshAccounts();
  }return d;
 };
 useEffect(()=>{let active=true;live.current=true;refresh(true).catch(e=>{if(active)setError(e.message);});return()=>{active=false;live.current=false;loadGeneration.current++;accountGeneration.current++;};},[]);
 const run=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){if(live.current)setError(e instanceof Error?e.message:'Please try again');}finally{lock.current=false;if(live.current)setBusy(false);}};
 useEffect(()=>{if(!selected||!['queued','screening'].includes(selected.status))return;let cancel=false;const t=setTimeout(()=>call('get_invoice',{invoice_id:selected.id}).then(d=>{if(!cancel)setSelected(d);}).catch(e=>{if(!cancel)setError(e.message);}),5000);return()=>{cancel=true;clearTimeout(t);};},[selected]);
 useEffect(()=>{if(error){errorBox.current?.focus();errorBox.current?.scrollIntoView({block:'center',behavior:'smooth'});}},[error]);
 const saleType=agreementType(form.agreement_type),consumer=isConsumerSale(saleType);
 const matchingTemplates=data.templates.filter((t:any)=>agreementType(t.agreement_type)===saleType);
 const selectedTemplate=matchingTemplates.find((t:any)=>t.version===form.agreement_version);
 const changeAgreementType=(value:string)=>setForm((f:any)=>({...f,agreement_type:value,agreement_version:'',signature_consent:false,
  consumer_terms:f.consumer_terms||{delivery:'',cancellations_returns:'',support_contact:'',additional_charges:''},
  buyer:{...f.buyer,type:value==='b2b'?'company':'individual'},remitter:{...f.remitter,type:value==='b2b'?'company':'individual'},
  order_source:isPlatformOrder(f.order_source)?f.order_source:value==='b2b'?'direct_b2b':'direct_consumer'}));
 const validateInvoice=(review=false)=>{
  const missing:string[]=[];
  const need=(ok:boolean,label:string)=>{if(!ok)missing.push(label);};
  const enough=(value:unknown,n:number)=>String(value||'').trim().length>=n;
  need(/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,79}$/.test(number.trim()),'invoice reference (up to 80 characters)');
  need(enough(form.buyer.legal_name,review?2:1),"buyer’s legal name");
  need(enough(form.buyer.address,review?8:1),'buyer’s billing address');
  need(/^[A-Z]{2}$/.test(form.buyer.country),'buyer’s country (2-letter code)');
  need(form.items.length>0,'at least one invoice item');
  form.items.forEach((item:any,i:number)=>{
   need(enough(item.description,review?30:1),'item '+(i+1)+' description'+(review?' (at least 30 characters)':''));
   need(Number.isSafeInteger(item.quantity)&&item.quantity>0&&item.quantity<=1000000,'item '+(i+1)+' quantity (positive whole number)');
   need(Number.isSafeInteger(item.unit_amount_minor)&&item.unit_amount_minor>0,'item '+(i+1)+' unit price (greater than zero)');
   if(review)need(enough(item.deliverable_reference,3),'item '+(i+1)+' delivery / item reference');
  });
  const sum=form.items.reduce((n:number,i:any)=>n+i.quantity*i.unit_amount_minor,0);
  need(Number.isSafeInteger(sum)&&sum>0,'a valid invoice total');
  const saleError=agreementSaleError(form);if(saleError)missing.push(saleError);
  if(consumer&&form.contract_path==='generated'&&form.agreement_version){
   for(const [key,label] of [['delivery','delivery arrangements'],['cancellations_returns','cancellation and return terms'],['support_contact','customer support contact'],['additional_charges','additional charges (enter None when applicable)']])need(enough(form.consumer_terms?.[key],3),label);
  }
  if(review){
   need(!!form.receiving_account_id,'receiving account for document review');
   if(!consumer)need(enough(form.buyer.tax_id,2),'buyer’s tax / registration ID');
   need(enough(form.remitter.legal_name,2),'bank sender’s legal name');
   need(enough(form.remitter.relationship,12),'commercial relationship (at least 12 characters)');
   need(enough(form.source_of_funds,30),'source of funds (at least 30 characters)');
   need(enough(form.fund_utilization,30),'use of funds (at least 30 characters)');
   if(form.buyer.country!==data.merchant?.incorporation_country){
    need(enough(form.discovery_channel,15),'how the buyer found you (at least 15 characters)');
    need(enough(form.cross_border_justification,40),'international sourcing reason (at least 40 characters)');
   }
   const kinds=new Set(data.assets.filter((a:any)=>form.document_ids.includes(a.id)).map((a:any)=>a.kind));
   if(form.contract_path==='custom')need(kinds.has('executed_contract'),'signed contract / statement of work');
   else{
    need(matchingTemplates.some((a:any)=>a.version===form.agreement_version&&a.status==='approved'),'approved template in Agreement');
    need(!!data.branding?.signature_asset_id&&enough(data.branding?.signer_name,2),'saved signer name and signature in Branding & signature');
    need(form.signature_consent===true,'signature authorization in Agreement');
   }
   if(form.category==='physical_goods'){
    need(kinds.has('logistics'),'logistics / physical possession proof');
    need(kinds.has('warehouse_receipt')||kinds.has('dispatch_log')||form.tracking_numbers.length>0,'warehouse receipt, dispatch log or tracking number');
   }
   if(isPlatformOrder(form.order_source)){
    need(enough(form.order_platform,2)&&enough(form.order_reference,2),'platform name and order reference');
    need(kinds.has('order_dashboard')||kinds.has('platform_order_export'),'order screenshot or official platform export');
   }
   if(!consumer&&(['individual','sole_proprietor'].includes(form.buyer.type)||form.remitter.type==='individual')){
    need(kinds.has('buyer_business_proof'),'buyer’s business registration proof');
    need(kinds.has('end_use_declaration')&&enough(form.commercial_end_use,30),'commercial end-use declaration');
    need(kinds.has('executed_contract'),'executed contract for the individual commercial buyer');
   }
   need(Number.isInteger(form.instalments.expected_count)&&form.instalments.expected_count>=1&&form.instalments.expected_count<=100,'number of payments (1 to 100)');
  }
  if(missing.length)throw Error('Your form is incomplete. Please complete: '+missing.join('; ')+'. Then try again. You can download an invoice without submitting it for document review.');
 };
 const set=(key:string,value:any)=>setForm((f:any)=>({...f,[key]:value}));
 const nested=(key:string,field:string,value:any)=>setForm((f:any)=>({...f,[key]:{...f[key],[field]:value}}));
 const save=async()=>{const d=await call('save_draft',{id:draft?.id,version:draft?.version,invoice_number:number,payload:form});setDraft(d);return d;};
 const upload=async(file:File,kind:string)=>{const r:any=await backendAPI.predeposit.upload(file,kind);if(!r.success)throw Error(r.error||'Upload failed');const a=r.data;
  if(['logo','signature'].includes(kind)){brandEdits.current.add(kind+'_asset_id');setBrand((b:any)=>({...b,[kind+'_asset_id']:a.id}));setNotice('Upload saved. Save branding to apply it.');}
  else{setForm((f:any)=>({...f,document_ids:[...f.document_ids,a.id]}));setNotice('Evidence uploaded. Save and generate to submit it for review.');}
  await refresh();return a;};
 const download=async(action='download',payload:any={invoice_id:selected.id})=>{const result=await call(action,payload);if(result.notice)setNotice(result.notice);const u=new URL(result.url);if(u.protocol!=='https:')throw Error('Invalid secure download');
  if(Capacitor.isNativePlatform())await Browser.open({url:u.toString(),presentationStyle:'fullscreen'});else{const a=document.createElement('a');a.href=u.toString();a.rel='noopener';a.target='_blank';a.click();}
 };
 const types=[['company','Company'],['sole_proprietor','Sole proprietor'],['individual','Individual'],['government','Government / public body']];
 const updateItem=(index:number,key:string,value:any)=>setForm((f:any)=>({...f,items:f.items.map((i:any,n:number)=>n===index?{...i,[key]:value}:i)}));
 const requiredKinds=new Set<string>();
 if(form.contract_path==='custom'||(!consumer&&form.buyer.type!=='company')||form.remitter.legal_name!==form.buyer.legal_name)requiredKinds.add('executed_contract');
 if(form.category==='physical_goods'){requiredKinds.add('logistics');requiredKinds.add('warehouse_receipt');requiredKinds.add('dispatch_log');}
 if(isPlatformOrder(form.order_source)){requiredKinds.add('order_dashboard');requiredKinds.add('platform_order_export');}
 if(!consumer&&['individual','sole_proprietor'].includes(form.buyer.type)){requiredKinds.add('buyer_business_proof');requiredKinds.add('end_use_declaration');}
 const uploadSlot=([kind,label]:[string,string])=><label key={kind} className="ih-upload">{label}<input type="file" disabled={data.enabled!==true} accept="application/pdf,image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)run(async()=>{await upload(f,kind);});e.target.value='';}}/></label>;
 const total=form.items.reduce((a:number,i:any)=>a+i.quantity*i.unit_amount_minor,0);
 return <main className={'invoice-hub '+tc.bg+' '+tc.text} data-light={tc.isLight}><FloatingBackButton onBack={onBack}/>
 <header className="ih-header"><p className="ih-eyebrow">BUSINESS TOOLS</p><h1>Invoice & Agreement Hub</h1><p className="ih-muted">Create invoices and contracts whenever you need them. Keep supporting documents ready for bank requests.</p></header>
 {error&&<div ref={errorBox} tabIndex={-1} role="alert" className="ih-error">{error}<button type="button" onClick={()=>run(async()=>{await refresh(true);})}>Retry</button></div>}
 {notice&&<p role="status" className="ih-notice">{notice}</p>}
 {data.enabled===false?<section className="ih-card"><h2>Invoicing is being prepared</h2><p>We will make this workspace available when the review service is ready.</p></section>:<>
 <nav className="ih-tabs" aria-label="Invoicing modules">{[['invoice','Invoice builder'],['documents','Review my documents'],['contract','Agreement'],['branding','Branding & signature']].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
 <fieldset disabled={busy} className="ih-workspace">
 {tab==='documents'?<DocumentComparison enabled={data.enabled===true}/>:tab==='branding'?<section className="ih-card"><h2>Company branding & signature</h2><p className="ih-muted">Your verified company name appears on every document. A saved signature is applied only when you authorize that invoice.</p>
 <Field label="Authorized signer's name" value={brand.signer_name} onChange={(v:string)=>{brandEdits.current.add('signer_name');setBrand({...brand,signer_name:v});}}/>
 <label className="ih-upload">Company logo · PNG or JPEG<input type="file" accept="image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)run(async()=>{await upload(f,'logo');});e.target.value='';}}/></label>{brand.logo_asset_id&&<p className="ih-muted">Logo uploaded</p>}
 <SignaturePad busy={busy||data.enabled!==true} onSave={(f:File)=>run(async()=>{await upload(f,'signature');})}/>{brand.signature_asset_id&&<p className="ih-muted">Signature uploaded</p>}
 <label className="ih-upload">Or upload your signature image<input type="file" accept="image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)run(async()=>{await upload(f,'signature');});e.target.value='';}}/></label>
 <button className="ih-primary" type="button" disabled={data.enabled!==true} onClick={()=>run(async()=>{await call('save_branding',brand);setData((p:any)=>({...p,branding:{...brand}}));brandEdits.current.clear();setNotice('Branding and signature saved.');})}>Save branding</button></section>:<>
 {tab==='invoice'&&<><section className="ih-card"><div className="ih-section-heading"><h2>Invoice details</h2><button type="button" onClick={()=>{setDraft(null);setNumber('');setForm(empty());setSelected(null);}}>New invoice</button></div>
 {data.drafts.length>0&&<Select label="Continue a saved draft" value={draft?.id||''} onChange={(v:string)=>{const d=data.drafts.find((x:any)=>x.id===v);if(d){setDraft(d);setNumber(d.invoice_number);setForm(d.payload);setSelected(null);}}} options={[['','Select draft'],...data.drafts.map((d:any)=>[d.id,d.invoice_number])]}/>}
 <Select label="Agreement type" value={saleType} onChange={changeAgreementType} options={[['b2b','B2B — Business to business'],['d2c','D2C — Own brand to consumer'],['b2c','B2C — Business to consumer']]}/>
 <p className="ih-muted">{consumer?'For personal purchases by an individual. D2C is for direct sales of your own brand; B2C covers retail and service sales to consumers. The receiving account’s payer eligibility still applies.':'For business purchases by companies and other commercial buyers.'}</p>
 <Select label="Invoice currency" value={form.currency} onChange={(currency:string)=>setForm({...form,currency,receiving_account_id:''} )} options={[['USD','USD'],['EUR','EUR'],['GBP','GBP']]}/>
 <div className="ih-grid"><Field label="Invoice reference" value={number} onChange={setNumber} required/><Select label="Receiving account" value={form.receiving_account_id} onChange={(id:string)=>{const a=data.accounts.find((a:any)=>a.id===id);setForm({...form,receiving_account_id:id,currency:a?.currency||form.currency});}} options={[['','Choose USD, EUR or GBP'],...data.accounts.filter((a:any)=>a.currency===form.currency).map((a:any)=>[a.id,a.label])]}/></div>
 {accountsRefreshing&&<small role="status">Refreshing account availability… You can keep filling in your invoice.</small>}
 {data.account_warning&&<p className="ih-notice">{data.account_warning}</p>}<p className="ih-muted">{data.payment_review_required!==true?'Available active account details are included in the invoice. You can also create an invoice without bank details. Document checks are optional.':'Bank details remain locked until this invoice is approved.'}</p>{form.currency==='GBP'&&<p className="ih-notice">GBP is strictly B2B. The payment must come from the named corporate buyer.</p>}
 </section><section className="ih-card"><h2>Buyer & expected sender</h2><div className="ih-grid">
 <Field label="Buyer's legal name" value={form.buyer.legal_name} onChange={(v:string)=>nested('buyer','legal_name',v)} required/>
 <Select label="Buyer type" value={form.buyer.type} onChange={(v:string)=>nested('buyer','type',v)} options={types}/>
 <Field label="Billing address" value={form.buyer.address} onChange={(v:string)=>nested('buyer','address',v)} required/>
 <Field label="Buyer country (2-letter code)" value={form.buyer.country} onChange={(v:string)=>nested('buyer','country',v.toUpperCase().slice(0,2))} help="For example GB, FR or US" required/>
 {!consumer&&<Field label="Tax / VAT / registration ID" value={form.buyer.tax_id} onChange={(v:string)=>nested('buyer','tax_id',v)} required/>}
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
 </section><section className="ih-card"><h2>Order evidence</h2><Select label="Order source" value={form.order_source} onChange={(v:string)=>set('order_source',v)} options={[[consumer?'direct_consumer':'direct_b2b',consumer?'Direct consumer order':'Direct B2B contract'],['ecommerce','E-commerce / online store'],['crm','CRM invoice']]}/>
 {isPlatformOrder(form.order_source)&&<><div className="ih-grid"><Field label="Platform / store name" value={form.order_platform} onChange={(v:string)=>set('order_platform',v)}/><Field label="Order reference" value={form.order_reference} onChange={(v:string)=>set('order_reference',v)}/></div><p className="ih-muted">Upload a dashboard screenshot or official export with the buyer, items, total, currency, order history, checkout time, payment and fulfillment status, and IP/device context.</p></>}
 {form.category==='physical_goods'&&<><p className="ih-notice">Physical goods require logistics or possession proof and warehouse/dispatch evidence or verified tracking.</p><Field label="Carrier tracking numbers (one per line)" multiline value={form.tracking_numbers.join('\n')} onChange={(v:string)=>set('tracking_numbers',v.split('\n').map(s=>s.trim()).filter(Boolean))}/></>}
 <div className="ih-grid">{Object.entries(labels).filter(([k])=>requiredKinds.has(k)).map(uploadSlot)}</div>
 <details className="ih-more"><summary>Additional supporting documents</summary><div className="ih-grid">{Object.entries(labels).filter(([k])=>!requiredKinds.has(k)).map(uploadSlot)}</div></details>
 <p className="ih-muted">PDF, PNG or JPEG · up to 20 MB per file. Attach only evidence needed for this invoice.</p>
 {data.assets.filter((a:any)=>!['logo','signature','signed_agreement'].includes(a.kind)).map((a:any)=><label className="ih-check" key={a.id}><input type="checkbox" checked={form.document_ids.includes(a.id)} onChange={e=>set('document_ids',e.target.checked?[...form.document_ids,a.id]:form.document_ids.filter((id:string)=>id!==a.id))}/>{labels[a.kind]||a.kind} · {new Date(a.created_at).toLocaleDateString()} · {a.id.slice(0,8)}</label>)}
 </section></>}
 {tab==='contract'&&<section className="ih-card"><h2>{AGREEMENT_LABELS[saleType]}</h2><Select label="Contract workflow" value={form.contract_path} onChange={(v:string)=>set('contract_path',v)} options={[['generated','Generate a '+saleType.toUpperCase()+' agreement'],['custom','Use my signed contract / SOW']]}/>
 {form.contract_path==='generated'?<><Select label="Agreement template" value={form.agreement_version} onChange={(v:string)=>setForm((f:any)=>({...f,agreement_version:v,signature_consent:false}))} options={[['','Select a template'],...matchingTemplates.map((t:any)=>[t.version,t.title+(t.status==='draft'?' · Draft for review':'')+' · '+t.version])]}/>
 <pre className="ih-terms">{selectedTemplate?.body||'Select a template to review its terms. Buyer, seller, invoice amount and currency will be filled from your invoice.'}</pre>
 {consumer&&<div className="ih-grid">{[['delivery','Delivery / performance arrangements'],['cancellations_returns','Cancellation, withdrawal and returns'],['support_contact','Customer support contact'],['additional_charges','Taxes / delivery / additional charges']].map(([key,label])=><Field key={key} label={label} value={form.consumer_terms?.[key]||''} onChange={(v:string)=>nested('consumer_terms',key,v)} multiline required/>)}</div>}
 {selectedTemplate?.status==='draft'&&<p className="ih-notice">Draft for review. Download your invoice to include this unsigned agreement. Signature and document-review approval require an approved template version.</p>}
 <label className="ih-check"><input type="checkbox" disabled={selectedTemplate?.status!=='approved'} checked={form.signature_consent} onChange={e=>set('signature_consent',e.target.checked)}/>I have read these terms and authorize my saved signature for this invoice’s agreement.</label>
 {!brand.signature_asset_id&&<button type="button" onClick={()=>setTab('branding')}>Set up signature</button>}</>:<><p>Upload the executed contract or statement of work under Order evidence. Its parties, currency, financial value, scope and signatures will be checked against this invoice.</p><button type="button" onClick={()=>setTab('invoice')}>Attach contract</button></>}
 </section>}
 <fieldset disabled={data.enabled!==true} className="ih-actions ih-sticky" style={{border:0,padding:0,margin:0,minWidth:0}}><button type="button" onClick={()=>run(async()=>{await save();await refresh();setNotice('Draft saved.');})}>Save draft</button>
 <button type="button" onClick={()=>run(async()=>{validateInvoice();const d=await save();await download('download_invoice',{draft_id:d.id,version:d.version});await refresh();})}><Download size={18}/> Download invoice</button>
 <button className="ih-primary" type="button" onClick={()=>run(async()=>{validateInvoice(true);const d=await save();const invoice=await call('submit',{draft_id:d.id,version:d.version});setSelected(invoice);await refresh();setNotice('Documents submitted for checking. Your existing account access is unchanged.');})}><FileText size={18}/>{busy?'Please wait…':'Check invoice & documents'}</button></fieldset>
 </>}
 </fieldset>
 <section className="ih-card"><div className="ih-section-heading"><h2>Your invoices</h2><button type="button" disabled={busy} onClick={()=>run(async()=>{await refresh();})} aria-label="Refresh invoices"><RefreshCw size={18}/></button></div>
 {data.enabled===null?<p className="ih-muted">Syncing saved invoices…</p>:data.invoices.length===0?<p className="ih-muted">Your submitted invoices will appear here.</p>:data.invoices.map((i:any)=><button className="ih-invoice-row" key={i.id} type="button" disabled={busy} onClick={()=>run(async()=>setSelected(await call('get_invoice',{invoice_id:i.id})))}><span>{i.invoice_number}<small>Revision {i.revision} · {i.currency}</small></span><span>{i.status.replace(/_/g,' ')}</span></button>)}
 {selected&&<div className="ih-review" aria-live="polite"><h3>{selected.invoice_number||number} · {selected.status.replace(/_/g,' ')}</h3>
 {['queued','screening'].includes(selected.status)&&<p>Review is processing. You can leave this screen and return later.</p>}
 {selected.merchant_feedback&&<p>{selected.merchant_feedback}</p>}
 {(selected.reasons||[]).length>0&&<ul>{selected.reasons.map((r:string)=><li key={r}>{reasonText[r]||r.replace(/_/g,' ')}</li>)}</ul>}
 {(selected.findings||[]).map((f:any,n:number)=><p key={n}>{f.explanation}</p>)}
 <button type="button" disabled={busy} onClick={()=>run(()=>download('download_invoice'))}><Download size={18}/> Download invoice</button>
 {selected.status==='approved'?<><p><CheckCircle2 size={18}/> Approved for this invoice revision.</p><button type="button" className="ih-primary" disabled={busy} onClick={()=>run(()=>download())}><Download size={18}/> Download invoice & payment details</button></>:<p className="ih-muted">{data.payment_review_required===false?'You can download your invoice with account details while addressing the document checks shown above.':'Payment details are locked. Correct the draft and submit a new revision when requested.'}</p>}
 </div>}</section></>}
 </main>;
}
