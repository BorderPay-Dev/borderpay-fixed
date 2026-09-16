import { claimReviewAttempt, recordReviewVisit, REVIEW_INTERVAL_MS } from '../utils/reviews/reviewPolicy.ts';
const day = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 8, 17, 12);
function store() { const data=new Map<string,string>();return { getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);} }; }
function assert(value: unknown, message: string) { if(!value)throw new Error(message); }
function threeDays(s: ReturnType<typeof store>, user='a') { for(let i=0;i<3;i++)recordReviewVisit(s,user,start+i*day); }
Deno.test('installation and repeated same-day opens never trigger review',()=>{
 const s=store();for(let i=0;i<10;i++)recordReviewVisit(s,'a',start+i*1000);
 assert(!claimReviewAttempt(s,'a',true,start+day),'fewer than three usage days');
});
Deno.test('completed verified action is required even after three usage days',()=>{
 const s=store();threeDays(s);
 assert(!claimReviewAttempt(s,'a',false,start+2*day),'pending/unverified action cannot prompt');
 assert(claimReviewAttempt(s,'a',true,start+2*day),'eligible action can prompt');
});
Deno.test('90-day pacing counts attempts and suppresses double taps',()=>{
 const s=store();threeDays(s);const now=start+2*day;
 assert(claimReviewAttempt(s,'a',true,now),'first attempt');
 assert(!claimReviewAttempt(s,'a',true,now),'double tap suppressed');
 assert(!claimReviewAttempt(s,'a',true,now+REVIEW_INTERVAL_MS-1),'wait full interval');
 assert(claimReviewAttempt(s,'a',true,now+REVIEW_INTERVAL_MS),'eligible after interval');
});
Deno.test('usage is per account while prompt pacing is per device',()=>{
 const s=store();threeDays(s);assert(!claimReviewAttempt(s,'b',true,start+2*day),'another account has no usage');
 threeDays(s,'b');assert(claimReviewAttempt(s,'a',true,start+2*day),'first account attempt');
 assert(!claimReviewAttempt(s,'b',true,start+2*day),'switching account cannot repeat device prompt');
});
Deno.test('storage failures and clock reversal safely suppress prompts',()=>{
 const unavailable={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}};
 recordReviewVisit(unavailable,'a',start);assert(!claimReviewAttempt(unavailable,'a',true,start),'blocked storage');
 const s=store();threeDays(s);assert(claimReviewAttempt(s,'a',true,start+3*day),'initial attempt');
 assert(!claimReviewAttempt(s,'a',true,start+2*day),'clock reversal must not repeat prompt');
});
