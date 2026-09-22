export type RestrictionKind = 'receiving_paused' | 'fraud_hold';
export function isRecordedFraudHold(reason: unknown): boolean {
 return /^(fraud-related withdrawal hold|provider fraud alert hold)\b/i.test(String(reason || '').trim());
}
export function restrictionNotice(kind: RestrictionKind, currencies: string[] = []) {
 const held=[...new Set(currencies.filter(c=>['USD','EUR','GBP'].includes(c)))];
 const accounts=held.length ? held.join(', ')+' receiving accounts' : 'receiving accounts';
 if(kind==='fraud_hold')return {
  subject:'Your BorderPay account is frozen',
  heading:'Your account is frozen',
  paragraphs:[
   'Receiving payments and withdrawals are unavailable while a fraud-related hold is in place.',
   'Ask the sender of the reported payment to contact their sending bank. If the fraud report was made in error, the sender must ask their bank to withdraw the report and confirm the updated No-Fraud status through the banking channel.',
   'Contact BorderPay support with the payment reference. We can review the restriction after official confirmation is received. Your account remains frozen until the hold is formally released.'
  ]
 };
 return {
  subject:'Your BorderPay receiving accounts are frozen',
  heading:'Your receiving accounts are frozen',
  paragraphs:[
   'Your '+accounts+' are frozen. Do not ask anyone to pay to these accounts or share your previous receiving details.',
   'You can still view your recorded wallet balances in the BorderPay web dashboard. Bank payment details and wallet deposit addresses are locked.',
   'You can request withdrawal of eligible remaining wallet funds through BorderPay support. Direct payments remain unavailable while the account is paused; support will explain the applicable recovery steps.',
   'Funds subject to a fraud-related hold cannot be withdrawn until the hold is released.'
  ]
 };
}
