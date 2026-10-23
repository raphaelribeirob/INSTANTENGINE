import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const registry=JSON.parse(readFileSync(new URL('../config/app-profiles.qa.json',import.meta.url),'utf8'));
test('6 app profiles conform to server SDK contract and tenant boundaries',async()=>{
 assert.equal(registry.profiles.length,6);
 const repo=createMemoryRepository(),engine=createTMNT({repository:repo});
 for(const profile of registry.profiles){
  assert.equal(await engine.registerApp({...profile,keyHash:'f'.repeat(64)}),true,profile.app);
  const scope={tenant:profile.tenant,app:profile.app,environment:profile.environment,subject:'qa_user'};
  assert.equal(await engine.track({...scope,eventId:randomUUID(),event:profile.events[0].name,occurredAt:'2026-10-20T12:00:00Z'}),true,profile.app);
  assert.equal(await engine.getHabit(scope)!==null,Boolean(profile.modules.habits),profile.app);
  assert.equal(await engine.schedule({...scope,campaignKey:'auto_demo',templateId:'default'}),null,'No consent or holdout exposure means no push');
 }
 assert.equal(repo.debug.apps.size,6);
 assert.equal(repo.debug.events.size,6);
});
test('profiles do not default to forced streaks for episodic or non-learning apps',()=>{
 const profiles=registry.profiles;
 for(const x of profiles){assert.equal(x.environment,'test');assert.equal(x.tenant,'tmntqa');}
 for(const app of ['instantbible','instantcloser','agesoma']){
  const x=profiles.find(p=>p.app===app);assert.ok(x);assert.notEqual(x.modules.habits,true);
 }
 assert.equal(profiles.find(p=>p.app==='agesoma').cadence,'episodic');
});
