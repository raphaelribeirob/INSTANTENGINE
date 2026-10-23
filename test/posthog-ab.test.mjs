import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
import {createNeonRepository} from '../src/storage/neon.mjs';
import {createRiverABExperiments,riverPostHogDistinctId,createPostHogNodeClient} from '../src/integrations/posthog-ab.mjs';

const S={tenant:'river',app:'instantstudy',environment:'test',subject:'anonymous123'},C={flagKey:'daily-goal-v1',variants:['control','test']};
const SECRET='x'.repeat(48);
const clock={value:new Date('2026-10-21T12:00:00Z')};
function fixture({flag='test',failFlags=false,failCapture=false,analytics=true,enabled=true,production=false}={}){
 const repository=createMemoryRepository({now:()=>clock.value});
 const sdk=createTMNT({repository,now:()=>clock.value});
 const calls={evals:[],reads:[],captures:[]};
 const client={
  async evaluateFlags(id,options){calls.evals.push({id,options});if(failFlags)throw Error('PostHog unavailable');return {getFlag(key){calls.reads.push(key);return flag;}};},
  async capture(data){calls.captures.push(data);if(failCapture)throw Error('Capture refused');},
 };
 const ab=createRiverABExperiments({repository,posthogClient:client,hashSecret:SECRET,enabled,allowProduction:production});
 async function init(){await sdk.registerApp({tenant:S.tenant,app:S.app,environment:S.environment,keyHash:'f'.repeat(64),modules:{analytics},events:[{name:'lesson_completed',value:true},{name:'app_opened',value:false}]});
  await sdk.track({...S,eventId:randomUUID(),event:'app_opened',occurredAt:'2026-10-21T11:59:00Z'});
  await ab.setAnalyticsConsent({...S,granted:true,verified:true});}
 return {repository,sdk,ab,client,calls,init};
}

