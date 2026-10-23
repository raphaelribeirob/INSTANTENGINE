/** In-memory adapter with the same conservative eligibility policy as SQL.
 * Incomplete durable DB semantics are intentionally NOT simulated as delivery. */
import {evaluateEligibility} from '../policy.mjs';
import {advanceHabit,reconcileHabitHistory} from '../habits.mjs';
import {localParts} from '../policy.mjs';
import {randomUUID} from 'node:crypto';
import {learnedReminderHour,calculateDailyMission,friendStreakFromDays,localDay} from '../retention-next.mjs';
export function createMemoryRepository({now=()=>new Date()}={}){
 const apps=new Map(),subjects=new Map(),events=new Map(),consents=new Map(),exposures=new Map(),deliveries=new Set();
 const jobs=new Map(),decisions=new Map(),outcomes=new Map(),habitStates=new Map();
 const friendships=new Map(),quests=new Map(),questDays=new Set();
 const missions=new Map(),missionClaims=new Set(),leagueMembers=new Map();
 const nonces=new Set(),inviteAttempts=new Map();
 const abConsents=new Map(),abAssignments=new Map(),abConversions=new Map();
 const offers=new Map(),redemptions=new Map(),checkoutRefs=new Set(),feedback=new Map(),reviewClaims=new Map();
 const pair=(p)=>[p.subject,p.friend].sort();
 const friendshipKey=(p)=>key(p)+'/'+pair(p).join('/');
 const questId=(p)=>friendshipKey(p)+'/'+p.questKey;
 const key=p=>[p.tenant,p.app,p.environment].join('/');
 const sk=p=>key(p)+'/'+p.subject;
 return {
  nonceDurability:'memory',
  debug:{nonces,apps,subjects,events,consents,exposures,deliveries,jobs,decisions,outcomes,habitStates,friendships,inviteAttempts,quests,questDays,missions,missionClaims,leagueMembers,offers,redemptions,checkoutRefs,feedback,reviewClaims,abConsents,abAssignments,abConversions},
  async claimRequest(p){if(Math.abs(new Date(now()).getTime()-p.timestampMs)>300000)return false;const k=key(p)+'/'+p.requestId;if(nonces.has(k))return false;nonces.add(k);return true;},
  async registerApp(p){const id=key(p);if(apps.has(id))return false;apps.set(id,{...p,enabled:true});return true;},
  async track(p){const id=key(p),config=apps.get(id);if(!config)throw Error('Unknown app');const reg=config.events.find(e=>e.name===p.event);if(!reg)throw Error('Unknown event');const ev=id+'/'+p.eventId;if(events.has(ev))return false;events.set(ev,{subjectKey:sk(p),occurredAt:p.occurredAt,isValue:reg.value,name:p.event,eventId:p.eventId});const state=subjects.get(sk(p))||{valueCount:0,lastValueAt:null,lastActiveAt:null,timezone:p.timezone,locale:p.locale,createdAt:new Date(now()).toISOString()};
   if(!state.lastActiveAt||new Date(state.lastActiveAt)<new Date(p.occurredAt))state.lastActiveAt=p.occurredAt;
   if(reg.value){state.valueCount++;if(!state.lastValueAt||new Date(state.lastValueAt)<new Date(p.occurredAt))state.lastValueAt=p.occurredAt;
    if(config.modules.habits){const prior=habitStates.get(sk(p));const next=advanceHabit(prior,p.occurredAt,{timezone:p.timezone,goal:prior?.dailyGoal??1,freezeBalance:prior?.freezeBalance??1});habitStates.set(sk(p),next);}}
   state.locale=p.locale;state.timezone=p.timezone;subjects.set(sk(p),state);
   if(reg.value && config.modules.social === true){
    for(const [id,q] of quests){
     if(q.appKey!==key(p)||q.status!=='active'||![q.first,q.second].includes(p.subject))continue;
     const at=new Date(p.occurredAt).getTime();
     if(at<q.createdAt||at>=q.expiresAt||at>new Date(now()).getTime()+300000||at<new Date(now()).getTime()-30*86400000)continue;
     const day=localParts(p.occurredAt,p.timezone).day;
     questDays.add(id+'/'+p.subject+'/'+day);
    }
   }
   return true;},
  async consent(p){if(!subjects.has(sk(p)))return false;consents.set(sk(p)+'/'+p.channel+'/'+p.purpose,{granted:p.granted,verified:p.verified});return true;},
  async expose(p){if(!subjects.has(sk(p)))return null;const id=sk(p)+'/'+p.experiment;if(!exposures.has(id))exposures.set(id,p.arm);return exposures.get(id);},
  async setABAnalyticsConsent(p){if(!subjects.has(sk(p))||!apps.get(key(p))?.modules.analytics)return false;
   abConsents.set(sk(p),{granted:p.granted,verified:p.verified});return true;},
  async isABEligible(p){return apps.get(key(p))?.enabled===true&&apps.get(key(p))?.modules.analytics===true&&subjects.has(sk(p))&&abConsents.get(sk(p))?.granted===true&&abConsents.get(sk(p))?.verified===true;},
  async getABAssignment(p){return abAssignments.get(sk(p)+'/'+p.flagKey)||null;},
  async claimABAssignment(p){if(!await this.isABEligible(p))return null;
   const id=sk(p)+'/'+p.flagKey;if(abAssignments.has(id))return {...abAssignments.get(id),firstExposure:false};
   const value={variant:p.variant,exposedAt:new Date(now()).toISOString()};abAssignments.set(id,value);
   return {...value,firstExposure:true};},
  async recordABConversion(p){if(!await this.isABEligible(p))return null;
   const a=abAssignments.get(sk(p)+'/'+p.flagKey);if(!a||typeof p.expectedVariant!=='string'||a.variant!==p.expectedVariant)return null;
   const ev=events.get(key(p)+'/'+p.eventId);
   if(!ev||ev.subjectKey!==sk(p)||!ev.isValue||ev.name!==p.conversionEvent||new Date(ev.occurredAt).getTime()<new Date(a.exposedAt).getTime())return null;
   const id=sk(p)+'/'+p.flagKey+'/'+p.eventId;if(abConversions.has(id))return null;
   abConversions.set(id,{variant:a.variant,eventId:p.eventId,conversionEvent:p.conversionEvent});return {variant:a.variant};},
  async getABRetentionDataset(p){
   if(!apps.get(key(p))?.enabled||apps.get(key(p))?.modules.analytics!==true)return {participants:[],valueDays:[]};
   const root=key(p)+'/',participants=[],valueDays=[];
   for(const [id,assignment] of abAssignments){
    if(!id.startsWith(root)||!id.endsWith('/'+p.flagKey))continue;
    const subject=id.slice(root.length,-p.flagKey.length-1);
    const c=abConsents.get(root+subject);
    if(c?.granted!==true||c?.verified!==true||!subjects.has(root+subject))continue;
    const common={tenant:p.tenant,app:p.app,environment:p.environment,subject};
    participants.push({...common,flagKey:p.flagKey,variant:assignment.variant,exposedAt:assignment.exposedAt});
    for(const ev of events.values())if(ev.subjectKey===root+subject&&ev.isValue&&new Date(ev.occurredAt)>=new Date(assignment.exposedAt))valueDays.push({...common,day:new Date(ev.occurredAt).toISOString().slice(0,10),verified:true});
   }
   if(participants.length>10000||valueDays.length>100000)throw new Error('Experiment exceeds in-process reporting limit; use warehouse aggregate');
   return {participants,valueDays};
  },
  async reconcileHabit(p){
   const cfg=apps.get(key(p)),user=subjects.get(sk(p));
   if(!cfg?.enabled||cfg.modules.habits!==true||!user)return null;
   const valueEvents=[...events.values()].filter(ev=>ev.subjectKey===sk(p)&&ev.isValue).map(ev=>({eventId:ev.eventId,isValue:true,occurredAt:ev.occurredAt}));
   const missionXp=[...missionClaims].filter(k=>k.startsWith(sk(p)+'/')).reduce((sum,k)=>{
    const tail=k.slice(sk(p).length+1),last=tail.lastIndexOf('/'),name=tail.slice(0,last);
    return sum+(missions.get(key(p)+'/'+name)?.rewardXp||0);
   },0);
   const previous=habitStates.get(sk(p));
   const state=reconcileHabitHistory({events:valueEvents,timezone:user.timezone,dailyGoal:previous?.dailyGoal??1,missionXp});
   const {earnedMilestones,...stored}=state;habitStates.set(sk(p),stored);
   return {...stored,earnedMilestones};
  },
  async getHabit(p){return habitStates.get(sk(p))||null;},
  async setHabitGoal(p){const config=apps.get(key(p));const state=habitStates.get(sk(p));if(!config?.modules.habits||!state)return false;state.dailyGoal=p.goal;state.goalMet=(state.todayCount||0)>=p.goal;return true;},
  async eligibility(p){const id=sk(p),app=apps.get(key(p)),subject=subjects.get(id);
   return evaluateEligibility({app,subject,consent:consents.get(id+'/push/reminder'),arm:exposures.get(id+'/retention_push'),now:now(),existingCampaign:deliveries.has(id+'/'+p.campaignKey),deliveries:[...jobs.entries()].filter(([,j])=>j.subjectKey===id).map(([keyJob,j])=>({...j,verifiedValue:outcomes.has(keyJob+'/value')}))});},
  async enqueue(p){const check=await this.eligibility(p);if(!check.eligible)return null;
   const id=sk(p)+'/'+p.campaignKey;if(deliveries.has(id))return null;deliveries.add(id);
   jobs.set(id,{subjectKey:sk(p),status:'reserved',templateId:p.templateId,campaignKey:p.campaignKey,locale:subjects.get(sk(p)).locale});return id;},
  async notificationContext(p){const id=sk(p),subject=subjects.get(id);if(!apps.has(key(p))||!subject)return null;
   const recent=[...decisions.values()].filter(d=>d.subjectKey===id).sort((a,b)=>b.at-a.at).slice(0,3).map(d=>d.templateId);
   const stats={};for(const d of decisions.values())if(d.appKey===key(p)&&d.kind===p.kind){const st=stats[d.templateId]||{views:0,successes:0};const job=jobs.get(d.id);if(job?.status==='provider_accepted' && new Date(job.sentAt).getTime()<=new Date(now()).getTime()-24*3600_000 && d.locale.split('-')[0]===subject.locale.split('-')[0]){st.views++;if(outcomes.has(d.id+'/value'))st.successes++;}stats[d.templateId]=st;}
   return {recent,stats,locale:subject.locale,timezone:subject.timezone,streak:habitStates.get(id)?.streak||0};},
  async smartNotificationContext(p){
   const id=sk(p),app=apps.get(key(p)),subject=subjects.get(id);
   if(!app||!subject)return null;
   const consent=consents.get(id+'/push/reminder')||null;
   const arm=exposures.get(id+'/retention_push')||null;
   const existingCampaign=deliveries.has(id+'/'+p.campaignKey);
   const recentJobs=[...jobs.entries()].filter(([,j])=>j.subjectKey===id).map(([jobKey,j])=>({
    status:j.status,sentAt:j.sentAt||null,leaseUntil:j.leaseUntil||null,
    verifiedValue:outcomes.has(jobKey+'/value')
   }));
   const safe=app.enabled&&app.modules.notifications===true&&consent?.granted===true&&consent?.verified===true&&arm==='treatment';
   const prev=safe?await this.notificationContext({...p,kind:p.kind||'reminder'}):null;
   const hours=safe?await this.sendTimeContext(p):null;
   return {app,subject:{...subject},consent,arm,existingCampaign,deliveries:recentJobs,
    habit:habitStates.get(id)||null,stats:prev?.stats||{},recent:prev?.recent||[],observations:hours?.observations||[]};
  },
  /** Dev-only atomic-equivalent reservation; Neon uses its SQL stored procedure. */
  async enqueueSelected(p){
   const id=await this.enqueue(p);if(!id)return null;
   if(await this.noteDecision(p))return id;
   jobs.delete(id);deliveries.delete(id);return null;
  },
  async noteDecision(p){const id=sk(p)+'/'+p.campaignKey;if(!jobs.has(id))return false;if(decisions.has(id))return false;
   decisions.set(id,{id,subjectKey:sk(p),appKey:key(p),templateId:p.templateId,kind:p.kind||'reminder',locale:subjects.get(sk(p)).locale,at:new Date(now()).getTime(),status:'reserved'});return true;},
  async outcome(p){const id=sk(p)+'/'+p.campaignKey;const job=jobs.get(id);if(!decisions.has(id)||!['opened','value'].includes(p.type)||job?.status!=='provider_accepted'||!job.sentAt||new Date(job.sentAt).getTime()>new Date(now()).getTime()||new Date(job.sentAt).getTime()<=new Date(now()).getTime()-86400000)return false;
   if(p.type==='value'&&! [...events.values()].some(ev=>ev.subjectKey===sk(p)&&ev.isValue&&new Date(ev.occurredAt).getTime()>=new Date(job.sentAt).getTime()&&new Date(ev.occurredAt).getTime()<=new Date(now()).getTime()))return false;
   const keyOutcome=id+'/'+p.type;if(outcomes.has(keyOutcome))return false;outcomes.set(keyOutcome,{at:new Date(now()),type:p.type});return true;},
  async publishOffer(p){const app=apps.get(key(p)),id=key(p)+'/'+p.offerId;
   if(!app?.enabled||app.modules.offers!==true||!app.events.some(x=>x.name===p.conversionEvent&&x.value)||offers.has(id))return false;
   offers.set(id,{...p,id,redemptionCount:0});return true;},
  async listOffers(p){const app=apps.get(key(p));if(!app?.enabled||app.modules.offers!==true||!subjects.has(sk(p)))return [];
   if(p.personalized&&!(consents.get(sk(p)+'/in_app/marketing')?.granted===true&&consents.get(sk(p)+'/in_app/marketing')?.verified===true))return [];
   const time=new Date(now()).getTime();return [...offers.values()].filter(x=>key(x)===key(p)&&new Date(x.startsAt).getTime()<=time&&time<new Date(x.endsAt).getTime()&&x.redemptionCount<x.maxRedemptions&&![...redemptions.values()].some(r=>r.offerKey===x.id&&r.subjectKey===sk(p))).map(x=>({offerId:x.offerId,currency:x.currency,listPriceMinor:x.listPriceMinor,discountMinor:x.discountMinor,startsAt:x.startsAt,endsAt:x.endsAt}));},
  async redeemOffer(p){const app=apps.get(key(p)),offer=offers.get(key(p)+'/'+p.offerId),ev=events.get(key(p)+'/'+p.eventId);
   if(!app?.enabled||app.modules.offers!==true||!offer||!ev||!ev.isValue||ev.name!==offer.conversionEvent||ev.subjectKey!==sk(p))return null;
   const time=new Date(now()).getTime(),eventAt=new Date(ev.occurredAt).getTime();
   if(time<new Date(offer.startsAt).getTime()||time>=new Date(offer.endsAt).getTime()||eventAt<new Date(offer.startsAt).getTime()||eventAt>time||offer.redemptionCount>=offer.maxRedemptions)return null;
   if([...redemptions.values()].some(r=>r.offerKey===offer.id&&r.subjectKey===sk(p)||r.appKey===key(p)&&r.eventId===p.eventId))return null;
   const redemptionId=randomUUID();redemptions.set(redemptionId,{redemptionId,appKey:key(p),subjectKey:sk(p),offerKey:offer.id,eventId:p.eventId,discountMinor:offer.discountMinor,currency:offer.currency,status:'pending'});
   offer.redemptionCount++;return {redemptionId,discountMinor:offer.discountMinor,currency:offer.currency,status:'pending'};},
  async settleRedemption(p){const item=redemptions.get(p.redemptionId);
   if(!item||item.status!=='pending'||item.subjectKey!==sk(p)||item.appKey!==key(p)||p.appliedDiscountMinor>item.discountMinor||checkoutRefs.has(key(p)+'/'+p.checkoutRef))return false;
   item.status='settled';item.appliedDiscountMinor=p.appliedDiscountMinor;item.checkoutRef=p.checkoutRef;checkoutRefs.add(key(p)+'/'+p.checkoutRef);return true;},
  async getSavings(p){const totals=new Map();for(const item of redemptions.values())if(item.subjectKey===sk(p)&&item.status==='settled'){const v=totals.get(item.currency)||{currency:item.currency,totalMinor:0,count:0};v.totalMinor+=item.appliedDiscountMinor;if(!Number.isSafeInteger(v.totalMinor))throw new RangeError('Money total exceeds safe JS integer');v.count++;totals.set(item.currency,v);}return {totals:[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency))};},
  async recordFeedback(p){const app=apps.get(key(p)),ev=events.get(key(p)+'/'+p.eventId),id=key(p)+'/'+p.eventId;
   if(!app?.enabled||app.modules.feedback!==true||!ev?.isValue||ev.subjectKey!==sk(p)||feedback.has(id))return false;
   feedback.set(id,{subjectKey:sk(p),score:p.score,reason:p.reason});return true;},
  async claimReviewPrompt(p){const app=apps.get(key(p)),subject=subjects.get(sk(p));if(!app?.enabled||app.modules.feedback!==true||!subject||subject.valueCount<5||new Date(now()).getTime()-new Date(subject.createdAt).getTime()<7*86400000)return false;
   const id=sk(p),time=new Date(now()).getTime(),history=reviewClaims.get(id)||[];
   if(history.some(x=>time-x<90*86400000)||history.filter(x=>time-x<365*86400000).length>=2)return false;
   history.push(time);reviewClaims.set(id,history);return true;},
  async inviteFriend(p){const cfg=apps.get(key(p));if(!cfg?.enabled||cfg.modules.social!==true||!subjects.has(sk(p))||!subjects.has(key(p)+'/'+p.friend)||p.subject===p.friend)return false;
   const id=friendshipKey(p);if(friendships.has(id))return false;
   const max=cfg.modules.socialMaxFriends??5,daily=cfg.modules.socialDailyInvites??5;
   // Both endpoints are protected: a recipient should not be spammed either.
   for(const user of [p.subject,p.friend]){
    const count=[...friendships.values()].filter(r=>r.appKey===key(p)&&r.status!=='declined'&&(r.first===user||r.second===user)).length;
    if(count>=max)return false;
   }
   const at=new Date(now()).getTime(),window=at-86400000,attemptKey=sk(p);
   const history=(inviteAttempts.get(attemptKey)||[]).filter(t=>t>window);
   if(history.length>=daily)return false;
   friendships.set(id,{appKey:key(p),first:pair(p)[0],second:pair(p)[1],requester:p.subject,status:'pending'});
   inviteAttempts.set(attemptKey,[...history,at]);return true;},
  async respondFriend(p){const id=friendshipKey(p),req=friendships.get(id);
   if(!req||req.status!=='pending'||req.requester!==p.friend||![req.first,req.second].includes(p.subject))return false;
   req.status=p.accept?'accepted':'declined';if(p.accept)req.acceptedAt=new Date(now()).toISOString();return true;},
  async removeFriend(p){const id=friendshipKey(p),rel=friendships.get(id);if(!rel)return false;
   friendships.delete(id);
   for(const [qid,q] of quests)if(q.appKey===key(p)&&q.first===rel.first&&q.second===rel.second){quests.delete(qid);for(const v of questDays)if(v.startsWith(qid+'/'))questDays.delete(v);}
   return true;},
  async startFriendQuest(p){const id=friendshipKey(p),rel=friendships.get(id),cfg=apps.get(key(p));
   if(cfg?.modules.social!==true||rel?.status!=='accepted')return false;
   const qid=questId(p);if(quests.has(qid))return false;
   const createdAt=new Date(now()).getTime(),expiresAt=createdAt+p.durationDays*86400000;
   quests.set(qid,{appKey:key(p),first:rel.first,second:rel.second,questKey:p.questKey,targetDays:p.targetDays,createdAt,expiresAt,status:'active'});return true;},
  async friendQuestStatus(p){const qid=questId(p),q=quests.get(qid);
   if(!q)return null;
   const progress=[...questDays].filter(x=>x.startsWith(qid+'/')).length;
   return {targetDays:q.targetDays,daysCompleted:progress,completed:progress>=q.targetDays,expired:new Date(now()).getTime()>=q.expiresAt};},
  async sendTimeContext(p){
   const app=apps.get(key(p)),subject=subjects.get(sk(p)),id=sk(p);
   if(!app?.enabled||app.modules.notifications!==true||!subject||app.cadence==='none'||app.cadence==='episodic'||exposures.get(id+'/retention_push')!=='treatment'||consents.get(id+'/push/reminder')?.granted!==true||consents.get(id+'/push/reminder')?.verified!==true)return null;
   const observations=[];
   for(const [idJob,job] of jobs){if(job.subjectKey!==id||job.status!=='provider_accepted'||!job.sentAt||new Date(job.sentAt).getTime()>new Date(now()).getTime()-86400000||new Date(job.sentAt).getTime()<new Date(now()).getTime()-90*86400000)continue;
    observations.push({sentAt:new Date(job.sentAt).getTime(),hour:localParts(job.sentAt,subject.timezone).hour,converted:outcomes.has(idJob+'/value')});}
   observations.sort((x,y)=>y.sentAt-x.sentAt);
   return {observations:observations.slice(0,250).map(({hour,converted})=>({hour,converted})),quietStart:app.quietStart,quietEnd:app.quietEnd,defaultHour:subject.reminderHour??18};
  },
  async applyOptimizedHour(p){
   const app=apps.get(key(p)),subject=subjects.get(sk(p));
   if(!app?.enabled||app.modules.notifications!==true||!subject||!Number.isInteger(p.hour)||p.hour<app.quietStart||p.hour>=app.quietEnd)return false;
   if(subject.reminderHour!==undefined&&subject.reminderHour!==null&&subject.reminderHourSource!=='algorithm')return false;
   if(consents.get(sk(p)+'/push/reminder')?.granted!==true||consents.get(sk(p)+'/push/reminder')?.verified!==true)return false;
   subject.reminderHour=p.hour;subject.reminderHourSource='algorithm';return true;
  },
  async defineDailyMission(p){
   const app=apps.get(key(p));if(!app?.enabled||app.modules.missions!==true||(p.rewardXp>0&&app.modules.habits!==true)||!app.events.some(x=>x.name===p.event&&x.value))return false;
   const id=key(p)+'/'+p.missionKey;if(missions.has(id))return false;
   missions.set(id,{...p});return true;
  },
  async dailyMissions(p){
   const cfg=apps.get(key(p)),user=subjects.get(sk(p));if(!cfg?.enabled||cfg.modules.missions!==true||!user)return [];
   const day=localDay(now(),user.timezone);
   const subjectEvents=[...events.values()].filter(ev=>ev.subjectKey===sk(p)).map(ev=>({id:ev.eventId,name:ev.name,isValue:ev.isValue,occurredAt:ev.occurredAt,subject:p.subject}));
   return [...missions.values()].filter(m=>key(m)===key(p)).map(m=>{const status=calculateDailyMission({mission:m,events:subjectEvents,subject:p.subject,day,timezone:user.timezone});return {...status,claimed:missionClaims.has(sk(p)+'/'+m.missionKey+'/'+day)};});
  },
  async claimDailyMission(p){
   const cfg=apps.get(key(p));if(!cfg?.enabled||cfg.modules.missions!==true)return false;
   const status=(await this.dailyMissions(p)).find(x=>x.missionKey===p.missionKey);
   if(!status?.completed||status.claimed)return false;
   const k=sk(p)+'/'+p.missionKey+'/'+status.day;if(missionClaims.has(k))return false;missionClaims.add(k);
   const habit=habitStates.get(sk(p));if(cfg.modules.habits===true&&habit){habit.xp+=status.rewardXp;}
   return true;
  },
  async friendStreak(p){
   const cfg=apps.get(key(p)),friendship=friendships.get(friendshipKey(p));
   if(!cfg?.enabled||cfg.modules.friendStreaks!==true||friendship?.status!=='accepted'||!friendship.acceptedAt)return null;
   const asOf=new Date(now());const firstDays=new Set(),secondDays=new Set();
   const x=sk(p),y=key(p)+'/'+p.friend;
   for(const ev of events.values()){
    if(!ev.isValue||new Date(ev.occurredAt)<=new Date(friendship.acceptedAt)||new Date(ev.occurredAt)>asOf)continue;
    if(ev.subjectKey===x)firstDays.add(localDay(ev.occurredAt,'UTC'));
    if(ev.subjectKey===y)secondDays.add(localDay(ev.occurredAt,'UTC'));
   }
   return friendStreakFromDays({firstDays:[...firstDays],secondDays:[...secondDays],asOf,timezone:'UTC'});
  },
  async joinLeague(p){const app=apps.get(key(p));if(!app?.enabled||app.modules.leagues!==true||!subjects.has(sk(p))||leagueMembers.has(sk(p)))return false;leagueMembers.set(sk(p),new Date(now()).toISOString());return true;},
  async leaveLeague(p){return leagueMembers.delete(sk(p));},
  async weeklyLeaderboard(p){
   const cfg=apps.get(key(p));if(!cfg?.enabled||cfg.modules.leagues!==true||!leagueMembers.has(sk(p)))return [];
   const t=new Date(now()),dow=(t.getUTCDay()+6)%7;const monday=Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate()-dow);
   const rows=[];for(const [member,joinedAt] of leagueMembers){if(!member.startsWith(key(p)+'/'))continue;
    const days=new Map();for(const event of events.values())if(event.subjectKey===member&&event.isValue){const ms=new Date(event.occurredAt).getTime();if(ms<monday||ms<=new Date(joinedAt).getTime()||ms>t.getTime())continue;const day=new Date(ms).toISOString().slice(0,10);days.set(day,(days.get(day)||0)+1);}
    const score=[...days.values()].reduce((sum,count)=>sum+Math.min(10,count)*10,0);
    rows.push({member,score});}
   rows.sort((a,b)=>b.score-a.score||a.member.localeCompare(b.member));
   return rows.slice(0,p.limit).map((row,index)=>({rank:index+1,alias:`Player ${index+1}`,score:row.score,isSelf:row.member===sk(p)}));
  },
  async eraseSubject(p){for(const x of [abConsents,abAssignments,abConversions])for(const id of x.keys())if(id===sk(p)||id.startsWith(sk(p)+'/'))x.delete(id);
   const prefix=sk(p),existed=subjects.delete(prefix);habitStates.delete(prefix);reviewClaims.delete(prefix);leagueMembers.delete(prefix);inviteAttempts.delete(prefix);for(const claim of missionClaims)if(claim.startsWith(prefix+'/'))missionClaims.delete(claim);
   for(const [id,v] of feedback)if(v.subjectKey===prefix)feedback.delete(id);
   for(const [id,v] of redemptions)if(v.subjectKey===prefix){redemptions.delete(id);if(v.checkoutRef)checkoutRefs.delete(v.appKey+'/'+v.checkoutRef);/* preserve anonymous stock tally: SQL does not refund stock after erasure */}
   for(const map of [consents,exposures])for(const k of map.keys())if(k.startsWith(prefix+'/'))map.delete(k);
   for(const d of deliveries)if(d.startsWith(prefix+'/'))deliveries.delete(d);
   for(const [k,v] of jobs)if(v.subjectKey===prefix)jobs.delete(k);
   for(const [k,v] of decisions)if(v.subjectKey===prefix){decisions.delete(k);outcomes.delete(k+'/value');outcomes.delete(k+'/opened');}
   for(const [k,record] of events)if(record.subjectKey===prefix)events.delete(k);
   const scoped=key(p);
   for(const [id,rel] of friendships)if(rel.appKey===scoped&&[rel.first,rel.second].includes(p.subject))friendships.delete(id);
   for(const [id,q] of quests)if(q.appKey===scoped&&[q.first,q.second].includes(p.subject)){quests.delete(id);for(const v of questDays)if(v.startsWith(id+'/'))questDays.delete(v);}
   return existed;}
 };
}
