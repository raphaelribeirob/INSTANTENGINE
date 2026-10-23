import test from 'node:test';import assert from 'node:assert/strict';
import {createRiverObserverNeonRepository} from '../src/storage/observer-neon.mjs';
import {createRiverValueOutboxNeonRepository} from '../src/storage/value-outbox-neon.mjs';
const p={tenant:'team',app:'speak',environment:'test',asOf:'2026-10-21',days:14,flagKey:'missions_test'};
function fakeSQL(){const calls=[];const sql=async(strings,...values)=>{calls.push({query:strings.join('?'),values});return calls.length===1?[{enabled:true,modules:{analytics:true}}]:calls.length===2?[{name:'lesson_completed',value:true}]:[];};return {sql,calls};}
test('all SQL observation queries use scoped, parameterized selects',async()=>{
 const f=fakeSQL(),repo=await createRiverObserverNeonRepository(null,{sql:f.sql});
 assert.equal((await repo.getObserverCatalog(p)).configured,true);
 await repo.getObserverOverview(p);await repo.getObserverRetention(p);await repo.getObserverExperiment(p);await repo.getObserverPipeline(p);
 for(const call of f.calls){assert.match(call.query,/\bSELECT\b/);assert.ok(!call.query.includes("'team'"));assert.ok(!call.query.includes("'speak'"));assert.ok(call.values.includes('team')&&call.values.includes('speak')&&call.values.includes('test'));}
 assert.ok(f.calls.some(c=>/river_v1_analytics_consents/.test(c.query)));
 assert.ok(f.calls.some(c=>/r\.is_value/.test(c.query)));
});
test('outbox storage claim is atomic and checks lease token on ack',async()=>{
 const f=fakeSQL(),repo=await createRiverValueOutboxNeonRepository(null,{sql:f.sql});
 await repo.claimValueOutbox({allowProduction:false});await repo.getVerifiedOutboxEvent({tenant:'team',app:'speak',environment:'test',eventId:'11111111-1111-4111-8111-111111111111'});
 await repo.isABEligible({tenant:'team',app:'speak',environment:'test',subject:'hashed'});
 await repo.completeValueOutbox({tenant:'team',app:'speak',environment:'test',eventId:'11111111-1111-4111-8111-111111111111',leaseToken:'22222222-2222-4222-8222-222222222222',status:'retry'});
 assert.match(f.calls[0].query,/FOR UPDATE SKIP LOCKED/);assert.match(f.calls[0].query,/attempts<20/);assert.match(f.calls[0].query,/environment<>'prod'/);assert.ok(f.calls[0].values.includes(false));
 assert.match(f.calls.at(-1).query,/lease_token=/);
 assert.ok(f.calls.at(-1).values.includes('retry'));
});
