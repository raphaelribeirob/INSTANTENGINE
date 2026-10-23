import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRiverEngine,signRiverBanditPolicy} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const now='2026-10-21T18:00:00Z';
const scope={tenant:'river',app:'academy',environment:'test',subject:'student_a'};
const variants=[{id:'streak_a',intent:'streak'},{id:'streak_b',intent:'streak'},{id:'restart_a',intent:'restart'},{id:'general_a',intent:'general'}];
const policy={schema:1,model:'mabwiser',tenant:'river',app:'academy',environment:'test',arms:['streak_b','no_send'],sampleCount:240,createdAt:'2026-10-21T00:00:00Z',expiresAt:'2026-10-28T00:00:00Z',decisions:{streak_afternoon:'streak_b'}};
const secret='q'.repeat(48);
async function fixture(overrides={}){
 const repository=createMemoryRepository({now:()=>new Date(now)});
 const model=overrides.policy||policy;
 const engine=createRiverEngine({repository,now:()=>new Date(now),banditPolicy:{enabled:true,secret,policy:model,signature:signRiverBanditPolicy(model,secret)}});
 await engine.registerApp({...scope,keyHash:'c'.repeat(64),cadence:'daily',modules:{habits:true,notifications:true},events:[{name:'lesson_completed',value:true}],quietStart:8,quietEnd:22,weeklyLimit:7});
 for(const day of [19,20])await engine.track({...scope,eventId:randomUUID(),event:'lesson_completed',occurredAt:`2026-10-${day}T13:00:00Z`,locale:'pt-BR',timezone:'America/Sao_Paulo'});
 if(overrides.consent!==false)await engine.setConsent({...scope,channel:'push',purpose:'reminder',granted:true,verified:true,platform:'android'});
 await engine.expose({...scope,holdoutPercent:0});
 return {repository,engine,plan:()=>engine.planSmartReminder({...scope,campaignKey:'test_nudge',variants,exploration:0})};
}
test('real engine routes approved contextual streak variant through signed MABWiser policy',async()=>{const f=await fixture();const r=await f.plan();assert.equal(r.action,'queued');assert.equal(r.templateId,'streak_b');assert.equal(r.selectionReason,'signed_offline_mabwiser_policy')});
test('real engine preserves denial and never runs model as consent bypass',async()=>{const f=await fixture({consent:false});const r=await f.plan();assert.equal(r.action,'do_not_send');assert.equal(f.repository.debug.jobs.size,0)});
test('real engine can use no_send without enqueueing a push',async()=>{const f=await fixture({policy:{...policy,decisions:{streak_afternoon:'no_send'}}});const r=await f.plan();assert.equal(r.reason,'bandit_recommends_rest');assert.equal(f.repository.debug.jobs.size,0)});
test('real engine refuses wrong-intent template recommendation',async()=>{const model={...policy,arms:['restart_a','no_send'],decisions:{streak_afternoon:'restart_a'}};const f=await fixture({policy:model});const r=await f.plan();assert.equal(r.action,'queued');assert.ok(['streak_a','streak_b'].includes(r.templateId));assert.notEqual(r.selectionReason,'signed_offline_mabwiser_policy')});
test('signed policies cannot be applied without explicit enabled switch',async()=>{const repository=createMemoryRepository({now:()=>new Date(now)});const engine=createRiverEngine({repository,now:()=>new Date(now),banditPolicy:{enabled:false,secret,policy,signature:signRiverBanditPolicy(policy,secret)}});await engine.registerApp({...scope,keyHash:'c'.repeat(64),cadence:'daily',modules:{habits:true,notifications:true},events:[{name:'lesson_completed',value:true}],quietStart:8,quietEnd:22,weeklyLimit:7});for(const day of [19,20])await engine.track({...scope,eventId:randomUUID(),event:'lesson_completed',occurredAt:`2026-10-${day}T13:00:00Z`,locale:'pt-BR',timezone:'America/Sao_Paulo'});await engine.setConsent({...scope,channel:'push',purpose:'reminder',granted:true,verified:true,platform:'android'});await engine.expose({...scope,holdoutPercent:0});const r=await engine.planSmartReminder({...scope,campaignKey:'qa_no_ml',variants,exploration:0});assert.equal(r.action,'queued');assert.notEqual(r.selectionReason,'signed_offline_mabwiser_policy')});
