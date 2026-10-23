/** v3.1.1 regression tests: closed UTC days and truthful cursor pagination. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createChurnDailyJob} from '../src/churn-prediction.mjs';

const scope={tenant:'riverthree',app:'instantspeak',environment:'test'};
const features={daysSinceOpen:1,activeDays7:2,activeDaysPrev7:2,completed7:1,failed7:0,crashes7:0,opens7:2};
const row=subject=>({subject,features});
function fixture({clock='2026-10-22T12:00:00Z',batches=[[]],enabled=true}={}){
 const reads=[],writes=[];
 const job=createChurnDailyJob({now:()=>new Date(clock),enabled,repository:{
  async listChurnFeatures(args){reads.push(args);return batches[reads.length-1]??[];},
  async upsertChurnScore(args){writes.push(args);return true;}
 }});
 return {job,reads,writes};
}

test("default day is yesterday UTC; never includes today's incomplete events",async()=>{
 const {job,reads}=fixture();
 const result=await job.run(scope);
 assert.equal(result.asOf,'2026-10-21');
 assert.equal(reads[0].asOf,'2026-10-21');
 assert.equal(result.pages,1);
 assert.equal(result.processed,0);
 assert.equal(result.hasMore,false);
});

test('UTC rollover at midnight still scores only the last closed UTC day',async()=>{
 const {job,reads}=fixture({clock:'2026-10-22T00:00:00.001Z'});
 assert.equal((await job.run(scope)).asOf,'2026-10-21');
 assert.equal(reads[0].asOf,'2026-10-21');
});

test('explicit today and future dates are rejected before database access',async()=>{
 const {job,reads,writes}=fixture();
 await assert.rejects(job.run({...scope,asOf:'2026-10-22'}),/completed UTC day/);
 await assert.rejects(job.run({...scope,asOf:'2026-10-23'}),/completed UTC day/);
 await assert.rejects(job.run({...scope,asOf:'2026-02-30'}),/Invalid asOf UTC day/);
 assert.equal(reads.length,0);assert.equal(writes.length,0);
});

test('invalid clock cannot silently make a daily score',async()=>{
 const {job,reads}=fixture({clock:'not-a-date'});
 await assert.rejects(job.run(scope),/Invalid UTC job clock/);
 assert.equal(reads.length,0);
});

test('short first page reports exactly one page and no remaining work',async()=>{
 const {job,reads,writes}=fixture({batches:[[row('u1')]]});
 const r=await job.run({...scope,pageSize:2});
 assert.deepEqual({pages:r.pages,processed:r.processed,hasMore:r.hasMore},{pages:1,processed:1,hasMore:false});
 assert.equal(reads.length,1);assert.equal(writes.length,1);
 assert.equal(writes[0].asOf,'2026-10-21');
});

test('full page followed by empty terminal page counts both actual database reads',async()=>{
 const {job,reads}=fixture({batches:[[row('u1'),row('u2')],[]]});
 const r=await job.run({...scope,pageSize:2});
 assert.deepEqual({pages:r.pages,processed:r.processed,hasMore:r.hasMore},{pages:2,processed:2,hasMore:false});
 assert.equal(reads[1].afterSubject,'u2');
});

test('reaching maxPages never falsely reports an extra processed page',async()=>{
 const {job,reads,writes}=fixture({batches:[[row('u1'),row('u2')],[row('u3')]]});
 const r=await job.run({...scope,pageSize:2,maxPages:1});
 assert.deepEqual({pages:r.pages,processed:r.processed,hasMore:r.hasMore},{pages:1,processed:2,hasMore:true});
 assert.equal(reads.length,1);assert.equal(writes.length,2);
});

test('two full pages at cap return conservative hasMore and do not exceed limit',async()=>{
 const {job,reads}=fixture({batches:[[row('u1'),row('u2')],[row('u3'),row('u4')],[]]});
 const r=await job.run({...scope,pageSize:2,maxPages:2});
 assert.deepEqual({pages:r.pages,processed:r.processed,hasMore:r.hasMore},{pages:2,processed:4,hasMore:true});
 assert.equal(reads.length,2);
});

test('empty first page is one actual read and zero writes',async()=>{
 const {job,reads,writes}=fixture();
 const r=await job.run({...scope,pageSize:10});
 assert.deepEqual({pages:r.pages,processed:r.processed,hasMore:r.hasMore},{pages:1,processed:0,hasMore:false});
 assert.equal(reads.length,1);assert.equal(writes.length,0);
});

test('disabled and production guard remain safe with default date',async()=>{
 const off=fixture({enabled:false});
 assert.equal((await off.job.run(scope)).status,'disabled');
 assert.equal(off.reads.length,0);
 const prod=fixture();
 assert.equal((await prod.job.run({...scope,environment:'prod'})).status,'production_disabled');
 assert.equal(prod.reads.length,0);
});
