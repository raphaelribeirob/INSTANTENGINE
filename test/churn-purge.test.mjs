import test from 'node:test';
import assert from 'node:assert/strict';
import {purgeConfiguration,runIndependentPurge} from '../bin/run-churn-purge.mjs';
const scope='demo/study_app/test';
test('purge remains OFF by default, no database connection',async()=>{
 let calls=0;
 const r=await runIndependentPurge({env:{INSTANT_CHURN_SCOPE:scope},repositoryFactory:async()=>{calls++;throw Error('must not connect')}});
 assert.equal(r.status,'disabled');assert.equal(calls,0);
});
test('explicit consent-scoped maintenance cleanup can run independently of churn scorer',async()=>{
 let got;const r=await runIndependentPurge({env:{INSTANT_PURGE_ENABLED:'true',INSTANT_CHURN_SCOPE:scope},repositoryFactory:async()=>({purgeExpired:async s=>{got=s;return {deletedEvents:2,deletedScores:3};}})});
 assert.equal(r.status,'ok');assert.deepEqual(got,{tenant:'demo',app:'study_app',environment:'test'});assert.equal(r.deletedEvents,2);
});
test('never executes a production purge without explicit production acknowledgement',async()=>{
 let calls=0;const r=await runIndependentPurge({env:{INSTANT_PURGE_ENABLED:'true',INSTANT_CHURN_SCOPE:'demo/study_app/prod'},repositoryFactory:async()=>{calls++;throw Error('must not connect')}});
 assert.equal(r.status,'production_disabled');assert.equal(calls,0);
});
test('invalid or forged scope is rejected before repository connection',async()=>{
 let calls=0;await assert.rejects(runIndependentPurge({env:{INSTANT_PURGE_ENABLED:'true',INSTANT_CHURN_SCOPE:'x/'},repositoryFactory:async()=>{calls++;}}),/scope/i);assert.equal(calls,0);
});
