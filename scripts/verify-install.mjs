import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
execFileSync(process.execPath,[resolve(root,'scripts/build-bootstrap.mjs'),'--check'],{stdio:'inherit'});
const dir=resolve(root,'migrations');
const files=readdirSync(dir).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort();
if(files.length!==16||!files.every((f,i)=>f.startsWith(String(i).padStart(4,'0')+'_'))){throw Error('Expected 0000 + 0001..0015 migration chain, found '+files.join(', '));}
const all=files.map(f=>readFileSync(resolve(dir,f),'utf8'));
for(const [i,s] of all.entries()){
 if(!s.trim())throw Error('Empty migration '+files[i]);
 if(/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(s))throw Error('Destructive DDL in '+files[i]);
}
const checks=[['r3_v1_apps',0],['r3_v1_events',0],['r3_v1_ingest',0],['r3_v1_delete_subject',1],['r3_v1_enqueue_smart',2],['r3_v1_habits',3],['r3_v1_retention_report',4],['r3_v1_friendships',5],['r3_v1_claim_job_scoped',6],['r3_v1_offers',7],['r3_v1_repurchase_report',8],['r3_v1_daily_missions',9],['r3_v1_league_members',10],['r3_v1_social_invite_audit',11],['r3_v1_reconcile_habit',12],['river_v1_ab_assignments',13],['river_v1_ab_conversions',13],['river_v1_verified_value_outbox',14],['river_v1_outbox_on_value',14],['river_v1_engagement_events',15],['river_v1_churn_daily_scores',15]];
for(const [needle,i] of checks)if(!all[i].includes(needle))throw Error(`Migration ${files[i]} missing ${needle}`);
console.log(`PASS: ${files.length} migration files, expected order, contract markers and no DROP TABLE/SCHEMA/DATABASE`);
