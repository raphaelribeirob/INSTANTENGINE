/**
 * RIVERENGINE universal server SDK (legacy TMNT API kept). Pure orchestration; no hosting, analytics,
 * notification provider, persistence or UI dependency at module import time.
 * Never import this module into untrusted mobile/browser clients with secrets.
 */
import {createHash} from 'node:crypto';
import {chooseVariant} from './decisions.mjs';
import {decideSmartNotification,recommendSafeSendHour} from './smart-notifications.mjs';
import {applyRiverBanditPolicy,riverBanditSegment} from './integrations/bandit-policy.mjs';
import {createCommerceAPI} from './commerce.mjs';
import {learnedReminderHour,assessExperiment,calculateDailyMission} from './retention-next.mjs';
export {learnedReminderHour,assessExperiment,calculateDailyMission,friendStreakFromDays} from './retention-next.mjs';
export {chooseVariant} from './decisions.mjs';
export {createGrokbotObserver,makeSignedGrokbotObservation,GROKBOT_OBSERVER_ENDPOINT} from './integrations/grokbot-observer.mjs';
export {createRiverObserverNeonRepository} from './storage/observer-neon.mjs';
export {createRiverValueOutboxPump} from './integrations/value-outbox.mjs';
export {createRiverValueOutboxNeonRepository} from './storage/value-outbox-neon.mjs';
export {createRiverAppInstrumentation} from './integrations/app-instrumentation.mjs';
export {scoreChurnRisk,createChurnDailyJob,createRiverEngagementAdapter,createInstantEngagementAdapter,planConsentSafeRetention} from './churn-prediction.mjs';
export {createRiverChurnNeonRepository,createInstantChurnNeonRepository} from './storage/churn-neon.mjs';
export {applyRiverBanditPolicy,signRiverBanditPolicy,riverBanditSegment} from './integrations/bandit-policy.mjs';
export {createRiverGraphileQueue,createRiverGraphileTaskList,createRiverPostHogHTTPDelivery} from './integrations/graphile-worker.mjs';
export {decideSmartNotification,recommendSafeSendHour} from './smart-notifications.mjs';
export {advanceHabit,reconcileHabitHistory} from './habits.mjs';
export {evaluateEligibility} from './policy.mjs';
export {analyzeRetention,analyzeRepurchase} from './analytics.mjs';
export {reportDuolingoRetention} from './duolingo-retention.mjs';
export {runCycle,tickHandler,validateSettings} from './worker.mjs';
export {createRiverABExperiments,riverPostHogDistinctId,createPostHogNodeClient} from './integrations/posthog-ab.mjs';

