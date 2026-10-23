import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(resolve(root,'legacy/R3ENGINE_v1.1.mjs'),'utf8');
function literal(name){
 const m=source.match(new RegExp('const '+name+' = String\\.raw`([\\s\\S]*?)`;'));
 if(!m)throw Error('Embedded universal schema not found: '+name);
 return m[1].trim();
}
const v10=literal('UNIVERSAL_SCHEMA_SQL'),v11=literal('UNIVERSAL_V11_SQL');
for(const s of ['r3_v1_apps','r3_v1_subjects','r3_v1_events','r3_v1_outbox','r3_v1_register_app','r3_v1_ingest','r3_v1_claim_request','r3_v1_claim_job']){
 if(!(v10+'\n'+v11).includes(s))throw Error('Missing bootstrap object: '+s);
}
if(/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(v10+'\n'+v11))throw Error('Dangerous statement in bootstrap');
const file=resolve(root,'migrations/0000_universal_bootstrap.sql');
const body=['-- TMNT Engine v2.2: schema universal R3 v1.0+v1.1 (NO legacy r3_users tables).',
 '-- Generated from legacy/R3ENGINE_v1.1.mjs via npm run db:bootstrap:build.',
 '-- Run ONLY on an authorized, isolated PostgreSQL QA branch/database.',
 '-- Requires PostgreSQL 14+ and pgcrypto/gen_random_uuid support.','',v10,'',v11,''].join('\n');
if(process.argv.includes('--check')){
 if(readFileSync(file,'utf8')!==body)throw Error('Bootstrap stale: run npm run db:bootstrap:build');
 console.log('PASS: bootstrap matches legacy v1.0 + v1.1 SQL');
}else{writeFileSync(file,body);console.log('Generated: '+file);}
