import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
import {createNeonRepository} from '../src/storage/neon.mjs';
import {learnedReminderHour,assessExperiment,friendStreakFromDays} from '../src/retention-next.mjs';
const scope={tenant:'lab',app:'academy',environment:'test'};
const start='2026-10-20T12:00:00.000Z';
async function fixture(opts={}){
 let clock=new Date(start);const repo=createMemoryRepository({now:()=>clock}),sdk=createTMNT({repository:repo,now:()=>clock});
 await sdk.registerApp({...scope,keyHash:'f'.repeat(64),cadence:'daily',quietStart:8,quietEnd:21,holdoutPercent:0,modules:{notifications:true,habits:true,social:true,friendStreaks:true,missions:true,...opts.modules},events:[{name:'lesson_completed',value:true},{name:'app_opened',value:false}]});
 const track=(subject,event='lesson_completed',occurredAt=clock)=>sdk.track({...scope,subject,event,eventId:randomUUID(),occurredAt,timezone:'UTC'});
 return {sdk,repo,track,setClock:x=>clock=new Date(x),getClock:()=>clock};
}
test('learned hour returns safe cold-start with no observations',()=>{assert.deepEqual(learnedReminderHour({quietStart:8,quietEnd:20,defaultHour:18}),{hour:18,learned:false,samples:0,reason:'cold_start_or_insufficient_data'});});
test('learned hour compares mature verified conversions with smoothing',()=>{const observations=[...Array.from({length:12},(_,i)=>({hour:10,converted:i<2})),...Array.from({length:12},(_,i)=>({hour:17,converted:i<9}))];const r=learnedReminderHour({observations,quietStart:8,quietEnd:21});assert.equal(r.hour,17);assert.equal(r.learned,true);});
test('learned hour refuses exploitative quiet hours',()=>{const observations=Array.from({length:30},()=>({hour:2,converted:true}));const r=learnedReminderHour({observations,quietStart:8,quietEnd:21});assert.equal(r.learned,false);assert.ok(r.hour>=8&&r.hour<21);});
test('invalid send time observations rejected',()=>{assert.throws(()=>learnedReminderHour({observations:[{hour:25,converted:true}]}));assert.throws(()=>learnedReminderHour({quietStart:20,quietEnd:19}));});
test('no consent or holdout means no personalized hour',async()=>{const {sdk,track}=await fixture();await track('student');assert.equal(await sdk.recommendReminderHour({...scope,subject:'student'}),null);await sdk.setConsent({...scope,subject:'student',channel:'push',purpose:'reminder',verified:true,granted:true,platform:'android'});assert.equal(await sdk.recommendReminderHour({...scope,subject:'student'}),null);});
test('verified schedule results can optimize hour, but user preference wins',async()=>{const {sdk,repo,track}=await fixture();await track('student','lesson_completed','2026-10-19T12:00:00Z');await sdk.setConsent({...scope,subject:'student',channel:'push',purpose:'reminder',verified:true,granted:true,platform:'android'});await sdk.expose({...scope,subject:'student',holdoutPercent:0});let r=await sdk.recommendReminderHour({...scope,subject:'student',apply:true});assert.equal(r.applied,false);const uid='lab/academy/test/student';for(let i=0;i<8;i++){const id=uid+`/campaign${i}`;repo.debug.jobs.set(id,{subjectKey:uid,status:'provider_accepted',sentAt:`2026-10-${String(i+9).padStart(2,'0')}T17:00:00Z`});repo.debug.outcomes.set(id+'/value',{type:'value'});}for(let i=0;i<8;i++){repo.debug.jobs.set(uid+`/bad${i}`,{subjectKey:uid,status:'provider_accepted',sentAt:`2026-10-${String(i+9).padStart(2,'0')}T10:00:00Z`});}r=await sdk.recommendReminderHour({...scope,subject:'student',apply:true});assert.equal(r.hour,17);assert.equal(r.applied,true);assert.equal(repo.debug.subjects.get(uid).reminderHour,17);repo.debug.subjects.get(uid).reminderHourSource='user';assert.equal((await sdk.recommendReminderHour({...scope,subject:'student',apply:true})).applied,false);});
test('mission requires approved value event and opt-in',async()=>{const {sdk}=await fixture();assert.equal(await sdk.defineDailyMission({...scope,missionKey:'open',event:'app_opened',target:1,rewardXp:10}),false);assert.equal(await sdk.defineDailyMission({...scope,missionKey:'learn3',event:'lesson_completed',target:3,rewardXp:20}),true);assert.equal(await sdk.defineDailyMission({...scope,missionKey:'learn3',event:'lesson_completed',target:3,rewardXp:20}),false);});
test('daily mission progresses with verified activity and claims once',async()=>{const {sdk,track,repo}=await fixture();await sdk.defineDailyMission({...scope,missionKey:'learn2',event:'lesson_completed',target:2,rewardXp:30});await track('alice');let r=await sdk.dailyMissions({...scope,subject:'alice'});assert.equal(r[0].progress,1);assert.equal(r[0].completed,false);assert.equal(await sdk.claimDailyMission({...scope,subject:'alice',missionKey:'learn2'}),false);await track('alice','app_opened');assert.equal((await sdk.dailyMissions({...scope,subject:'alice'}))[0].progress,1);await track('alice');r=await sdk.dailyMissions({...scope,subject:'alice'});assert.equal(r[0].completed,true);const before=(await sdk.getHabit({...scope,subject:'alice'})).xp;const claim=await Promise.all(Array.from({length:4},()=>sdk.claimDailyMission({...scope,subject:'alice',missionKey:'learn2'})));assert.deepEqual(claim,[true,false,false,false]);assert.equal((await sdk.getHabit({...scope,subject:'alice'})).xp,before+30);assert.equal(repo.debug.missionClaims.size,1);});
test('daily missions reset by user local calendar and deletion cascades',async()=>{const f=await fixture();await f.sdk.defineDailyMission({...scope,missionKey:'one',event:'lesson_completed',target:1,rewardXp:5});await f.track('alice');assert.equal(await f.sdk.claimDailyMission({...scope,subject:'alice',missionKey:'one'}),true);f.setClock('2026-10-21T12:00:00Z');assert.equal((await f.sdk.dailyMissions({...scope,subject:'alice'}))[0].progress,0);assert.equal(await f.sdk.eraseSubject({...scope,subject:'alice'}),true);assert.equal(f.repo.debug.missionClaims.size,0);});
test('episodic commerce must not inherit missions without opt-in',async()=>{const f=await fixture({modules:{missions:false}});assert.equal(await f.sdk.defineDailyMission({...scope,missionKey:'sales',event:'lesson_completed',target:1,rewardXp:5}),false);});
test('friend streak requires bilateral acceptance and both value days after acceptance',async()=>{const f=await fixture();await f.track('alice');await f.track('bob');assert.equal(await f.sdk.friendStreak({...scope,subject:'alice',friend:'bob'}),null);await f.sdk.inviteFriend({...scope,subject:'alice',friend:'bob'});assert.equal(await f.sdk.friendStreak({...scope,subject:'alice',friend:'bob'}),null);await f.sdk.respondFriend({...scope,subject:'bob',friend:'alice',accept:true});assert.equal((await f.sdk.friendStreak({...scope,subject:'alice',friend:'bob'})).streak,0);f.setClock('2026-10-20T12:00:01Z');await f.track('alice');await f.track('bob','app_opened');assert.equal((await f.sdk.friendStreak({...scope,subject:'alice',friend:'bob'})).streak,0);await f.track('bob');assert.equal((await f.sdk.friendStreak({...scope,subject:'alice',friend:'bob'})).streak,1);f.setClock('2026-10-21T12:00:00Z');await f.track('alice');await f.track('bob');assert.equal((await f.sdk.friendStreak({...scope,subject:'bob',friend:'alice'})).streak,2);});
test('friend streak drops after missed shared day, and removal revokes',async()=>{const f=await fixture();await f.track('alice');await f.track('bob');await f.sdk.inviteFriend({...scope,subject:'alice',friend:'bob'});await f.sdk.respondFriend({...scope,subject:'bob',friend:'alice',accept:true});f.setClock('2026-10-20T12:00:01Z');await f.track('alice');await f.track('bob');f.setClock('2026-10-23T12:00:00Z');assert.equal((await f.sdk.friendStreak({...scope,subject:'alice',friend:'bob'})).streak,0);assert.equal(await f.sdk.removeFriend({...scope,subject:'alice',friend:'bob'}),true);assert.equal(await f.sdk.friendStreak({...scope,subject:'alice',friend:'bob'}),null);});
test('verified local timezone / day intersection helper is stable',()=>{assert.deepEqual(friendStreakFromDays({firstDays:['2026-10-19','2026-10-20'],secondDays:['2026-10-19','2026-10-20'],asOf:'2026-10-20T20:00:00Z'}),{streak:2,longestStreak:2,lastSharedDay:'2026-10-20',timezone:'UTC'});});
test('statistical experiment reports insufficient evidence, no fabricated causal claim',()=>{const row={arms:{treatment:{eligible:10,retained:6},holdout:{eligible:1,retained:0}}};const res=assessExperiment(row,{holdoutPercent:10});assert.equal(res.status,'insufficient_sample');assert.equal(res.causalClaim,false);});
test('significant lift detected but never labeled proven causal',()=>{const row={arms:{treatment:{eligible:200,retained:140},holdout:{eligible:200,retained:80}}};const r=assessExperiment(row,{holdoutPercent:50,minPerArm:100});assert.equal(r.status,'statistical_signal');assert.ok(r.pValue<0.05);assert.equal(r.causalClaim,false);assert.ok(r.confidenceInterval[0]>0);});
test('sample ratio mismatch blocks green effect label',()=>{const row={arms:{treatment:{eligible:900,retained:700},holdout:{eligible:100,retained:40}}};const r=assessExperiment(row,{holdoutPercent:50});assert.equal(r.status,'sample_ratio_mismatch');});
test('No effect and invalid arm counts handled safely',()=>{const row={arms:{treatment:{eligible:300,retained:150},holdout:{eligible:300,retained:150}}};assert.equal(assessExperiment(row,{holdoutPercent:50}).status,'no_statistical_signal');assert.throws(()=>assessExperiment({arms:{treatment:{eligible:1,retained:2},holdout:{eligible:1,retained:0}}}));});
test('Neon adapter exposes additive SQL contracts without leaking raw SQL interpolation',async()=>{const queries=[];const sql=async(parts,...vals)=>{const q=parts.join('?');queries.push({q,vals});if(q.includes('r3_v1_send_time_observations'))return [{hour:18,converted:true}];if(q.includes('FROM r3_v1_apps cfg JOIN r3_v1_subjects'))return [{quiet_start:8,quiet_end:21,reminder_hour:null}];if(q.includes('r3_v1_daily_mission_status'))return [{mission_key:'one',event_name:'lesson_completed',day:'2026-10-20',target:1,progress:1,completed:true,reward_xp:10,claimed:false}];if(q.includes('r3_v1_friend_streak'))return [{streak:3,longest_streak:3,last_shared_day:'2026-10-20'}];return [{ok:true}];};const repo=await createNeonRepository(null,{sql});const sdk=createTMNT({repository:repo});await sdk.defineDailyMission({...scope,missionKey:'one',event:'lesson_completed',target:1,rewardXp:10});assert.equal((await sdk.dailyMissions({...scope,subject:'alice'}))[0].progress,1);assert.equal(await sdk.claimDailyMission({...scope,subject:'alice',missionKey:'one'}),true);assert.equal((await sdk.friendStreak({...scope,subject:'alice',friend:'bob'})).streak,3);assert.equal((await sdk.recommendReminderHour({...scope,subject:'alice'})).hour,18);for(const term of ['r3_v1_define_daily_mission','r3_v1_daily_mission_status','r3_v1_claim_daily_mission','r3_v1_friend_streak','r3_v1_send_time_observations'])assert.ok(queries.some(x=>x.q.includes(term)),term);});

