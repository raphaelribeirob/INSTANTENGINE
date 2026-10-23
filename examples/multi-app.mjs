/** Demonstrates independent app configurations. Local memory only; no real push. */
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const engine=createTMNT({repository:createMemoryRepository()});
const tenant='instant';
const apps=[
 {app:'dotsvest',cadence:'daily',modules:{notifications:true,habits:true,social:true},event:'micro_lesson_completed'},
 {app:'instantcloser',cadence:'weekly',modules:{notifications:true,habits:false,social:false},event:'followup_completed'},
 {app:'marketplace',cadence:'episodic',modules:{notifications:false,habits:false,social:false},event:'order_completed'}
];
for(const p of apps){
 const scope={tenant,app:p.app,environment:'test'};
 await engine.registerApp({...scope,keyHash:'a'.repeat(64),cadence:p.cadence,modules:p.modules,events:[{name:p.event,value:true},{name:'app_opened',value:false}]});
 const accepted=await engine.track({...scope,subject:'opaque-test-user',event:p.event,eventId:randomUUID(),timezone:'America/Sao_Paulo',locale:'pt-BR'});
 if(!accepted)throw Error('Integration test failure');
 console.log(JSON.stringify({app:p.app,registered:true,valueEvent:true,habits:!!p.modules.habits,social:!!p.modules.social}));
}
