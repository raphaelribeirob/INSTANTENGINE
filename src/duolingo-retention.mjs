/** Privacy-conscious, Duolingo-inspired retention experiment reporting.
 * Only feed authenticated, backend-verified value events, not app opens or pageviews.
 * D1/D7/D30 = activity on EXACT UTC date after the UTC exposure date, not cumulative.
 * The whole target date must have elapsed; immature participants are right-censored.
 * Reports are exploratory and never constitute proof of causality or product parity.
 */
import {assessExperiment} from './retention-next.mjs';
const DAY_MS=86_400_000;
const AS_OF=/^\d{4}-\d{2}-\d{2}$/;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
function dayNumber(s){if(typeof s!=='string'||!AS_OF.test(s))throw new TypeError('Invalid UTC day');const t=Date.parse(s+'T00:00:00.000Z');if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==s)throw new TypeError('Invalid calendar day');return t/DAY_MS;}
function utcDay(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new TypeError('Invalid exposure time');return d.toISOString().slice(0,10);}
function identity(row){for(const x of ['tenant','app','environment','subject'])if(typeof row?.[x]!=='string'||!ID.test(row[x]))throw new TypeError('Invalid experiment participant scope');return [row.tenant,row.app,row.environment,row.subject].join('\x1f');}
export function reportDuolingoRetention({participants=[],valueDays=[],asOf,flagKey,windows=[1,7,30],minPerArm=100,expectedControlShare=0.5}={}){
 if(!Array.isArray(participants)||!Array.isArray(valueDays)||!Array.isArray(windows)||windows.length===0||windows.some(x=>![1,7,30].includes(x))||new Set(windows).size!==windows.length)throw new TypeError('Unsupported retention windows');
 if(typeof flagKey!=='string'||!/^[a-z][a-z0-9_-]{1,79}$/.test(flagKey))throw new TypeError('Invalid experiment key');
 if(!Number.isInteger(minPerArm)||minPerArm<2||!(expectedControlShare>0&&expectedControlShare<1))throw new TypeError('Invalid reporting policy');
 const cutoff=dayNumber(asOf),seen=new Set(),subjects=new Map(),exposures={control:0,test:0};
 for(const p of participants){const id=identity(p);if(p.flagKey!==flagKey||!['control','test'].includes(p.variant))throw new TypeError('Invalid experiment membership');
  const cohortDay=utcDay(p.exposedAt),cohort=dayNumber(cohortDay);if(cohort>cutoff)throw new TypeError('Future exposure');
  if(seen.has(id))throw new TypeError('Duplicate or mixed-variant exposure');seen.add(id);subjects.set(id,{cohort,variant:p.variant});exposures[p.variant]++;
 }
 const completed=new Set();
 for(const e of valueDays){const id=identity(e);if(!subjects.has(id))continue;
  if(e.verified!==true)throw new TypeError('Retention requires backend-verified value events');
  const d=dayNumber(e.day);if(d>cutoff)throw new TypeError('Future activity');completed.add(id+'\x1f'+d);
 }
 const total=exposures.control+exposures.test,expected=total*expectedControlShare;
 const z=total>0?(exposures.control-expected)/Math.sqrt(total*expectedControlShare*(1-expectedControlShare)):null;
 const sampleRatioMismatch=z!==null&&total>=50&&Math.abs(z)>3.29;
 const results=windows.map(n=>{
  const arms={control:{eligible:0,retained:0},test:{eligible:0,retained:0}};
  for(const [id,p] of subjects){if(p.cohort+n+1>cutoff)continue;const a=arms[p.variant];a.eligible++;if(completed.has(id+'\x1f'+(p.cohort+n)))a.retained++;}
  const base=arms.control,variant=arms.test;
  const assessment=assessExperiment({arms:{holdout:base,treatment:variant}},{holdoutPercent:expectedControlShare*100,minPerArm});
  return {day:n,arms,rateControl:base.eligible?base.retained/base.eligible:null,rateTest:variant.eligible?variant.retained/variant.eligible:null,
   assessment:{...assessment,sampleRatioMismatch:assessment.sampleRatioMismatch||sampleRatioMismatch},
   maturedParticipants:base.eligible+variant.eligible};
 });
 return {experimentKey:flagKey,dayDefinition:'UTC exact-day return after first verified exposure',asOf,exposures,expectedControlShare,sampleRatioMismatch,
  windows:results,readyForRollout:false,causalLiftProven:false,
  caveats:['Exploratory report only; no automatic ship decision','Check instrumentation, consent, SRM, power, guardrails and pre-registered primary metric',
   'UTC day cohorts may differ from per-user local-day habit streaks','Excludes subjects whose target day has not fully elapsed']};
}