test('weekly league requires explicit opt-in, and never exposes other identifiers',async()=>{
 const f=await fixture({modules:{leagues:true}});await f.track('alice');await f.track('bob');
 assert.deepEqual(await f.sdk.weeklyLeaderboard({...scope,subject:'alice'}),[]);
 assert.equal(await f.sdk.joinLeague({...scope,subject:'alice'}),true);
 assert.equal(await f.sdk.joinLeague({...scope,subject:'bob'}),true);
 assert.equal(await f.sdk.joinLeague({...scope,subject:'alice'}),false);
 f.setClock('2026-10-20T12:00:01Z');await f.track('alice');await f.track('alice');await f.track('bob');
 const ranks=await f.sdk.weeklyLeaderboard({...scope,subject:'alice'});
 assert.equal(ranks.length,2);assert.equal(ranks[0].score,20);assert.equal(ranks[0].isSelf,true);
 assert.equal(JSON.stringify(ranks).includes('bob'),false);
 assert.equal(await f.sdk.leaveLeague({...scope,subject:'alice'}),true);
 assert.deepEqual(await f.sdk.weeklyLeaderboard({...scope,subject:'alice'}),[]);
});
test('league scores cap same-day event spam at ten events, and reset weekly',async()=>{
 const f=await fixture({modules:{leagues:true}});await f.track('alice');await f.sdk.joinLeague({...scope,subject:'alice'});f.setClock('2026-10-20T12:00:01Z');
 for(let i=0;i<13;i++)await f.track('alice');
 assert.equal((await f.sdk.weeklyLeaderboard({...scope,subject:'alice'}))[0].score,100);
 f.setClock('2026-10-26T12:00:00Z');
 assert.equal((await f.sdk.weeklyLeaderboard({...scope,subject:'alice'}))[0].score,0);
});
test('leagues disabled by default and user erasure revokes membership',async()=>{
 const f=await fixture({modules:{leagues:false}});await f.track('alice');assert.equal(await f.sdk.joinLeague({...scope,subject:'alice'}),false);
 const g=await fixture({modules:{leagues:true}});await g.track('alice');await g.sdk.joinLeague({...scope,subject:'alice'});await g.sdk.eraseSubject({...scope,subject:'alice'});
 assert.equal(g.repo.debug.leagueMembers.size,0);
});

