import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTMNTGateway,makeSignedTMNTRequest} from '../src/integrations/http-gateway.mjs';
import {assessExperiment} from '../src/retention-next.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
import {createTMNT} from '../src/index.mjs';

const scope={tenant:'vtest',app:'study',environment:'test'};
const when=()=>new Date('2026-10-20T12:00:00Z');
async function setup(modules={social:true,friendStreaks:true}){
 const repo=createMemoryRepository({now:when}),sdk=createTMNT({repository:repo,now:when});
 await sdk.registerApp({...scope,keyHash:'b'.repeat(64),modules,events:[{name:'lesson_completed',value:true}]});
 for(let i=0;i<12;i++)await sdk.track({...scope,subject:`u${i}`,eventId:randomUUID(),event:'lesson_completed',occurredAt:when(),timezone:'UTC'});
 return {repo,sdk,invite:(user,friend)=>sdk.inviteFriend({...scope,subject:user,friend}),respond:(user,friend)=>sdk.respondFriend({...scope,subject:user,friend,accept:true})};
}

test('prod receiver rejects signed HTTP downgrade before consuming nonce',async()=>{
 const secret='t'.repeat(48),registered='vtest/study/prod',calls=[];
 const gw=createTMNTGateway({engine:{track:async()=>true},nonceStore:{nonceDurability:'persistent',claimRequest:async x=>{calls.push(x);return true;}},credentials:{[registered]:{secret,actions:['track']}},now:()=>when().getTime()});
 const secure=makeSignedTMNTRequest({baseUrl:'https://example.org',scope:registered,subject:'u0',secret,operation:'track',params:{},timestamp:when().getTime()});
 const raw=await secure.text();
 const downgraded=new Request('http://example.org/tmnt/v1/action',{method:'POST',headers:secure.headers,body:raw});
 assert.equal((await gw(downgraded)).status,403);assert.equal(calls.length,0);
 const spoof=new Request('http://example.org/tmnt/v1/action',{method:'POST',headers:{...Object.fromEntries(secure.headers),'x-forwarded-proto':'https','forwarded':'proto=https'},body:raw});
 assert.equal((await gw(spoof)).status,403);assert.equal(calls.length,0);
 const valid=new Request(secure.url,{method:'POST',headers:secure.headers,body:raw});
 assert.equal((await gw(valid)).status,200);assert.equal(calls.length,1);
});
test('test/staging retain HTTP loopback mode; prod signer remains HTTPS-only',async()=>{
 const s='s'.repeat(40),scopeName='vtest/study/prod';
 assert.throws(()=>makeSignedTMNTRequest({baseUrl:'http://localhost',scope:scopeName,subject:'u0',secret:s,operation:'track'}),/HTTPS/);
});

test('Wilson/Newcombe interval is not degenerate at 0/100 and 100/100',()=>{
 const r=assessExperiment({arms:{treatment:{eligible:100,retained:100},holdout:{eligible:100,retained:0}}},{holdoutPercent:50});
 assert.equal(r.intervalMethod,'newcombe_wilson_95');assert.ok(r.confidenceInterval[0]<1&&r.confidenceInterval[0]>0.9);
 assert.ok(r.confidenceInterval[1]<=1);assert.ok(r.pValue>0&&r.pValue<1);assert.equal(r.causalClaim,false);
});
test('A/A, zero rates, small samples and SRM remain conservative',()=>{
 const aa=assessExperiment({arms:{treatment:{eligible:100,retained:0},holdout:{eligible:100,retained:0}}},{holdoutPercent:50});
 assert.equal(aa.pValue,1);assert.ok(aa.confidenceInterval[0]<0&&aa.confidenceInterval[1]>0);
 const small=assessExperiment({arms:{treatment:{eligible:2,retained:2},holdout:{eligible:2,retained:0}}},{holdoutPercent:50});
 assert.equal(small.status,'insufficient_sample');
 const srm=assessExperiment({arms:{treatment:{eligible:900,retained:800},holdout:{eligible:100,retained:20}}},{holdoutPercent:50});
 assert.equal(srm.status,'sample_ratio_mismatch');
});
test('defaults limit to five pending/accepted friendships per user',async()=>{
 const f=await setup();const responses=await Promise.all(Array.from({length:8},(_,i)=>f.invite('u0',`u${i+1}`)));
 assert.equal(responses.filter(Boolean).length,5);assert.equal(f.repo.debug.friendships.size,5);
});
test('limit protects recipients against many different senders',async()=>{
 const f=await setup();const attempts=await Promise.all(Array.from({length:8},(_,i)=>f.invite(`u${i+1}`,'u0')));
 assert.equal(attempts.filter(Boolean).length,5);
});
test('app can choose stricter max connections and daily send rate',async()=>{
 const f=await setup({social:true,socialMaxFriends:8,socialDailyInvites:2});
 assert.equal(await f.invite('u0','u1'),true);
 assert.equal(await f.invite('u0','u2'),true);
 assert.equal(await f.invite('u0','u3'),false);
 await f.sdk.removeFriend({...scope,subject:'u0',friend:'u1'});
 assert.equal(await f.invite('u0','u4'),false); // removing friend does not reset 24h rate
});
test('invalid social thresholds rejected at registration',async()=>{
 const repo=createMemoryRepository(),sdk=createTMNT({repository:repo});
 for(const socialMaxFriends of [-1,0,51,'unlimited',1.5])await assert.rejects(()=>sdk.registerApp({...scope,keyHash:'b'.repeat(64),modules:{social:true,socialMaxFriends},events:[{name:'lesson_completed',value:true}]}),/modules/);
});
test('social isolation and erasure remove user-owned invite history',async()=>{
 const f=await setup();await f.invite('u0','u1');assert.equal(f.repo.debug.inviteAttempts.size,1);
 await f.sdk.eraseSubject({...scope,subject:'u0'});
 assert.equal(f.repo.debug.inviteAttempts.size,0);assert.equal(f.repo.debug.friendships.size,0);
});

