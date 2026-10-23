/** Static read-only Neon catalog readiness checks. Does not prove RLS policy correctness. */
const CRITICAL=['r3_v1_subjects','river_v1_analytics_consents',
 'river_v1_engagement_events','river_v1_churn_daily_scores'];
export function checkStagingSecurity(rows){
 if(!Array.isArray(rows))throw new TypeError('Catalog results required');
 const found=new Map(rows.map(x=>[x.table_name,x]));
 const findings=[];
 for(const table of CRITICAL){
  const entry=found.get(table);
  if(!entry){findings.push({table,reason:'table_missing'});continue;}
  if(entry.rls_enabled!==true)findings.push({table,reason:'rls_disabled'});
  if(entry.rls_forced!==true)findings.push({table,reason:'rls_owner_bypass_possible'});
  if(!Number.isInteger(Number(entry.policy_count))||Number(entry.policy_count)<1)
   findings.push({table,reason:'rls_policy_missing'});
 }
 return {status:findings.length?'blocked':'catalog_pass',checkedTables:CRITICAL.length,
  findings,warning:'Catalog proof only: also test real grants, tenant isolation, consent races and backup restore'};
}