test('portable HTTP gateway supports mission read but protects mission administration',async()=>{
 const {createTMNTGateway,makeSignedTMNTRequest}=await import('../src/integrations/http-gateway.mjs');
 const f=await fixture();await f.track('alice');
 const credentials={'lab/academy/test':{secret:'k'.repeat(40)}};
 const gateway=createTMNTGateway({engine:f.sdk,nonceStore:f.repo,credentials,now:()=>Date.parse(start)});
 const make=(operation,params={})=>makeSignedTMNTRequest({baseUrl:'http://localhost:3031',scope:'lab/academy/test',subject:'alice',secret:'k'.repeat(40),operation,params,timestamp:Date.parse(start)});
 assert.equal((await gateway(make('defineDailyMission',{missionKey:'one',event:'lesson_completed',target:1,rewardXp:5}))).status,403);
 const allowed=await gateway(make('dailyMissions'));assert.equal(allowed.status,200);assert.deepEqual((await allowed.json()).result,[]);
 const admin=createTMNTGateway({engine:f.sdk,nonceStore:f.repo,credentials:{'lab/academy/test':{secret:'k'.repeat(40),actions:['defineDailyMission']}},now:()=>Date.parse(start)});
 const response=await admin(make('defineDailyMission',{missionKey:'one',event:'lesson_completed',target:1,rewardXp:5}));assert.equal(response.status,200);
 assert.equal((await response.json()).result,true);
});

test('non-prespecified alpha is rejected to keep 95% intervals coherent',()=>{const arms={treatment:{eligible:100,retained:50},holdout:{eligible:100,retained:50}};assert.throws(()=>assessExperiment({arms},{holdoutPercent:50,alpha:0.1}));});

test('mission reward does not promise XP for an app without habits',async()=>{const f=await fixture({modules:{habits:false,missions:true}});assert.equal(await f.sdk.defineDailyMission({...scope,missionKey:'xp_fake',event:'lesson_completed',target:1,rewardXp:15}),false);assert.equal(await f.sdk.defineDailyMission({...scope,missionKey:'no_xp',event:'lesson_completed',target:1,rewardXp:0}),true);});
