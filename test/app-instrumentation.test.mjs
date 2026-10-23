import test from 'node:test';import assert from 'node:assert/strict';
import {createRiverAppInstrumentation} from '../src/integrations/app-instrumentation.mjs';
import {createRiverEngine} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const eid='cc3c3c3c-0000-4000-8000-000000000001',scope={tenant:'river',app:'study',environment:'test'};
function make(){const repo=createMemoryRepository(),engine=createRiverEngine({repository:repo});let calls=0;
 const app=createRiverAppInstrumentation({...scope,engine,events:['lesson_completed'],enabled:true,
 verifyBusinessEvent:async(q)=>{calls++;return q.event==='lesson_completed'?{verified:true,subject:'authenticated_subject',event:q.event,occurredAt:new Date().toISOString(),locale:'pt-BR',timezone:'America/Sao_Paulo'}:null;}});
 return {repo,engine,app,getCalls:()=>calls};}
test('backend verified completion is accepted exactly once',async()=>{const x=make();await x.engine.registerApp({...scope,keyHash:'a'.repeat(64),modules:{habits:true,analytics:true},events:[{name:'lesson_completed',value:true}]});assert.equal((await x.app.record({businessEventId:eid,event:'lesson_completed'})).status,'recorded');assert.equal((await x.app.record({businessEventId:eid,event:'lesson_completed'})).status,'duplicate');assert.equal((await x.engine.getHabit({...scope,subject:'authenticated_subject'})).todayCount,1);});
test('unregistered event does not call app verifier or create data',async()=>{const x=make();assert.equal((await x.app.record({businessEventId:eid,event:'app_opened'})).status,'invalid_or_unregistered_event');assert.equal(x.getCalls(),0);});
test('unverified business event rejected without raw-client identity',async()=>{let called=0;const x=createRiverAppInstrumentation({...scope,enabled:true,events:['lesson_completed'],engine:{track:async()=>{called++;return true}},verifyBusinessEvent:async()=>({verified:false,subject:'spoof',event:'lesson_completed'})});assert.equal((await x.record({businessEventId:eid,event:'lesson_completed'})).status,'not_verified');assert.equal(called,0);});
test('production instrumentation remains disabled without explicit release',async()=>{const x=createRiverAppInstrumentation({tenant:'river',app:'study',environment:'prod',enabled:true,events:['lesson_completed'],engine:{track:async()=>true},verifyBusinessEvent:async()=>({verified:true,subject:'user',event:'lesson_completed'})});assert.equal((await x.record({businessEventId:eid,event:'lesson_completed'})).status,'production_disabled');});
