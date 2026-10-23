/** Cohort retention math: exact D1/D7/D30 on fully matured cohorts only.
 * Participants must represent logged experiment exposures, not assignments alone.
 * This describes association / raw lift, not causal significance by itself. */
const Y=86400000;
const date=d=>{if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z')))throw new TypeError('Invalid day');return Date.parse(d+'T00:00:00Z');};
const key=r=>[r.tenant,r.app,r.environment,r.subject].join('\u001f');
const group=r=>[r.tenant,r.app,r.environment].join('/');
export function analyzeRetention({participants=[],valueDays=[],asOf,windows=[1,7,30]}={}){
 const cutoff=date(asOf),all=new Map(),events=new Set();
 if(!Array.isArray(windows)||windows.some(n=>![1,7,30].includes(n)))throw new TypeError('Unsupported window');
 for(const p of participants){if(!['treatment','holdout'].includes(p.arm))throw new TypeError('Invalid arm');date(p.cohortDay);const k=key(p);if(all.has(k))throw new TypeError('Duplicate exposure');all.set(k,p);}
 for(const v of valueDays){date(v.day);events.add(key(v)+'\u001f'+v.day);}
 const output=[];
 const scopes=[...new Set(participants.map(group))].sort();
 for(const scope of scopes)for(const n of windows){if(![1,7,30].includes(n))throw new TypeError('Unsupported window');const arms={treatment:{eligible:0,retained:0},holdout:{eligible:0,retained:0}};
  for(const p of participants){if(group(p)!==scope)continue;
   // End of Dn must pass fully; exclude censored/new cohorts.
   const cohort=date(p.cohortDay);if(cohort+(n+1)*Y>cutoff)continue;
   const target=new Date(cohort+n*Y).toISOString().slice(0,10);
   arms[p.arm].eligible++;if(events.has(key(p)+'\u001f'+target))arms[p.arm].retained++;
  }
  const t=arms.treatment,h=arms.holdout;
  const rateT=t.eligible?t.retained/t.eligible:null,rateH=h.eligible?h.retained/h.eligible:null;
  output.push({scope,day:n,arms,rateTreatment:rateT,rateHoldout:rateH,rawLift:rateT!==null&&rateH!==null?rateT-rateH:null,causalSignificance:'not_assessed'});
 }
 return output;
}

/** Repurchase by first *verified purchase* cohort; 30/60/90-day windows.
 * Requires distinct purchase DAYS; same-day purchases are not counted as repurchase.
 * Raw differences between exposed experiment arms are observational, not causal proof. */
export function analyzeRepurchase({participants=[],purchaseDays=[],asOf,windows=[30,60,90]}={}){
 const cutoff=date(asOf),uniquePurchases=new Map(),cohorts=new Map();
 if(!Array.isArray(windows)||windows.some(n=>![30,60,90].includes(n)))throw new TypeError('Unsupported repurchase window');
 for(const p of participants){if(!['treatment','holdout'].includes(p.arm))throw new TypeError('Invalid arm');date(p.cohortDay);const k=key(p);if(cohorts.has(k))throw new TypeError('Duplicate exposure');cohorts.set(k,p);}
 for(const value of purchaseDays){const k=key(value);date(value.day);if(!uniquePurchases.has(k))uniquePurchases.set(k,new Set());uniquePurchases.get(k).add(value.day);}
 const result=[];
 for(const segment of [...new Set(participants.map(group))].sort())for(const window of windows){
  const arms={treatment:{eligible:0,repurchased:0},holdout:{eligible:0,repurchased:0}};
  for(const p of participants){if(group(p)!==segment)continue;
   const days=uniquePurchases.get(key(p));if(!days?.has(p.cohortDay))continue; // first purchase must be verified
   const cohort=date(p.cohortDay);if(cohort+(window+1)*Y>cutoff)continue;
   const target=arms[p.arm];target.eligible++;
   if([...days].some(d=>date(d)>cohort&&date(d)<=cohort+window*Y))target.repurchased++;
  }
  const t=arms.treatment,h=arms.holdout;
  const rt=t.eligible?t.repurchased/t.eligible:null,rh=h.eligible?h.repurchased/h.eligible:null;
  result.push({scope:segment,windowDays:window,arms,rateTreatment:rt,rateHoldout:rh,rawLift:rt===null||rh===null?null:rt-rh,causalSignificance:'not_assessed'});
 }
 return result;
}