test('disabled by default, cannot send PostHog exposures',async()=>{
 const x=fixture({enabled:false});await x.init();const res=await x.ab.expose({...S,...C,analyticsConsent:true});assert.equal(res.reason,'disabled');assert.equal(x.calls.evals.length,0);
});
test('verified stored consent is required even if caller claims consent',async()=>{
 const x=fixture();await x.sdk.registerApp({...S,keyHash:'f'.repeat(64),modules:{analytics:true},events:[{name:'app_opened',value:false}]});
 await x.sdk.track({...S,eventId:randomUUID(),event:'app_opened'});
 let r=await x.ab.expose({...S,...C,analyticsConsent:true});assert.equal(r.reason,'not_opted_in_or_ineligible');assert.equal(x.calls.evals.length,0);
 assert.rejects(x.ab.setAnalyticsConsent({...S,granted:true,verified:false}),/Invalid analytics consent/);
});
test('client consent false blocks even when stored consent true',async()=>{
 const x=fixture();await x.init();const r=await x.ab.expose({...S,...C,analyticsConsent:false});assert.equal(r.reason,'consent_required');assert.equal(x.calls.evals.length,0);
});
test('native PostHog multivariate flag is evaluated at exposure with opaque distinct ID',async()=>{
 const x=fixture();await x.init();const r=await x.ab.expose({...S,...C,analyticsConsent:true});assert.deepEqual({variant:r.variant,first:r.firstExposure},{variant:'test',first:true});
 assert.equal(x.calls.evals.length,1);assert.equal(x.calls.evals[0].id.length,64);assert.deepEqual(x.calls.evals[0].options,{flagKeys:[C.flagKey]});assert.deepEqual(x.calls.reads,[C.flagKey]);
 assert.equal(x.calls.evals[0].id,riverPostHogDistinctId(S,SECRET));assert.equal(JSON.stringify(x.calls).includes('anonymous123'),false);
});
test('repeated exposures are sticky and do not re-query flag even after rollout changes',async()=>{
 const x=fixture();await x.init();await x.ab.expose({...S,...C,analyticsConsent:true});x.client.evaluateFlags=async()=>{throw Error('flag toggled');};
 const r=await x.ab.expose({...S,...C,analyticsConsent:true});assert.equal(r.variant,'test');assert.equal(r.firstExposure,false);assert.equal(x.calls.evals.length,1);
});
test('unknown flag and outages fail closed to control without assignment',async()=>{
 for(const options of [{flag:false},{flag:'random'},{failFlags:true}]){
 const x=fixture(options);await x.init();const r=await x.ab.expose({...S,...C,analyticsConsent:true});assert.equal(r.status,'inactive');assert.equal(r.variant,'control');assert.equal(x.repository.debug.abAssignments.size,0);}
});
test('no analytics module means no assignment and no feature flag call',async()=>{
 const x=fixture({analytics:false});await x.init();const r=await x.ab.expose({...S,...C,analyticsConsent:true});assert.equal(r.status,'inactive');assert.equal(x.calls.evals.length,0);
});
test('strict scope isolation, including environment, tenant and app',async()=>{
 const x=fixture();await x.init();await x.ab.expose({...S,...C,analyticsConsent:true});
 for(const diff of [{tenant:'other'},{app:'other'},{environment:'staging'},{subject:'other'}]){
  const r=await x.ab.expose({...S,...diff,...C,analyticsConsent:true});assert.equal(r.status,'inactive');}
 assert.equal(x.repository.debug.abAssignments.size,1);
});
test('rejects invalid keys, unknown arms, unscoped IDs and non-HTTPS hosts',async()=>{
 const x=fixture();await x.init();
 await assert.rejects(x.ab.expose({...S,...C,variants:['test'],analyticsConsent:true}),/Invalid variants/);
 await assert.rejects(x.ab.expose({...S,...C,flagKey:'../bad',analyticsConsent:true}),/Invalid flagKey/);
 await assert.rejects(x.ab.expose({...S,...C,subject:'contains spaces',analyticsConsent:true}),/Invalid subject/);
 await assert.rejects(createPostHogNodeClient({projectKey:'phc_testing',host:'http://us.i.posthog.com'}),/Invalid PostHog host/);
});
test('prod cannot be enabled without distinct explicit allowProduction flag',async()=>{
 const x=fixture();await x.init();const r=await x.ab.expose({...S,environment:'prod',...C,analyticsConsent:true});assert.equal(r.reason,'prod_disabled');assert.equal(x.calls.evals.length,0);
});
test('conversion requires recorded real value event AFTER exposure, no clicks and no duplicates',async()=>{
 const x=fixture();await x.init();await x.ab.expose({...S,...C,analyticsConsent:true});
 let bad=await x.ab.conversion({...S,...C,eventId:randomUUID(),conversionEvent:'lesson_completed',analyticsConsent:true});assert.equal(bad.tracked,false);
 clock.value=new Date('2026-10-21T12:10:00Z');
 const clickId=randomUUID();await x.sdk.track({...S,eventId:clickId,event:'app_opened',occurredAt:clock.value});
 bad=await x.ab.conversion({...S,...C,eventId:clickId,conversionEvent:'app_opened',analyticsConsent:true});assert.equal(bad.tracked,false);
 const eid=randomUUID();await x.sdk.track({...S,eventId:eid,event:'lesson_completed',occurredAt:clock.value});
 const p={...S,...C,eventId:eid,conversionEvent:'lesson_completed',analyticsConsent:true};
 const ok=await x.ab.conversion(p);assert.equal(ok.tracked,true);assert.equal(ok.variant,'test');assert.equal(ok.posthogQueued,true);
 assert.equal((await x.ab.conversion(p)).tracked,false);assert.equal(x.calls.captures.length,1);
 assert.equal(x.calls.captures[0].event,'riverengine_ab_conversion');assert.equal(x.calls.captures[0].properties['$feature/daily-goal-v1'],'test');assert.ok(!JSON.stringify(x.calls.captures).includes(S.subject));
});
test('cannot attribute a real value event that predates exposure or belongs to another user',async()=>{
 clock.value=new Date('2026-10-21T12:00:00Z');const x=fixture();await x.init();
 const pre=randomUUID();await x.sdk.track({...S,eventId:pre,event:'lesson_completed',occurredAt:'2026-10-21T11:59:59Z'});
 await x.ab.expose({...S,...C,analyticsConsent:true});
 assert.equal((await x.ab.conversion({...S,...C,eventId:pre,conversionEvent:'lesson_completed',analyticsConsent:true})).tracked,false);
});
test('opt-out blocks new exposure and conversion and is scoped',async()=>{
 clock.value=new Date('2026-10-21T12:00:00Z');const x=fixture();await x.init();await x.ab.expose({...S,...C,analyticsConsent:true});
 await x.ab.setAnalyticsConsent({...S,granted:false,verified:true});
 const r=await x.ab.expose({...S,...C,analyticsConsent:true});assert.equal(r.status,'inactive');
 assert.equal((await x.ab.conversion({...S,...C,eventId:randomUUID(),conversionEvent:'lesson_completed',analyticsConsent:true})).tracked,false);
});
test('provider queue errors are reported but a verified conversion remains recorded',async()=>{
 clock.value=new Date('2026-10-21T12:00:00Z');const x=fixture({failCapture:true});await x.init();await x.ab.expose({...S,...C,analyticsConsent:true});
 const eid=randomUUID();clock.value=new Date('2026-10-21T12:10:00Z');await x.sdk.track({...S,eventId:eid,event:'lesson_completed',occurredAt:clock.value});
 const p={...S,...C,eventId:eid,conversionEvent:'lesson_completed',analyticsConsent:true};
 const r=await x.ab.conversion(p);assert.equal(r.tracked,true);assert.equal(r.posthogQueued,false);assert.equal((await x.ab.conversion(p)).tracked,false);
});
test('erasure also deletes analytics consent, experiment assignments and conversions',async()=>{
 clock.value=new Date('2026-10-21T12:00:00Z');const x=fixture();await x.init();await x.ab.expose({...S,...C,analyticsConsent:true});
 const eid=randomUUID();clock.value=new Date('2026-10-21T12:10:00Z');await x.sdk.track({...S,eventId:eid,event:'lesson_completed',occurredAt:clock.value});
 await x.ab.conversion({...S,...C,eventId:eid,conversionEvent:'lesson_completed',analyticsConsent:true});
 assert.equal(x.repository.debug.abConversions.size,1);await x.sdk.eraseSubject(S);
 assert.equal(x.repository.debug.abConsents.size,0);assert.equal(x.repository.debug.abAssignments.size,0);assert.equal(x.repository.debug.abConversions.size,0);
});
test('Neon adapter uses scoped and parametrized SQL for assignments and verified conversions',async()=>{
 const calls=[];const sql=async(parts,...args)=>{const query=parts.join('?');calls.push({query,args});if(query.includes('river_v1_ab_conversions'))return [{event_id:randomUUID()}];if(query.includes('FROM river_v1_ab_assignments'))return [{variant:'test',exposed_at:new Date()}];if(query.includes('INSERT INTO river_v1_ab_assignments'))return [{variant:'test',exposed_at:new Date()}];return [{ok:1,granted:true}];};
 const repo=await createNeonRepository(null,{sql});assert.equal((await repo.claimABAssignment({...S,flagKey:C.flagKey,variant:'test'})).variant,'test');
 assert.equal((await repo.recordABConversion({...S,flagKey:C.flagKey,eventId:randomUUID(),conversionEvent:'lesson_completed',expectedVariant:'test'})).variant,'test');
 assert.ok(calls.some(q=>q.query.includes('r3_v1_events v')&&q.query.includes('reg.is_value')&&q.query.includes('x.exposed_at')));
 assert.ok(calls.every(q=>!q.query.includes(S.subject)||q.args.includes(S.subject)));
});

test('three PostHog A/B draft configurations are disabled, unique and use verified-value conversion schemas',async()=>{
 const {readFileSync}=await import('node:fs');
 const cfg=JSON.parse(readFileSync(new URL('../config/posthog-ab-drafts.json',import.meta.url),'utf8'));
 assert.equal(cfg.enabled,false);assert.equal(cfg.status,'draft_only_not_created_in_posthog');assert.equal(cfg.experiments.length,3);
 assert.equal(new Set(cfg.experiments.map(x=>x.flagKey)).size,3);
 for(const x of cfg.experiments){assert.deepEqual(x.variants,['control','test']);assert.equal(x.primaryEvent,'riverengine_ab_conversion');assert.match(x.flagKey,/^[a-z][a-z0-9_-]+$/);assert.ok(x.conversionEvent.endsWith('_completed'));}
});
