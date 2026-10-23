import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateSettings,messageFor,sendOneSignal,runCycle,cronHandler,posthogEvent,safeEqual} from '../src/worker.mjs';
const job=()=>({job_id:randomUUID(),t:'acme',a:'app',e:'test',s:'subject_10',template:'remember',locale:'pt-BR',attempt:1});
const env={R3_PUSH_ENABLED:'true',TMNT_ALLOWED_PUSH_ENVIRONMENTS:'test',TMNT_ONESIGNAL_APPS_JSON:JSON.stringify({'acme/app/test':{app_id:'a'.repeat(36),rest_api_key:'test-private-key-is-long'}}),TMNT_TEMPLATES_JSON:JSON.stringify({remember:{en:{title:'Return',body:'Try one step'},pt:{title:'Volte',body:'Dê um passo'}}})};
const settings=()=>validateSettings(env);
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function dbjobs(arr){const calls=[];return {calls,async claim(w){calls.push(['claim',w]);return arr.shift()||null;},async preflight(j,w){calls.push(['preflight',j.job_id,w]);return true;},async suppress(j,w,reason){calls.push(['suppress',j.job_id,w,reason]);return true;},async finish(j,w,sent,id,err){calls.push(['finish',j.job_id,w,sent,id,err]);return true;}};}
test('off by default, no provider configuration needed',()=>{const x=validateSettings({});assert.equal(x.enabled,false);assert.deepEqual(x.allowed,[])});
test('safe auth timing comparison',()=>{assert.equal(safeEqual('a','a'),true);assert.equal(safeEqual('a','aa'),false);assert.equal(safeEqual(null,'a'),false)});
test('reject bad app key, short provider secret, template and allowed environments',()=>{
 assert.throws(()=>validateSettings({...env,TMNT_ONESIGNAL_APPS_JSON:JSON.stringify({'bad':{app_id:'aaa',rest_api_key:'short'}})}));
 assert.throws(()=>validateSettings({...env,TMNT_ALLOWED_PUSH_ENVIRONMENTS:'production'}));
 assert.throws(()=>validateSettings({...env,TMNT_TEMPLATES_JSON:'{bad'}));
});
test('localized approved template and English fallback',()=>{
 assert.equal(messageFor(job(),settings()).title,'Volte');
 assert.equal(messageFor({...job(),locale:'es-MX'},settings()).title,'Return');
 assert.throws(()=>messageFor({...job(),template:'unapproved'},settings()));
});
test('OneSignal payload targeted by external_id and idempotency_key',async()=>{
 const j=job();let sent;
 const v=await sendOneSignal(j,settings(),{fetchImpl:async(url,opt)=>{sent={url,opt};return response({id:'provider-id',recipients:1});}});
 assert.deepEqual(v,{providerId:'provider-id'});
 assert.equal(sent.url,'https://api.onesignal.com/notifications');
 assert.equal(sent.opt.method,'POST');
 const d=JSON.parse(sent.opt.body);
 assert.equal(d.idempotency_key,j.job_id);
 assert.deepEqual(d.include_aliases.external_id,[j.s]);
 assert.equal(d.target_channel,'push');assert.equal(d.contents.en,'Dê um passo');
 assert.ok(!sent.opt.body.includes('test-private-key-is-long'));
});
test('OneSignal refuses zero recipients, errors, missing id, HTTP errors',async()=>{
 for(const d of [{id:'x',recipients:0},{errors:['oops'],id:'x'},{recipients:1},{id:'x',success:false}])await assert.rejects(sendOneSignal(job(),settings(),{fetchImpl:async()=>response(d)}));
 await assert.rejects(sendOneSignal(job(),settings(),{fetchImpl:async()=>response({},429)}),/429/);
});
test('no real push when disabled; worker does not claim',async()=>{
 const db=dbjobs([job()]);const r=await runCycle({db,settings:validateSettings({})});assert.equal(r.status,'disabled');assert.equal(db.calls.length,0);
});
test('worker success claims once, finalizes, provider success is not delivery',async()=>{
 const db=dbjobs([job()]);const r=await runCycle({db,settings:settings(),fetchImpl:async()=>response({id:'accepted',recipients:1})});
 assert.deepEqual({...r},{status:'processed',claimed:1,accepted:1,failed:0});
 assert.equal(db.calls.find(x=>x[0]==='finish')[3],true);
});
test('opt-out between claim and provider call is suppressed',async()=>{const db=dbjobs([job()]);db.preflight=async()=>false;let sends=0;const r=await runCycle({db,settings:settings(),fetchImpl:async()=>{sends++;return response({id:'abc'});}});assert.equal(r.accepted,0);assert.equal(sends,0);assert.equal(db.calls.filter(x=>x[0]==='suppress').length,1);});
test('worker provider failure finalizes failed for retry',async()=>{
 const db=dbjobs([job()]);const r=await runCycle({db,settings:settings(),fetchImpl:async()=>{throw Error('timeout');}});
 assert.equal(r.failed,1);assert.equal(db.calls.find(x=>x[0]==='finish')[3],false);
});
test('worker rejects unexpected production job without mutating it',async()=>{
 const db=dbjobs([{...job(),e:'prod'}]);await assert.rejects(runCycle({db,settings:settings(),fetchImpl:async()=>{throw Error('network must not be called');}}),/outside configured app\/environment scopes/);
 assert.equal(db.calls.filter(x=>['suppress','finish','preflight'].includes(x[0])).length,0);
});
test('worker fails closed if database finalization fails',async()=>{
 const db=dbjobs([job()]);db.finish=async()=>false;
 await assert.rejects(runCycle({db,settings:settings(),fetchImpl:async()=>response({id:'abc'})}),/finalization failed/);
});
test('worker imposes max batch size',async()=>{await assert.rejects(runCycle({db:dbjobs([job()]),settings:settings(),maxJobs:100}));});
test('cron denies missing/invalid secret and wrong method',async()=>{
 const h=(auth,method='GET')=>({method,headers:{authorization:auth}});
 assert.equal((await cronHandler(h('Bearer X'),{env:{...env,CRON_SECRET:'a'.repeat(40)}})).status,401);
 assert.equal((await cronHandler(h('Bearer '+ 'a'.repeat(40),'POST'),{env:{...env,CRON_SECRET:'a'.repeat(40)}})).status,405);
});
test('cron safe disabled never initializes database',async()=>{
 const secret='z'.repeat(40),r=await cronHandler({method:'GET',headers:{authorization:'Bearer '+secret}},{env:{CRON_SECRET:secret},dbFactory:()=>{throw Error('bad');}});
 assert.equal(r.status,200);assert.equal(r.body.delivery_enabled,false);
});
test('cron enabled without DATABASE_URL responds 503',async()=>{
 const secret='x'.repeat(40),r=await cronHandler({method:'GET',headers:{authorization:'Bearer '+secret}},{env:{...env,CRON_SECRET:secret}});
 assert.equal(r.status,503);
});
test('cron enabled with injected adapter processes safely',async()=>{
 const secret='x'.repeat(40),r=await cronHandler({method:'GET',headers:{authorization:'Bearer '+secret}},{env:{...env,CRON_SECRET:secret,DATABASE_URL:'mock'},dbFactory:async()=>dbjobs([job()]),fetchImpl:async()=>response({id:'abc',recipients:1})});
 assert.equal(r.status,200);assert.equal(r.body.accepted,1);
});
test('PostHog telemetry disabled without project token',async()=>assert.deepEqual(await posthogEvent('test',{tenant:'a',app:'b',subject:'x'},settings()),{skipped:true}));
test('PostHog sends hashed id and no plain subject or key in events',async()=>{
 const s={...settings(),posthogKey:'phc_test',hashSecret:'secret'.repeat(8)},j=job();let body;
 await posthogEvent('tmnt_push_provider_result',{tenant:j.t,app:j.a,environment:j.e,subject:j.s,id:j.job_id,accepted:true},s,{isEligible:async()=>true,fetchImpl:async(_,opts)=>{body=JSON.parse(opts.body);return response({});}});
 assert.equal(body.event,'tmnt_push_provider_result');assert.equal(body.distinct_id.length,64);assert.ok(!JSON.stringify(body).includes(j.s));
});
test('PostHog failure never causes provider duplicate sends',async()=>{
 const db=dbjobs([job()]);const s={...settings(),posthogKey:'phc_test',hashSecret:'secret'.repeat(8)};let sends=0;
 const fetchImpl=async(url)=>{if(url.includes('onesignal')){sends++;return response({id:'abc',recipients:1});}throw Error('posthog unavailable');};
 const r=await runCycle({db,settings:s,fetchImpl});assert.equal(r.accepted,1);assert.equal(sends,1);
});
test('PostHog identifiers are separated by environment as well as tenant and app',async()=>{
 const s={...settings(),posthogKey:'phc_test',hashSecret:'secret'.repeat(8)},j=job(),ids=[];
 const fetchImpl=async(_,opts)=>{ids.push(JSON.parse(opts.body).distinct_id);return response({});};
 await posthogEvent('retention_value',{tenant:j.t,app:j.a,environment:'test',subject:j.s},s,{fetchImpl,isEligible:async()=>true});
 await posthogEvent('retention_value',{tenant:j.t,app:j.a,environment:'prod',subject:j.s},s,{fetchImpl,isEligible:async()=>true});
 assert.notEqual(ids[0],ids[1]);
});