const SCOPE=/^[a-z][a-z0-9_-]{1,49}$/;
const IDENT=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const EVENT=/^[a-z][a-z0-9_.-]{1,79}$/;
const CAMPAIGN=/^[a-zA-Z0-9_.-]{1,100}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENVS=new Set(['test','staging','prod']);
const CADENCES=new Set(['daily','weekly','episodic','none']);
const CHANNELS=new Set(['push','email','in_app']);
const PURPOSES=new Set(['reminder','marketing','transactional']);
const PLATFORMS=new Set(['ios','android','web','server']);
function requireMatch(v,regex,label){if(typeof v!=='string'||!regex.test(v))throw new TypeError(`Invalid ${label}`);return v;}
function validateScope(x){
 if(!x||typeof x!=='object')throw new TypeError('Scope required');
 const tenant=requireMatch(x.tenant,SCOPE,'tenant'),app=requireMatch(x.app,SCOPE,'app');
 const environment=x.environment;
 if(!ENVS.has(environment))throw new TypeError('Invalid environment');
 return {tenant,app,environment};
}
function validateSubject(v){return requireMatch(v,IDENT,'subject');}
function dateTime(v){const d=new Date(v);if(!Number.isFinite(d.getTime()))throw new TypeError('Invalid timestamp');return d.toISOString();}
function tz(v){try{new Intl.DateTimeFormat('en',{timeZone:v});return v;}catch{throw new TypeError('Invalid timezone');}}
export function holdoutArm({tenant,app,environment,subject,experiment,holdoutPercent=10}){
 validateScope({tenant,app,environment});validateSubject(subject);requireMatch(experiment,EVENT,'experiment');
 if(!Number.isInteger(holdoutPercent)||holdoutPercent<0||holdoutPercent>50)throw new TypeError('Invalid holdout');
 const hash=createHash('sha256').update([tenant,app,environment,subject,experiment].join('\u001f')).digest();
 return (hash.readUInt32BE(0)/0x100000000)*100<holdoutPercent?'holdout':'treatment';
}
export function createTMNT({repository,now=()=>new Date(),onEvent=null,banditPolicy=null}={}){
 if(onEvent!==null&&typeof onEvent!=='function')throw new TypeError('Invalid telemetry callback');
 // Telemetry is best effort and cannot invalidate committed events or opt-outs.
 const emit=async(name,p,properties={})=>{
  if(!onEvent||typeof repository?.isABEligible!=='function')return;
  try{
   // Verified and persisted consent, enabled analytics module and live subject are all mandatory.
   if(!await repository.isABEligible(p))return;
   await onEvent({name,tenant:p.tenant,app:p.app,environment:p.environment,subject:p.subject,properties});
  }catch{/* Fail closed; activity persistence must not be rolled back by analytics. */}
 };
 const actions=['registerApp','track','consent','expose','enqueue','eraseSubject'];
 if(!repository||actions.some(x=>typeof repository[x]!=='function'))throw new TypeError('Repository does not implement TMNT contract');
 return Object.freeze({
  ...createCommerceAPI(repository,{now,emit}),
  async registerApp({tenant,app,environment,keyHash,cadence='daily',modules={},quietStart=8,quietEnd=21,weeklyLimit=3,holdoutPercent=10,events}={}){
   const s=validateScope({tenant,app,environment});
   requireMatch(keyHash,/^[0-9a-f]{64}$/i,'keyHash');
   if(!CADENCES.has(cadence))throw new TypeError('Invalid cadence');
   if(!modules||typeof modules!=='object'||Array.isArray(modules)||Object.keys(modules).some(x=>['socialMaxFriends','socialDailyInvites'].includes(x)?!Number.isInteger(modules[x])||modules[x]<1||modules[x]>50:!['notifications','habits','analytics','offers','feedback','social','missions','friendStreaks','leagues'].includes(x)||typeof modules[x]!=='boolean'))throw new TypeError('Invalid modules');
   if(!Number.isInteger(quietStart)||quietStart<0||quietStart>22||!Number.isInteger(quietEnd)||quietEnd<=quietStart||quietEnd>23)throw new TypeError('Invalid quiet hours');
   if(!Number.isInteger(weeklyLimit)||weeklyLimit<0||weeklyLimit>7||!Number.isInteger(holdoutPercent)||holdoutPercent<0||holdoutPercent>50)throw new TypeError('Invalid limits');
   if(!Array.isArray(events)||events.length===0||events.length>50)throw new TypeError('At least one event required');
   const used=new Set();for(const item of events){requireMatch(item?.name,EVENT,'event');if(typeof item.value!=='boolean'||used.has(item.name))throw new TypeError('Invalid event registry');used.add(item.name);}
   return repository.registerApp({...s,keyHash,cadence,modules,quietStart,quietEnd,weeklyLimit,holdoutPercent,events});
  },
  async track({tenant,app,environment,subject,eventId,event,occurredAt=now(),locale='en',timezone='UTC'}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);requireMatch(eventId,UUID,'eventId');requireMatch(event,EVENT,'event');
   if(typeof locale!=='string'||locale.length>24||!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(locale))throw new TypeError('Invalid locale');
   const occurred=dateTime(occurredAt);
   if(new Date(occurred).getTime()>new Date(now()).getTime()+5*60*1000)throw new TypeError('Future event');
   const tracked=await repository.track({...s,subject,eventId,event,occurredAt:occurred,locale,timezone:tz(timezone)});
   if(tracked)await emit('tmnt_event_tracked',{...s,subject},{event,occurredAt:occurred});
   return tracked;
  },
  async setConsent({tenant,app,environment,subject,channel,purpose,granted,verified=false,platform}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);
   if(!CHANNELS.has(channel)||!PURPOSES.has(purpose)||!PLATFORMS.has(platform)||typeof granted!=='boolean'||typeof verified!=='boolean'||(granted&&!verified))throw new TypeError('Invalid consent');
   return repository.consent({...s,subject,channel,purpose,granted,verified,platform});
  },
  async expose({tenant,app,environment,subject,experiment='retention_push',holdoutPercent=10,configVersion=1}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);requireMatch(experiment,EVENT,'experiment');
   if(!Number.isInteger(configVersion)||configVersion<1||!Number.isInteger(holdoutPercent)||holdoutPercent<0||holdoutPercent>50)throw new TypeError('Invalid experiment configuration');
   const arm=holdoutArm({...s,subject,experiment,holdoutPercent});
   const result=await repository.expose({...s,subject,experiment,arm,configVersion});
   if(result)await emit('tmnt_experiment_exposed',{...s,subject},{experiment,arm:result,configVersion});
   return result;
  },
  async schedule({tenant,app,environment,subject,campaignKey,templateId}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);requireMatch(campaignKey,CAMPAIGN,'campaignKey');requireMatch(templateId,/^[a-zA-Z0-9_.-]{1,80}$/,'templateId');
   return repository.enqueue({...s,subject,campaignKey,templateId});
  },
  /** Trusted backend repair after offline sync; not authorized by default HTTP action list. */
  async reconcileHabit({tenant,app,environment,subject}={}){const s=validateScope({tenant,app,environment});validateSubject(subject);if(typeof repository.reconcileHabit!=='function')throw new Error('Habit reconciliation adapter missing');return repository.reconcileHabit({...s,subject});},
  async getHabit({tenant,app,environment,subject}={}){const s=validateScope({tenant,app,environment});validateSubject(subject);if(typeof repository.getHabit!=='function')throw new Error('Habits adapter missing');return repository.getHabit({...s,subject});},
  async setHabitGoal({tenant,app,environment,subject,goal}={}){const s=validateScope({tenant,app,environment});validateSubject(subject);if(!Number.isInteger(goal)||goal<1||goal>10)throw new TypeError('Invalid goal');if(typeof repository.setHabitGoal!=='function')throw new Error('Habits adapter missing');return repository.setHabitGoal({...s,subject,goal});},
  /** Server-side contextual planner. Calls provider-neutral enqueue only if all checks pass.
   * It does not initiate network pushes. The worker performs an independent preflight.
   * Calling this from an authenticated scheduler is the app backend's responsibility.
   */
  async planSmartReminder({tenant,app,environment,subject,campaignKey,variants,kind='reminder',exploration=0.12,
     autoTuneHour=true,minSamples=6,minimumFatigueSamples=4}={}){
   const scope=validateScope({tenant,app,environment});validateSubject(subject);
   requireMatch(campaignKey,CAMPAIGN,'campaignKey');requireMatch(kind,EVENT,'kind');
   if(typeof autoTuneHour!=='boolean')throw new TypeError('Invalid autotune flag');
   if(typeof repository.smartNotificationContext!=='function'||typeof repository.enqueueSelected!=='function')throw new Error('Smart notification repository contract missing');
   const p={...scope,subject,campaignKey,kind};
   const context=await repository.smartNotificationContext(p);
   if(!context)return {action:'do_not_send',reason:'unknown_subject'};
   // Auto-tune only for verified push consent + treatment; never overwrite explicit user choices.
   let hourUpdate='not_attempted';
   if(autoTuneHour&&context.app?.enabled===true&&context.app.modules?.notifications===true&&context.consent?.granted&&context.consent?.verified&&context.arm==='treatment'){
    const suggested=recommendSafeSendHour({context,minSamples});
    hourUpdate=suggested.reason;
    if(suggested.apply&&typeof repository.applyOptimizedHour==='function'){
     const updated=await repository.applyOptimizedHour({...scope,subject,hour:suggested.hour});
     if(updated){context.subject.reminderHour=suggested.hour;context.subject.reminderHourSource='algorithm';hourUpdate='updated';}
     else hourUpdate='not_applied';
    }
   }
   const decision=decideSmartNotification({context,variants,seed:[tenant,app,environment,subject,campaignKey].join(':'),now:now(),exploration,minimumFatigueSamples});
   if(decision.action!=='send')return {...decision,hourUpdate};
   // Optional offline ML is advisory only. Eligibility/consent/fatigue and atomic SQL send checks are authoritative.
   let selected=decision;
   if(banditPolicy?.enabled===true){
    try{
     const userHour=Number(new Intl.DateTimeFormat('en',{hour:'2-digit',hourCycle:'h23',timeZone:context.subject?.timezone||'UTC'}).format(now()));
     const segment=riverBanditSegment({daysSinceValue:decision.daysSinceValue,streak:context.habit?.streak||0,localHour:userHour});
     // Allow only templates approved for this *same intent* to avoid ML turning a supportive restart into pressure.
     const approved=variants.filter(v=>v?.intent===decision.intent||(decision.intent==='general'&&(!v?.intent||v.intent==='general'))).map(v=>v.id);
     selected=applyRiverBanditPolicy({baseline:decision,policy:banditPolicy.policy,signature:banditPolicy.signature,secret:banditPolicy.secret,scope,segment,approvedTemplates:approved,now:now(),enabled:banditPolicy.enabled,allowProduction:banditPolicy.allowProduction===true});
    }catch{selected=decision;}
   }
   if(selected.action!=='send')return {...selected,hourUpdate};
   const deliveryId=await repository.enqueueSelected({...p,templateId:selected.templateId});
   if(!deliveryId)return {action:'do_not_send',reason:'atomic_enqueue_denied',hourUpdate};
   return {...selected,action:'queued',deliveryId,hourUpdate,providerDelivered:false};
  },
  async recommend({tenant,app,environment,subject,campaignKey,variants,kind='reminder',exploration=0.12}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);requireMatch(campaignKey,CAMPAIGN,'campaignKey');requireMatch(kind,EVENT,'kind');
   if(typeof repository.notificationContext!=='function'||(typeof repository.noteDecision!=='function'&&typeof repository.enqueueSelected!=='function'))throw new Error('Adapter does not support decision telemetry');
   const context=await repository.notificationContext({...s,subject,kind});
   if(!context)return null;
   const selection=chooseVariant({variants,stats:context.stats,recent:context.recent,seed:[tenant,app,environment,subject,campaignKey].join(':'),exploration});
   const details={...s,subject,campaignKey,templateId:selection.id,kind};
   let deliveryId;
   if(typeof repository.enqueueSelected==='function')deliveryId=await repository.enqueueSelected(details);
   else {
     deliveryId=await repository.enqueue(details);
     if(deliveryId){
       const noted=await repository.noteDecision(details);
       if(!noted)throw new Error('Decision record failed');
     }
   }
   if(!deliveryId)return null;
   return {deliveryId,templateId:selection.id,reason:selection.reason,causalEffect:null};
  },
  async recordOutcome({tenant,app,environment,subject,campaignKey,type}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);requireMatch(campaignKey,CAMPAIGN,'campaignKey');
   if(!['opened','value'].includes(type))throw new TypeError('Invalid outcome');
   if(typeof repository.outcome!=='function')throw new Error('Adapter does not support outcome attribution');
   const recorded=await repository.outcome({...s,subject,campaignKey,type});
   if(recorded)await emit('tmnt_notification_outcome',{...s,subject},{campaignKey,type});
   return recorded;
  },
  /** Social features are opt-in per app and require explicit bilateral acceptance.
   * Never expose direct methods to anonymous clients: the app backend must bind
   * subject to the authenticated user before invoking these methods. */
  async inviteFriend({tenant,app,environment,subject,friend}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);validateSubject(friend);
   if(subject===friend)throw new TypeError('Cannot invite self');
   if(typeof repository.inviteFriend!=='function')throw new Error('Social adapter missing');
   return repository.inviteFriend({...s,subject,friend});
  },
  async respondFriend({tenant,app,environment,subject,friend,accept}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);validateSubject(friend);
   if(subject===friend||typeof accept!=='boolean')throw new TypeError('Invalid friend response');
   if(typeof repository.respondFriend!=='function')throw new Error('Social adapter missing');
   return repository.respondFriend({...s,subject,friend,accept});
  },
  async removeFriend({tenant,app,environment,subject,friend}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);validateSubject(friend);
   if(subject===friend)throw new TypeError('Invalid friend');
   if(typeof repository.removeFriend!=='function')throw new Error('Social adapter missing');
   return repository.removeFriend({...s,subject,friend});
  },
  async startFriendQuest({tenant,app,environment,subject,friend,questKey,targetDays=6,durationDays=7}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);validateSubject(friend);
   requireMatch(questKey,CAMPAIGN,'questKey');
   if(subject===friend||!Number.isInteger(targetDays)||targetDays<2||targetDays>30||!Number.isInteger(durationDays)||durationDays<1||durationDays>30||targetDays>durationDays*2)throw new TypeError('Invalid quest settings');
   if(typeof repository.startFriendQuest!=='function')throw new Error('Social adapter missing');
   return repository.startFriendQuest({...s,subject,friend,questKey,targetDays,durationDays});
  },
  async friendQuestStatus({tenant,app,environment,subject,friend,questKey}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);validateSubject(friend);requireMatch(questKey,CAMPAIGN,'questKey');
   if(subject===friend)throw new TypeError('Invalid friend');
   if(typeof repository.friendQuestStatus!=='function')throw new Error('Social adapter missing');
   return repository.friendQuestStatus({...s,subject,friend,questKey});
  },
  /** Advisory scheduling; applying a learned hour is explicitly opt-in. */
  async recommendReminderHour({tenant,app,environment,subject,apply=false,minSamples=6}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);
   if(typeof apply!=='boolean'||!Number.isInteger(minSamples)||minSamples<2||minSamples>100)throw new TypeError('Invalid learning configuration');
   if(typeof repository.sendTimeContext!=='function')throw new Error('Send-time adapter missing');
   const context=await repository.sendTimeContext({...s,subject});if(!context)return null;
   const recommendation=learnedReminderHour({...context,minSamples});
   let applied=false;
   if(apply&&recommendation.learned&&typeof repository.applyOptimizedHour==='function')applied=await repository.applyOptimizedHour({...s,subject,hour:recommendation.hour});
   return {...recommendation,applied};
  },
  async defineDailyMission({tenant,app,environment,missionKey,event,target=1,rewardXp=0}={}){
   const s=validateScope({tenant,app,environment});requireMatch(missionKey,CAMPAIGN,'missionKey');requireMatch(event,EVENT,'event');
   if(!Number.isInteger(target)||target<1||target>100||!Number.isInteger(rewardXp)||rewardXp<0||rewardXp>500)throw new TypeError('Invalid mission');
   if(typeof repository.defineDailyMission!=='function')throw new Error('Mission adapter missing');
   return repository.defineDailyMission({...s,missionKey,event,target,rewardXp});
  },
  async dailyMissions({tenant,app,environment,subject}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);
   if(typeof repository.dailyMissions!=='function')throw new Error('Mission adapter missing');
   return repository.dailyMissions({...s,subject});
  },
  async claimDailyMission({tenant,app,environment,subject,missionKey}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);requireMatch(missionKey,CAMPAIGN,'missionKey');
   if(typeof repository.claimDailyMission!=='function')throw new Error('Mission adapter missing');
   return repository.claimDailyMission({...s,subject,missionKey});
  },
  async friendStreak({tenant,app,environment,subject,friend}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);validateSubject(friend);
   if(subject===friend)throw new TypeError('Invalid friend');
   if(typeof repository.friendStreak!=='function')throw new Error('Friend Streak adapter missing');
   return repository.friendStreak({...s,subject,friend});
  },
  async joinLeague({tenant,app,environment,subject}={}){const s=validateScope({tenant,app,environment});validateSubject(subject);if(typeof repository.joinLeague!=='function')throw new Error('League adapter missing');return repository.joinLeague({...s,subject});},
  async leaveLeague({tenant,app,environment,subject}={}){const s=validateScope({tenant,app,environment});validateSubject(subject);if(typeof repository.leaveLeague!=='function')throw new Error('League adapter missing');return repository.leaveLeague({...s,subject});},
  async weeklyLeaderboard({tenant,app,environment,subject,limit=20}={}){const s=validateScope({tenant,app,environment});validateSubject(subject);if(!Number.isInteger(limit)||limit<1||limit>50)throw new TypeError('Invalid leaderboard limit');if(typeof repository.weeklyLeaderboard!=='function')throw new Error('League adapter missing');return repository.weeklyLeaderboard({...s,subject,limit});},
  assessExperiment(row,policy){return assessExperiment(row,policy);},
  async eraseSubject({tenant,app,environment,subject}={}){
   const s=validateScope({tenant,app,environment});validateSubject(subject);
   return repository.eraseSubject({...s,subject});
  }
 });
}

/** Official brand alias; legacy createTMNT remains compatible. */
export {createTMNT as createRiverEngine,createTMNT as createInstantEngine};
