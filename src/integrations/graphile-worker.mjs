/** RIVERENGINE -> Graphile Worker (optional, server-only, at-least-once telemetry).
 * A trusted DB event is resolved at execution time. No raw subject in Graphile payload.
 * Existing RIVERENGINE push outbox remains the only sender of push notifications.
 */
import {createHmac} from 'node:crypto';

const SCOPE=/^[a-z][a-z0-9_-]{1,49}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT=/^[a-z][a-z0-9_.-]{1,79}$/;
const ENVS=new Set(['test','staging','prod']);
const TASK='river_verified_value_analytics';
function scope(p){
 if(!p||!SCOPE.test(p.tenant)||!SCOPE.test(p.app)||!ENVS.has(p.environment)||!UUID.test(p.eventId))throw new TypeError('Invalid scoped event');
 return {tenant:p.tenant,app:p.app,environment:p.environment,eventId:p.eventId.toLowerCase()};
}
function scopedKey(payload,secret){return createHmac('sha256',secret).update([payload.tenant,payload.app,payload.environment,payload.eventId].join('\x1f')).digest('hex');}
function strongSecret(s){if(typeof s!=='string'||s.length<32)throw new TypeError('Strong HMAC secret required');}
/** Build independently testable Graphile task list. */
export function createRiverGraphileTaskList({loadVerifiedEvent,isEligible,deliver,secret,allowProduction=false}={}){
 strongSecret(secret);
 if(![loadVerifiedEvent,isEligible,deliver].every(f=>typeof f==='function'))throw new TypeError('Trusted resolver, eligibility and delivery functions required');
 return Object.freeze({
  [TASK]:async(payload)=>{
   const p=scope(payload);
   if(p.environment==='prod'&&!allowProduction)return {skipped:'prod_disabled'};
   const event=await loadVerifiedEvent(p); // Lookup after DB commit. Never trust queued payload as source of truth.
   if(!event)return {skipped:'event_erased_or_missing'};
   if(event.tenant!==p.tenant||event.app!==p.app||event.environment!==p.environment||event.eventId?.toLowerCase()!==p.eventId||event.verifiedValue!==true||!EVENT.test(event.eventName)||typeof event.subject!=='string'||!event.subject)return {skipped:'not_verified_value'};
   const eligible=await isEligible({tenant:p.tenant,app:p.app,environment:p.environment,subject:event.subject});
   if(eligible!==true)return {skipped:'consent_revoked_or_analytics_disabled'};
   const insertId=scopedKey(p,secret);
   const ack=await deliver({event,insertId});
   // Provider errors must trigger Graphile retries; never treat SDK buffer queueing as ingestion.
   if(ack?.acknowledged!==true)throw new Error('Analytics ingestion not acknowledged');
   return {acknowledged:true};
  }
 });
}
/** Opens PostgreSQL TCP connection via Graphile Worker; never works through Neon HTTP driver.
 * No DDL is run until the operator explicitly enables and starts a dedicated worker service.
 */
export function createRiverGraphileQueue({connectionString,secret,loadVerifiedEvent,isEligible,deliver,enabled=false,allowProduction=false,graphileLoader=()=>import('graphile-worker')}={}){
 strongSecret(secret);
 if(typeof enabled!=='boolean'||typeof allowProduction!=='boolean'||typeof graphileLoader!=='function')throw new TypeError('Invalid queue settings');
 if(enabled&&(!/^postgres(?:ql)?:\/\//.test(connectionString||'')||!connectionString))throw new TypeError('PostgreSQL TCP connection string required');
 const tasks=createRiverGraphileTaskList({loadVerifiedEvent,isEligible,deliver,secret,allowProduction});
 let utilities=null,runner=null;
 async function library(){try{return await graphileLoader();}catch{throw new Error('Install optional graphile-worker and pg in a trusted Node worker service');}}
 return Object.freeze({
  async enqueueVerifiedValue(event){
   if(!enabled)return {status:'disabled'};
   const p=scope(event);
   if(p.environment==='prod'&&!allowProduction)return {status:'prod_disabled'};
   const graphile=await library();
   if(!utilities)utilities=await graphile.makeWorkerUtils({connectionString});
   const key='river_analytics_'+scopedKey(p,secret);
   await utilities.addJob(TASK,p,{jobKey:key,maxAttempts:8,queueName:`river_${createHmac('sha256',secret).update([p.tenant,p.app,p.environment].join('\x1f')).digest('hex').slice(0,24)}`});
   return {status:'queued',jobKey:key}; // not delivered
  },
  async start(){
   if(!enabled)return {status:'disabled'};
   if(runner)throw new Error('Worker already running');
   const graphile=await library();
   runner=await graphile.run({connectionString,taskList:tasks,concurrency:2,noHandleSignals:true});
   return {status:'started'};
  },
  async stop(){
   if(runner){await runner.stop();runner=null;}
   if(utilities){await utilities.release();utilities=null;}
   return {status:'stopped'};
  },
  tasks
 });
}
/** Raw PostHog ingestion acknowledgement, HMAC pseudonym and deterministic $insert_id.
 * The caller MUST re-check persistent analytics consent before invoking.
 */
export function createRiverPostHogHTTPDelivery({projectKey,hashSecret,host='https://us.i.posthog.com',fetchImpl=fetch}={}){
 strongSecret(hashSecret);
 if(typeof projectKey!=='string'||projectKey.length<8||!['https://us.i.posthog.com','https://eu.i.posthog.com'].includes(host)||typeof fetchImpl!=='function')throw new TypeError('Invalid PostHog delivery configuration');
 return async({event,insertId})=>{
  if(typeof insertId!=='string'||!/^[0-9a-f]{64}$/.test(insertId)||!event?.subject||!EVENT.test(event.eventName))throw new TypeError('Invalid event receipt');
  const distinctId=createHmac('sha256',hashSecret).update([event.tenant,event.app,event.environment,event.subject].join('\x1f')).digest('hex');
  const response=await fetchImpl(host+'/capture/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({api_key:projectKey,event:'riverengine_verified_value',distinct_id:distinctId,properties:{tenant_id:event.tenant,app_id:event.app,environment:event.environment,value_event:event.eventName,$insert_id:insertId}}),signal:AbortSignal.timeout(6000)});
  return {acknowledged:response.ok}; // HTTP acceptance, not confirmation that PostHog dashboards processed it.
 };
}
