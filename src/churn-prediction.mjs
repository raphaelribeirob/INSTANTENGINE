/** RIVERENGINE churn v3.0. Server-only, transparent and privacy-first.
 * Baseline = heuristic risk INDEX, never a probability. A validated model is optional.
 * No push or user-level observer access is exposed from this module.
 */
const SCOPE=/^[a-z][a-z0-9_-]{1,49}$/;
const SUBJECT=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const KINDS=new Set(['app_opened','lesson_completed','value_completed','action_failed','app_crashed']);
const SOURCES=new Set(['icon','push','widget','deeplink','unknown']);
const FEATURES=['daysSinceOpen','activeDays7','activeDaysPrev7','completed7','failed7','crashes7','opens7'];
const CLAMP=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function nonnegativeInt(v,max=100000){if(!Number.isSafeInteger(v)||v<0||v>max)throw new TypeError('Invalid engagement count');return v;}
function isoDate(v){if(typeof v!=='string'||!DATE.test(v)||Number.isNaN(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new TypeError('Invalid asOf UTC day');return v;}
export function validateChurnScope({tenant,app,environment}={}){
 if(!SCOPE.test(tenant??'')||!SCOPE.test(app??'')||!['test','staging','prod'].includes(environment))throw new TypeError('Invalid INSTANTENGINE tenant/app/environment');
 return {tenant,app,environment};
}
export function normalizeEngagement({eventId,kind,source='unknown',occurredAt,now=new Date()}={}){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId??'')||!KINDS.has(kind)||!SOURCES.has(source))throw new TypeError('Invalid trusted engagement signal');
 if(kind!=='app_opened'&&source!=='unknown')throw new TypeError('Only app opens may have a source');
 const time=new Date(occurredAt),clock=new Date(now);
 if(!Number.isFinite(time.getTime())||!Number.isFinite(clock.getTime())||time.getTime()>clock.getTime()+300000||time.getTime()<clock.getTime()-2*86400000)throw new TypeError('Outside allowed engagement event window');
 return {eventId,kind,source,occurredAt:time.toISOString()};
}
/** Only a trusted backend callback can resolve a subject and a verified app event.
 * User-supplied source/subject is never accepted. Repository enforces analytics opt-in.
 */
export function createRiverEngagementAdapter({repository,tenant,app,environment='test',verifyEngagementEvent,enabled=false,allowProduction=false,now=()=>new Date()}={}){
 const scope=validateChurnScope({tenant,app,environment});
 if(!repository||typeof repository.recordEngagement!=='function'||typeof verifyEngagementEvent!=='function'||typeof enabled!=='boolean'||typeof allowProduction!=='boolean'||typeof now!=='function')throw new TypeError('Trusted adapter required');
 return Object.freeze({async record({eventId,kind}={}){
  if(!enabled)return {status:'disabled'};
  if(environment==='prod'&&!allowProduction)return {status:'production_disabled'};
  if(!KINDS.has(kind)||!/^[-0-9a-f]{36}$/i.test(eventId??''))return {status:'invalid_signal'};
  const proof=await verifyEngagementEvent({...scope,eventId,kind});
  if(proof?.verified!==true||proof.eventId!==eventId||proof.kind!==kind||!SUBJECT.test(proof.subject??''))return {status:'unverified'};
  let signal;try{signal=normalizeEngagement({eventId,kind,source:proof.source??'unknown',occurredAt:proof.occurredAt,now:now()});}catch{return {status:'invalid_proof'};}
  const inserted=await repository.recordEngagement({...scope,subject:proof.subject,...signal});
  return {status:inserted?'recorded':'duplicate_or_no_consent'};
 }});
}
function numericFeature(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Feature snapshot required');
 const out={};for(const k of FEATURES)out[k]=nonnegativeInt(raw[k],k==='daysSinceOpen'?365:k.startsWith('activeDays')?7:100000);
 if(out.activeDays7>7||out.activeDaysPrev7>7)throw new TypeError('Impossible active day count');
 return out;
}
function getVector(f){return [CLAMP(f.daysSinceOpen/7,0,1),f.activeDays7/7,f.activeDaysPrev7/7,CLAMP(f.completed7/10,0,1),CLAMP(f.failed7/10,0,1),CLAMP(f.crashes7/3,0,1),CLAMP(f.opens7/14,0,1)];}
function validateModel(m){
 const v=m?.validation;
 if(m?.schema!=='river_churn_v1'||m?.approved!==true||m?.status!=='validated'||typeof m.version!=='string'||!/^[-a-zA-Z0-9_.]{2,64}$/.test(m.version)||!Array.isArray(m.weights)||m.weights.length!==FEATURES.length||m.weights.some(x=>!Number.isFinite(x)||Math.abs(x)>50)||!Number.isFinite(m.intercept)||Math.abs(m.intercept)>50||!v||!Number.isInteger(v.testSize)||v.testSize<200||!Number.isInteger(v.returned)||v.returned<30||!Number.isInteger(v.didNotReturn)||v.didNotReturn<30||v.returned+v.didNotReturn!==v.testSize||![v.auc,v.brier,v.baselineBrier,v.calibrationError].every(Number.isFinite)||v.auc<0.6||v.auc>1||v.brier<0||v.brier>v.baselineBrier||v.baselineBrier>1||v.calibrationError<0||v.calibrationError>0.1)throw new TypeError('Unvalidated or poorly calibrated churn model');
 return m;
}
/** Training, validation and model promotion are separate controlled offline jobs.
 * The caller supplies a validated frozen artifact, not training data from user devices.
 */
