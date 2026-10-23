/** Privacy-first, provider-independent, contextual notification planning.
 * Advisory policy; all sends still require the atomic, server-side enqueue and worker preflight.
 * Correlation of sends and value events is NOT causal lift.
 */
import {evaluateEligibility} from './policy.mjs';
import {chooseVariant} from './decisions.mjs';
import {learnedReminderHour} from './retention-next.mjs';

const INTENTS=new Set(['general','streak','restart','goal']);
const DENY=(reason)=>({action:'do_not_send',reason});
function clock(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new TypeError('Invalid decision clock');return d;}
function finiteInt(v,min,max,name){if(!Number.isInteger(v)||v<min||v>max)throw new TypeError('Invalid '+name);return v;}

/** Pure, deterministic pre-enqueue decision. Treat missing consent/arm as disqualifying. */
export function decideSmartNotification({context,variants,now=new Date(),seed,exploration=0.12,minimumFatigueSamples=4}={}){
 if(!context||typeof context!=='object'||!Array.isArray(variants)||!variants.length||typeof seed!=='string'||!seed)throw new TypeError('Smart notification context, variants and seed required');
 const d=clock(now);finiteInt(minimumFatigueSamples,3,20,'fatigue sample threshold');
 const elig=evaluateEligibility({...context,now:d});
 if(!elig.eligible)return DENY(elig.reason);
 // The decision engine never trusts openings alone as successful retention.
 const windowStart=d.getTime()-14*86400000;
 const matured=(context.deliveries||[]).filter(x=>x.status==='provider_accepted'&&x.sentAt&&Number.isFinite(new Date(x.sentAt).getTime())&&new Date(x.sentAt).getTime()<=d.getTime()-86400000&&new Date(x.sentAt).getTime()>=windowStart);
 const misses=matured.filter(x=>x.verifiedValue!==true).length;
 const converted=matured.length-misses;
 if(matured.length>=minimumFatigueSamples&&converted===0)return {...DENY('notification_fatigue_no_verified_value'),matured:matured.length};
 if(matured.length>=8&&converted/matured.length<0.125)return {...DENY('notification_fatigue_low_value'),matured:matured.length};
 const dayGap=elig.daysSinceValue;
 const goal=Number(context.habit?.dailyGoal||1);
 const streak=Number(context.habit?.streak||0);
 const intent=dayGap>=3?'restart':streak>=2&&dayGap===1?'streak':goal>=2?'goal':'general';
 for(const variant of variants)if(variant?.intent!==undefined&&!INTENTS.has(variant.intent))throw new TypeError('Unknown notification intent');
 const matching=variants.filter(v=>v?.intent===intent);
 const general=variants.filter(v=>v?.intent===undefined||v?.intent==='general');
 const chosen=matching.length?matching:general;
 if(!chosen.length)return DENY('no_contextually_approved_template');
 const selection=chooseVariant({variants:chosen,stats:context.stats||{},recent:context.recent||[],seed,exploration});
 return {action:'send',reason:'eligible_contextual',intent,templateId:selection.id,selectionReason:selection.reason,daysSinceValue:dayGap,exploration:selection.exploration,matured:matured.length};
}

/** Automated hour adjustment; never edits a user's explicitly selected reminder hour. */
export function recommendSafeSendHour({context,minSamples=6}={}){
 if(!context||typeof context!=='object'||!context.app||!context.subject)throw new TypeError('Missing hour context');
 finiteInt(minSamples,2,1000,'minimum observations');
 const explicit=context.subject.reminderHourSource==='user';
 if(explicit)return {apply:false,reason:'user_preference',hour:context.subject.reminderHour};
 const recommendations=learnedReminderHour({observations:context.observations||[],quietStart:context.app.quietStart,quietEnd:context.app.quietEnd,defaultHour:context.subject.reminderHour??18,minSamples});
 if(!recommendations.learned)return {apply:false,reason:recommendations.reason,hour:recommendations.hour};
 if(context.subject.reminderHour===recommendations.hour)return {apply:false,reason:'already_optimized',hour:recommendations.hour};
 return {apply:true,reason:'measured_verified_value',hour:recommendations.hour,samples:recommendations.samples};
}
