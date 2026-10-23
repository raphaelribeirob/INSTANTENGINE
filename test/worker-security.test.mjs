import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {neonAdapter,posthogEvent,runCycle,validateSettings} from '../src/worker.mjs';

const baseSettings={enabled:true,allowed:['test'],apps:{'tenant/app/test':{app_id:'test-id',rest_api_key:'secret'}},templates:{},posthogKey:'',hashSecret:'',posthogHost:'https://us.i.posthog.com'};
const j=(e='test')=>({job_id:randomUUID(),t:'tenant',a:'app',e,s:'u_1',template:'m1',locale:'en',attempt:1});

test('neon claims only explicitly allowed environments before touching queue',async()=>{
  const calls=[];
  const sql=async(parts,...values)=>{calls.push({q:parts.join('?'),values});return [];};
  const adapter=await neonAdapter(null,{sql});
  assert.equal(await adapter.claim('worker_1234',['staging','test'],['tenant/app/staging','tenant/app/test']),null);
  assert.match(calls[0].q,/r3_v1_claim_job_scoped/);
  assert.ok(!calls[0].q.includes('r3_v1_claim_job('));
  assert.deepEqual(calls[0].values,['worker_1234','staging,test','tenant/app/staging,tenant/app/test']);
});
test('neon claim requires valid environment scope',async()=>{
  let called=0;const sql=async()=>{called++;return [];};
  const adapter=await neonAdapter(null,{sql});
  for(const value of [[],['production'],['test','bad'],null,'test'])await assert.rejects(adapter.claim('worker_1234',value,['tenant/app/test']),/scope required/);
  for(const value of [[],null,['bad'],['tenant/app/prod']])await assert.rejects(adapter.claim('worker_1234',['test'],value),/scope required/);
  assert.equal(called,0);
});
test('runCycle passes explicit environments to claim',async()=>{
  const captured=[];
  const db={claim:async(worker,allowed,scopes)=>{captured.push({worker,allowed,scopes});return null;}};
  const result=await runCycle({db,settings:baseSettings,workerId:'worker_1234'});
  assert.equal(result.claimed,0);
  assert.deepEqual(captured,[{worker:'worker_1234',allowed:['test'],scopes:['tenant/app/test']}]);
});
test('scoped mock queue leaves production jobs intact when test worker runs',async()=>{
  const prod=j('prod'),testJob=j('test'),queue=[prod,testJob],claims=[];
  const db={
    claim:async(_,allowed)=>{const index=queue.findIndex(item=>allowed.includes(item.e));if(index<0)return null;return queue.splice(index,1)[0];},
    preflight:async()=>true,
    finish:async(job)=>{claims.push(job.e);return true;},
  };
  const settings={...baseSettings};
  const result=await runCycle({db,settings,deliver:async()=>({providerId:'simulated_accepted'})});
  assert.equal(result.accepted,1);
  assert.equal(result.claimed,1);
  assert.deepEqual(claims,['test']);
  assert.deepEqual(queue,[prod]);
});
test('legacy unscoped adapter is rejected before any provider I/O',async()=>{
  let sends=0,updates=0;
  const db={claim:async()=>j('prod'),suppress:async()=>{updates++;},finish:async()=>{updates++;}};
  await assert.rejects(runCycle({db,settings:baseSettings,deliver:async()=>{sends++;return {providerId:'x'};}}),/outside configured app\/environment scopes/);
  assert.equal(sends,0);assert.equal(updates,0);
});
test('duplicate permitted environments are rejected in settings',()=>{
  assert.throws(()=>validateSettings({R3_PUSH_ENABLED:'true',TMNT_ALLOWED_PUSH_ENVIRONMENTS:'test,test'}),/Invalid allowed environments/);
});
test('PostHog refuses to transmit without adequate secret',async()=>{
  let sent=0;
  await assert.rejects(posthogEvent('x',{tenant:'t',app:'a',environment:'test',subject:'user'}, {...baseSettings,posthogKey:'phc_test'}, {fetchImpl:async()=>{sent++;}}),/Strong analytics hashing secret/);
  assert.equal(sent,0);
});
test('PostHog uses HMAC with secret and scope, never unsalted hash',async()=>{
  let posted;
  const hashSecret='testing-private-hmac-key-with-adequate-entropy';
  const x={tenant:'tenant',app:'app',environment:'test',subject:'opaque_user',id:randomUUID(),accepted:true};
  const result=await posthogEvent('tmnt_push_provider_result',x,{...baseSettings,posthogKey:'phc_test',hashSecret},{isEligible:async()=>true,fetchImpl:async(_,options)=>{posted=JSON.parse(options.body);return {ok:true};}});
  assert.deepEqual(result,{ok:true});
  assert.equal(posted.distinct_id,createHmac('sha256',hashSecret).update([x.tenant,x.app,x.environment,x.subject].join('\x1f')).digest('hex'));
  assert.ok(!JSON.stringify(posted).includes(x.subject));
});
test('migration filters candidate and rechecks selected row before mutation',()=>{
  const sql=readFileSync(new URL('../migrations/0006_scoped_worker_claim.sql',import.meta.url),'utf8');
  assert.match(sql,/environment\s*=\s*ANY\(allowed_envs\)/);
  assert.match(sql,/z\.environment=ANY\(allowed_envs\)/);
  assert.match(sql,/allowed_scopes/);
  assert.match(sql,/FOR UPDATE SKIP LOCKED/);
  assert.match(sql,/r3_v1_claim_job_scoped/);
  assert.match(sql,/r3_v1_consents/);
  assert.match(sql,/r3_v1_exposures/);
});
test('same-environment jobs from unconfigured apps are not claimed',async()=>{
  const app1=j('test');const app2={...j('test'),a:'otherapp'};
  const queue=[app2,app1];let sends=0;
  const db={claim:async(_,allowed,scopes)=>{
    const pos=queue.findIndex(x=>allowed.includes(x.e)&&scopes.includes(`${x.t}/${x.a}/${x.e}`));
    return pos<0?null:queue.splice(pos,1)[0];
  },preflight:async()=>true,finish:async()=>true};
  const out=await runCycle({db,settings:baseSettings,deliver:async()=>{sends++;return {providerId:'simulated_accepted'}}});
  assert.equal(out.accepted,1);assert.equal(sends,1);assert.deepEqual(queue,[app2]);
});
test('worker with no configured provider does not dequeue any app',async()=>{
  let claims=0;
  await assert.rejects(runCycle({db:{claim:async()=>{claims++;return null;}},settings:{...baseSettings,apps:{}}}),/No eligible push providers/);
  assert.equal(claims,0);
});
test('neon scope validation rejects any app from other environment',async()=>{
  let calls=0;
  const db=await neonAdapter(null,{sql:async()=>{calls++;return [];}});
  await assert.rejects(db.claim('worker_1234',['test'],['tenant/app/prod']),/scope required/);
  assert.equal(calls,0);
});
