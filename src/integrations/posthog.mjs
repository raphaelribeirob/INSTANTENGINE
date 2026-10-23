/** Server-only PostHog adapter. Pseudonymizes per tenant/app/env with HMAC.
 * Events are best-effort. For reliable analytics use a durable outbox. */
import {createHmac} from 'node:crypto';
const HOSTS=new Set(['https://us.i.posthog.com','https://eu.i.posthog.com']);
const NAME=/^tmnt_[a-z_]+$/;
export function createPostHogEmitter({projectKey,hashSecret,host='https://us.i.posthog.com',fetchImpl=fetch,isEligible}={}){
 if(typeof projectKey!=='string'||projectKey.length<8)throw new TypeError('Invalid project key');
 if(typeof hashSecret!=='string'||hashSecret.length<32)throw new TypeError('Strong hashing secret required');
 if(!HOSTS.has(host))throw new TypeError('Invalid PostHog host');
 if(typeof fetchImpl!=='function')throw new TypeError('Invalid fetch implementation');
 if(typeof isEligible!=='function')throw new TypeError('Verified analytics eligibility callback required');
 return async ({name,tenant,app,environment,subject,properties={}})=>{
  if(!NAME.test(name))throw new TypeError('Unexpected event name');
  if(![tenant,app,environment,subject].every(x=>typeof x==='string'&&x.length))throw new TypeError('Invalid scope');
  // The caller must check the persisted consent/module state at send time. Never trust a client opt-in boolean.
  let eligible=false;try{eligible=await isEligible({tenant,app,environment,subject})===true;}catch{return {ok:false,reason:'eligibility_unavailable'};}
  if(!eligible)return {ok:false,reason:'consent_required'};
  const distinct=createHmac('sha256',hashSecret).update([tenant,app,environment,subject].join('\x1f')).digest('hex');
  const safeProps={};for(const k of ['event','experiment','arm','configVersion','campaignKey','type','occurredAt'])if(Object.hasOwn(properties,k))safeProps[k]=properties[k];
  const payload={api_key:projectKey,event:name,distinct_id:distinct,properties:{tenant_id:tenant,app_id:app,environment,...safeProps}};
  const response=await fetchImpl(host+'/capture/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)});
  return {ok:!!response.ok};
 };
}
