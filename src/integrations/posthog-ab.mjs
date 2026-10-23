/** RIVERENGINE x PostHog native multivariate A/B experiments (backend only).
 * A call to expose() MUST happen only at the moment an eligible user reaches the tested surface.
 * PostHog SDK flags.getFlag() creates the native $feature_flag_called exposure event.
 * Persist assignments to prevent variant switching. Product activity must be tracked by the
 * authenticated RIVERENGINE backend before recording a conversion.
 * PostHog event delivery is best-effort (SDK queue); production needs durable telemetry outbox.
 */
import {createHmac} from 'node:crypto';
import {reportDuolingoRetention} from '../duolingo-retention.mjs';

const SCOPE=/^[a-z][a-z0-9_-]{1,49}$/;
const SUBJECT=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const FLAG=/^[a-z][a-z0-9_-]{1,79}$/;
const VARIANT=/^[a-z][a-z0-9_-]{0,39}$/;
const EVENT=/^[a-z][a-z0-9_.-]{1,79}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENVS=new Set(['test','staging','prod']);
function verify(x,re,label){if(typeof x!=='string'||!re.test(x))throw new TypeError(`Invalid ${label}`);return x;}
function scope(x){if(!x||typeof x!=='object')throw new TypeError('Scope required');
 return {tenant:verify(x.tenant,SCOPE,'tenant'),app:verify(x.app,SCOPE,'app'),environment:ENVS.has(x.environment)?x.environment:(()=>{throw new TypeError('Invalid environment')})(),subject:verify(x.subject,SUBJECT,'subject')};}
function config(x){const flagKey=verify(x.flagKey,FLAG,'flagKey');const variants=x.variants;
 if(!Array.isArray(variants)||variants.length<2||variants.length>20||variants.some(v=>typeof v!=='string'||!VARIANT.test(v))||new Set(variants).size!==variants.length||!variants.includes('control'))throw new TypeError('Invalid variants: require distinct control and test arms');
 return {flagKey,variants};}
