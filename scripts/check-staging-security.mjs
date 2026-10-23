/** Read-only preflight. Never applies migrations or changes RLS permissions. */
import {validateChurnScope} from '../src/churn-prediction.mjs';
import {checkStagingSecurity} from '../src/staging-readiness.mjs';
const {DATABASE_URL,INSTANT_PREFLIGHT_SCOPE,INSTANT_PREFLIGHT_SCHEMA}=process.env;
const schema=INSTANT_PREFLIGHT_SCHEMA;
try{
 const [tenant,app,environment]=(INSTANT_PREFLIGHT_SCOPE??'').split('/');
 validateChurnScope({tenant,app,environment});
 if(environment!=='staging')throw new Error('Only staging preflight permitted');
 if(typeof schema!=='string'||!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
  throw new Error('Explicit safe schema name required');
 if(!DATABASE_URL)throw new Error('Backend-only DATABASE_URL required');
 const {neon}=await import('@neondatabase/serverless');
 const sql=neon(DATABASE_URL);
 const rows=await sql`SELECT c.relname AS table_name,
   c.relrowsecurity AS rls_enabled,
   c.relforcerowsecurity AS rls_forced,
   COUNT(p.policyname)::int AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname
  WHERE n.nspname=${schema} AND c.relkind IN ('r','p')
    AND c.relname IN ('r3_v1_subjects','river_v1_analytics_consents',
      'river_v1_engagement_events','river_v1_churn_daily_scores')
  GROUP BY c.relname,c.relrowsecurity,c.relforcerowsecurity`;
 const result=checkStagingSecurity(rows);
 console.log(JSON.stringify({scope:INSTANT_PREFLIGHT_SCOPE,schema,...result}));
 if(result.status!=='catalog_pass')process.exitCode=1;
}catch(e){
 // Never echo SQL connection strings or secret contents.
 console.error(JSON.stringify({status:'blocked',reason:'staging_preflight_failed',
  hint:'Check scoped staging settings, Neon connectivity and catalog permissions',code:e.code??'invalid_config'}));
 process.exitCode=2;
}
