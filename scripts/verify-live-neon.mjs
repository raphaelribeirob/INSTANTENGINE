/** Safe read-only DB preflight. Requires backend-only DATABASE_URL, never logs credentials. */
import {createNeonRepository} from '../src/storage/neon.mjs';
const url=process.env.DATABASE_URL;
if(!url){console.error('SKIP: DATABASE_URL unavailable. Run from an authenticated backend environment.');process.exitCode=2;}
else{
 try{
  const {neon}=await import('@neondatabase/serverless');
  if(typeof neon!=='function')throw Error('Invalid Neon driver');
  const sql=neon(url);
  const requirements=[
   'r3_v1_apps','r3_v1_subjects','r3_v1_events','r3_v1_outbox','r3_v1_habits',
   'r3_v1_daily_missions','r3_v1_friendships','r3_v1_offers',
  ];
  const funcs=[
   'r3_v1_register_app','r3_v1_ingest','r3_v1_set_consent','r3_v1_claim_request',
   'r3_v1_enqueue','r3_v1_claim_job_scoped','r3_v1_reconcile_habit',
   'r3_v1_define_daily_mission','r3_v1_invite_friend',
  ];
  const tables=await sql`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p')`;
  const methods=await sql`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`;
  const present=new Set(tables.map(x=>x.name)),available=new Set(methods.map(x=>x.name));
  const missing=[...requirements.filter(x=>!present.has(x)),...funcs.filter(x=>!available.has(x))];
  if(missing.length){console.error('FAIL: missing tables/functions: '+missing.join(', '));process.exitCode=1;}
  else {const repo=await createNeonRepository(url);if(repo.nonceDurability!=='persistent')throw Error('Unsafe repository');console.log('PASS: live Neon driver, connection and 17 expected SQL names; no writes performed');}
 }catch(e){console.error('FAIL: live Neon preflight: '+(e.code??e.name??'Error')+' '+String(e.message??'').replaceAll(url,'[REDACTED]'));process.exitCode=1;}
}