export function scoreChurnRisk({features,model=null}={}){
 const f=numericFeature(features),z=getVector(f);
 if(model){const m=validateModel(model);
  const logit=CLAMP(m.intercept+z.reduce((sum,x,i)=>sum+x*m.weights[i],0),-35,35);
  const returnP=Math.round((1/(1+Math.exp(-logit)))*10000)/10000;
  return {kind:'validated_probability',modelVersion:m.version,returnProbabilityTomorrow:returnP,churnProbabilityTomorrow:Math.round((1-returnP)*10000)/10000,
   riskTier:returnP<0.35?'high':returnP<0.7?'medium':'low',recommendedAction:'human_review_only',automaticSend:false};
 }
 // Explicitly NOT calibrated. Do not present as chance of returning or real probability.
 const gap=CLAMP(f.daysSinceOpen,0,7),momentum=f.activeDays7-f.activeDaysPrev7;
 const raw=28+gap*8+(f.completed7===0?12:-Math.min(16,f.completed7*3))
  -f.activeDays7*4+(momentum<0?Math.min(13,-momentum*3):0)
  +Math.min(12,f.failed7*2)+Math.min(16,f.crashes7*8)-Math.min(10,f.opens7);
 const index=Math.round(CLAMP(raw,0,100));
 const reasons=[];
 if(gap>=3)reasons.push('long_absence');
 if(f.completed7===0)reasons.push('no_recent_verified_progress');
 if(momentum<=-2)reasons.push('declining_activity');
 if(f.failed7>=3)reasons.push('repeated_failed_actions');
 if(f.crashes7>0)reasons.push('stability_issue');
 return {kind:'heuristic_risk_index',modelVersion:'river_heuristic_v1',riskIndex:index,returnProbabilityTomorrow:null,churnProbabilityTomorrow:null,
  riskTier:index>=70?'high':index>=35?'medium':'low',reasonCodes:reasons,recommendedAction:'human_review_only',automaticSend:false};
}
/** Fixed UTC daily job. Scoped, opt-in-only repository; no messaging side-effects.
 * Default is the last fully closed UTC day, never the current incomplete day.
 * Idempotent daily upsert; pagination supports deterministic resumption.
 */