/** Same HMAC convention as createPostHogEmitter and worker; no raw user IDs. */
export function riverPostHogDistinctId({tenant,app,environment,subject},hashSecret){
 const s=scope({tenant,app,environment,subject});if(typeof hashSecret!=='string'||hashSecret.length<32)throw new TypeError('Strong analytics hashing secret required');
 return createHmac('sha256',hashSecret).update([s.tenant,s.app,s.environment,s.subject].join('\x1f')).digest('hex');
}
export function createRiverABExperiments({repository,posthogClient,hashSecret,enabled=false,allowProduction=false}={}){
 if(!repository||['setABAnalyticsConsent','isABEligible','getABAssignment','claimABAssignment','recordABConversion'].some(k=>typeof repository[k]!=='function'))throw new TypeError('AB repository contract missing');
 if(!posthogClient||typeof posthogClient.evaluateFlags!=='function'||typeof posthogClient.capture!=='function')throw new TypeError('PostHog Node client required');
 if(typeof enabled!=='boolean'||typeof allowProduction!=='boolean')throw new TypeError('Invalid feature flags');
 riverPostHogDistinctId({tenant:'check',app:'check',environment:'test',subject:'check'},hashSecret);
 function gate(s,analyticsConsent){if(!enabled)return 'disabled';if(s.environment==='prod'&&!allowProduction)return 'prod_disabled';if(analyticsConsent!==true)return 'consent_required';return null;}
 return Object.freeze({
  /** Authenticated backend only: persist verified opt-in/out. Never expose through the public gateway. */
  async setAnalyticsConsent(p={}){const s=scope(p);if(typeof p.granted!=='boolean'||typeof p.verified!=='boolean'||(p.granted&&!p.verified))throw new TypeError('Invalid analytics consent');return repository.setABAnalyticsConsent({...s,granted:p.granted,verified:p.verified});},
  /** Only call after server authenticates subject and determines user will see experiment surface. */
  async expose(p={}){
   const s=scope(p),c=config(p),deny=gate(s,p.analyticsConsent);
   if(deny)return {status:'inactive',reason:deny,variant:'control',exposed:false};
   if(!await repository.isABEligible(s))return {status:'inactive',reason:'not_opted_in_or_ineligible',variant:'control',exposed:false};
   const existing=await repository.getABAssignment({...s,flagKey:c.flagKey});
   if(existing){if(!c.variants.includes(existing.variant))return {status:'inactive',reason:'stored_variant_not_allowed',variant:'control',exposed:false};
    return {status:'assigned',variant:existing.variant,exposed:true,firstExposure:false};}
   const distinctId=riverPostHogDistinctId(s,hashSecret);
   let variant;
   try{
    const flags=await posthogClient.evaluateFlags(distinctId,{flagKeys:[c.flagKey]});
    // Evaluating at the surface records PostHog's native $feature_flag_called exposure.
    variant=flags?.getFlag(c.flagKey);
   }catch{return {status:'inactive',reason:'posthog_unavailable',variant:'control',exposed:false};}
   if(!c.variants.includes(variant))return {status:'inactive',reason:'flag_not_configured',variant:'control',exposed:false};
   const assigned=await repository.claimABAssignment({...s,flagKey:c.flagKey,variant});
   if(!assigned)return {status:'inactive',reason:'subject_or_module_ineligible',variant:'control',exposed:false};
   if(!c.variants.includes(assigned.variant))return {status:'inactive',reason:'stored_variant_not_allowed',variant:'control',exposed:false};
   return {status:'assigned',variant:assigned.variant,exposed:true,firstExposure:assigned.firstExposure===true};
  },
  /** Admin-only aggregated experiment analysis; never expose through untrusted client gateway. */
  async reportRetention(p={}){
   if(typeof repository.getABRetentionDataset!=='function')throw new Error('Retention reporting adapter missing');
   const s=scope(p),c=config(p);
   if(!enabled||s.environment==='prod'&&!allowProduction)return {status:'disabled'};
   const dataset=await repository.getABRetentionDataset({...s,flagKey:c.flagKey});
   return reportDuolingoRetention({...dataset,asOf:p.asOf,flagKey:c.flagKey,windows:p.windows??[1,7,30],minPerArm:p.minPerArm??100});
  },
  /** EventId must already be recorded as a verified value event in Riverengine. */
  async conversion(p={}){
   const s=scope(p),c=config(p),deny=gate(s,p.analyticsConsent);
   if(deny)return {tracked:false,reason:deny};
   verify(p.eventId,UUID,'eventId');verify(p.conversionEvent,EVENT,'conversionEvent');
   if(!await repository.isABEligible(s))return {tracked:false,reason:'not_opted_in_or_ineligible'};
   const existing=await repository.getABAssignment({...s,flagKey:c.flagKey});
   if(!existing)return {tracked:false,reason:'no_exposure'};
   if(!c.variants.includes(existing.variant))return {tracked:false,reason:'stored_variant_not_allowed'};
   const variant=existing.variant;
   // Repository must validate this expected variant atomically while recording.
   const stored=await repository.recordABConversion({...s,flagKey:c.flagKey,eventId:p.eventId,conversionEvent:p.conversionEvent,expectedVariant:variant});
   if(!stored)return {tracked:false,reason:'no_eligible_verified_event_or_duplicate'};
   if(stored.variant!==variant)return {tracked:false,reason:'variant_changed'};
   const distinctId=riverPostHogDistinctId(s,hashSecret);
   try{
    // Queue acknowledged is NOT proof of ingestion. For strict delivery use a durable outbox.
    await posthogClient.capture({distinctId,event:'riverengine_ab_conversion',properties:{
     tenant_id:s.tenant,app_id:s.app,environment:s.environment,
     experiment_key:c.flagKey,conversion_event:p.conversionEvent,
     [`$feature/${c.flagKey}`]:variant,
    }});
    return {tracked:true,variant,posthogQueued:true};
   }catch{return {tracked:true,variant,posthogQueued:false};}
  },
 });
}
/** Optional SDK loader. Install posthog-node in a trusted backend; no live credentials in tests. */
export async function createPostHogNodeClient({projectKey,host='https://us.i.posthog.com'}={}){
 if(typeof projectKey!=='string'||projectKey.length<8)throw new TypeError('PostHog project token required');
 if(!['https://us.i.posthog.com','https://eu.i.posthog.com'].includes(host))throw new TypeError('Invalid PostHog host');
 let sdk;
 try{sdk=await import('posthog-node');}catch{throw new Error('Install optional server-side posthog-node dependency');}
 return new sdk.PostHog(projectKey,{host,disableGeoip:true,featureFlagsRequestTimeoutMs:3000});
}
