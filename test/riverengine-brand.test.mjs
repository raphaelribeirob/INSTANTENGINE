import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRiverEngine,createTMNT} from '../src/index.mjs';
import {createRiverEngineGateway,createTMNTGateway,makeSignedRiverEngineRequest,makeSignedTMNTRequest,ENDPOINT} from '../src/integrations/http-gateway.mjs';

test('official engine alias preserves implementation and legacy SDK',()=>{assert.equal(createRiverEngine,createTMNT);});
test('official signed gateway aliases preserve historical wire format',()=>{assert.equal(createRiverEngineGateway,createTMNTGateway);assert.equal(makeSignedRiverEngineRequest,makeSignedTMNTRequest);assert.equal(ENDPOINT,'/tmnt/v1/action');});
test('package name, version and README title are consistent',()=>{const p=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));assert.equal(p.name,'@riverthree/instantengine');assert.equal(p.version,'3.1.2');assert.match(readFileSync(new URL('../README.md',import.meta.url),'utf8'),/^# INSTANTENGINE/);});
