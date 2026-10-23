// Local demo only — no external service and no real notifications.
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const db=createMemoryRepository();
const engine=createTMNT({repository:db});
const apps=[
  {app:'dotsvest',event:'lesson_completed',cadence:'daily'},
  {app:'instantspeak',event:'conversation_completed',cadence:'daily'},
  {app:'instantcloser',event:'deal_closed',cadence:'weekly'},
  {app:'bible',event:'reading_completed',cadence:'daily'},
  {app:'marketplace',event:'purchase_completed',cadence:'episodic'}
];
const results=[];
for(const item of apps){
  const scope={tenant:'instant',app:item.app,environment:'test'};
  await engine.registerApp({...scope,keyHash:'c'.repeat(64),cadence:item.cadence,modules:{notifications:item.cadence!=='episodic'},events:[{name:item.event,value:true}]});
  await engine.track({...scope,subject:'demo_user',eventId:randomUUID(),event:item.event,locale:'pt-BR',timezone:'America/Sao_Paulo'});
  await engine.setConsent({...scope,subject:'demo_user',channel:'push',purpose:'reminder',granted:true,verified:true,platform:'android'});
  const cohort=await engine.expose({...scope,subject:'demo_user',holdoutPercent:0});
  const campaign=await engine.schedule({...scope,subject:'demo_user',campaignKey:'demo_01',templateId:'gentle_reminder'});
  results.push({app:item.app,valueEvent:item.event,cohort,campaignScheduled:Boolean(campaign)});
}
console.log(JSON.stringify({status:'dry_run',apps:results,realNotificationsSent:0},null,2));
