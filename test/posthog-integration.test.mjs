import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
import {createPostHogEmitter} from '../src/integrations/posthog.mjs';
const scope={tenant:'studio',app:'study',environment:'test'};
test('server-only emitter masks opaque subject, enforces host and records scoped exposure',async()=>{
 const requests=[];const repo=createMemoryRepository();const emit=createPostHogEmitter({projectKey:'phc_testing',hashSecret:'s'.repeat(40),isEligible:p=>repo.isABEligible(p),fetchImpl:async(url,opts)=>{requests.push({url,payload:JSON.parse(opts.body)});return {ok:true};}});
 const sdk=createTMNT({repository:repo,onEvent:emit});
 await sdk.registerApp({...scope,keyHash:'a'.repeat(64),modules:{analytics:true},events:[{name:'task_completed',value:true}]});
 // First register an opaque subject, then grant verified analytics consent before emitting events.
 await sdk.track({...scope,subject:'opaque-user',event:'task_completed',eventId:randomUUID()});
 await repo.setABAnalyticsConsent({...scope,subject:'opaque-user',granted:true,verified:true});
 const eventId=randomUUID();await sdk.track({...scope,subject:'opaque-user',event:'task_completed',eventId});
 await sdk.track({...scope,subject:'opaque-user',event:'task_completed',eventId});
 await sdk.expose({...scope,subject:'opaque-user'});
 assert.equal(requests.length,2,'duplicate event excluded');
 assert.equal(requests[1].payload.event,'tmnt_experiment_exposed');
 assert.equal(requests[1].payload.distinct_id.length,64);
 assert.ok(!JSON.stringify(requests).includes('opaque-user'));
 assert.equal(requests[1].payload.properties.tenant_id,'studio');
 assert.throws(()=>createPostHogEmitter({projectKey:'phc_testing',hashSecret:'s'.repeat(40),host:'https://evil.test'}));
});
test('analytics outage does not roll back durable event processing',async()=>{
 const sdk=createTMNT({repository:createMemoryRepository(),onEvent:async()=>{throw Error('down');}});
 await sdk.registerApp({...scope,keyHash:'a'.repeat(64),events:[{name:'task_completed',value:true}]});
 assert.equal(await sdk.track({...scope,subject:'learner',event:'task_completed',eventId:randomUUID()}),true);
});
test('identical subject under distinct apps receives unrelated analytics IDs',async()=>{
 const ids=[];const send=createPostHogEmitter({projectKey:'phc_testing',hashSecret:'t'.repeat(40),isEligible:async()=>true,fetchImpl:async(_url,opt)=>{ids.push(JSON.parse(opt.body).distinct_id);return {ok:true};}});
 await send({name:'tmnt_event_tracked',...scope,subject:'learner'});
 await send({name:'tmnt_event_tracked',tenant:'different',app:'study',environment:'test',subject:'learner'});
 assert.notEqual(ids[0],ids[1]);
});

test('worker and SDK share the same per-app identity when hashing secret matches',async()=>{
 const {posthogEvent}=await import('../src/worker.mjs');
 let fromWorker,fromSDK;
 const hashSecret='f'.repeat(40),projectKey='phc_testing';
 await posthogEvent('tmnt_push_provider_result',{...scope,subject:'opaque-id',id:randomUUID(),accepted:true},
 {posthogKey:projectKey,posthogHost:'https://us.i.posthog.com',hashSecret},
 {isEligible:async()=>true,fetchImpl:async(_,opts)=>{fromWorker=JSON.parse(opts.body).distinct_id;return {ok:true};}});
 const emit=createPostHogEmitter({projectKey,hashSecret,isEligible:async()=>true,fetchImpl:async(_,opts)=>{fromSDK=JSON.parse(opts.body).distinct_id;return {ok:true};}});
 await emit({name:'tmnt_event_tracked',...scope,subject:'opaque-id'});
 assert.equal(fromWorker,fromSDK);
});

test('worker settings refuse PostHog without strongly scoped identity hashing',async()=>{
 const {validateSettings}=await import('../src/worker.mjs');
 assert.throws(()=>validateSettings({TMNT_POSTHOG_PROJECT_KEY:'phc_live_example'}),/hashing secret/);
 assert.equal(validateSettings({TMNT_POSTHOG_PROJECT_KEY:'phc_live_example',TMNT_ANALYTICS_HASH_SECRET:'k'.repeat(40)}).hashSecret.length,40);
});
