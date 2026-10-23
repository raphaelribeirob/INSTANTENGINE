import test from 'node:test';
import assert from 'node:assert/strict';
import {checkStagingSecurity} from '../src/staging-readiness.mjs';
const names=['r3_v1_subjects','river_v1_analytics_consents','river_v1_engagement_events','river_v1_churn_daily_scores'];
const good=names.map(table_name=>({table_name,rls_enabled:true,rls_forced:true,policy_count:2}));
test('complete protected catalog passes with explicit non-certification warning',()=>{
 const r=checkStagingSecurity(good);
 assert.equal(r.status,'catalog_pass');assert.equal(r.findings.length,0);
 assert.match(r.warning,/isolation/);
});
test('missing tenant table blocks readiness',()=>{
 assert.equal(checkStagingSecurity(good.slice(1)).findings[0].reason,'table_missing');
});
test('disabled RLS blocks readiness',()=>{
 const rows=good.map((r,i)=>i===2?{...r,rls_enabled:false}:r);
 assert.equal(checkStagingSecurity(rows).status,'blocked');
 assert.ok(checkStagingSecurity(rows).findings.some(x=>x.reason==='rls_disabled'));
});
test('RLS owner bypass without FORCE blocks readiness',()=>{
 const rows=good.map((r,i)=>i===0?{...r,rls_forced:false}:r);
 assert.ok(checkStagingSecurity(rows).findings.some(x=>x.reason==='rls_owner_bypass_possible'));
});
test('no policy or bad input fails closed',()=>{
 assert.ok(checkStagingSecurity(good.map(x=>({...x,policy_count:0}))).findings.length===4);
 assert.throws(()=>checkStagingSecurity({}),/Catalog/);
});
