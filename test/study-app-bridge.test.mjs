import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
import {createTMNTGateway} from '../src/integrations/http-gateway.mjs';
import {createTMNTStudyBridge,signVerifiedLearner} from '../integrations/study-app/tmntBridge.mjs';

const scope='lab/study_app/test';
const signingSecret='signer-'+randomUUID()+randomUUID();
const identitySecret='identity-'+randomUUID()+randomUUID();
const pseudonymSecret='pseudonym-'+randomUUID()+randomUUID();
const learnerId='trusted_learner_123';
function signedHeaders(sessionId, options={}){
 const timestamp=options.timestamp??Date.now();
 const locale=options.locale??'pt-BR';
 const timezone=options.timezone??'America/Sao_Paulo';
 const chosen=options.learnerId??learnerId;
 return {'x-study-app-learner':chosen,'x-study-app-identity-ts':String(timestamp),
  'x-study-app-locale':locale,'x-study-app-timezone':timezone,
  'x-study-app-identity-proof':signVerifiedLearner({learnerId:chosen,sessionId,timestamp,locale,timezone,secret:identitySecret})};
}
function setup(url, overrides={}){return createTMNTStudyBridge({enabled:true,endpoint:url,scope,signingSecret,identitySecret,pseudonymSecret,...overrides});}
async function withServer(fn){
 const repo=createMemoryRepository();const engine=createTMNT({repository:repo});
 await engine.registerApp({tenant:'lab',app:'study_app',environment:'test',keyHash:'a'.repeat(64),cadence:'daily',modules:{habits:true,notifications:false},events:[{name:'study_session_completed',value:true}]});
 const gateway=createTMNTGateway({engine,nonceStore:repo,credentials:{[scope]:{secret:signingSecret,actions:['track','getHabit']}}});
 const server=createServer(async(req,res)=>{
  try {const parts=[];for await(const part of req)parts.push(part);
   const incoming=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(parts)});
   const result=await gateway(incoming);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());
  }catch{res.writeHead(500);res.end('Unavailable');}
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 try{return await fn({repo,engine,url:`http://127.0.0.1:${server.address().port}`});}
 finally{await new Promise(ok=>server.close(ok));}
}

test('disabled by default cannot emit or require secrets',async()=>{
 assert.equal(await createTMNTStudyBridge().emitCompleted({session:{},headers:{}}),'disabled');
});
test('rejects missing, weak, reused secrets and public HTTP gateway',()=>{
 assert.throws(()=>createTMNTStudyBridge({enabled:true}),/required/);
 assert.throws(()=>setup('http://example.com'),/HTTPS/);
 assert.throws(()=>setup('http://127.0.0.1:2345',{scope:'lab/study_app/prod'}),/HTTPS/);
 assert.throws(()=>setup('http://localhost',{identitySecret:signingSecret}),/secrets/);
});
test('verified completed session goes over real HTTP; second delivery is idempotent',async()=>withServer(async({repo,url})=>{
 const bridge=setup(url);const session={sessionId:randomUUID(),learnerId,completed:true,attempts:3,completedAt:new Date().toISOString()};
 const headers=signedHeaders(session.sessionId);
 assert.equal(await bridge.emitCompleted({session,headers}),'recorded');
 assert.equal(await bridge.emitCompleted({session,headers}),'rejected');
 assert.equal(repo.debug.events.size,1);
 const event=[...repo.debug.events.values()][0];
 assert.equal(event.name,'study_session_completed');assert.equal(repo.debug.subjects.get(event.subjectKey).timezone,'America/Sao_Paulo');
 assert.equal(repo.debug.subjects.get(event.subjectKey).locale,'pt-BR');
 const anonSubject=event.subjectKey.split('/').at(-1);
 assert.notEqual(anonSubject,learnerId);assert.equal(anonSubject.length,48);
 const habit=await repo.getHabit({tenant:'lab',app:'study_app',environment:'test',subject:anonSubject});
 assert.equal(habit.streak,1);assert.equal(habit.xp,10);
}));
test('identity spoof, changed timezone or language, stale timestamp and invalid signature are refused',async()=>withServer(async({url,repo})=>{
 const bridge=setup(url);const session={sessionId:randomUUID(),learnerId,completed:true,attempts:1};
 const base=signedHeaders(session.sessionId);
 for(const headers of [ {},{...base,'x-study-app-learner':'other_user'},
  {...base,'x-study-app-timezone':'UTC'}, {...base,'x-study-app-locale':'en'},
  {...base,'x-study-app-identity-proof':'sha256='+'0'.repeat(64)},
  signedHeaders(session.sessionId,{timestamp:Date.now()-180000})]){
  assert.equal(await bridge.emitCompleted({session,headers}),'identity_required');
 }
 assert.equal(repo.debug.events.size,0);
}));
test('unsuccessful or unverified study cannot create a retention event',async()=>withServer(async({url,repo})=>{
 const bridge=setup(url);const sessionId=randomUUID(),headers=signedHeaders(sessionId);
 for(const s of [{sessionId,learnerId,completed:false,attempts:3},
 {sessionId,learnerId,completed:true,attempts:0}]){
  assert.equal(await bridge.emitCompleted({session:s,headers}),'not_completed');
 }
 assert.equal(repo.debug.events.size,0);
}));
test('network failure returns unavailable and does not report successful delivery',async()=>{
 const bridge=setup('http://127.0.0.1:1',{fetchImpl:async()=>{throw Error('network unavailable');}});
 const session={sessionId:randomUUID(),learnerId,completed:true,attempts:1};
 assert.equal(await bridge.emitCompleted({session,headers:signedHeaders(session.sessionId)}),'unavailable');
});
test('signing request against gateway with wrong key fails closed',async()=>withServer(async({url,repo})=>{
 const bridge=setup(url,{signingSecret:'bad-signature-'+randomUUID()+randomUUID()});
 const session={sessionId:randomUUID(),learnerId,completed:true,attempts:1};
 assert.equal(await bridge.emitCompleted({session,headers:signedHeaders(session.sessionId)}),'rejected');
 assert.equal(repo.debug.events.size,0);
}));
