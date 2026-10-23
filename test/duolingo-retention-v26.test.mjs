import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTMNT,createRiverABExperiments,reportDuolingoRetention} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
import {createPostHogEmitter} from '../src/integrations/posthog.mjs';
import {posthogEvent} from '../src/worker.mjs';
import {createNeonRepository} from '../src/storage/neon.mjs';
const S={tenant:'growth',app:'study',environment:'test',subject:'learner01'};
const C={flagKey:'retention-daily',variants:['control','test'],analyticsConsent:true};
const keyHash='e'.repeat(64);
const hashSecret='c'.repeat(48);
function mockClient(variant='test'){
 const captured=[];
 return {captured,async evaluateFlags(){return {getFlag:()=>variant}},async capture(v){captured.push(v)}};
}
async function fixture({analytics=true,flag='test'}={}){
 const now={value:new Date('2026-10-02T13:00:00.000Z')};
 const repo=createMemoryRepository({now:()=>now.value});
 const calls=[],emit=createPostHogEmitter({projectKey:'phc_test_growth',hashSecret,
  isEligible:p=>repo.isABEligible(p),fetchImpl:async(url,opts)=>{calls.push(JSON.parse(opts.body));return {ok:true}}});
 const sdk=createTMNT({repository:repo,now:()=>now.value,onEvent:emit});
 await sdk.registerApp({...S,keyHash,modules:{analytics,habits:true},events:[{name:'lesson_completed',value:true},{name:'app_opened',value:false}]});
 const client=mockClient(flag),ab=createRiverABExperiments({repository:repo,posthogClient:client,hashSecret,enabled:true});
 return {repo,now,sdk,calls,ab,client};
}
async function track(x,event='lesson_completed',scope=S){return x.sdk.track({...scope,event,eventId:randomUUID(),occurredAt:x.now.value});}

