import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const dir=resolve(import.meta.dirname,'../migrations');
test('universal v1.0 + v1.1 bootstrap is independently shipped and reproducible',()=>{
 const s=readFileSync(resolve(dir,'0000_universal_bootstrap.sql'),'utf8');
 assert.match(s,/CREATE TABLE IF NOT EXISTS r3_v1_apps/);
 assert.match(s,/CREATE TABLE IF NOT EXISTS r3_v1_outbox/);
 assert.match(s,/FUNCTION r3_v1_register_app/);
 assert.match(s,/FUNCTION r3_v1_claim_request/);
 assert.doesNotMatch(s,/CREATE TABLE IF NOT EXISTS r3_users\b/);
 const cmd=execFileSync(process.execPath,[resolve(import.meta.dirname,'../scripts/build-bootstrap.mjs'),'--check'],{encoding:'utf8'});
 assert.match(cmd,/PASS/);
});
test('0000–0015: complete migration chain with no database-dropping statement',()=>{
 const fs=readdirSync(dir).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort();
 assert.equal(fs.length,16);
 for(const [i,f] of fs.entries()){
  assert.ok(f.startsWith(String(i).padStart(4,'0')+'_'));
  const s=readFileSync(resolve(dir,f),'utf8');
  assert.ok(s.length>40);
  assert.doesNotMatch(s,/\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i);
 }
});
test('read-only live preflight exists and does not require credentials for local test',()=>{
 const s=readFileSync(resolve(import.meta.dirname,'../scripts/verify-live-neon.mjs'),'utf8');
 assert.match(s,/SKIP: DATABASE_URL unavailable/);
 assert.match(s,/await import\('@neondatabase\/serverless'\)/);
 assert.doesNotMatch(s,/\bDELETE FROM\b|\bTRUNCATE\b|\bDROP TABLE\b/);
});
