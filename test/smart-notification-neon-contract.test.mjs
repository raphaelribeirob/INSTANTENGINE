import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeonRepository} from '../src/storage/neon.mjs';
import {neonAdapter} from '../src/worker.mjs';

const scope={tenant:'river',app:'academy',environment:'test',subject:'learner_1',campaignKey:'day_1',kind:'reminder'};
const row={enabled:true,modules:{notifications:true,analytics:true},cadence:'daily',quiet_start:8,quiet_end:22,weekly_limit:7,
  timezone:'America/Sao_Paulo',locale:'pt-BR',last_value_at:'2026-10-20T18:00:00Z',reminder_hour:null,reminder_hour_source:'unset',paused_until:null,
  granted:true,verified:true,arm:'treatment',streak:3,daily_goal:2};
function fakeSql(user=row){
 const calls=[];
 const sql=async(strings,...params)=>{const query=strings.join('?');calls.push({query,params});
  if(query.includes('SELECT cfg.enabled,cfg.modules'))return user?[user]:[];
  if(query.includes('FROM r3_v1_outbox q')&&query.includes('verified_value'))return [{status:'provider_accepted',sent_at:'2026-10-18T18:00:00Z',verified_value:true,lease_until:null}];
  if(query.includes('SELECT 1 AS present FROM r3_v1_outbox'))return [];
  if(query.includes('SELECT u.locale,u.timezone'))return [{locale:'pt-BR',timezone:'America/Sao_Paulo'}];
  if(query.includes('FROM r3_v1_message_decisions d WHERE'))return [{template_id:'neutral_tip'}];
  if(query.includes('COUNT(*)::integer AS views'))return [{template_id:'neutral_tip',views:20,successes:10}];
  if(query.includes('SELECT cfg.quiet_start,cfg.quiet_end'))return [{quiet_start:8,quiet_end:22,reminder_hour:null,timezone:'America/Sao_Paulo'}];
  if(query.includes('SELECT * FROM r3_v1_send_time_observations'))return [{hour:15,converted:true}];
  if(query.includes('SELECT EXISTS('))return [{eligible:true}];
  throw new Error('Unexpected SQL contract query: '+query.slice(0,100));
 };return {sql,calls};
}
test('Neon smart context is tenant-scoped and contains previous value outcomes',async()=>{
 const f=fakeSql(),r=await createNeonRepository(null,{sql:f.sql});
 const x=await r.smartNotificationContext(scope);
 assert.equal(x.arm,'treatment');assert.equal(x.consent.granted,true);assert.equal(x.habit.streak,3);
 assert.equal(x.deliveries[0].verifiedValue,true);assert.equal(x.observations[0].hour,15);
 assert.equal(x.stats.neutral_tip.successes,10);
 for(const q of f.calls)if(q.query.includes('verified_value')||q.query.includes('SELECT 1 AS present FROM r3_v1_outbox'))for(const id of ['river','academy','test','learner_1'])assert.ok(q.params.includes(id));
});
test('Neon smart context fails closed and avoids behavioral queries without consent',async()=>{
 const f=fakeSql({...row,granted:false});const r=await createNeonRepository(null,{sql:f.sql});
 const x=await r.smartNotificationContext(scope);
 assert.equal(x.consent.granted,false);assert.deepEqual(x.deliveries,[]);
 assert.equal(f.calls.length,1);
});
test('worker SQL preflight enforces mature no-value notification fatigue in all scheduling paths',async()=>{
 const f=fakeSql();const a=await neonAdapter(null,{sql:f.sql});
 const job={t:'river',a:'academy',e:'test',s:'learner_1',job_id:'11111111-1111-4111-8111-111111111111',attempt:1};
 assert.equal(await a.preflight(job,'worker'),true);
 const sql=f.calls[0].query;
 assert.match(sql,/notification_fatigue|mature provider-accepted|COUNT\(\*\) FROM r3_v1_outbox fatigue/);
 assert.match(sql,/r3_v1_message_outcomes mv/);
 assert.match(sql,/c\.granted AND c\.verified/);
 assert.match(sql,/q\.status='sending'/);
 assert.match(sql,/x\.arm='treatment'/);
});
