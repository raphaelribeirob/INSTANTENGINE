import test from 'node:test';
import assert from 'node:assert/strict';
import {makeManifest,verifyManifest} from '../scripts/verify-manifest.mjs';
test('SHA256 manifest exactly matches shipped INSTANTENGINE source tree and version',async()=>{
 const result=await verifyManifest();assert.equal(result.status,'pass');
 const v=await makeManifest();assert.equal(v.product,'INSTANTENGINE');assert.equal(v.version,'3.1.2');
 assert.equal(v.files.length,v.file_count_excluding_manifest);
 assert.ok(v.files.some(f=>f.path==='src/storage/churn-neon.mjs'));
 assert.ok(v.files.some(f=>f.path==='bin/run-churn-purge.mjs'));
 assert.ok(v.files.every(f=>/^[a-f0-9]{64}$/.test(f.sha256)));
});
