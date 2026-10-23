/**
 * TMNT Engine backend-to-backend transport (no hosting dependency).
 * Never expose a signing key in browser/mobile clients. Application backend
 * authenticates the end user, binds actor/subject, and signs one request.
 * Durable nonceStore.claimRequest is mandatory; no in-memory fallback in prod.
 */
import {createHmac,createHash,randomUUID,timingSafeEqual} from 'node:crypto';

const SCOPE=/^[a-z][a-z0-9_-]{1,49}\/[a-z][a-z0-9_-]{1,49}\/(?:test|staging|prod)$/;
const ACTOR=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIG=/^sha256=([a-f0-9]{64})$/;
export const ENDPOINT='/tmnt/v1/action';
export const DEFAULT_ACTIONS=Object.freeze(['track','setConsent','expose','schedule','recommend','planSmartReminder','recordOutcome','getHabit','setHabitGoal','listOffers','redeemOffer','getSavings','recordFeedback','claimReviewPrompt','inviteFriend','respondFriend','removeFriend','startFriendQuest','friendQuestStatus','recommendReminderHour','dailyMissions','claimDailyMission','friendStreak','joinLeague','leaveLeague','weeklyLeaderboard']);
const MASTER_ACTIONS=new Set([...DEFAULT_ACTIONS,'publishOffer','settleRedemption','eraseSubject','defineDailyMission','reconcileHabit']);
const finiteTime=v=>typeof v==='number'&&Number.isSafeInteger(v);
const scalar=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max;
const fail=(code,msg)=>new Response(JSON.stringify({error:msg}),{status:code,headers:{'content-type':'application/json','cache-control':'no-store'}});
const ok=v=>new Response(JSON.stringify({result:v}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
function safeSignature(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function signContent({secret,scope,subject,nonce,timestamp,method,path,body}){
 const checksum=createHash('sha256').update(body).digest('hex');
 const canonical=['tmnt/v1',scope,subject,nonce,String(timestamp),method,path,checksum].join('\n');
 return 'sha256='+createHmac('sha256',secret).update(canonical).digest('hex');
}
function config(credentials){
 if(!credentials||typeof credentials!=='object'||Array.isArray(credentials))throw new Error('Invalid credential registry');
 const keys=new Map();
 for(const [scope,record] of Object.entries(credentials)){
  if(!SCOPE.test(scope)||!record||!scalar(record.secret,2048)||record.secret.length<32)throw new Error('Invalid credential');
  const actions=record.actions??DEFAULT_ACTIONS;
  if(!Array.isArray(actions)||!actions.length||actions.some(a=>!MASTER_ACTIONS.has(a)))throw new Error('Invalid action permissions');
  keys.set(scope,{secret:record.secret,actions:new Set(actions)});
 }
 return keys;
}
async function readLimited(request,maxBytes){
 const header=request.headers.get('content-length');
 if(header!==null && (!/^\d+$/.test(header)||Number(header)>maxBytes))throw new RangeError('Payload too large');
 if(!request.body)return Buffer.alloc(0);
 const stream=request.body.getReader();const chunks=[];let total=0;
 try {while(true){const {done,value}=await stream.read();if(done)break;total+=value.byteLength;if(total>maxBytes)throw new RangeError('Payload too large');chunks.push(value);}}
 finally {try {await stream.cancel();}catch{/* ignored */}stream.releaseLock();}
 return Buffer.concat(chunks,total);
}
export function createTMNTGateway({engine,nonceStore,credentials,now=()=>Date.now(),maxBytes=65536}={}){
 if(!engine||!nonceStore||typeof nonceStore.claimRequest!=='function')throw Error('Engine and durable nonce store required');
 if(!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>1048576)throw Error('Invalid body limit');
 const keys=config(credentials);
 if([...keys].some(([name])=>name.endsWith('/prod')) && nonceStore.nonceDurability!=='persistent')
  throw Error('Production requires persistent replay protection');
 return async function handle(request){
  try{
   const url=new URL(request.url);
   // Production credentials require TLS at the receiving boundary. Untrusted
   // X-Forwarded-Proto/Forwarded headers are intentionally ignored. A trusted
   // reverse proxy must provide the canonical HTTPS URL to this handler.
   const scopeHint=request.headers.get('x-tmnt-scope');
   if(scopeHint?.endsWith('/prod') && url.protocol!=='https:')return fail(403,'TLS required');
   if(url.pathname!==ENDPOINT||url.search)return fail(404,'Not found');
   if(request.method!=='POST')return fail(405,'Method not allowed');
   const scope=request.headers.get('x-tmnt-scope'),subject=request.headers.get('x-tmnt-subject');
   const nonce=request.headers.get('x-tmnt-nonce'),timestamp=Number(request.headers.get('x-tmnt-timestamp'));
   const signature=request.headers.get('x-tmnt-signature');
   if(!scope||!SCOPE.test(scope)||!ACTOR.test(subject??'')||!UUID.test(nonce??'')||
    !/^\d{13}$/.test(request.headers.get('x-tmnt-timestamp')??'')||!finiteTime(timestamp)||
    Math.abs(now()-timestamp)>300000||!SIG.test(signature??''))return fail(401,'Unauthorized');
   const auth=keys.get(scope);if(!auth)return fail(401,'Unauthorized');
   const body=await readLimited(request,maxBytes);
   const expected=signContent({secret:auth.secret,scope,subject,nonce,timestamp,method:'POST',path:ENDPOINT,body});
   if(!safeSignature(signature,expected))return fail(401,'Unauthorized');
   let packet;try{packet=JSON.parse(body.toString('utf8'));}catch{return fail(400,'Invalid JSON');}
   if(!packet||Array.isArray(packet)||typeof packet!=='object'||!MASTER_ACTIONS.has(packet.operation)||
    !auth.actions.has(packet.operation)||!packet.params||Array.isArray(packet.params)||typeof packet.params!=='object')return fail(403,'Operation not permitted');
   // Subject is bound to the authenticated backend, never inferred from client params.
   if(packet.params.subject!==undefined&&packet.params.subject!==subject)return fail(403,'Subject mismatch');
   if(typeof engine[packet.operation]!=='function')return fail(501,'Operation not available');
   const [tenant,app,environment]=scope.split('/');
   const claimed=await nonceStore.claimRequest({tenant,app,environment,subject,requestId:nonce,timestampMs:timestamp});
   if(claimed!==true)return fail(409,'Duplicate or expired request');
   const params={...packet.params,tenant,app,environment,subject};
   const result=await engine[packet.operation](params);
   return ok(result);
  }catch(e){
   if(e instanceof RangeError)return fail(413,'Payload too large');
   if(e instanceof TypeError)return fail(400,'Invalid request parameters');
   // No internal error or secret details leave the trusted backend.
   return fail(503,'Backend unavailable');
  }
 };
}

/** Backend-side signing helper. Does not authenticate users: host backend must do that. */
export function makeSignedTMNTRequest({baseUrl,scope,subject,secret,operation,params={},timestamp=Date.now(),nonce=randomUUID()}={}){
 if(!SCOPE.test(scope??'')||!ACTOR.test(subject??'')||!scalar(secret,2048)||secret.length<32||!UUID.test(nonce)||!finiteTime(timestamp))throw new TypeError('Invalid signer settings');
 if(!MASTER_ACTIONS.has(operation)||!params||Array.isArray(params)||typeof params!=='object')throw new TypeError('Invalid operation');
 const body=JSON.stringify({operation,params});const url=new URL(ENDPOINT,baseUrl);
 if(scope.endsWith('/prod')&&url.protocol!=='https:')throw new TypeError('Production requires HTTPS');
 const signature=signContent({secret,scope,subject,nonce,timestamp,method:'POST',path:ENDPOINT,body:Buffer.from(body)});
 return new Request(url,{method:'POST',headers:{'content-type':'application/json','x-tmnt-scope':scope,'x-tmnt-subject':subject,'x-tmnt-nonce':nonce,'x-tmnt-timestamp':String(timestamp),'x-tmnt-signature':signature},body});
}

/** Official brand aliases; signatures and /tmnt/v1/action remain stable. */
export {createTMNTGateway as createRiverEngineGateway,createTMNTGateway as createInstantEngineGateway,makeSignedTMNTRequest as makeSignedRiverEngineRequest,makeSignedTMNTRequest as makeSignedInstantEngineRequest};
