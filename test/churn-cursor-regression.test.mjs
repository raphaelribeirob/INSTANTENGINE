import test from 'node:test';
import assert from 'node:assert/strict';
import {createChurnDailyJob} from '../src/churn-prediction.mjs';
const scope={tenant:'demo',app:'language_app',environment:'test',asOf:'2026-10-20'};
const features={daysSinceOpen:2,activeDays7:1,activeDaysPrev7:2,completed7:0,failed7:0,crashes7:0,opens7:1};
const row=subject=>({subject,features});
function job(repo){return createChurnDailyJob({enabled:true,now:()=>new Date('2026-10-22T12:00:00Z'),repository:repo});}
test('full page returns resumable cursor and next run starts after it',async()=>{
 const reads=[],saved=[];
 const j=job({
  async listChurnFeatures(p){reads.push(p.afterSubject);return p.afterSubject===''?[row('u1'),row('u2')]:p.afterSubject==='u2'?[row('u3')]:[];},
  async upsertChurnScore(p){saved.push(p.subject);return true;}
 });
 const a=await j.run({...scope,pageSize:2,maxPages:1});
 assert.equal(a.hasMore,true);assert.equal(a.nextCursor,'u2');assert.equal(a.processed,2);
 const b=await j.run({...scope,pageSize:2,afterSubject:a.nextCursor});
 assert.equal(b.hasMore,false);assert.equal(b.nextCursor,null);
 assert.deepEqual(reads,['','u2']);assert.deepEqual(saved,['u1','u2','u3']);
});
test('revoked consent during scoring counts skipped not persisted',async()=>{
 const j=job({listChurnFeatures:async()=>[row('u1')],upsertChurnScore:async()=>false});
 const r=await j.run({...scope,pageSize:2});
 assert.equal(r.processed,0);assert.equal(r.skipped,1);
});
test('invalid cursor fails before reading or writing',async()=>{
 let calls=0;
 const j=job({listChurnFeatures:async()=>{calls++;return [];},upsertChurnScore:async()=>{calls++;return true;}});
 await assert.rejects(j.run({...scope,afterSubject:'../injection'}),/cursor/);
 assert.equal(calls,0);
});
test('unknown write result fails closed instead of overstating scoring',async()=>{
 const j=job({listChurnFeatures:async()=>[row('u1')],upsertChurnScore:async()=>undefined});
 await assert.rejects(j.run({...scope,pageSize:2}),/boolean/);
});