test('offline upload reconciliation rebuilds verified streak without invented activities or duplicate XP',async()=>{
 let clock=new Date('2026-10-20T15:00:00Z');
 const repo=createMemoryRepository({now:()=>clock}),sdk=createTMNT({repository:repo,now:()=>clock});
 await sdk.registerApp({...scope,keyHash:'a'.repeat(64),modules:{habits:true},events:[{name:'lesson_completed',value:true},{name:'app_opened',value:false}]});
 const input=(event,at,id=randomUUID())=>sdk.track({...scope,subject:'alice',eventId:id,event,occurredAt:at,timezone:'UTC'});
 assert.equal(await input('lesson_completed','2026-10-20T11:00:00Z'),true);
 assert.equal(await sdk.setHabitGoal({...scope,subject:'alice',goal:3}),true);
 assert.equal(await input('lesson_completed','2026-10-18T11:00:00Z'),true);
 assert.equal(await input('app_opened','2026-10-19T11:00:00Z'),true);
 assert.equal((await sdk.getHabit({...scope,subject:'alice'})).streak,1);
 assert.equal(await input('lesson_completed','2026-10-19T11:00:00Z'),true);
 const first=await sdk.reconcileHabit({...scope,subject:'alice'});
 assert.equal(first.streak,3);assert.equal(first.xp,30);assert.equal(first.dailyGoal,3);
 const repeat=await sdk.reconcileHabit({...scope,subject:'alice'});
 assert.deepEqual(repeat,first);assert.equal(repo.debug.events.size,4);
});
test('reconciliation does not erase XP earned from completed daily missions',async()=>{
 const f=await setup({habits:true,missions:true});
 await f.sdk.defineDailyMission({...scope,missionKey:'one',event:'lesson_completed',target:1,rewardXp:20});
 assert.equal(await f.sdk.claimDailyMission({...scope,subject:'u0',missionKey:'one'}),true);
 const state=await f.sdk.reconcileHabit({...scope,subject:'u0'});
 assert.equal(state.xp,30);
 assert.equal((await f.sdk.reconcileHabit({...scope,subject:'u0'})).xp,30);
});
test('reconciliation only available to backends with explicit administrative action',async()=>{
 const {repo,sdk}=await setup({habits:true});
 const secret='k'.repeat(40),cred={'vtest/study/test':{secret}},create=(nonce=randomUUID())=>makeSignedTMNTRequest({baseUrl:'http://localhost',scope:'vtest/study/test',subject:'u0',secret,operation:'reconcileHabit',timestamp:when().getTime(),nonce});
 const gateway=createTMNTGateway({engine:sdk,nonceStore:repo,credentials:cred,now:()=>when().getTime()});
 assert.equal((await gateway(create())).status,403);
 const admin=createTMNTGateway({engine:sdk,nonceStore:repo,credentials:{'vtest/study/test':{secret,actions:['reconcileHabit']}},now:()=>when().getTime()});
 assert.equal((await admin(create())).status,200);
});
