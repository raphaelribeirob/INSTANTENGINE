import test from 'node:test';import assert from 'node:assert/strict';
import {createRiverValueOutboxPump} from '../src/integrations/value-outbox.mjs';
const job={tenant:'tenant',app:'study',environment:'test',eventId:'11111111-1111-4111-8111-111111111111',leaseToken:'22222222-2222-4222-8222-222222222222'};
const data={...job,subject:'learner',verifiedValue:true,eventName:'lesson_completed'};
function fixture({eligible=true,evt=data,delivery={acknowledged:true},environment='test'}={}){
 const updates=[],calls=[],repo={async claimValueOutbox({allowProduction}={}){return environment==='prod'&&!allowProduction?null:{...job,environment}},async getVerifiedOutboxEvent(){return evt},async isABEligible(){return eligible},async completeValueOutbox(x){updates.push(x);return true}};
 const pump=createRiverValueOutboxPump({repository:repo,deliver:async(x)=>{calls.push(x);return delivery},secret:'b'.repeat(48),enabled:true});return {pump,updates,calls};
}
test('successful value event is acknowledged once, with HMAC insert id',async()=>{const f=fixture();assert.deepEqual(await f.pump.drainOnce(),{status:'accepted_by_provider'});assert.equal(f.updates[0].status,'acknowledged');assert.match(f.calls[0].insertId,/^[0-9a-f]{64}$/);});
test('revoked consent discards task without sending',async()=>{const f=fixture({eligible:false});assert.equal((await f.pump.drainOnce()).status,'no_analytics_consent');assert.equal(f.calls.length,0);assert.equal(f.updates[0].status,'discarded');});
test('missing value events are discarded',async()=>{const f=fixture({evt:null});assert.equal((await f.pump.drainOnce()).status,'missing_erased_or_invalid');});
test('provider failures schedule retry, never fake delivery',async()=>{const f=fixture({delivery:{acknowledged:false}});assert.equal((await f.pump.drainOnce()).status,'retry_scheduled');assert.equal(f.updates[0].status,'retry');});
test('production is off without explicit flag',async()=>{const f=fixture({environment:'prod'});assert.equal((await f.pump.drainOnce()).status,'empty');assert.equal(f.calls.length,0);});
test('disabled mode does not claim jobs',async()=>{const f=fixture();const p=createRiverValueOutboxPump({repository:{claimValueOutbox:async()=>{throw Error('should not claim')},completeValueOutbox:async()=>true,getVerifiedOutboxEvent:async()=>null,isABEligible:async()=>false},deliver:()=>({acknowledged:true}),secret:'c'.repeat(48)});assert.equal(typeof p.drainOnce,'function');assert.deepEqual(await p.drainOnce(),{status:'disabled'});});
