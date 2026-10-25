import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recoverMemberships}from'./recover-memberships.mjs';
const environment={WORKFARE_PAY_MODE:'live',APP_ORIGIN:'https://app.workfa.re',WORKFARE_PAY_HOSTED_STATE_SECRET:'fixture-only-long-private-worker-secret-value',PORT:'3000'};
test('membership worker only processes durable declarations on loopback',async()=>{
 let calls=0;const request=async(url,options)=>{calls++;assert.equal(url.href,'http://127.0.0.1:3000/api/payments/membership/recovery');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.match(options.headers.Authorization,/^Bearer [a-f0-9]{64}$/);assert.equal(options.body,undefined);return{ok:true,json:async()=>({ok:true,complete:1,pending:0,reviews:3})};};
 assert.deepEqual(await recoverMemberships({environment,request}),{ok:true,complete:1,pending:0,reviews:3});assert.equal(calls,1);
});
test('membership worker rejects bad environments before making requests',async()=>{
 for(const patch of[{PORT:'3000/path'},{PORT:'0'},{PORT:'65536'},{APP_ORIGIN:'http://app.workfa.re'},{WORKFARE_PAY_HOSTED_STATE_SECRET:''},{WORKFARE_PAY_MODE:'local_simulation'}]){
  let calls=0;await assert.rejects(recoverMemberships({environment:{...environment,...patch},request:async()=>{calls++;}}));assert.equal(calls,0);
 }
});
test('membership worker reports unresolved reviews separately from newly processed requests',async()=>{
 const request=async()=>({ok:true,json:async()=>({ok:true,complete:0,pending:0,reviews:2})});
 assert.deepEqual(await recoverMemberships({environment,request}),{ok:true,complete:0,pending:0,reviews:2});
});
test('membership worker refuses an unconfirmed recovery response without exposing private content',async()=>{
 const request=async()=>({ok:false,json:async()=>({error:'private email customer record'})});
 await assert.rejects(recoverMemberships({environment,request}),error=>error.message==='Recovery was not confirmed.');
});
