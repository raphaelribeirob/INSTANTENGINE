import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
import {createTMNTGateway,makeSignedTMNTRequest,DEFAULT_ACTIONS} from '../src/integrations/http-gateway.mjs';
import {createNeonRepository} from '../src/storage/neon.mjs';
const scope='company/school/test', secret='test-secret-fake-credential-0123456789-for-hmac', attacker='wrong-0123456789-secret-is-also-long-value';
const object={tenant:'company',app:'school',environment:'test'};
const clock=()=>new Date('2026-10-20T08:00:00.000Z');
async function fixture(){
 const repository=createMemoryRepository({now:clock}),engine=createTMNT({repository,now:clock});
 await engine.registerApp({...object,keyHash:'a'.repeat(64),modules:{notifications:true,habits:true,offers:true},events:[{name:'lesson_completed',value:true}]});
 const handle=createTMNTGateway({engine,nonceStore:repository,credentials:{[scope]:{secret}},now:()=>clock().getTime()});
 const send=({subject='alice',operation='track',params={},timestamp=clock().getTime(),nonce=randomUUID(),signer=secret}={})=>
  handle(makeSignedTMNTRequest({baseUrl:'http://127.0.0.1:1',scope,subject,secret:signer,operation,params,timestamp,nonce}));
 return {repository,engine,handle,send};
}
const get=async r=>({status:r.status,body:await r.json()});
test('valid signed backend event commits and duplicate event is rejected',async()=>{
 const f=await fixture(),eventId=randomUUID(),params={eventId,event:'lesson_completed',occurredAt:'2026-10-20T07:00:00Z'};
 assert.deepEqual(await get(await f.send({params})),{status:200,body:{result:true}});
 assert.deepEqual(await get(await f.send({params})),{status:200,body:{result:false}});
 assert.equal(f.repository.debug.events.size,1);
});
test('exact replay of signed request cannot run twice, including simultaneous race',async()=>{
 const f=await fixture();const nonce=randomUUID();const params={eventId:randomUUID(),event:'lesson_completed',occurredAt:'2026-10-20T07:00:00Z'};
 const calls=await Promise.all(Array.from({length:10},()=>f.send({params,nonce})));
 const codes=await Promise.all(calls.map(r=>r.status));assert.equal(codes.filter(x=>x===200).length,1);assert.equal(codes.filter(x=>x===409).length,9);
 assert.equal(f.repository.debug.events.size,1);
});
test('reject forged payload, modified subject, forged app, wrong signature',async()=>{
 const f=await fixture(),p={eventId:randomUUID(),event:'lesson_completed',occurredAt:'2026-10-20T07:00:00Z'};
 const original=makeSignedTMNTRequest({baseUrl:'http://example.test',scope,subject:'alice',secret,operation:'track',params:p,timestamp:clock().getTime()});
 const raw=await original.text();
 const tampered=new Request(original.url,{method:'POST',headers:original.headers,body:raw.replace('lesson_completed','lesson_compl_ted')});
 assert.equal((await f.handle(tampered)).status,401);
 const actor=new Request(original.url,{method:'POST',headers:original.headers,body:raw});actor.headers.set('x-tmnt-subject','bob');assert.equal((await f.handle(actor)).status,401);
 const scoped=new Request(original.url,{method:'POST',headers:original.headers,body:raw});scoped.headers.set('x-tmnt-scope','company/other/test');assert.equal((await f.handle(scoped)).status,401);
 assert.equal((await f.send({params:p,signer:attacker})).status,401);
 assert.equal(f.repository.debug.events.size,0);
});
test('reject expired and future request timestamps',async()=>{
 const f=await fixture();for(const off of [-301000,301000])assert.equal((await f.send({timestamp:clock().getTime()+off})).status,401);
});
test('scope is server bound; subject spoof and unauthorized admin actions are rejected',async()=>{
 const f=await fixture(),p={eventId:randomUUID(),event:'lesson_completed',occurredAt:'2026-10-20T07:00:00Z'};
 assert.equal((await f.send({params:{...p,tenant:'other'}})).status,200);
 assert.equal(f.repository.debug.events.size,1);
 assert.equal((await f.send({params:{...p,subject:'bob'}})).status,403);
 assert.equal((await f.send({operation:'eraseSubject'})).status,403);
 assert.equal((await f.send({operation:'settleRedemption'})).status,403);
 assert.equal((await f.send({operation:'publishOffer'})).status,403);
});
test('default scopes are restricted and reject unconfigured scopes',async()=>{
 const f=await fixture();assert.ok(DEFAULT_ACTIONS.includes('track'));assert.ok(!DEFAULT_ACTIONS.includes('settleRedemption'));
 const req=makeSignedTMNTRequest({baseUrl:'http://x.test',scope:'company/other/test',subject:'alice',secret,operation:'track',timestamp:clock().getTime()});
 assert.equal((await f.handle(req)).status,401);
});
test('non-JSON and oversized body fail closed without consuming nonce',async()=>{
 const f=await fixture(),p={eventId:randomUUID(),event:'lesson_completed',occurredAt:'2026-10-20T07:00:00Z'};
 const good=makeSignedTMNTRequest({baseUrl:'http://x.test',scope,subject:'alice',secret,operation:'track',params:p,timestamp:clock().getTime()});
 const large=new Request(good.url,{method:'POST',headers:good.headers,body:'x'.repeat(70000)});large.headers.delete('content-length');assert.equal((await f.handle(large)).status,413);
 assert.equal((await f.handle(good)).status,200);
});
test('malformed method, query, nonce and stale credentials fail closed',async()=>{
 const f=await fixture();assert.equal((await f.handle(new Request('http://x.test/tmnt/v1/action',{method:'GET'}))).status,405);
 assert.equal((await f.handle(new Request('http://x.test/tmnt/v1/action?foo=bar',{method:'POST'}))).status,404);
 const r=makeSignedTMNTRequest({baseUrl:'http://x.test',scope,subject:'alice',secret,operation:'track',timestamp:clock().getTime()});r.headers.set('x-tmnt-nonce','nonsense');assert.equal((await f.handle(r)).status,401);
});
test('no durable nonce store prevents gateway creation',async()=>{
 const f=await fixture();assert.throws(()=>createTMNTGateway({engine:f.engine,nonceStore:{},credentials:{[scope]:{secret}}}),/durable nonce/);
});
test('Neon repository claims nonce by real SQL procedure with bound parameters',async()=>{
 const calls=[];const sql=async(parts,...args)=>{calls.push({q:parts.join('?'),args});return [{ok:true}];};
 const r=await createNeonRepository(null,{sql});assert.equal(await r.claimRequest({...object,subject:'alice',requestId:randomUUID(),timestampMs:clock().getTime()}),true);
 assert.ok(calls[0].q.includes('r3_v1_claim_request'));assert.ok(calls[0].q.includes('::uuid'));assert.ok(calls[0].args.includes('alice'));
});
test('end-to-end actual Node HTTP server accepts one signed event',async()=>{
 const f=await fixture();const server=createServer(async (req,res)=>{
  const chunks=[];for await (const c of req)chunks.push(c);
  const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(chunks)});
  const out=await f.handle(request);res.writeHead(out.status,Object.fromEntries(out.headers.entries()));res.end(await out.text());
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const port=server.address().port;
  const signed=makeSignedTMNTRequest({baseUrl:`http://127.0.0.1:${port}`,scope,subject:'alice',secret,operation:'track',timestamp:clock().getTime(),params:{eventId:randomUUID(),event:'lesson_completed',occurredAt:'2026-10-20T07:00:00Z'}});
  const response=await fetch(signed);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{result:true});assert.equal(f.repository.debug.events.size,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('production refuses ephemeral nonce storage even when signed credentials are valid',async()=>{
 const repo=createMemoryRepository({now:clock}),engine=createTMNT({repository:repo});
 assert.throws(()=>createTMNTGateway({engine,nonceStore:repo,credentials:{'company/school/prod':{secret}}}),/persistent replay/);
});
test('production can use explicitly persistent nonce adapter',async()=>{
 const repo=createMemoryRepository({now:clock}),engine=createTMNT({repository:repo});
 const durable={nonceDurability:'persistent',claimRequest:async()=>true};
 const gateway=createTMNTGateway({engine,nonceStore:durable,credentials:{'company/school/prod':{secret}}});
 assert.equal(typeof gateway,'function');
});

test('production signing helper refuses plain HTTP',()=>{
 assert.throws(()=>makeSignedTMNTRequest({baseUrl:'http://api.example.org',scope:'company/school/prod',subject:'alice',secret,operation:'track'}),/HTTPS/);
 const r=makeSignedTMNTRequest({baseUrl:'https://api.example.org',scope:'company/school/prod',subject:'alice',secret,operation:'track'});
 assert.equal(new URL(r.url).protocol,'https:');
});


test('signed gateway exposes contextual reminder planning only for verified user and queues, never delivers',async()=>{
 const time=()=>new Date('2026-10-21T18:00:00.000Z');
 const repo=createMemoryRepository({now:time}),engine=createTMNT({repository:repo,now:time});
 const key={tenant:'company',app:'school',environment:'test',subject:'alice'};
 await engine.registerApp({...key,keyHash:'a'.repeat(64),cadence:'daily',modules:{notifications:true,habits:true},quietStart:8,quietEnd:22,weeklyLimit:3,events:[{name:'lesson_completed',value:true}]});
 for(const day of [19,20])await engine.track({...key,eventId:randomUUID(),event:'lesson_completed',occurredAt:`2026-10-${day}T14:00:00Z`,timezone:'America/Sao_Paulo'});
 await engine.setConsent({...key,channel:'push',purpose:'reminder',granted:true,verified:true,platform:'android'});
 await engine.expose({...key,holdoutPercent:0});
 const gateway=createTMNTGateway({engine,nonceStore:repo,credentials:{[scope]:{secret}},now:()=>time().getTime()});
 const params={campaignKey:'c_streak',variants:[{id:'streak_safe',intent:'streak'},{id:'neutral_safe',intent:'general'}],exploration:0};
 const req=makeSignedTMNTRequest({baseUrl:'http://x.test',scope,subject:'alice',secret,operation:'planSmartReminder',params,timestamp:time().getTime()});
 const response=await gateway(req);assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.result.action,'queued');assert.equal(body.result.templateId,'streak_safe');assert.equal(body.result.providerDelivered,false);
 const wrong=makeSignedTMNTRequest({baseUrl:'http://x.test',scope,subject:'bob',secret,operation:'planSmartReminder',params:{...params,subject:'alice'},timestamp:time().getTime()});
 assert.equal((await gateway(wrong)).status,403);
});
