import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInstantEngine,createRiverEngine,createTMNT,createInstantEngagementAdapter,createRiverEngagementAdapter,createInstantChurnNeonRepository,createRiverChurnNeonRepository} from '../src/index.mjs';
import {createInstantEngineGateway,createRiverEngineGateway,createTMNTGateway,makeSignedInstantEngineRequest,makeSignedRiverEngineRequest,makeSignedTMNTRequest,ENDPOINT} from '../src/integrations/http-gateway.mjs';
import {createInstantEngagementAdapter as directAdapter} from '../src/churn-prediction.mjs';
import {createInstantChurnNeonRepository as directRepo} from '../src/storage/churn-neon.mjs';
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
test('INSTANTENGINE branded package and documented master',()=>{
 assert.equal(pkg.name,'@riverthree/instantengine');assert.equal(pkg.version,'3.1.0');
 assert.match(readFileSync(new URL('../INSTANTENGINE.MD',import.meta.url),'utf8'),/^# INSTANTENGINE/);
 assert.match(readFileSync(new URL('../RIVERENGINE.MD',import.meta.url),'utf8'),/^# RIVERENGINE/);
});
test('INSTANTENGINE SDK aliases preserve old functions and signed TMNT wire protocol',()=>{
 assert.equal(createInstantEngine,createTMNT);assert.equal(createRiverEngine,createTMNT);
 assert.equal(createInstantEngineGateway,createTMNTGateway);assert.equal(createRiverEngineGateway,createTMNTGateway);
 assert.equal(makeSignedInstantEngineRequest,makeSignedTMNTRequest);assert.equal(makeSignedRiverEngineRequest,makeSignedTMNTRequest);
 assert.equal(createInstantEngagementAdapter,createRiverEngagementAdapter);assert.equal(createInstantEngagementAdapter,directAdapter);
 assert.equal(createInstantChurnNeonRepository,createRiverChurnNeonRepository);assert.equal(createInstantChurnNeonRepository,directRepo);
 assert.equal(ENDPOINT,'/tmnt/v1/action');
});
