// Local example ONLY. No OneSignal, Neon, production analytics, or external I/O.
import {randomUUID} from 'node:crypto';
import {createRiverEngine} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const now=()=>new Date('2026-10-21T18:00:00.000Z');
const repository=createMemoryRepository({now});
const river=createRiverEngine({repository,now});
const scope={tenant:'river',app:'study',environment:'test',subject:'opaque_learner'};
await river.registerApp({...scope,keyHash:'a'.repeat(64),cadence:'daily',quietStart:8,quietEnd:22,weeklyLimit:3,holdoutPercent:10,modules:{notifications:true,habits:true},events:[{name:'study_session_completed',value:true},{name:'app_opened',value:false}]});
for(const day of [19,20])await river.track({...scope,eventId:randomUUID(),event:'study_session_completed',occurredAt:`2026-10-${day}T16:00:00Z`,locale:'pt-BR',timezone:'America/Sao_Paulo'});
await river.setConsent({...scope,channel:'push',purpose:'reminder',granted:true,verified:true,platform:'android'});
await river.expose({...scope,holdoutPercent:0});
const decision=await river.planSmartReminder({...scope,campaignKey:'qa_reminder_20261021',variants:[{id:'gentle_streak',intent:'streak'},{id:'restart_small',intent:'restart'},{id:'generic_safe',intent:'general'}],exploration:0});
console.log(JSON.stringify({decision,providerCallMade:false,productionPushEnabled:false}));
