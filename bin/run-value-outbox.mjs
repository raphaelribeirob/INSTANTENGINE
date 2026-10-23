/** Optional QA-first durable PostHog telemetry pump; never sends push. */
import {createRiverValueOutboxNeonRepository} from '../src/storage/value-outbox-neon.mjs';
import {createRiverValueOutboxPump} from '../src/integrations/value-outbox.mjs';
import {createRiverPostHogHTTPDelivery} from '../src/integrations/graphile-worker.mjs';
const env=process.env;
if(env.RIVER_VALUE_OUTBOX_ENABLED!=='true'){
 console.log('RIVERENGINE value telemetry worker DISABLED (safe default)');
 process.exit(0);
}
if(env.RIVER_VALUE_OUTBOX_ALLOW_PRODUCTION==='true'&&env.RIVER_VALUE_OUTBOX_PRODUCTION_APPROVED!=='true')throw new Error('Explicit production change approval required');
if(!env.DATABASE_URL||!env.RIVER_VALUE_OUTBOX_HASH_SECRET||!env.RIVER_POSTHOG_PROJECT_KEY)throw new Error('Missing backend-only worker configuration');
const repository=await createRiverValueOutboxNeonRepository(env.DATABASE_URL);
const deliver=createRiverPostHogHTTPDelivery({projectKey:env.RIVER_POSTHOG_PROJECT_KEY,hashSecret:env.RIVER_VALUE_OUTBOX_HASH_SECRET,host:env.RIVER_POSTHOG_HOST||'https://us.i.posthog.com'});
const pump=createRiverValueOutboxPump({repository,deliver,secret:env.RIVER_VALUE_OUTBOX_HASH_SECRET,enabled:true,allowProduction:env.RIVER_VALUE_OUTBOX_ALLOW_PRODUCTION==='true'});
let running=true;process.on('SIGTERM',()=>{running=false});process.on('SIGINT',()=>{running=false});
while(running){
 try{const result=await pump.drainOnce();if(result.status!=='empty')console.log('river_value_outbox',result.status);
  if(result.status==='empty')await new Promise(r=>setTimeout(r,2000));
 }catch{console.error('river_value_outbox worker cycle failed');await new Promise(r=>setTimeout(r,5000));}
}
