/** Optional, provider-independent retention policies. Never implies causal lift. */
import {createHash} from 'node:crypto';
const localDay=(at,zone='UTC')=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const dayNumber=d=>Math.floor(Date.parse(d+'T00:00:00Z')/86400000);
export function learnedReminderHour({observations=[],quietStart=8,quietEnd=21,defaultHour=18,minSamples=6}={}){
 if(!Array.isArray(observations)||observations.length>10000||!Number.isInteger(quietStart)||!Number.isInteger(quietEnd)||quietStart<0||quietEnd>23||quietStart>=quietEnd||!Number.isInteger(defaultHour)||defaultHour<0||defaultHour>23||!Number.isInteger(minSamples)||minSamples<2)throw new TypeError('Invalid scheduling policy');
 // Observe actual provider-accepted notifications and verified value completions.
 // Smoothed per-hour posterior avoids overfitting one successful notification.
 const buckets=Array.from({length:24},()=>({count:0,success:0}));
 for(const o of observations){if(!Number.isInteger(o.hour)||o.hour<0||o.hour>23||typeof o.converted!=='boolean')throw new TypeError('Invalid observed notification');buckets[o.hour].count++;if(o.converted)buckets[o.hour].success++;}
 const valid=Array.from({length:quietEnd-quietStart},(_,i)=>i+quietStart);
 const total=valid.reduce((sum,h)=>sum+buckets[h].count,0);
 const candidates=valid.filter(h=>buckets[h].count>=minSamples);
 const fallback=valid.includes(defaultHour)?defaultHour:valid[Math.floor(valid.length/2)];
 if(candidates.length===0)return {hour:fallback,learned:false,samples:total,reason:'cold_start_or_insufficient_data'};
 const scores=candidates.map(h=>({hour:h,score:(buckets[h].success+2)/(buckets[h].count+4),n:buckets[h].count}));
 scores.sort((a,b)=>b.score-a.score||b.n-a.n||a.hour-b.hour);
 return {hour:scores[0].hour,learned:true,samples:total,reason:'smoothed_verified_value_rate'};
}
/** Daily quest status counts only registered value events, local calendar day, and unique event ids. */
export function calculateDailyMission({mission,events=[],subject,day,timezone='UTC'}={}){
 if(!mission||typeof mission.event!=='string'||!Number.isInteger(mission.target)||mission.target<1||mission.target>100||!Number.isInteger(mission.rewardXp)||mission.rewardXp<0||mission.rewardXp>500||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)||!subject)throw new TypeError('Invalid daily mission');
 const ids=new Set();for(const e of events){if(e.subject===subject&&e.name===mission.event&&e.isValue&&localDay(e.occurredAt,timezone)===day)ids.add(e.id);}
 return {missionKey:mission.missionKey,event:mission.event,day,target:mission.target,progress:Math.min(mission.target,ids.size),completed:ids.size>=mission.target,rewardXp:mission.rewardXp};
}
export function friendStreakFromDays({firstDays=[],secondDays=[],asOf,timezone='UTC'}={}){
 const today=localDay(asOf,timezone);const left=new Set(firstDays),right=new Set(secondDays);
 const common=[...left].filter(d=>right.has(d)&&/^\d{4}-\d\d-\d\d$/.test(d)&&d<=today).sort();
 let longest=0,currentRun=0,last=null;
 for(const day of common){currentRun=last!==null&&dayNumber(day)-dayNumber(last)===1?currentRun+1:1;longest=Math.max(longest,currentRun);last=day;}
 const age=last===null?Infinity:dayNumber(today)-dayNumber(last);
 return {streak:age<=1?currentRun:0,longestStreak:longest,lastSharedDay:last,timezone};
}
const phi=x=>{const t=1/(1+0.2316419*Math.abs(x));const d=0.3989422804014327*Math.exp(-x*x/2);const p=1-d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?p:1-p;};
/** Exploratory two-proportion analysis; SRM and sample thresholds guard against false victory claims. */
export function assessExperiment(row,{holdoutPercent=10,minPerArm=100,alpha=0.05}={}){
 const a=row?.arms?.treatment,b=row?.arms?.holdout;
 if(!a||!b||![a.eligible,a.retained,b.eligible,b.retained].every(x=>Number.isInteger(x)&&x>=0)||a.retained>a.eligible||b.retained>b.eligible||!Number.isFinite(holdoutPercent)||holdoutPercent<=0||holdoutPercent>=100||!Number.isInteger(minPerArm)||minPerArm<2||alpha!==0.05)throw new TypeError('Invalid experiment');
 const n=a.eligible+b.eligible,expected=n*holdoutPercent/100;
 const srm=n<1?null:(b.eligible-expected)/Math.sqrt(Math.max(1e-12,n*holdoutPercent/100*(1-holdoutPercent/100)));
 const sampleRatioMismatch=srm!==null&&Math.abs(srm)>3.29;
 if(n===0||a.eligible<minPerArm||b.eligible<minPerArm)return {status:'insufficient_sample',sampleRatioMismatch,rawLift:null,pValue:null,confidenceInterval:null,causalClaim:false};
 const rateT=a.retained/a.eligible,rateH=b.retained/b.eligible,diff=rateT-rateH;
 // Newcombe hybrid-score interval (Wilson intervals on both arms) remains
 // non-degenerate for 0/n and n/n, unlike a Wald interval.
 const z=1.959963984540054;
 const wilson=(p,denom)=>{const z2=z*z,base=1+z2/denom;
  const center=(p+z2/(2*denom))/base;
  const half=z*Math.sqrt(p*(1-p)/denom+z2/(4*denom*denom))/base;
  return [Math.max(0,center-half),Math.min(1,center+half)];};
 const [lt,ut]=wilson(rateT,a.eligible),[lh,uh]=wilson(rateH,b.eligible);
 const lower=diff-Math.hypot(rateT-lt,uh-rateH);
 const upper=diff+Math.hypot(ut-rateT,rateH-lh);
 const pooled=(a.retained+b.retained)/n;const pooledSe=Math.sqrt(pooled*(1-pooled)*(1/a.eligible+1/b.eligible));
 const score=pooledSe===0?0:Math.abs(diff/pooledSe);
 // Direct normal tail computation avoids 1 - Phi(z) rounding to zero.
 const t=1/(1+0.2316419*score),density=0.3989422804014327*Math.exp(-score*score/2);
 const tail=density*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
 const pValue=score===0?1:Math.max(Number.MIN_VALUE,Math.min(1,2*tail));
 return {status:sampleRatioMismatch?'sample_ratio_mismatch':pValue<alpha?'statistical_signal':'no_statistical_signal',rawLift:diff,pValue,confidenceInterval:[Math.max(-1,lower),Math.min(1,upper)],intervalMethod:'newcombe_wilson_95',sampleRatioMismatch,causalClaim:false,warning:'Exploratory unadjusted p-value. Requires verified randomization, multiple-test plan, guardrails and preregistration.'};
}
export {localDay};
