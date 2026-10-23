/** App-side verified business-event adapter. One per backend, never in a browser. */
const SCOPE=/^[a-z][a-z0-9_-]{1,49}$/;
const EVENT=/^[a-z][a-z0-9_.-]{1,79}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createRiverAppInstrumentation({engine,tenant,app,environment='test',events=[],verifyBusinessEvent,enabled=false,allowProduction=false}={}){
 if(!engine||typeof engine.track!=='function'||typeof verifyBusinessEvent!=='function')throw new TypeError('Trusted app backend and verification callback required');
 if(!SCOPE.test(tenant??'')||!SCOPE.test(app??'')||!['test','staging','prod'].includes(environment)||!Array.isArray(events)||!events.length||events.some(e=>!EVENT.test(e))||new Set(events).size!==events.length)throw new TypeError('Invalid registered value events');
 if(typeof enabled!=='boolean'||typeof allowProduction!=='boolean')throw new TypeError('Invalid flags');
 const allowed=new Set(events);
 return Object.freeze({
  async record({businessEventId,event}={}){
   if(!enabled)return {status:'disabled'};
   if(environment==='prod'&&!allowProduction)return {status:'production_disabled'};
   if(!UUID.test(businessEventId??'')||!allowed.has(event))return {status:'invalid_or_unregistered_event'};
   // Trust only the callback querying the actual application's authenticated event store.
   // A user/request cannot supply subject, locale, timestamp or verification boolean.
   const proof=await verifyBusinessEvent({tenant,app,environment,businessEventId,event});
   if(!proof||proof.verified!==true||proof.event!==event||typeof proof.subject!=='string')return {status:'not_verified'};
   const recorded=await engine.track({tenant,app,environment,subject:proof.subject,eventId:businessEventId,event,
     occurredAt:proof.occurredAt,locale:proof.locale||'en',timezone:proof.timezone||'UTC'});
   return {status:recorded?'recorded':'duplicate'};
  }
 });
}
