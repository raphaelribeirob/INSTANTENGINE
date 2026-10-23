import {createGrokbotObserver,makeSignedGrokbotObservation} from '../src/integrations/grokbot-observer.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const now=Date.parse('2026-10-21T12:00:00Z'),scope='example/study/test',secret='qa-signing-secret-not-for-production-0123456789';
const repository={
 async getObserverCatalog(){return {configured:true,enabled:true,analyticsEnabled:true,events:[{name:'lesson_completed',value:true}]};},
 async getObserverOverview(){return [{day:'2026-10-20',active:45,valueEvents:63}]},
 async getObserverRetention(){return [{day:1,eligible:45,retained:28},{day:7,eligible:29,retained:15},{day:30,eligible:9,retained:6}]},
 async getObserverExperiment(){return []}
};
const observer=createGrokbotObserver({repository,nonceStore:createMemoryRepository({now:()=>new Date(now)}),credentials:{[scope]:{secret,operations:['catalog','overview','retention','diagnose'],experiments:[]}},now:()=>now});
for(const operation of ['catalog','overview','retention','diagnose']){
 const req=makeSignedGrokbotObservation({baseUrl:'http://localhost',scope,secret,operation,params:{},timestamp:now});
 const response=await observer.handle(req);
 console.log(operation,response.status,JSON.stringify((await response.json()).result).slice(0,420));
}
