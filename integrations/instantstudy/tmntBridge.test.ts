import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTMNTStudyBridge, signVerifiedLearner} from './tmntBridge.js';
const signingSecret='signer-'+randomUUID()+randomUUID();
const identitySecret='identity-'+randomUUID()+randomUUID();
const pseudonymSecret='pseudonym-'+randomUUID()+randomUUID();
const scope='qa/instantstudy/test';
function setup(fetchImpl:typeof fetch){return createTMNTStudyBridge({enabled:true,
 endpoint:'http://127.0.0.1:6060',scope,signingSecret,identitySecret,pseudonymSecret,fetchImpl});}
function claims(sessionId:string,learnerId='learner_01'){
 const timestamp=Date.now(),locale='pt-BR',timezone='America/Sao_Paulo';
 return {'x-instantstudy-learner':learnerId,'x-instantstudy-identity-ts':String(timestamp),
  'x-instantstudy-locale':locale,'x-instantstudy-timezone':timezone,
  'x-instantstudy-identity-proof':signVerifiedLearner({learnerId,sessionId,timestamp,secret:identitySecret,locale,timezone})};
}
test('disabled when feature flag is absent',async()=>{
 assert.equal(await createTMNTStudyBridge().emitCompleted({session:{sessionId:randomUUID(),completed:true,attempts:1},headers:{}}),'disabled');
});
test('backend completion with signed actor sends scoped signed request',async()=>{
 let seen:RequestInit|undefined;
 const bridge=setup(async (_url,init)=>{seen=init;return new Response('{"result":true}',{status:200});});
 const session={sessionId:randomUUID(),learnerId:'learner_01',completed:true,attempts:1};
 assert.equal(await bridge.emitCompleted({session,headers:claims(session.sessionId)}),'recorded');
 const packet=JSON.parse(String(seen?.body));
 assert.equal(packet.operation,'track');assert.equal(packet.params.event,'study_session_completed');
 assert.equal(packet.params.timezone,'America/Sao_Paulo');
 assert.equal((seen?.headers as Record<string,string>)['x-tmnt-scope'],scope);
});
test('forged identity and a session with zero attempts do not emit',async()=>{
 let requests=0;const bridge=setup(async()=>{requests++;return new Response('{"result":true}',{status:200});});
 const session={sessionId:randomUUID(),learnerId:'learner_01',completed:true,attempts:1};
 assert.equal(await bridge.emitCompleted({session,headers:{...claims(session.sessionId),'x-instantstudy-learner':'spoofed'}}),'identity_required');
 assert.equal(await bridge.emitCompleted({session:{...session,attempts:0},headers:claims(session.sessionId)}),'not_completed');
 assert.equal(requests,0);
});
test('failed gateway never reports delivery',async()=>{
 const bridge=setup(async()=>{throw Error('offline');});
 const session={sessionId:randomUUID(),learnerId:'learner_01',completed:true,attempts:1};
 assert.equal(await bridge.emitCompleted({session,headers:claims(session.sessionId)}),'unavailable');
});
