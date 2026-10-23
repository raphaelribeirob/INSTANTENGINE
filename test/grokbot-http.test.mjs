import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createGrokbotObserver} from '../src/integrations/grokbot-observer.mjs';
import {callRiverObserver} from '../agents/grokbot/observer-client.mjs';
const secret='z'.repeat(48),scope='sample/learn/test';
test('Grokbot CLI read-only client signs request against actual local HTTP server',async()=>{
 const nonceSeen=new Set();const observer=createGrokbotObserver({
   nonceStore:{nonceDurability:'persistent',async claimRequest({requestId}){if(nonceSeen.has(requestId))return false;nonceSeen.add(requestId);return true;}},
   repository:{async getObserverCatalog(){return {configured:true,enabled:true,analyticsEnabled:true,events:[{name:'lesson_completed',value:true}]}},async getObserverOverview(){return [{day:new Date().toISOString().slice(0,10),active:25,valueEvents:31}]},async getObserverRetention(){return [{day:1,eligible:30,retained:21}]},async getObserverExperiment(){return []}},
   credentials:{[scope]:{secret,operations:['catalog','overview','retention'],experiments:[]}}
 });
 const server=createServer(async(req,res)=>{
  const r=new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers,body:req.method==='POST'?req:undefined,duplex:req.method==='POST'?'half':undefined});
  const resp=await observer.handle(r);res.writeHead(resp.status,Object.fromEntries(resp.headers));res.end(Buffer.from(await resp.arrayBuffer()));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address();const result=await callRiverObserver({operation:'overview',params:{days:7},environment:{RIVER_OBSERVER_SCOPE:scope,RIVER_OBSERVER_SIGNING_SECRET:secret,RIVER_OBSERVER_BASE_URL:`http://127.0.0.1:${address.port}`}});assert.equal(result.daily[0].activeUsers,25);assert.equal(result.daily[0].valueEvents,31);}
 finally{await new Promise(resolve=>server.close(resolve));}
});
