/** Offline MABWiser advisory policy — never bypasses RIVERENGINE notification safety checks. */
import {createHmac,timingSafeEqual} from 'node:crypto';
const SCOPE=/^[a-z][a-z0-9_-]{1,49}$/;
const SEGMENT=/^(new|returning|streak)_(morning|afternoon|evening)$/;
const ARM=/^[a-z][a-z0-9_.-]{1,79}$/;
const ENVS=new Set(['test','staging','prod']);
function canonical(policy){return JSON.stringify(policy);}
function verifyPayload(p){
 if(!p||p.schema!==1||p.model!=='mabwiser'||!SCOPE.test(p.tenant)||!SCOPE.test(p.app)||!ENVS.has(p.environment)||!Array.isArray(p.arms)||p.arms.length<2||new Set(p.arms).size!==p.arms.length||p.arms.some(a=>a!=='no_send'&&!ARM.test(a)))throw new TypeError('Invalid bandit policy');
 if(!p.decisions||Object.entries(p.decisions).some(([key,arm])=>!SEGMENT.test(key)||!p.arms.includes(arm)))throw new TypeError('Invalid bandit decisions');
 if(!Number.isInteger(p.sampleCount)||p.sampleCount<100||!Number.isFinite(Date.parse(p.expiresAt))||!Number.isFinite(Date.parse(p.createdAt)))throw new TypeError('Invalid bandit evidence/expiration');
 return p;
}
export function signRiverBanditPolicy(policy,secret){
 if(typeof secret!=='string'||secret.length<32)throw new TypeError('Strong signing secret required');
 verifyPayload(policy);
 return createHmac('sha256',secret).update(canonical(policy)).digest('hex');
}
export function applyRiverBanditPolicy({baseline,policy,signature,secret,scope,segment,approvedTemplates=[],now=new Date(),enabled=false,allowProduction=false}={}){
 // Base policy decides eligibility, fatigue, consent, and user-defined time first.
 if(baseline?.action!=='send'||!enabled)return baseline;
 if(!scope||scope.environment==='prod'&&!allowProduction)return baseline;
 let expected;
 try{verifyPayload(policy);expected=signRiverBanditPolicy(policy,secret);}catch{return baseline;}
 if(typeof signature!=='string'||!/^[0-9a-f]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))return baseline;
 if(policy.tenant!==scope.tenant||policy.app!==scope.app||policy.environment!==scope.environment)return baseline;
 if(Date.parse(policy.createdAt)>new Date(now).getTime()||Date.parse(policy.expiresAt)<=new Date(now).getTime())return baseline;
 if(!SEGMENT.test(segment||''))return baseline;
 const arm=policy.decisions[segment];
 if(arm==='no_send')return {...baseline,action:'do_not_send',reason:'bandit_recommends_rest',templateId:undefined};
 if(!arm||!approvedTemplates.includes(arm))return baseline;
 return {...baseline,templateId:arm,selectionReason:'signed_offline_mabwiser_policy'};
}
/** Coarse non-sensitive context computed only from trusted backend habit/clock state. */
export function riverBanditSegment({daysSinceValue,streak=0,localHour}={}){
 if(!Number.isInteger(daysSinceValue)||daysSinceValue<0||!Number.isFinite(streak)||!Number.isInteger(localHour)||localHour<0||localHour>23)return null;
 const group=streak>=2?'streak':daysSinceValue>=2?'returning':'new';
 const time=localHour<12?'morning':localHour<17?'afternoon':'evening';
 return `${group}_${time}`;
}
