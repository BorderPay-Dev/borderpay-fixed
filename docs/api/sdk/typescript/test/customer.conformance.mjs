import assert from 'node:assert/strict';
import {BorderPayClient} from '../dist/index.js';
const calls=[];
const client=new BorderPayClient({apiKey:'partner-fixture',gatewayUrl:'https://api.example',mode:'production',customerAccessToken:async()=>'customer-fixture',fetchImpl:async(url,init)=>{calls.push({url,headers:init.headers,body:JSON.parse(init.body)});return new Response(JSON.stringify({success:true,data:{}}));}});
await client.balances();await client.deleteExternalAccount('saved-bank','delete-intent');
assert.equal(calls[0].headers.Authorization,'Bearer partner-fixture');assert.equal(calls[0].headers['X-BorderPay-Customer-Authorization'],'Bearer customer-fixture');assert.equal(calls[0].body.method,'GET');assert.equal(calls[1].body.method,'DELETE');assert.equal(calls[1].headers['Idempotency-Key'],'delete-intent');assert.equal(calls[1].body.external_account_id,'saved-bank');
console.log('SDK customer session, GET and DELETE transport: PASS');
