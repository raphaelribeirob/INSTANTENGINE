/** Synthetic local adapter stress test; not a throughput/latency guarantee for Neon. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const repository=createMemoryRepository(),engine=createTMNT({repository});
for(const t of ['tenantone','tenanttwo'])await engine.registerApp({tenant:t,app:'generic',environment:'test',keyHash:'c'.repeat(64),cadence:'episodic',modules:{notifications:false},events:[{name:'task_completed',value:true}]});
const count=Number(process.env.TMNT_LOAD_EVENTS||5000);
if(!Number.isInteger(count)||count<1||count>100000)throw Error('Invalid test count');
const start=performance.now();
const rows=Array.from({length:count},(_,i)=>({tenant:i%2?'tenantone':'tenanttwo',app:'generic',environment:'test',subject:'user_'+(i%100),event:'task_completed',eventId:randomUUID()}));
const results=await Promise.all(rows.map(row=>engine.track(row)));
assert.equal(results.filter(Boolean).length,count);
const duplicate=await Promise.all(Array.from({length:20},()=>engine.track(rows[0])));
assert.equal(duplicate.filter(Boolean).length,0);
assert.equal(repository.debug.events.size,count);
const ms=Math.round(performance.now()-start);
console.log(JSON.stringify({test:'synthetic-memory-load',inserted:count,duplicateRejected:20,elapsedMs:ms,status:'PASS',note:'Not a Neon benchmark or a production capacity claim'}));