test('F1: generic PostHog emits nothing before stored opt-in, even when analytics module true',async()=>{
 const x=await fixture();await track(x);assert.equal(x.calls.length,0);
 await x.ab.setAnalyticsConsent({...S,granted:true,verified:true});await track(x);
 assert.equal(x.calls.length,1);assert.equal(x.calls[0].event,'tmnt_event_tracked');
 await x.ab.setAnalyticsConsent({...S,granted:false,verified:true});await track(x);
 assert.equal(x.calls.length,1);
});
test('F1: telemetry cannot emit when module disabled even if event was durably saved',async()=>{
 const x=await fixture({analytics:false});await track(x);
 assert.equal(x.calls.length,0);assert.equal(await x.ab.setAnalyticsConsent({...S,granted:true,verified:true}),false);
});
test('F1: emitter refuses operation without a persisted-consent validator',()=>{
 assert.throws(()=>createPostHogEmitter({projectKey:'phc_test_growth',hashSecret}),/eligibility callback/);
});
test('F1: emitter fails closed when eligibility provider fails (no outbound HTTP)',async()=>{
 let networkCalls=0;const send=createPostHogEmitter({projectKey:'phc_test_growth',hashSecret,isEligible:async()=>{throw Error('db-down')},fetchImpl:async()=>{networkCalls++;return {ok:true}}});
 const result=await send({name:'tmnt_event_tracked',...S});assert.equal(result.ok,false);assert.equal(networkCalls,0);
});
test('F1: worker PostHog telemetry requires explicit eligibility verification',async()=>{
 let n=0;const settings={posthogKey:'phc_test_growth',posthogHost:'https://us.i.posthog.com',hashSecret};
 const send=async()=>{n++;return {ok:true}};
 const result=await posthogEvent('tmnt_push_provider_result',S,settings,{fetchImpl:send});
 assert.equal(result.skipped,true);assert.equal(n,0);
});
test('F2: wrong variant never consumes an eligible conversion, valid retry succeeds',async()=>{
 const x=await fixture();await track(x,'app_opened');await x.ab.setAnalyticsConsent({...S,granted:true,verified:true});
 assert.equal((await x.ab.expose({...S,...C})).variant,'test');
 x.now.value=new Date('2026-10-03T13:00:00Z');const eventId=randomUUID();
 await x.sdk.track({...S,event:'lesson_completed',eventId,occurredAt:x.now.value});
 const bad=await x.ab.conversion({...S,...C,variants:['control','alternate'],eventId,conversionEvent:'lesson_completed'});
 assert.equal(bad.reason,'stored_variant_not_allowed');assert.equal(x.repo.debug.abConversions.size,0);
 const good=await x.ab.conversion({...S,...C,eventId,conversionEvent:'lesson_completed'});
 assert.equal(good.tracked,true);assert.equal(x.repo.debug.abConversions.size,1);
 assert.equal((await x.ab.conversion({...S,...C,eventId,conversionEvent:'lesson_completed'})).tracked,false);
});
test('F2: direct storage call cannot consume a conversion without exact expected variant',async()=>{
 const x=await fixture();await track(x,'app_opened');await x.ab.setAnalyticsConsent({...S,granted:true,verified:true});await x.ab.expose({...S,...C});
 x.now.value=new Date('2026-10-03T14:00:00Z');const eventId=randomUUID();
 await x.sdk.track({...S,event:'lesson_completed',eventId,occurredAt:x.now.value});
 const p={...S,flagKey:C.flagKey,conversionEvent:'lesson_completed',eventId};
 assert.equal(await x.repo.recordABConversion(p),null);
 assert.equal(await x.repo.recordABConversion({...p,expectedVariant:'control'}),null);
 assert.equal((await x.repo.recordABConversion({...p,expectedVariant:'test'})).variant,'test');
});
test('F2: Neon SQL conversion predicate enforces expected variant within the insertion',async()=>{
 const queries=[],repo=await createNeonRepository(null,{sql:async(parts,...values)=>{queries.push({q:parts.join('?'),values});return []}});
 const valid=await repo.recordABConversion({...S,flagKey:C.flagKey,eventId:randomUUID(),conversionEvent:'lesson_completed',expectedVariant:'test'});
 assert.equal(valid,null);assert.equal(queries.length,1);assert.match(queries[0].q,/x\.variant=\?/);assert.ok(queries[0].values.includes('test'));
});
test('D1/D7/D30: exact-day matured cohorts, unique people, no invented causal lift',()=>{
 const participants=[{...S,subject:'u1',flagKey:C.flagKey,variant:'control',exposedAt:'2026-09-01T12:00:00Z'},
  {...S,subject:'u2',flagKey:C.flagKey,variant:'test',exposedAt:'2026-09-01T12:00:00Z'},
  {...S,subject:'u3',flagKey:C.flagKey,variant:'test',exposedAt:'2026-09-30T12:00:00Z'}];
 const valueDays=[{...S,subject:'u1',day:'2026-09-02',verified:true},{...S,subject:'u2',day:'2026-09-02',verified:true},
  {...S,subject:'u2',day:'2026-09-08',verified:true},{...S,subject:'u2',day:'2026-10-01',verified:true},
  {...S,subject:'u2',day:'2026-09-02',verified:true},{...S,subject:'u3',day:'2026-10-01',verified:true}];
 const r=reportDuolingoRetention({participants,valueDays,asOf:'2026-10-02',flagKey:C.flagKey,minPerArm:2});
 const d1=r.windows.find(x=>x.day===1),d7=r.windows.find(x=>x.day===7),d30=r.windows.find(x=>x.day===30);
 assert.equal(d1.arms.test.eligible,2);assert.equal(d1.arms.test.retained,2);assert.equal(d1.arms.control.retained,1);
 assert.equal(d7.arms.test.eligible,1);assert.equal(d7.arms.test.retained,1);
 assert.equal(d30.arms.test.eligible,1);assert.equal(d30.arms.test.retained,1);assert.equal(r.causalLiftProven,false);
 assert.equal(d1.assessment.status,'insufficient_sample');
});
test('analytics report excludes unfinished D30 cohorts and rejects fabricated value signals',()=>{
 const participants=[{...S,flagKey:C.flagKey,variant:'test',exposedAt:'2026-10-01T12:00:00Z'}];
 const good=reportDuolingoRetention({participants,asOf:'2026-10-02',flagKey:C.flagKey});
 assert.equal(good.windows.find(x=>x.day===30).maturedParticipants,0);
 assert.throws(()=>reportDuolingoRetention({participants,valueDays:[{...S,day:'2026-10-02',verified:false}],asOf:'2026-10-02',flagKey:C.flagKey}),/backend-verified/);
});
test('AB report detects serious sample ratio mismatch without declaring victory',()=>{
 const participants=Array.from({length:100},(_,i)=>({...S,subject:'a'+i,flagKey:C.flagKey,variant:i<90?'control':'test',exposedAt:'2026-08-01T00:00:00Z'}));
 const r=reportDuolingoRetention({participants,flagKey:C.flagKey,asOf:'2026-10-02'});
 assert.equal(r.sampleRatioMismatch,true);assert.equal(r.readyForRollout,false);
});
test('AB reporting respects analytics opt-out, keeps PII out of output',async()=>{
 const x=await fixture();await track(x,'app_opened');await x.ab.setAnalyticsConsent({...S,granted:true,verified:true});await x.ab.expose({...S,...C});
 x.now.value=new Date('2026-10-03T12:00:00Z');await track(x);
 const r=await x.ab.reportRetention({...S,...C,asOf:'2026-10-08',minPerArm:2});
 assert.equal(r.exposures.test,1);assert.equal(JSON.stringify(r).includes(S.subject),false);
 await x.ab.setAnalyticsConsent({...S,granted:false,verified:true});
 const denied=await x.ab.reportRetention({...S,...C,asOf:'2026-10-08'});
 assert.equal(denied.exposures.test,0);
});
