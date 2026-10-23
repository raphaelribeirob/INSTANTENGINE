import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRiverEngine,decideSmartNotification,recommendSafeSendHour} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const NOW='2026-10-21T18:00:00.000Z';
const scope={tenant:'river',app:'academy',environment:'test',subject:'learner_1'};
const variants=[{id:'habit_safe',intent:'streak'},{id:'welcome_back',intent:'restart'},{id:'goal_small',intent:'goal'},{id:'neutral_tip',intent:'general'}];
async function fixture({consent=true,exposure=true,days=[19,20],weeklyLimit=7,app='academy',modules={notifications:true,habits:true}}={}){
 const local={...scope,app},repository=createMemoryRepository({now:()=>new Date(NOW)}),engine=createRiverEngine({repository,now:()=>new Date(NOW)});
 await engine.registerApp({...local,keyHash:'f'.repeat(64),cadence:'daily',modules,quietStart:8,quietEnd:22,weeklyLimit,events:[{name:'lesson_completed',value:true},{name:'app_opened',value:false}]});
 for(const day of days)await engine.track({...local,eventId:randomUUID(),event:'lesson_completed',occurredAt:`2026-10-${day}T13:00:00Z`,locale:'pt-BR',timezone:'America/Sao_Paulo'});
 if(consent)await engine.setConsent({...local,channel:'push',purpose:'reminder',granted:true,verified:true,platform:'android'});
 if(exposure)await engine.expose({...local,holdoutPercent:0});
 return {repository,engine,local,plan:(campaignKey='day_reminder')=>engine.planSmartReminder({...local,campaignKey,variants,exploration:0})};
}
test('one contextual planner call enqueues a streak message once, and records decision',async()=>{
 const f=await fixture();const r=await f.plan();assert.equal(r.action,'queued');assert.equal(r.intent,'streak');assert.equal(r.templateId,'habit_safe');assert.equal(f.repository.debug.decisions.size,1);
 const duplicate=await f.plan();assert.equal(duplicate.action,'do_not_send');assert.equal(f.repository.debug.jobs.size,1);
});
test('long gap selects supportive restart, never streak pressure',async()=>{
 const f=await fixture({days:[18]});const r=await f.plan();assert.equal(r.intent,'restart');assert.equal(r.templateId,'welcome_back');
});
test('missing consent and holdout make no decisions or jobs',async()=>{
 for(const options of [{consent:false},{exposure:false}]){const f=await fixture(options);const result=await f.plan();assert.equal(result.action,'do_not_send');assert.equal(f.repository.debug.jobs.size,0);assert.equal(f.repository.debug.decisions.size,0);}
});
test('unregistered subject and disabled module never schedule',async()=>{
 const f=await fixture({modules:{notifications:false,habits:true}});assert.equal((await f.plan()).action,'do_not_send');
 const unknown=await f.engine.planSmartReminder({...f.local,subject:'ghost',campaignKey:'c1',variants});assert.equal(unknown.reason,'unknown_subject');
});
test('after activity today no reminder, even with multiple variants',async()=>{
 const f=await fixture({days:[21,20]});const r=await f.plan();assert.equal(r.reason,'already_completed_today');
});
test('do not nag after four matured provider accepts without verified value; openings cannot count',async()=>{
 const f=await fixture();const prefix='river/academy/test/learner_1';const D=f.repository.debug;
 for(const [idx,day] of [19,17,15,13].entries())D.jobs.set('old_'+idx,{subjectKey:prefix,status:'provider_accepted',sentAt:`2026-10-${day}T18:00:00Z`,locale:'pt-BR'});
 const result=await f.plan();assert.equal(result.reason,'notification_fatigue_no_verified_value');assert.equal(D.decisions.size,0);assert.equal(D.jobs.size,4);
});
test('verified value outcomes can prevent fatigue suppression',async()=>{
 const f=await fixture();const prefix='river/academy/test/learner_1';const D=f.repository.debug;
 for(const [idx,day] of [19,17,15,13].entries())D.jobs.set('old_'+idx,{subjectKey:prefix,status:'provider_accepted',sentAt:`2026-10-${day}T18:00:00Z`,locale:'pt-BR'});
 D.outcomes.set('old_0/value',{type:'value'});
 const result=await f.plan();assert.equal(result.action,'queued');assert.equal(result.matured,4);
});
test('quiet hours and user pause are independent hard suppressions',async()=>{
 const f=await fixture();const state=f.repository.debug.subjects.get('river/academy/test/learner_1');
 state.pausedUntil='2026-10-22T18:00:00Z';assert.equal((await f.plan()).reason,'paused');
 state.pausedUntil=null;
 f.repository.debug.apps.get('river/academy/test').quietEnd=14;
 assert.equal((await f.plan()).reason,'quiet_hours');
});
test('unknown contextual templates do not trigger fallback to a mismatched intent',async()=>{
 const f=await fixture();const r=await f.engine.planSmartReminder({...f.local,campaignKey:'context_miss',variants:[{id:'welcome_back',intent:'restart'}]});
 assert.equal(r.reason,'no_contextually_approved_template');assert.equal(f.repository.debug.jobs.size,0);
});
test('reject malformed variant intent rather than silently sending',()=>{
 const context={app:{enabled:true,modules:{notifications:true},cadence:'daily',quietStart:8,quietEnd:22,weeklyLimit:7},subject:{lastValueAt:'2026-10-20T18:00:00Z',timezone:'UTC'},consent:{granted:true,verified:true},arm:'treatment',deliveries:[]};
 assert.throws(()=>decideSmartNotification({context,variants:[{id:'x',intent:'shame'}],seed:'one',now:NOW}),/Unknown/);
});
test('auto-tune selects measured hour; existing explicit preference remains authoritative',async()=>{
 const f=await fixture();const user=f.repository.debug.subjects.get('river/academy/test/learner_1');
 const data=await f.repository.smartNotificationContext({...f.local,campaignKey:'c1'});
 data.observations=[...Array.from({length:8},()=>({hour:15,converted:true})),...Array.from({length:8},()=>({hour:18,converted:false}))];
 const suggestion=recommendSafeSendHour({context:data,minSamples:6});assert.equal(suggestion.hour,15);assert.equal(suggestion.apply,true);
 user.reminderHour=18;user.reminderHourSource='user';
 const after=await f.plan();assert.equal(after.reason,'reminder_hour');assert.equal(user.reminderHour,18);
});
test('verified automatic hour adjustment changes local schedule and preserves user override',async()=>{
 const f=await fixture();const user=f.repository.debug.subjects.get('river/academy/test/learner_1');
 const original=f.repository.smartNotificationContext.bind(f.repository);
 f.repository.smartNotificationContext=async p=>({...await original(p),observations:[...Array.from({length:9},()=>({hour:16,converted:true})),...Array.from({length:8},()=>({hour:18,converted:false}))]});
 const a=await f.plan();assert.equal(a.action,'do_not_send');assert.equal(a.reason,'reminder_hour');assert.equal(a.hourUpdate,'updated');assert.equal(user.reminderHour,16);
 user.reminderHourSource='user';user.reminderHour=18;
 const b=await f.plan('new_campaign');assert.equal(b.reason,'reminder_hour');assert.equal(user.reminderHour,18);
});
test('atomic enqueue final gate can reject a revoked consent between planning and enqueue',async()=>{
 const f=await fixture();const enqueue=f.repository.enqueueSelected.bind(f.repository);
 f.repository.enqueueSelected=async p=>{await f.engine.setConsent({...f.local,channel:'push',purpose:'reminder',granted:false,verified:false,platform:'android'});return enqueue(p);};
 const r=await f.plan();assert.equal(r.reason,'atomic_enqueue_denied');assert.equal(f.repository.debug.jobs.size,0);
});
test('app/tenant isolation for decisions',async()=>{
 const one=await fixture();const two=await fixture({app:'learn2'});
 const [a,b]=await Promise.all([one.plan(),two.plan()]);assert.equal(a.action,'queued');assert.equal(b.action,'queued');
 assert.ok(a.deliveryId.startsWith('river/academy/test'));assert.ok(b.deliveryId.startsWith('river/learn2/test'));
});
test('legacy schedule is also fatigue-protected by shared memory safety policy',async()=>{
 const f=await fixture();const prefix='river/academy/test/learner_1';
 for(const [idx,day] of [19,17,15,13].entries())f.repository.debug.jobs.set('old_'+idx,{subjectKey:prefix,status:'provider_accepted',sentAt:`2026-10-${day}T18:00:00Z`});
 const created=await f.engine.schedule({...f.local,campaignKey:'legacy_not_allowed',templateId:'neutral_tip'});
 assert.equal(created,null);
});
