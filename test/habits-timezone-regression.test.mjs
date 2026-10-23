import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {advanceHabit,createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';

// Calendar boundaries should be defined by the user's own IANA timezone,
// matching PostgreSQL (occurred_at AT TIME ZONE timezone)::date.
const pairs=[
 {name:'Sao Paulo: midnight UTC falls within the same local day',tz:'America/Sao_Paulo',a:'2026-10-18T20:30:00-03:00',b:'2026-10-18T23:30:00-03:00'},
 {name:'Tokyo: both instants are the same Japan calendar day',tz:'Asia/Tokyo',a:'2026-10-18T00:30:00+09:00',b:'2026-10-18T23:30:00+09:00'},
 {name:'New York: fall DST repeated 01:30 is still one local day',tz:'America/New_York',a:'2026-11-01T01:30:00-04:00',b:'2026-11-01T01:30:00-05:00'},
 {name:'New York: spring DST jump does not create a new day',tz:'America/New_York',a:'2026-03-08T01:30:00-05:00',b:'2026-03-08T03:30:00-04:00'},
 {name:'UTC: subsequent activity on the same UTC day',tz:'UTC',a:'2026-10-18T00:30:00Z',b:'2026-10-18T23:30:00Z'}
];
for(const {name,tz,a,b} of pairs){
 test(name,()=>{
  const first=advanceHabit({},a,{timezone:tz,goal:3,freezeBalance:1});
  const next=advanceHabit(first,b,{timezone:tz});
  assert.equal(next.streak,1);
  assert.equal(next.todayCount,2);
  assert.equal(next.dailyGoal,3);
  assert.equal(next.xp,20);
  assert.equal(next.goalMet,false);
 });
}

const boundaries=[
 {name:'Sao Paulo',tz:'America/Sao_Paulo',a:'2026-10-18T23:55:00-03:00',b:'2026-10-19T00:05:00-03:00'},
 {name:'Tokyo',tz:'Asia/Tokyo',a:'2026-10-18T23:55:00+09:00',b:'2026-10-19T00:05:00+09:00'},
 {name:'NY spring-forward',tz:'America/New_York',a:'2026-03-08T23:55:00-04:00',b:'2026-03-09T00:05:00-04:00'},
 {name:'UTC',tz:'UTC',a:'2026-10-18T23:55:00Z',b:'2026-10-19T00:05:00Z'}
];
for(const {name,tz,a,b} of boundaries){
 test(name+': local midnight advances exactly once',()=>{
  const first=advanceHabit({},a,{timezone:tz,goal:3});
  const next=advanceHabit(first,b,{timezone:tz});
  assert.equal(next.streak,2);
  assert.equal(next.todayCount,1);
  assert.equal(next.dailyGoal,3);
  assert.equal(next.goalMet,false);
 });
}

test('saved daily goal persists through repeated events, new day, and freeze',()=>{
 const a=advanceHabit({},'2026-10-16T12:00:00Z',{goal:4,freezeBalance:1});
 const b=advanceHabit(a,'2026-10-16T15:00:00Z');
 const c=advanceHabit(b,'2026-10-18T12:00:00Z');
 assert.equal(c.dailyGoal,4);
 assert.equal(c.streak,2);
 assert.equal(c.todayCount,1);
 assert.equal(c.freezeBalance,0);
 assert.equal(c.goalMet,false);
});

test('older out-of-order upload never rewinds streak or awards XP',()=>{
 const a=advanceHabit({},'2026-10-18T12:00:00Z',{goal:3});
 const b=advanceHabit(a,'2026-10-19T12:00:00Z');
 const old=advanceHabit(b,'2026-10-17T12:00:00Z');
 assert.equal(old.ignoredStale,true);
 for(const field of ['streak','lastDay','xp','dailyGoal','todayCount','freezeBalance'])assert.equal(old[field],b[field]);
});

test('duplicate event UUID is idempotent and personalized goal persists through tracking',async()=>{
 const now=()=>new Date('2026-10-20T16:00:00Z');
 const repo=createMemoryRepository({now});const engine=createTMNT({repository:repo,now});
 const scope={tenant:'regression',app:'academy',environment:'test'};
 await engine.registerApp({...scope,keyHash:'e'.repeat(64),cadence:'daily',modules:{habits:true},events:[{name:'lesson_completed',value:true}]});
 const subject='sample',timezone='America/Sao_Paulo';
 const track=(eventId,occurredAt)=>engine.track({...scope,subject,timezone,locale:'pt-BR',event:'lesson_completed',eventId,occurredAt});
 const uuid=randomUUID();
 assert.equal(await track(uuid,'2026-10-18T20:30:00-03:00'),true);
 assert.equal(await engine.setHabitGoal({...scope,subject,goal:3}),true);
 assert.equal(await track(uuid,'2026-10-18T20:30:00-03:00'),false);
 assert.equal(await track(randomUUID(),'2026-10-18T23:30:00-03:00'),true);
 const first=await engine.getHabit({...scope,subject});
 assert.equal(first.dailyGoal,3);assert.equal(first.streak,1);assert.equal(first.xp,20);assert.equal(first.todayCount,2);
 assert.equal(await track(randomUUID(),'2026-10-19T20:30:00-03:00'),true);
 const second=await engine.getHabit({...scope,subject});
 assert.equal(second.dailyGoal,3);assert.equal(second.streak,2);assert.equal(second.todayCount,1);assert.equal(second.xp,30);
});

test('goal 10 remains intact after day change and goal met only after tenth value',()=>{
 let x=advanceHabit({},'2026-10-19T12:00:00Z',{timezone:'UTC',goal:10});
 for(let i=1;i<10;i++)x=advanceHabit(x,`2026-10-19T${String(12+i).padStart(2,'0')}:00:00Z`,{timezone:'UTC'});
 assert.equal(x.todayCount,10);assert.equal(x.goalMet,true);assert.equal(x.dailyGoal,10);
 const y=advanceHabit(x,'2026-10-20T12:00:00Z',{timezone:'UTC'});
 assert.equal(y.dailyGoal,10);assert.equal(y.todayCount,1);assert.equal(y.goalMet,false);assert.equal(y.streak,2);
});

test('changing a daily goal immediately recomputes goalMet (without an event)',async()=>{
 const repo=createMemoryRepository({now:()=>new Date('2026-10-20T12:00:00Z')});
 const engine=createTMNT({repository:repo,now:()=>new Date('2026-10-20T12:00:00Z')});
 const s={tenant:'regression',app:'goals',environment:'test'};
 await engine.registerApp({...s,keyHash:'e'.repeat(64),modules:{habits:true},events:[{name:'task_completed',value:true}]});
 await engine.track({...s,subject:'person',eventId:randomUUID(),event:'task_completed',occurredAt:'2026-10-20T10:00:00Z'});
 assert.equal((await engine.getHabit({...s,subject:'person'})).goalMet,true);
 assert.equal(await engine.setHabitGoal({...s,subject:'person',goal:3}),true);
 assert.equal((await engine.getHabit({...s,subject:'person'})).goalMet,false);
 assert.equal(await engine.setHabitGoal({...s,subject:'person',goal:1}),true);
 assert.equal((await engine.getHabit({...s,subject:'person'})).goalMet,true);
});

test('Neon SDK getHabit normalizes PostgreSQL DATE, BIGINT, and goalMet',async()=>{
 const {createNeonRepository}=await import('../src/storage/neon.mjs');
 const sql=async()=>[{lastDay:new Date('2026-10-18T00:00:00.000Z'),streak:1,longestStreak:1,todayCount:2,dailyGoal:3,xp:'20',freezeBalance:1}];
 const repository=await createNeonRepository(null,{sql});
 const habit=await repository.getHabit({tenant:'regression',app:'goals',environment:'test',subject:'person'});
 assert.deepEqual(habit,{lastDay:'2026-10-18',streak:1,longestStreak:1,todayCount:2,dailyGoal:3,xp:20,freezeBalance:1,goalMet:false});
});
