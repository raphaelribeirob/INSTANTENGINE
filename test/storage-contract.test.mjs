import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNeonRepository} from '../src/storage/neon.mjs';
import {neonAdapter} from '../src/worker.mjs';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const scope={tenant:'company',app:'work',environment:'test'};
test('Neon tagged-template adapter contract tests with injected trusted client, no database secrets',async()=>{
 const calls=[];const sql=async (parts,...values)=>{calls.push({query:parts.join('?'),values});if(parts.join('?').includes('r3_v1_quest_status'))return [{target_days:4,days_completed:'3',completed:false,expired:false}];if(parts.join('?').includes('r3_v1_ingest'))return [{ok:true}];return [{ok:true}];};
 const repo=await createNeonRepository(null,{sql});const sdk=createTMNT({repository:repo});
 assert.equal(await sdk.registerApp({...scope,keyHash:'a'.repeat(64),modules:{social:true},events:[{name:'task_completed',value:true}]}),true);
 assert.equal(await sdk.track({...scope,subject:'actor',event:'task_completed',eventId:randomUUID()}),true);
 assert.equal(await sdk.inviteFriend({...scope,subject:'actor',friend:'other'}),true);
 assert.equal(await sdk.respondFriend({...scope,subject:'other',friend:'actor',accept:true}),true);
 assert.equal(await sdk.removeFriend({...scope,subject:'other',friend:'actor'}),true);
 assert.equal(await sdk.startFriendQuest({...scope,subject:'actor',friend:'other',questKey:'mission',targetDays:4}),true);
 assert.deepEqual(await sdk.friendQuestStatus({...scope,subject:'actor',friend:'other',questKey:'mission'}),{targetDays:4,daysCompleted:3,completed:false,expired:false});
 for(const term of ['r3_v1_register_app','r3_v1_ingest','r3_v1_invite_friend','r3_v1_respond_friend','r3_v1_remove_friend','r3_v1_start_friend_quest','r3_v1_quest_status'])assert.ok(calls.some(x=>x.query.includes(term)),term);
 assert.ok(calls.every(x=>x.values.includes(scope.tenant)&&x.values.includes(scope.app)&&x.values.includes(scope.environment)));
});
test('Worker SQL preflight contract checks quiet hours, cadence, lease, cap, consent and holdout',async()=>{
 const calls=[];const sql=async (parts,...values)=>{const query=parts.join('?');calls.push({query,values});return [{eligible:true}];};
 const repo=await neonAdapter(null,{sql});const x=await repo.preflight({t:'company',a:'app',e:'test',s:'user',job_id:randomUUID(),attempt:1},'worker_hello');
 assert.equal(x,true);const q=calls[0].query;
 for(const token of ['quiet_start','quiet_end','weekly_limit','last_value_at','lease_until','push','retention_push','provider_accepted','cadence','reminder_hour'])assert.ok(q.includes(token),token);
 assert.ok(calls[0].values.includes('company'));
});
test('memory adapter concurrent event deduplication and 1000 scoped inserts',async()=>{
 const repo=createMemoryRepository(),sdk=createTMNT({repository:repo});
 await sdk.registerApp({...scope,keyHash:'b'.repeat(64),cadence:'none',events:[{name:'sale_completed',value:true}]});
 const common={...scope,subject:'user_1',event:'sale_completed',eventId:randomUUID()};
 assert.deepEqual((await Promise.all(Array.from({length:20},()=>sdk.track(common)))).filter(Boolean).length,1);
 const results=await Promise.all(Array.from({length:1000},(_,i)=>sdk.track({...scope,subject:`u${i%30}`,event:'sale_completed',eventId:randomUUID()})));
 assert.equal(results.filter(Boolean).length,1000);
 assert.equal(repo.debug.events.size,1001);
 assert.equal(repo.debug.subjects.size,31);
});
