import test from 'node:test';import assert from 'node:assert/strict';
import {createGrokbotObserver,makeSignedGrokbotObservation} from '../src/integrations/grokbot-observer.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const secret='A'.repeat(48),now=Date.parse('2026-10-21T12:00:00Z');
const scope='demo/study_app/test';
const db={
 async getObserverCatalog(p){return {configured:true,enabled:true,analyticsEnabled:true,events:[{name:'lesson_completed',value:true},{name:'app_opened',value:false}]};},
 async getObserverOverview(p){return Array.from({length:p.days},(_,i)=>({day:new Date(Date.parse(p.asOf+'T00:00:00Z')-(p.days-1-i)*86400000).toISOString().slice(0,10),active:25,valueEvents:50}));},
 async getObserverRetention(){return [{day:1,eligible:100,retained:45},{day:7,eligible:75,retained:30},{day:30,eligible:8,retained:4}]},
 async getObserverChurn(){return [{tier:'low',participants:30},{tier:'medium',participants:12},{tier:'high',participants:0}]},
 async getObserverPipeline(){return {pending:3,leased:0,dead:1,acknowledged:40}},
 async getObserverExperiment(){return [{variant:'control',participants:50,converters:20,conversions:21},{variant:'test',participants:12,converters:7,conversions:7}]}
};
function make({credentials={[scope]:{secret,operations:['catalog','overview','retention','experiment','diagnose','pipeline'],experiments:['new_missions']}},nonceStore=createMemoryRepository({now:()=>new Date(now)}),repository=db,minCohort=20}={}){
 return createGrokbotObserver({repository,nonceStore,credentials,now:()=>now,minCohort});
}
const signed=(operation,params={},scopeArg=scope,secretArg=secret)=>makeSignedGrokbotObservation({baseUrl:'http://localhost:3000',scope:scopeArg,secret:secretArg,operation,params,timestamp:now});
async function call(observer,operation,params={}){const resp=await observer.handle(signed(operation,params));return {status:resp.status,data:await resp.json()};}
test('catalog returns only event definitions, never subject IDs',async()=>{const x=await call(make(),'catalog');assert.equal(x.status,200);assert.equal(x.data.result.instrumentation.events.length,2);assert.ok(!JSON.stringify(x.data).includes('subject_id'));});
test('overview returns k-anonymous daily counts',async()=>{const r=await call(make(),'overview',{days:7});assert.equal(r.status,200);assert.equal(r.data.result.daily.length,7);assert.equal(r.data.result.daily[0].activeUsers,25);});
test('suppresses small daily cohorts and full day event counts',async()=>{const repo={...db,async getObserverOverview(){return [{day:'2026-10-20',active:3,valueEvents:17}]}};const r=await call(make({repository:repo}),'overview',{days:7});assert.equal(r.data.result.daily[0].activeUsers,null);assert.equal(r.data.result.daily[0].valueEvents,null);});
test('retention hides nonmature and small cohorts, no raw rows',async()=>{const r=await call(make(),'retention');assert.equal(r.status,200);assert.deepEqual(r.data.result.windows.map(w=>w.retentionRate),[0.45,0.4,null]);});
test('experiments restricted by scope allowlist and suppress low-variant samples',async()=>{const x=await call(make(),'experiment',{flagKey:'new_missions'});assert.equal(x.data.result.status,'insufficient_data');assert.equal(x.data.result.arms[1].participants,null);const y=await call(make(),'experiment',{flagKey:'other_flag'});assert.equal(y.data.result.restricted,true);});
test('unauthenticated request is rejected',async()=>{const r=await make().handle(new Request('http://localhost/riverengine/v1/observe',{method:'POST',body:'{}'}));assert.equal(r.status,401);});
test('tampering with body after signing fails HMAC',async()=>{const q=signed('catalog');const b=await q.text();const altered=new Request(q.url,{method:'POST',headers:q.headers,body:b.replace('catalog','overview')});const r=await make().handle(altered);assert.equal(r.status,401);});
test('scope cannot be changed by agent',async()=>{const q=signed('catalog');q.headers.set('x-river-observer-scope','demo/language_app/test');const r=await make().handle(q);assert.equal(r.status,401);});
test('cross-app scoped token cannot access other app',async()=>{const r=await make().handle(signed('catalog',{},'demo/language_app/test'));assert.equal(r.status,401);});
test('nonce replay refused by durable API contract',async()=>{const o=make(),request=signed('overview',{days:7});assert.equal((await o.handle(request.clone())).status,200);assert.equal((await o.handle(request.clone())).status,409);});
test('write operation rejected (no notifications or config writes)',async()=>{assert.throws(()=>signed('schedule',{}),TypeError);});
test('prod credentials require persistent nonce repository',()=>{assert.throws(()=>make({credentials:{'demo/study_app/prod':{secret,operations:['catalog']}}}),/Persistent/);});
test('production requests require TLS',async()=>{const dbNonce={nonceDurability:'persistent',async claimRequest(){return true}};const o=make({nonceStore:dbNonce,credentials:{'demo/study_app/prod':{secret,operations:['catalog']}}});const q=makeSignedGrokbotObservation({baseUrl:'https://example.com',scope:'demo/study_app/prod',secret,operation:'catalog',timestamp:now});const downgraded=new Request(q.url.replace('https:','http:'),q);const res=await o.handle(downgraded);assert.equal(res.status,403);});
test('unconfigured apps do not hallucinate retention metrics',async()=>{const repo={...db,async getObserverCatalog(){return {configured:false}}};const r=await call(make({repository:repo}),'retention');assert.equal(r.data.result.status,'not_instrumented_or_analytics_disabled');});
test('diagnostics use conservative deterministic evidence',async()=>{const r=await call(make(),'diagnose');assert.equal(r.status,200);assert.equal(r.data.result.finding.code,'no_large_observed_drop');assert.ok(r.data.result.finding.proposedAction);});

test('pipeline reports buckets without leaking small event counts',async()=>{const r=await call(make(),'pipeline');assert.equal(r.status,200);assert.equal(r.data.result.pending,'below_privacy_threshold');assert.equal(r.data.result.deadLetterAlert,true);assert.equal(r.data.result.acknowledged,'at_least_20');assert.equal(JSON.stringify(r.data).includes('"pending":3'),false);});

test('churn is read-only, cohort-suppressed and never reveals a single subject',async()=>{const o=make({credentials:{[scope]:{secret,operations:['churn']}}});const r=await call(o,'churn',{asOf:'2026-10-21'});assert.equal(r.status,200);assert.equal(r.data.result.dailyRisk.low,30);assert.equal(r.data.result.dailyRisk.medium,null);assert.equal(r.data.result.dailyRisk.high,null);assert.ok(!JSON.stringify(r.data).includes('subject_id'));});
test('churn requires explicit per-scope observer allowlist',async()=>{const o=make({credentials:{[scope]:{secret,operations:['catalog']}}});const r=await call(o,'churn');assert.equal(r.status,403);});
