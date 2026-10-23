import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstantChurnNeonRepository} from '../src/storage/churn-neon.mjs';
const scope={tenant:'riverthree',app:'instantspeak',environment:'test',asOf:'2026-10-22',limit:10,afterSubject:''};
const data={subject:'test-user',lastSeen:'2026-10-21T23:59:59Z',activeDays7:1,activeDaysPrev7:0,completed7:0,failed7:0,crashes7:0,opens7:1};
test('late yesterday UTC counts as one inactive calendar day, not zero',async()=>{
 const repo=await createInstantChurnNeonRepository(null,{sql:async()=>[data]});
 const r=await repo.listChurnFeatures(scope);assert.equal(r[0].features.daysSinceOpen,1);
});
test('as-of day and older activity count calendar days correctly',async()=>{
 let last=data.lastSeen;const repo=await createInstantChurnNeonRepository(null,{sql:async()=>[{...data,lastSeen:last}]});
 for(const [seen,days] of [['2026-10-22T00:00:01Z',0],['2026-10-20T23:58:00Z',2],['2026-10-21T00:01:00-03:00',1]]){
  last=seen;const r=await repo.listChurnFeatures(scope);assert.equal(r[0].features.daysSinceOpen,days);
 }
});
