import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const scope={tenant:'alpha',app:'academy',environment:'test'};
let time;
function make(){time=new Date('2026-10-20T12:00:00.000Z');const repo=createMemoryRepository({now:()=>time}),sdk=createTMNT({repository:repo,now:()=>time});return {sdk,repo};}
async function app(sdk,scope0=scope,social=true){return sdk.registerApp({...scope0,keyHash:'a'.repeat(64),cadence:'daily',modules:{notifications:true,social},quietStart:0,quietEnd:23,events:[{name:'activity_completed',value:true},{name:'app_opened',value:false}]});}
async function track(sdk,subject,event='activity_completed',scope0=scope,at=time){return sdk.track({...scope0,subject,event,eventId:randomUUID(),occurredAt:at,timezone:'UTC'});}
test('explicit bilateral friend acceptance; self, one-way or duplicate invitations rejected',async()=>{
 const {sdk}=make();await app(sdk);await track(sdk,'alice');await track(sdk,'bob');
 await assert.rejects(()=>sdk.inviteFriend({...scope,subject:'alice',friend:'alice'}));
 assert.equal(await sdk.inviteFriend({...scope,subject:'alice',friend:'bob'}),true);
 assert.equal(await sdk.inviteFriend({...scope,subject:'bob',friend:'alice'}),false);
 assert.equal(await sdk.startFriendQuest({...scope,subject:'alice',friend:'bob',questKey:'weekly01'}),false);
 assert.equal(await sdk.respondFriend({...scope,subject:'alice',friend:'bob',accept:true}),false);
 assert.equal(await sdk.respondFriend({...scope,subject:'bob',friend:'alice',accept:true}),true);
 assert.equal(await sdk.respondFriend({...scope,subject:'bob',friend:'alice',accept:true}),false);
 assert.equal(await sdk.startFriendQuest({...scope,subject:'alice',friend:'bob',questKey:'weekly01',targetDays:3}),true);
 assert.equal(await sdk.startFriendQuest({...scope,subject:'bob',friend:'alice',questKey:'weekly01'}),false);
});
test('real value days only, one contribution per person per day, completion by both friends',async()=>{
 const {sdk}=make();await app(sdk);await track(sdk,'alice');await track(sdk,'bob');
 await sdk.inviteFriend({...scope,subject:'alice',friend:'bob'});await sdk.respondFriend({...scope,subject:'bob',friend:'alice',accept:true});
 assert.equal(await sdk.startFriendQuest({...scope,subject:'alice',friend:'bob',questKey:'weekly02',targetDays:3}),true);
 await track(sdk,'alice','app_opened');await track(sdk,'alice','activity_completed');
 await track(sdk,'alice','activity_completed');await track(sdk,'bob','activity_completed');
 let state=await sdk.friendQuestStatus({...scope,subject:'bob',friend:'alice',questKey:'weekly02'});
 assert.equal(state.daysCompleted,2);assert.equal(state.completed,false);
 time=new Date('2026-10-21T12:00:00.000Z');
 await track(sdk,'bob','activity_completed');state=await sdk.friendQuestStatus({...scope,subject:'alice',friend:'bob',questKey:'weekly02'});
 assert.equal(state.daysCompleted,3);assert.equal(state.completed,true);
});
test('social opt-in disabled, foreign app, nonexistent friend and decline are fail-closed',async()=>{
 const {sdk}=make();await app(sdk,scope,false);await track(sdk,'alice');await track(sdk,'bob');
 assert.equal(await sdk.inviteFriend({...scope,subject:'alice',friend:'bob'}),false);
 const alt={tenant:'another',app:'academy',environment:'test'};await app(sdk,alt,true);await track(sdk,'alice','activity_completed',alt);
 assert.equal(await sdk.inviteFriend({...alt,subject:'alice',friend:'bob'}),false);
 await track(sdk,'bob','activity_completed',alt);
 assert.equal(await sdk.inviteFriend({...alt,subject:'alice',friend:'bob'}),true);
 assert.equal(await sdk.respondFriend({...alt,subject:'bob',friend:'alice',accept:false}),true);
 assert.equal(await sdk.startFriendQuest({...alt,subject:'bob',friend:'alice',questKey:'nope'}),false);
});
test('invalid duration and target, missing quest and per-scope deletion cascade',async()=>{
 const {sdk,repo}=make();await app(sdk);await track(sdk,'alice');await track(sdk,'bob');
 await sdk.inviteFriend({...scope,subject:'alice',friend:'bob'});await sdk.respondFriend({...scope,subject:'bob',friend:'alice',accept:true});
 await assert.rejects(()=>sdk.startFriendQuest({...scope,subject:'alice',friend:'bob',questKey:'x',targetDays:31}));
 await assert.rejects(()=>sdk.startFriendQuest({...scope,subject:'alice',friend:'bob',questKey:'x',targetDays:5,durationDays:1}));
 assert.equal(await sdk.friendQuestStatus({...scope,subject:'alice',friend:'bob',questKey:'missing'}),null);
 await sdk.startFriendQuest({...scope,subject:'alice',friend:'bob',questKey:'valid'});await track(sdk,'bob');
 assert.equal(repo.debug.friendships.size,1);assert.equal(repo.debug.quests.size,1);
 assert.equal(await sdk.eraseSubject({...scope,subject:'bob'}),true);
 assert.equal(repo.debug.friendships.size,0);assert.equal(repo.debug.quests.size,0);assert.equal(repo.debug.questDays.size,0);
});
test('backdated value events and after-expiration events cannot earn quest days',async()=>{
 const {sdk}=make();await app(sdk);await track(sdk,'alice');await track(sdk,'bob');
 await sdk.inviteFriend({...scope,subject:'alice',friend:'bob'});await sdk.respondFriend({...scope,subject:'bob',friend:'alice',accept:true});
 await sdk.startFriendQuest({...scope,subject:'alice',friend:'bob',questKey:'timed',durationDays:1,targetDays:2});
 await track(sdk,'alice','activity_completed',scope,new Date('2026-10-19T12:00:00.000Z'));
 time=new Date('2026-10-22T12:00:00.000Z');await track(sdk,'bob');
 const x=await sdk.friendQuestStatus({...scope,subject:'alice',friend:'bob',questKey:'timed'});
 assert.equal(x.daysCompleted,0);assert.equal(x.expired,true);
});

test('unfriending immediately revokes shared missions and clears contributions',async()=>{
 const {sdk,repo}=make();await app(sdk);await track(sdk,'alice');await track(sdk,'bob');
 await sdk.inviteFriend({...scope,subject:'alice',friend:'bob'});
 await sdk.respondFriend({...scope,subject:'bob',friend:'alice',accept:true});
 await sdk.startFriendQuest({...scope,subject:'alice',friend:'bob',questKey:'revoked'});
 await track(sdk,'alice');
 assert.equal(repo.debug.questDays.size,1);
 assert.equal(await sdk.removeFriend({...scope,subject:'bob',friend:'alice'}),true);
 assert.equal(await sdk.friendQuestStatus({...scope,subject:'bob',friend:'alice',questKey:'revoked'}),null);
 assert.equal(repo.debug.questDays.size,0);
 assert.equal(await sdk.removeFriend({...scope,subject:'bob',friend:'alice'}),false);
});