export function createChurnDailyJob({repository,enabled=false,allowProduction=false,model=null,now=()=>new Date()}={}){
 if(!repository||typeof repository.listChurnFeatures!=='function'||typeof repository.upsertChurnScore!=='function'||typeof enabled!=='boolean'||typeof allowProduction!=='boolean')throw new TypeError('Scoped churn repository required');
 if(model)validateModel(model);
 return Object.freeze({async run({tenant,app,environment,asOf,pageSize=250,maxPages=100}={}){
  const scope=validateChurnScope({tenant,app,environment});
  const clock=new Date(now());
  if(!Number.isFinite(clock.getTime()))throw new TypeError('Invalid UTC job clock');
  const todayUtc=clock.toISOString().slice(0,10);
  // The default scores yesterday even when the scheduler runs near UTC midnight.
  const scoreDay=isoDate(asOf??new Date(clock.getTime()-86400000).toISOString().slice(0,10));
  if(scoreDay>=todayUtc)throw new TypeError('Churn score day must be a completed UTC day');
  if(!enabled)return {status:'disabled',processed:0};
  if(environment==='prod'&&!allowProduction)return {status:'production_disabled',processed:0};
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500||!Number.isInteger(maxPages)||maxPages<1||maxPages>10000)throw new TypeError('Invalid pagination');
  let afterSubject='',processed=0,pages=0,mayHaveMore=false;
  for(;pages<maxPages;){
   const batch=await repository.listChurnFeatures({...scope,asOf:scoreDay,afterSubject,limit:pageSize});
   pages++; // Count actual repository page reads, including empty terminal reads.
   if(!Array.isArray(batch)||batch.length>pageSize)throw new TypeError('Invalid repository page');
   if(batch.length===0){mayHaveMore=false;break;}
   for(const row of batch){if(!SUBJECT.test(row?.subject??'')||row.subject<=afterSubject)throw new TypeError('Unordered subject pagination');
    const scored=scoreChurnRisk({features:row.features,model});
    await repository.upsertChurnScore({...scope,subject:row.subject,asOf:scoreDay,score:scored});
    afterSubject=row.subject;processed++;
   }
   // A full final page may have more subjects. We deliberately avoid an extra
   // query beyond maxPages: hasMore is conservative at the page cap.
   mayHaveMore=batch.length===pageSize;
   if(!mayHaveMore)break;
  }
  return {status:'ok',asOf:scoreDay,processed,pages,hasMore:mayHaveMore,modelVersion:model?.version??'river_heuristic_v1',notificationsSent:0};
 }});
}

/** Advisory-only intervention planner; never invokes notification providers.
 * Notification permission explanations are user-initiated, in-app, rate limited and opt-out respecting.
 * The existing RIVERENGINE smart-notification eligibility + holdout policy remains mandatory.
 */
export {createRiverEngagementAdapter as createInstantEngagementAdapter};
export function planConsentSafeRetention({score,context}={}){
 if(!score||!['low','medium','high'].includes(score.riskTier)||!context||typeof context!=='object')throw new TypeError('Validated advisory context required');
 const NO=(reason)=>({action:'none',reason,automaticSend:false});
 if(context.analyticsConsent!==true)return NO('analytics_consent_missing');
 if(score.riskTier==='low')return NO('no_intervention_necessary');
 if(context.hasRecentCrash===true)return {action:'prioritize_stability_fix',reason:'recent_crash',automaticSend:false};
 if(context.notificationsEnabled!==true){
  if(context.userInitiatedInApp!==true||context.permissionPromptDismissed===true||!Number.isInteger(context.daysSincePermissionPrompt)||context.daysSincePermissionPrompt<30)return NO('respect_notification_choice');
  const benefit=['friend_quest','streak','ranking','daily_goal'].find(v=>context.verifiedBenefits?.[v]===true)??'reminder';
  return {action:'explain_permission_in_app',reason:'user_initiated_help',benefit,automaticSend:false,
   mandatoryChoice:'dismissible_without_penalty'};
 }
 if(context.notificationConsent!==true||context.experimentArm!=='treatment')return NO('push_consent_or_holdout_block');
 return {action:'review_existing_notification_policy',reason:'potential_useful_intervention',automaticSend:false,
  mandatoryChecks:['smart_notification_eligibility','quiet_hours','frequency_cap','provider_state','verified_value_fatigue','experiment_holdout']};
}
