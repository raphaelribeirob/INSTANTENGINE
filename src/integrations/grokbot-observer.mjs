/** RIVERENGINE -> Grokbot observer API. Read-only, scoped, k-anonymized and HMAC authenticated.
 * Use exclusively inside an authenticated server. No tokens or user IDs in tool output.
 */
import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';

const PATH='/riverengine/v1/observe';
const SCOPE=/^[a-z][a-z0-9_-]{1,49}\/[a-z][a-z0-9_-]{1,49}\/(?:test|staging|prod)$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const FLAG=/^[a-z][a-z0-9_-]{1,79}$/;
const OPS=new Set(['overview','retention','experiment','diagnose','catalog','pipeline','churn']);
const NO_CACHE={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
function error(status,message){return new Response(JSON.stringify({error:message}),{status,headers:NO_CACHE});}
function success(result){return new Response(JSON.stringify({result}),{status:200,headers:NO_CACHE});}
function validDate(v){return typeof v==='string'&&DATE.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
function secureEquals(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function signed({secret,scope,timestamp,nonce,body}){
 const digest=createHash('sha256').update(body).digest('hex');
 return createHmac('sha256',secret).update(['river-observer-v1','POST',PATH,scope,timestamp,nonce,digest].join('\n')).digest('hex');
}
async function limitedBody(request,maxBytes){
 const h=request.headers.get('content-length');if(h!==null&&(!/^\d+$/.test(h)||Number(h)>maxBytes))throw new RangeError('size');
 if(!request.body)return Buffer.alloc(0);
 const reader=request.body.getReader();const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new RangeError('size');chunks.push(value);}}
 finally{try{await reader.cancel();}catch{}reader.releaseLock();}
 return Buffer.concat(chunks,size);
}
function numeric(v){const x=Number(v);return Number.isSafeInteger(x)&&x>=0?x:null;}
function mask(value,n){const val=numeric(value);return val===null||val<n?null:val;}
function safeRate(a,b){return a===null||b===null||b===0?null:Math.round(a/b*10000)/10000;}
const envelope=(scope,asOf)=>({scope:{tenant:scope.tenant,app:scope.app,environment:scope.environment},asOf,
 privacy:'consented, aggregated; suppressed when eligible users < minimum cohort; no individual records',causalInterpretation:'exploratory_only'});
/** Repository methods only return aggregate rows, never individual subjects. */
export function createGrokbotObserver({repository,nonceStore,credentials,now=()=>Date.now(),minCohort=20,maxBytes=8192}={}){
 if(!repository||['getObserverCatalog','getObserverOverview','getObserverRetention','getObserverExperiment'].some(m=>typeof repository[m]!=='function'))throw new TypeError('Observer aggregate repository required');
 if(!nonceStore||typeof nonceStore.claimRequest!=='function')throw new TypeError('Durable replay store required');
 if(!credentials||typeof credentials!=='object'||Array.isArray(credentials))throw new TypeError('Credentials required');
 if(!Number.isInteger(minCohort)||minCohort<20||minCohort>10000||!Number.isInteger(maxBytes)||maxBytes<512||maxBytes>65536)throw new TypeError('Privacy settings invalid');
 const access=new Map();
 for(const [k,v] of Object.entries(credentials)){
  if(!SCOPE.test(k)||typeof v?.secret!=='string'||v.secret.length<32||!Array.isArray(v?.operations)||v.operations.length===0||v.operations.some(x=>!OPS.has(x))||!Array.isArray(v?.experiments??[])||v.experiments?.some(x=>!FLAG.test(x)))throw new TypeError('Invalid observer credential');
  access.set(k,{secret:v.secret,operations:new Set(v.operations),experiments:new Set(v.experiments??[])});
 }
 if([...access.keys()].some(k=>k.endsWith('/prod'))&&nonceStore.nonceDurability!=='persistent')throw new TypeError('Persistent replay protection required for production');
 async function execute(operation,p,scope){
  const asOf=p.asOf??new Date(now()).toISOString().slice(0,10);
  if(!validDate(asOf)||asOf>new Date(now()).toISOString().slice(0,10))throw new TypeError('Invalid observation day');
  if(operation==='experiment'&&(!FLAG.test(p.flagKey)||!access.get([scope.tenant,scope.app,scope.environment].join('/')).experiments.has(p.flagKey)))return {restricted:true,reason:'experiment_not_allowed'};
  if(operation==='catalog'){
   const c=await repository.getObserverCatalog(scope);
   return {...envelope(scope,asOf),instrumentation:{configured:c?.configured===true,enabled:c?.enabled===true,analyticsEnabled:c?.analyticsEnabled===true,events:Array.isArray(c?.events)?c.events.filter(e=>typeof e.name==='string'&&typeof e.value==='boolean').map(e=>({name:e.name,value:e.value})).slice(0,50):[]}};
  }
  const cfg=await repository.getObserverCatalog(scope);
  if(cfg?.configured!==true||cfg?.enabled!==true||cfg?.analyticsEnabled!==true)return {...envelope(scope,asOf),status:'not_instrumented_or_analytics_disabled',metrics:null};
  if(operation==='churn'){
   if(typeof repository.getObserverChurn!=='function')return {...envelope(scope,asOf),status:'not_configured',dailyRisk:null};
   const rows=await repository.getObserverChurn({...scope,asOf});
   const result={low:null,medium:null,high:null};
   for(const row of rows||[])if(Object.hasOwn(result,row.tier))result[row.tier]=mask(row.participants,minCohort);
   return {...envelope(scope,asOf),status:'ok',kind:'cohort_risk_distribution',
    dailyRisk:result,notes:['Counts below the privacy threshold are suppressed, never zero-filled',
     'Heuristic indices are not tomorrow-return probabilities; correlation is not causal uplift',
     'No individual risk scores or campaigns are available to Grokbot']};
  }
  if(operation==='pipeline'){
   if(typeof repository.getObserverPipeline!=='function')return {...envelope(scope,asOf),status:'not_configured'};
   const p=await repository.getObserverPipeline(scope);
   if(!p)return {...envelope(scope,asOf),status:'not_configured'};
   const pending=numeric(p.pending),leased=numeric(p.leased),dead=numeric(p.dead),accepted=numeric(p.acknowledged);
   const bucket=n=>n===null?'unknown':n===0?'none':n<minCohort?'below_privacy_threshold':'at_least_'+minCohort;
   return {...envelope(scope,asOf),status:'ok',pending:bucket(pending),leased:bucket(leased),dead:bucket(dead),acknowledged:bucket(accepted),
     deadLetterAlert:dead!==null&&dead>0,requiresOperatorReview:dead!==null&&dead>0};
  }
  if(operation==='experiment'){
   const raw=await repository.getObserverExperiment({...scope,flagKey:p.flagKey,asOf});
   const arms=(raw||[]).map(r=>({variant:r.variant,participants:mask(r.participants,minCohort),converters:mask(r.participants,minCohort)===null?null:numeric(r.converters),conversions:mask(r.participants,minCohort)===null?null:numeric(r.conversions)}));
   return {...envelope(scope,asOf),experimentKey:p.flagKey,status:arms.length>0&&arms.every(r=>r.participants!==null)&&arms.length>=2?'exploratory':'insufficient_data',arms,readyForRollout:false};
  }
  const days=operation==='overview'&&Number.isInteger(p.days)?p.days:14;
  if(days<7||days>30)throw new TypeError('Invalid observation range');
  const raw=await repository.getObserverOverview({...scope,days,asOf});
  const daily=(raw||[]).map(r=>{
   const active=mask(r.active,minCohort);
   return {day:String(r.day).slice(0,10),activeUsers:active,valueEvents:active===null?null:numeric(r.valueEvents)};
  });
  if(operation==='overview')return {...envelope(scope,asOf),status:'ok',daily,
   notes:['Value events are backend verified; analytics consent must be current','Suppression is based on unique participants per cell']};
  const retention=await repository.getObserverRetention({...scope,asOf});
  const windows=(retention||[]).map(r=>{
   const eligible=mask(r.eligible,minCohort);const retained=eligible===null?null:numeric(r.retained);
   return {day:Number(r.day),eligible,retained,retentionRate:safeRate(retained,eligible)};
  }).filter(x=>[1,7,30].includes(x.day));
  if(operation==='retention')return {...envelope(scope,asOf),status:'ok',windows,
   cohort:'First backend-verified value-event day in UTC, matured exact-day Dn',notes:['Observational, not a randomized experiment','Immature cohorts are excluded']};
  // Only deterministic operational diagnostics. The agent may propose, never execute actions.
  const visible=daily.filter(x=>x.activeUsers!==null);const halves=visible.filter(x=>x.day<=asOf).slice(-14);
  let finding={code:'insufficient_data',severity:'info',evidence:'Cohort privacy threshold not met',proposedAction:'Check instrumentation and accumulate valid cohorts; do not infer abandonment'};
  if(halves.length===14){const prev=halves.slice(0,7).reduce((a,b)=>a+b.activeUsers,0),current=halves.slice(7).reduce((a,b)=>a+b.activeUsers,0);
   if(prev>0&&current/prev<0.75)finding={code:'lower_recent_activity',severity:'review',evidence:{previousWeekUserDays:prev,currentWeekUserDays:current},proposedAction:'Investigate event coverage and test a pre-registered retention hypothesis with holdout; no automatic campaign changes'};
   else finding={code:'no_large_observed_drop',severity:'info',evidence:{previousWeekUserDays:prev,currentWeekUserDays:current},proposedAction:'Continue controlled measurement'};
  }
  return {...envelope(scope,asOf),status:'ok',finding,retention:windows};
 }
 return Object.freeze({
  async handle(request){
   try{
    const u=new URL(request.url);if(u.pathname!==PATH||u.search)return error(404,'Not found');
    if(request.method!=='POST')return error(405,'Method not allowed');
    const scopeValue=request.headers.get('x-river-observer-scope');
    if(!SCOPE.test(scopeValue??''))return error(401,'Unauthorized');
    if(scopeValue.endsWith('/prod')&&u.protocol!=='https:')return error(403,'TLS required');
    const auth=access.get(scopeValue);if(!auth)return error(401,'Unauthorized');
    const timestamp=request.headers.get('x-river-observer-timestamp')??'';
    const nonce=request.headers.get('x-river-observer-nonce')??'';
    const signature=request.headers.get('x-river-observer-signature')??'';
    if(!/^\d{13}$/.test(timestamp)||Math.abs(now()-Number(timestamp))>300000||!UUID.test(nonce)||!/^[0-9a-f]{64}$/.test(signature))return error(401,'Unauthorized');
    const body=await limitedBody(request,maxBytes);
    if(!secureEquals(signature,signed({secret:auth.secret,scope:scopeValue,timestamp,nonce,body})))return error(401,'Unauthorized');
    let packet;try{packet=JSON.parse(body.toString('utf8'));}catch{return error(400,'Invalid JSON');}
    if(!packet||typeof packet!=='object'||Array.isArray(packet)||!auth.operations.has(packet.operation)||!OPS.has(packet.operation)||!packet.params||typeof packet.params!=='object'||Array.isArray(packet.params)||Object.keys(packet.params).some(k=>!['asOf','days','flagKey'].includes(k)))return error(403,'Operation not permitted');
    const [tenant,app,environment]=scopeValue.split('/');const scope={tenant,app,environment};
    const claimed=await nonceStore.claimRequest({...scope,subject:'grokbot_observer',requestId:nonce,timestampMs:Number(timestamp)});
    if(claimed!==true)return error(409,'Duplicate request');
    const data=await execute(packet.operation,packet.params,scope);
    return success(data);
   }catch(e){if(e instanceof RangeError)return error(413,'Payload too large');if(e instanceof TypeError)return error(400,'Invalid parameters');return error(503,'Backend unavailable');}
  },
  async observe({tenant,app,environment,operation,params={}}={}){
   const scopeValue=[tenant,app,environment].join('/');if(!access.has(scopeValue)||!access.get(scopeValue).operations.has(operation))throw new Error('Operation not allowed');
   return execute(operation,params,{tenant,app,environment}); // trusted in-process diagnostic only
  }
 });
}
export function makeSignedGrokbotObservation({baseUrl,scope,secret,operation,params={},timestamp=Date.now(),nonce=randomUUID()}={}){
 if(!SCOPE.test(scope??'')||typeof secret!=='string'||secret.length<32||!OPS.has(operation)||!UUID.test(nonce)||!Number.isSafeInteger(timestamp)||!params||typeof params!=='object'||Array.isArray(params))throw new TypeError('Invalid signed observation');
 const url=new URL(PATH,baseUrl);if(scope.endsWith('/prod')&&url.protocol!=='https:')throw new TypeError('Production requires HTTPS');
 const body=Buffer.from(JSON.stringify({operation,params}));const signature=signed({secret,scope,timestamp:String(timestamp),nonce,body});
 return new Request(url,{method:'POST',headers:{'content-type':'application/json','x-river-observer-scope':scope,'x-river-observer-timestamp':String(timestamp),'x-river-observer-nonce':nonce,'x-river-observer-signature':signature},body});
}
export const GROKBOT_OBSERVER_ENDPOINT=PATH;
