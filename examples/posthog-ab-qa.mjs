/** Fully offline PostHog A/B contract demonstration. Does not send data anywhere. */
import {randomUUID} from 'node:crypto';
import {createRiverEngine,createRiverABExperiments} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const s={tenant:'river',app:'study',environment:'test',subject:'opaque_a1'};
let time=new Date('2026-10-21T12:00:00Z');
const repository=createMemoryRepository({now:()=>time});
const engine=createRiverEngine({repository,now:()=>time});
const posthogClient={async evaluateFlags(){return {getFlag(){return 'test';}};},async capture(p){console.log('PostHog local capture:',p.event,p.properties.conversion_event);}};
const ab=createRiverABExperiments({repository,posthogClient,hashSecret:'x'.repeat(48),enabled:true});
await engine.registerApp({...s,keyHash:'f'.repeat(64),modules:{analytics:true,habits:true},events:[{name:'lesson_completed',value:true}]});
await engine.track({...s,eventId:randomUUID(),event:'lesson_completed',occurredAt:'2026-10-21T11:59:00Z'});
await ab.setAnalyticsConsent({...s,granted:true,verified:true});
console.log('Exposure:',await ab.expose({...s,flagKey:'goal-copy',variants:['control','test'],analyticsConsent:true}));
time=new Date('2026-10-21T12:12:00Z');const eventId=randomUUID();
await engine.track({...s,eventId,event:'lesson_completed',occurredAt:time});
console.log('Conversion:',await ab.conversion({...s,eventId,conversionEvent:'lesson_completed',flagKey:'goal-copy',variants:['control','test'],analyticsConsent:true}));
