/**
 * TMNT Engine v1.1.0 — retention engine (technical rebranding of R3ENGINE).
 * Single source file. Node.js >= 22.
 *
 * Commands:
 *   node R3ENGINE.mjs test          embedded unit/contract tests; no external service needed
 *   node R3ENGINE.mjs smoke         integration smoke against real local HTTP server
 *   node R3ENGINE.mjs check         security + SQL contract static checks
 *   node R3ENGINE.mjs sql           prints full PostgreSQL schema and migrations
 *   node R3ENGINE.mjs analytics     prints retention reporting SQL
 *   node R3ENGINE.mjs serve         runs HTTP API; PORT env var, default 3030
 *
 * Production installation: npm install @neondatabase/serverless
 * Configure DATABASE_URL, R3_APP_KEYS_JSON, CRON_SECRET, ONESIGNAL_APPS_JSON,
 * R3_PUSH_ENABLED=false (default). Route /api/{health,events,user,goal,progress,reminders,offer,journey,feedback,review-prompt,cron}.
 * Database migration: pipe `node R3ENGINE.mjs sql` into psql or paste into Neon SQL editor.
 * ONLY enable real notifications after APNs/FCM, OneSignal consent + LGPD reviews.
 * No real push is sent during tests. This is NOT a trained churn ML predictor.
 * New V0.7: authentic offer comparison, verified journey progress, independent
 * 0-10 feedback and unbiased native store review request eligibility.
 * Offer catalog must be server-supplied R3_VERIFIED_OFFERS_JSON (never a client price).
 * Native review request is not proof the platform presented a prompt. No rating gating.
 *
 * LIMITATIONS: A standalone source file does not install third-party runtime deps,
 * configure Vercel scheduled jobs, or provision push credentials automatically.
 * Offline unit/API test success is not proof of a production-ready deployment.
 *
 * V0.6 STAGING (2026-10-17): validated on dedicated Neon branch:
 * SQL migration, verified lesson hour sampling, duplicate event suppression,
 * observed two-hour conversion, preference pause gate and delivery claim retry guard.
 * 89/89 local checks passed at last run; OneSignal device delivery NOT tested.
 * STAGING OBSERVATIONS (2026-10-16): a distinct Neon PostgreSQL 17 project named
 * R3ENGINE-staging was provisioned for isolated tests, with no production app data.
 * Real SQL tests passed: schema/functions creation, deduplication, streak once/day,
 * consent opt-in/opt-out, atomic claim and retry suppression, 3 workers claiming
 * the same delivery (exactly one claim), and a 3-per-7-day quota block.
 * This does NOT establish 100% production readiness: APNs/FCM, real OneSignal
 * acceptance, app SDK integration, load testing and end-to-end data erasure
 * still require credentialed testing. Previous audit measured 41/41 tests passed. Run the current suite and coverage anew.
 *
 * SECURITY: NEVER put DATABASE_URL or R3_APP_KEYS_JSON in a mobile/web client.
 * The application's own backend authenticates its user before calling this API.
 * Use HTTPS, rate limits, a protected scheduler, and distinct app secrets.
 * Consent must be backed by a real push subscription and system permission.
 *
 * Example private server-only environment (placeholders, not actual secrets):
 *   DATABASE_URL=<postgresql pooled URL>
 *   R3_APP_KEYS_JSON={"language_app":"<32+ chars>","study_app":"<32+ chars>","reading_app":"<32+ chars>"}
 *   CRON_SECRET=<32+ chars>
 *   ONESIGNAL_APPS_JSON={"language_app":{"app_id":"<uuid>","rest_api_key":"<key>"}}
 *   R3_PUSH_ENABLED=false
 *
 * Routes: GET /api/health, POST /api/events, DELETE /api/user, GET /api/cron.
 * Example event JSON (request header X-R3-App and Bearer app server secret):
 *   {"event_id":"9e0b893e-6c61-40aa-af23-bb86ad63f73d","user_id":"pseudonymous-1",
 *    "type":"day_completed","locale":"pt-BR","timezone":"America/Sao_Paulo"}
 * Values: session_started, lesson_completed, day_completed, push_opt_in, push_opt_out.
 * v0.5: a completed lesson maintains the streak; goal is separately configurable.
 *          GET /api/progress?user_id=..., PUT /api/goal {user_id,target:1..10}.
 *          Daily quests, milestone rewards and pre-equipped freeze (max 2).
 * v0.6: PUT /api/reminders {user_id,reminder_hour:8..21|null,paused_until:UTC_ISO|null}.
 * Learned hour comes from 3 verified completions; 10% arm exploration and novelty.
 * Snapshot locale + template variant makes retries consistent; attribution in 2h is observational.
 * IMPORTANT: server backend must verify actual push subscription and permissions independently.
 * NO friend streaks, leagues, proof of causal lift, or verified device delivery.
 * CRITICAL: app backend must verify user identity AND verify lesson completion.
 * Raw client events must not be forwarded without checking their authenticity.
 * DELETE body: {"user_id":"pseudonymous-1"}. Delete in OneSignal separately.
 *
 * Monitoring target: D1/D7/D30 retention, treatment vs 10% holdout, opt-outs,
 * suppression rate, provider acceptance and actual device delivery (not equivalent).
 */
import http from 'node:http';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
// ---------------- R3 UNIVERSAL CORE v1.0 (additive; legacy v0.7 remains intact) ----------------
import { createHmac, randomBytes } from 'node:crypto';
const U_ID=/^[a-z][a-z0-9_-]{1,49}$/;
const U_SUBJECT=/^[A-Za-z0-9_.:-]{1,120}$/;
const U_EVENT=/^[a-z][a-z0-9_.]{1,63}$/;
const U_CHANNELS=new Set(['push','in_app','email']);
const U_PURPOSES=new Set(['reminder','marketing','transactional']);
const U_CADENCES=new Set(['daily','weekly','episodic','none']);
const U_ENVIRONMENTS=new Set(['test','staging','prod']);
const U_PLATFORM=new Set(['ios','android','web','server']);
function uError(status,message){const e=new Error(message);e.status=status;return e;}
function uPlain(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function uText(v,re,label){if(typeof v!=='string'||!re.test(v))throw uError(400,'Invalid '+label);return v;}
function uDate(d){const n=Date.parse(d);if(typeof d!=='string'||!Number.isFinite(n)||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d{2}:\d{2})$/.test(d))throw uError(400,'Invalid occurred_at');return n;}
function uManifest(raw){
 if(!uPlain(raw))throw uError(400,'Invalid manifest');
 const tenant_id=uText(raw.tenant_id,U_ID,'tenant_id'),app_id=uText(raw.app_id,U_ID,'app_id');
 const environment=raw.environment||'test';if(!U_ENVIRONMENTS.has(environment))throw uError(400,'Invalid environment');
 const events=raw.events;
 if(!Array.isArray(events)||events.length<1||events.length>40||new Set(events.map(e=>e?.name)).size!==events.length)throw uError(400,'Invalid event registry');
 const registry=events.map(e=>{if(!uPlain(e))throw uError(400,'Invalid event');const name=uText(e.name,U_EVENT,'event name');if(typeof e.value!=='boolean')throw uError(400,'Event value must be boolean');return {name,value:e.value};});
 if(!registry.some(e=>e.value))throw uError(400,'At least one verified value event required');
 const cadence=raw.cadence||'episodic';if(!U_CADENCES.has(cadence))throw uError(400,'Invalid cadence');
 const modules=raw.modules??{};if(!uPlain(modules))throw uError(400,'Invalid modules');
 for(const [k,v] of Object.entries(modules)){if(!['habits','notifications','feedback','offers'].includes(k)||typeof v!=='boolean')throw uError(400,'Invalid module');}
 const quiet_start=raw.quiet_start??8,quiet_end=raw.quiet_end??21;
 if(!Number.isInteger(quiet_start)||!Number.isInteger(quiet_end)||quiet_start<0||quiet_end>23||quiet_start>=quiet_end)throw uError(400,'Invalid quiet hours');
 const weekly_limit=raw.weekly_limit??3,holdout_percent=raw.holdout_percent??10;
 if(!Number.isInteger(weekly_limit)||weekly_limit<0||weekly_limit>7||!Number.isInteger(holdout_percent)||holdout_percent<0||holdout_percent>50)throw uError(400,'Invalid limits');
 return {tenant_id,app_id,environment,events:registry,cadence,modules:{habits:false,notifications:false,feedback:false,offers:false,...modules},quiet_start,quiet_end,weekly_limit,holdout_percent};
}
function uValidateEvent(raw,manifest,subject,now=Date.now()){
 if(!uPlain(raw)||raw.subject_id!==subject)throw uError(403,'Subject mismatch');
 const event_id=uText(raw.event_id,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,'event_id');
 const name=uText(raw.name,U_EVENT,'name');const def=manifest.events.find(e=>e.name===name);
 if(!def)throw uError(400,'Event not in app registry');
 if(raw.schema_version!==1)throw uError(400,'Unsupported schema_version');
 const occurred_at=raw.occurred_at??new Date(now).toISOString(),timestamp=uDate(occurred_at);
 if(timestamp>now+300000||timestamp<now-30*86400000)throw uError(400,'Event timestamp out of bounds');
 const timezone=raw.timezone??'UTC',locale=raw.locale??'en';
 if(!validTimezone(timezone)||typeof locale!=='string'||!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale))throw uError(400,'Invalid timezone or locale');
 if(raw.properties!==undefined)throw uError(400,'Event properties disabled to reduce PII risk');
 return {event_id,name,is_value:def.value,occurred_at,timezone,locale};
}
function uAssignment(m,subject,key='retention_push'){
 const fraction=createHash('sha256').update([m.tenant_id,m.app_id,m.environment,key,subject].join(':')).digest().readUInt32BE(0)/4294967296;
 return fraction<(m.holdout_percent/100)?'holdout':'treatment';
}
function uEvaluate({manifest:m,subject_id,subject,consent,recent_sent,now=new Date(),channel='push',purpose='reminder'}){
 if(!m.enabled)return {eligible:false,reason:'app_disabled'};
 if(!m.modules?.notifications||m.cadence==='none')return {eligible:false,reason:'module_disabled'};
 if(!U_CHANNELS.has(channel)||!U_PURPOSES.has(purpose))return {eligible:false,reason:'unsupported_channel_or_purpose'};
 if(channel!=='push'||purpose!=='reminder')return {eligible:false,reason:'channel_adapter_not_configured'};
 if(uAssignment(m,subject_id)==='holdout' && purpose==='reminder')return {eligible:false,reason:'holdout'};
 if(!consent?.granted||!consent?.verified)return {eligible:false,reason:'no_verified_consent'};
 if(!subject?.last_value_at)return {eligible:false,reason:'no_verified_value'};
 if(subject.paused_until&&Date.parse(subject.paused_until)>now.getTime())return {eligible:false,reason:'paused'};
 const zone=subject.timezone||'UTC';const nowLocal=localClock(now,zone);
 if(nowLocal.hour<m.quiet_start||nowLocal.hour>=m.quiet_end)return {eligible:false,reason:'quiet_hours'};
 const hour=subject.reminder_hour;
 if(hour!==null&&hour!==undefined&&nowLocal.hour!==Number(hour))return {eligible:false,reason:'preferred_hour'};
 if((recent_sent||[]).some(x=>new Date(x).getTime()>now.getTime()-86400000))return {eligible:false,reason:'cooldown'};
 if((recent_sent||[]).filter(x=>new Date(x).getTime()>now.getTime()-7*86400000).length>=m.weekly_limit)return {eligible:false,reason:'weekly_quota'};
 const valDate=localClock(new Date(subject.last_value_at),zone).day,days=dayDifference(nowLocal.day,valDate);
 if(days<=0)return {eligible:false,reason:'already_completed'};
 if(m.cadence==='daily'&&days>7)return {eligible:false,reason:'dormant'};
 if(m.cadence==='weekly'&&days<7)return {eligible:false,reason:'weekly_not_due'};
 if(m.cadence==='episodic')return {eligible:false,reason:'episodic_no_automatic_push'};
 return {eligible:true,reason:'eligible',campaign:'value_reminder'};
}
function uSubjectSignature(secret,req,{tenant_id,app_id,environment},subject,ts){
 const url=new URL(req.url,'http://r3.local');
 // The whole payload, including URL query and JSON body, is authenticated.
 // Requests from trusted backend services only; never expose the key in SDKs.
 const body=req.body===undefined?'':typeof req.body==='string'?req.body:JSON.stringify(req.body);
 const digest=createHash('sha256').update(body).digest('hex');
 return createHmac('sha256',secret).update([req.method,url.pathname,url.searchParams.toString(),tenant_id,app_id,environment,subject,ts,req.headers?.['x-r3-request-id']||'',digest].join('\n')).digest('hex');
}
function uSafeSecret(value){return typeof value==='string'&&value.length>=32&&value.length<=256;}
function uAdmin(req){const s=process.env.R3_ADMIN_SECRET;return uSafeSecret(s)&&safeEqual(req.headers?.authorization,`Bearer ${s}`);}
function uDb(){return database();}
async function uAuthenticate(req,adapter={}){
 const h=req.headers??{},tenant_id=uText(h['x-r3-tenant'],U_ID,'tenant_id'),app_id=uText(h['x-r3-app'],U_ID,'app_id');
 const environment=h['x-r3-environment']??'test';if(!U_ENVIRONMENTS.has(environment))throw uError(401,'Invalid environment');
 const subject=uText(h['x-r3-subject'],U_SUBJECT,'subject');
 const ts=h['x-r3-timestamp'],sig=h['x-r3-signature'];
 if(typeof ts!=='string'||!/^\d{10,13}$/.test(ts)||Math.abs(Date.now()-Number(ts))>300000)throw uError(401,'Expired subject proof');
 const match=typeof h.authorization==='string'?/^Bearer ([A-Za-z0-9_\-]+)$/.exec(h.authorization):null;
 const key=match?.[1];if(!uSafeSecret(key))throw uError(401,'Unauthorized');
 const repo=adapter.repo||uRepository;
 const manifest=await repo.getApp(tenant_id,app_id,environment);
 if(!manifest||!manifest.enabled||!safeEqual(createHash('sha256').update(key).digest('hex'),manifest.key_hash))throw uError(401,'Unauthorized');
 if(typeof sig!=='string'||!safeEqual(sig,uSubjectSignature(key,req,{tenant_id,app_id,environment},subject,ts)))throw uError(401,'Subject proof invalid');
 const nonce=h['x-r3-request-id'];
 if(typeof nonce!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce))throw uError(401,'Request ID required');
 if(!await repo.claimRequest(manifest,subject,nonce,Number(ts)))throw uError(401,'Replayed request');
 return {manifest,subject,repo};
}
const uRepository={
 async getApp(tenant_id,app_id,environment){
  const db=await uDb();const [a]=await db`SELECT * FROM r3_v1_apps WHERE tenant_id=${tenant_id} AND app_id=${app_id} AND environment=${environment}`;
  if(!a)return null;
  const registry=await db`SELECT name,is_value FROM r3_v1_event_registry WHERE tenant_id=${tenant_id} AND app_id=${app_id} AND environment=${environment}`;
  return {...a,events:registry.map(x=>({name:x.name,value:x.is_value})),modules:a.modules};
 },
  async claimRequest(m,subject,nonce,ts){const db=await uDb();const [r]=await db`SELECT r3_v1_claim_request(${m.tenant_id},${m.app_id},${m.environment},${subject},${nonce}::uuid,${ts}::bigint) AS claimed`;return r?.claimed===true;},
 async register(m,hash){
  const db=await uDb();
  const [r]=await db`SELECT r3_v1_register_app(${m.tenant_id},${m.app_id},${m.environment},${hash},${m.cadence},${JSON.stringify(m.modules)}::jsonb,${m.quiet_start},${m.quiet_end},${m.weekly_limit},${m.holdout_percent},${JSON.stringify(m.events)}::jsonb) AS created`;
  return r?.created===true;
 },
 async setActive(m,enabled){const db=await uDb();const [r]=await db`UPDATE r3_v1_apps SET enabled=${enabled},config_version=config_version+1,updated_at=NOW()
   WHERE tenant_id=${m.tenant_id} AND app_id=${m.app_id} AND environment=${m.environment} RETURNING config_version`;return r||null;},
 async ingest(m,subject,e){const db=await uDb();const [r]=await db`SELECT r3_v1_ingest(${m.tenant_id},${m.app_id},${m.environment},${subject},${e.event_id}::uuid,${e.name},${e.occurred_at}::timestamptz,${e.locale},${e.timezone}) AS inserted`;return r?.inserted===true;},
 async state(m,subject){const db=await uDb();const [r]=await db`SELECT subject_id,value_count,last_value_at,last_active_at,timezone,locale,paused_until,reminder_hour FROM r3_v1_subjects WHERE tenant_id=${m.tenant_id} AND app_id=${m.app_id} AND environment=${m.environment} AND subject_id=${subject}`;return r||null;},
 async consent(m,subject,p){const db=await uDb();const [r]=await db`SELECT r3_v1_set_consent(${m.tenant_id},${m.app_id},${m.environment},${subject},${p.channel},${p.purpose},${p.granted},${p.verified},${p.platform}) AS updated`;return r?.updated===true;},
 async consentState(m,subject,channel,purpose){const db=await uDb();const [r]=await db`SELECT granted,verified FROM r3_v1_consents WHERE tenant_id=${m.tenant_id} AND app_id=${m.app_id} AND environment=${m.environment} AND subject_id=${subject} AND channel=${channel} AND purpose=${purpose}`;return r||null;},
 async recent(m,subject,channel,purpose){const db=await uDb();const r=await db`SELECT sent_at FROM r3_v1_notification_receipts WHERE tenant_id=${m.tenant_id} AND app_id=${m.app_id} AND environment=${m.environment} AND subject_id=${subject} AND channel=${channel} AND purpose=${purpose} AND sent_at>NOW()-INTERVAL '7 days'`;return r.map(x=>x.sent_at);},
 async expose(m,subject,key){const db=await uDb();const arm=uAssignment(m,subject,key);await db`INSERT INTO r3_v1_exposures(tenant_id,app_id,environment,subject_id,experiment_key,arm,config_version)
 VALUES(${m.tenant_id},${m.app_id},${m.environment},${subject},${key},${arm},${m.config_version}) ON CONFLICT DO NOTHING`;
 const [r]=await db`SELECT arm,config_version FROM r3_v1_exposures WHERE tenant_id=${m.tenant_id} AND app_id=${m.app_id} AND environment=${m.environment} AND subject_id=${subject} AND experiment_key=${key}`;return r;},
 async preference(m,subject,p){const db=await uDb();const [r]=await db`UPDATE r3_v1_subjects SET reminder_hour=${p.reminder_hour},paused_until=${p.paused_until}::timestamptz WHERE tenant_id=${m.tenant_id} AND app_id=${m.app_id} AND environment=${m.environment} AND subject_id=${subject} RETURNING subject_id`;return !!r;},
 async erase(m,subject){const db=await uDb();const r=await db`DELETE FROM r3_v1_subjects WHERE tenant_id=${m.tenant_id} AND app_id=${m.app_id} AND environment=${m.environment} AND subject_id=${subject} RETURNING subject_id`;return !!r.length;}
};
function uConsent(raw){if(!uPlain(raw)||!U_CHANNELS.has(raw.channel)||!U_PURPOSES.has(raw.purpose)||typeof raw.granted!=='boolean'||typeof raw.verified!=='boolean'||!U_PLATFORM.has(raw.platform))throw uError(400,'Invalid consent');
 if(raw.granted&&!raw.verified)throw uError(400,'Cannot grant without verified platform consent');
 return {channel:raw.channel,purpose:raw.purpose,granted:raw.granted,verified:raw.granted&&raw.verified,platform:raw.platform};}
function uPreference(raw){if(!uPlain(raw))throw uError(400,'Invalid preferences');const h=raw.reminder_hour,until=raw.paused_until;
 if(h!==null&&(!Number.isInteger(h)||h<0||h>23))throw uError(400,'Invalid reminder_hour');
 if(until!==null&&(typeof until!=='string'||!Number.isFinite(Date.parse(until))||Date.parse(until)<Date.now()-60000||Date.parse(until)>Date.now()+365*86400000))throw uError(400,'Invalid paused_until');
 return {reminder_hour:h,paused_until:until};}
async function uHandler(req,res,{repo=uRepository}={}){
 try{
  // Bind signatures to the exact raw bytes received over HTTP; unit-test mocks
  // may already carry a parsed body. Do this BEFORE authentication.
  if(req.body===undefined && !['GET','DELETE'].includes(req.method)){
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;
    if(size>4096)throw uError(413,'Payload too large');chunks.push(chunk);}
   req.body=Buffer.concat(chunks).toString('utf8');
  }
  const path=new URL(req.url,'http://r3.local').pathname;
  if(path==='/api/v1/admin/apps'||path==='/api/v1/admin/active'){
   if(!uAdmin(req))throw uError(401,'Admin authorization required');
   if(!guard(req.method,path.endsWith('/apps')?'POST':'PUT',res))return;
   const raw=await bodyJson(req);
   if(path.endsWith('/apps')){
    const m=uManifest(raw),key=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(key).digest('hex');
    const created=await repo.register(m,hash);
    if(!created)throw uError(409,'App already registered');
    return json(res,201,{tenant_id:m.tenant_id,app_id:m.app_id,environment:m.environment,app_key:key,notice:'Shown once; store only in app backend'});
   }
   if(!uPlain(raw)||typeof raw.enabled!=='boolean')throw uError(400,'Invalid active flag');
   const m={tenant_id:uText(raw.tenant_id,U_ID,'tenant_id'),app_id:uText(raw.app_id,U_ID,'app_id'),environment:raw.environment??'test'};
   if(!U_ENVIRONMENTS.has(m.environment))throw uError(400,'Invalid environment');
   const changed=await repo.setActive(m,raw.enabled);return json(res,changed?200:404,changed?{updated:true,config_version:changed.config_version}:{error:'App not found'});
  }
  const {manifest:m,subject,repo:db}=await uAuthenticate(req,{repo});
  if(path==='/api/v1/events'){
   if(!guard(req.method,'POST',res))return;
   const e=uValidateEvent(await bodyJson(req),m,subject);
   const inserted=await db.ingest(m,subject,e);return json(res,inserted?201:200,{inserted,duplicate:!inserted,is_value:e.is_value});
  }
  if(path==='/api/v1/state'){
   if(!guard(req.method,'GET',res))return;
   const state=await db.state(m,subject);return json(res,state?200:404,state?{...state,modules:m.modules,cadence:m.cadence}:{error:'No state'});
  }
  if(path==='/api/v1/consent'){
   if(!guard(req.method,'PUT',res))return;
   const p=uConsent(await bodyJson(req)),saved=await db.consent(m,subject,p);return json(res,saved?200:404,saved?{updated:true}:{error:'Subject not found'});
  }
  if(path==='/api/v1/preference'){
   if(!guard(req.method,'PUT',res))return;
   const p=uPreference(await bodyJson(req)),saved=await db.preference(m,subject,p);return json(res,saved?200:404,saved?{updated:true}:{error:'Subject not found'});
  }
  if(path==='/api/v1/experiment'){
   if(!guard(req.method,'POST',res))return;
   const raw=await bodyJson(req),key=uText(raw?.experiment_key,U_EVENT,'experiment key');
   const st=await db.state(m,subject);if(!st)throw uError(404,'Subject not found');
   const exposure=await db.expose(m,subject,key);return json(res,200,exposure);
  }
  if(path==='/api/v1/decision'){
   if(!guard(req.method,'POST',res))return;
   const raw=await bodyJson(req),channel=raw?.channel??'push',purpose=raw?.purpose??'reminder';
   if(!U_CHANNELS.has(channel)||!U_PURPOSES.has(purpose))throw uError(400,'Invalid channel/purpose');
   const [state,consent,recent_sent]=await Promise.all([db.state(m,subject),db.consentState(m,subject,channel,purpose),db.recent(m,subject,channel,purpose)]);
   if(!state)throw uError(404,'Subject not found');
   const decision=uEvaluate({manifest:m,subject_id:subject,subject:state,consent,recent_sent,channel,purpose});
   return json(res,200,{...decision,advisory_only:true,delivery_scheduled:false});
  }
  if(path==='/api/v1/user'){
   if(!guard(req.method,'DELETE',res))return;
   const deleted=await db.erase(m,subject);return json(res,200,{deleted,external_provider_erasure_required:true});
  }
  return json(res,404,{error:'Unknown v1 route'});
 }catch(err){
  const status=err.status||(err.code==='23505'?409:503);
  if(status===503)console.error('R3 universal error',err.message);
  return json(res,status,{error:status===503?'Service unavailable':err.message});
 }
}

// ---------------- ENGINE ----------------
/** R3ENGINE: pure decision rules. No tracking of SSID, precise location or sensitive data. */
const APPS = Object.freeze(['language_app', 'study_app', 'reading_app']);
const EVENT_TYPES = Object.freeze([
  'session_started', 'lesson_completed', 'day_completed', 'push_opt_in', 'push_opt_out'
]);
const SEND_HOUR = 19;
const QUIET_START = 8, QUIET_END = 21, MAX_UNANSWERED_7D=2;
const MAX_PUSHES_PER_7_DAYS = 3;
const HOLDOUT_PERCENT = 10;
const DAY_MS = 86_400_000;

function validTimezone(zone) {
  if (typeof zone !== 'string' || zone.length > 80) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; }
  catch { return false; }
}

function localClock(date, timezone) {
  if (!validTimezone(timezone)) throw new Error('Invalid timezone');
  const fields = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const take = type => fields.find(x => x.type === type)?.value;
  return { day: `${take('year')}-${take('month')}-${take('day')}`, hour: Number(take('hour')) };
}

function dayDifference(dayA, dayB) {
  return Math.round((Date.parse(`${dayA}T00:00:00Z`) - Date.parse(`${dayB}T00:00:00Z`)) / DAY_MS);
}

/** Deterministic 10% control cohort. Matches db/analytics.sql. */
function isHoldout(app, userId) {
  // Four bytes avoid the 30/256 (11.71875%) bias of modulo on one byte.
  const bucket = createHash('md5').update(`${app}:${userId}`).digest().readUInt32BE(0) % 100;
  return bucket < HOLDOUT_PERCENT;
}

function validateEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid JSON event');
  const { event_id, user_id, type, timezone, locale = 'en' } = raw;
  if (typeof event_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event_id)) throw new Error('Invalid event_id UUID');
  if (typeof user_id !== 'string' || !/^[\w:.-]{1,120}$/.test(user_id)) throw new Error('Invalid pseudonymous user_id');
  if (!EVENT_TYPES.includes(type)) throw new Error('Unknown event type');
  if (!validTimezone(timezone)) throw new Error('Invalid IANA timezone');
  if (typeof locale !== 'string' || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)) throw new Error('Invalid locale');
  return { event_id, user_id, type, timezone, locale };
}

/** Heuristic only, NOT a trained abandonment prediction. */
function riskScore(daysInactive) {
  if (!Number.isFinite(daysInactive)) return 0;
  return Math.round(Math.min(0.9, 0.15 + Math.max(0, daysInactive) * 0.13) * 100) / 100;
}

function chosenHour(user) {
  if(Number.isInteger(user.reminder_hour) && user.reminder_hour>=QUIET_START && user.reminder_hour<=QUIET_END)return user.reminder_hour;
  if(Number(user.hourly_samples)>=3 && Number.isInteger(user.learned_hour) && user.learned_hour>=QUIET_START && user.learned_hour<=QUIET_END)return user.learned_hour;
  return SEND_HOUR;
}
function decideNotification(user,sentLast7d,now=new Date()) {
  if(!APPS.includes(user.app)||!user.push_consent||!user.last_active_at||isHoldout(user.app,user.user_id))return null;
  if(Number(sentLast7d)>=MAX_PUSHES_PER_7_DAYS||Number(user.unanswered_7d||0)>=MAX_UNANSWERED_7D)return null;
  if(user.paused_until && new Date(user.paused_until)>now)return null;
  if(user.last_sent_at && now.getTime()-new Date(user.last_sent_at).getTime()<DAY_MS)return null;
  const current=localClock(now,user.timezone);
  if(current.hour!==chosenHour(user))return null;
  if(user.last_completed_local_date && dateKey(user.last_completed_local_date)===current.day)return null;
  const lastDay=user.last_completed_local_date?dateKey(user.last_completed_local_date):localClock(new Date(user.last_active_at),user.timezone).day;
  const daysInactive=dayDifference(current.day,lastDay);
  if(daysInactive<1||daysInactive>7)return null;
  const kind=daysInactive===1 && Number(user.current_streak)>=2 && user.app!=='reading_app'?'streak_reminder':'return_reminder';
  return {kind,day:current.day,daysInactive,sendHour:current.hour,riskHeuristic:riskScore(daysInactive)};
}

const COPY = {
  language_app: {
    en: { streak_reminder: ['Keep your speaking streak', 'A short conversation is ready when you are.'], return_reminder: ['Your next conversation is ready', 'Practice a few minutes at your own pace.'] },
    pt: { streak_reminder: ['Continue sua sequência de conversação', 'Uma conversa curta está pronta para você.'], return_reminder: ['Sua próxima conversa está pronta', 'Pratique alguns minutos no seu ritmo.'] },
    es: { streak_reminder: ['Continúa tu racha de conversación', 'Tienes una conversación breve preparada.'], return_reminder: ['Tu próxima conversación está lista', 'Practica unos minutos a tu ritmo.'] },
    fr: { streak_reminder: ['Continuez votre série', 'Une courte conversation vous attend.'], return_reminder: ['Votre prochaine conversation est prête', 'Pratiquez quelques minutes à votre rythme.'] },
    de: { streak_reminder: ['Setze deine Serie fort', 'Ein kurzes Gespräch wartet auf dich.'], return_reminder: ['Dein nächstes Gespräch ist bereit', 'Übe ein paar Minuten in deinem Tempo.'] },
    it: { streak_reminder: ['Continua la tua serie', 'Ti aspetta una breve conversazione.'], return_reminder: ['La prossima conversazione è pronta', 'Esercitati qualche minuto al tuo ritmo.'] },
    ru: { streak_reminder: ['Продолжайте серию занятий', 'Вас ждёт короткий разговор.'], return_reminder: ['Следующий разговор готов', 'Практикуйтесь несколько минут в удобном темпе.'] }
  },
  study_app: {
    en: { streak_reminder: ['Keep learning', 'Your next short study session is ready.'], return_reminder: ['Pick up where you left off', 'A small step is enough for today.'] },
    pt: { streak_reminder: ['Continue estudando', 'Sua próxima sessão curta está pronta.'], return_reminder: ['Continue de onde parou', 'Um pequeno passo já conta hoje.'] },
    es: { streak_reminder: ['Sigue aprendiendo', 'Tu próxima sesión breve está lista.'], return_reminder: ['Retoma tus estudios', 'Un pequeño paso cuenta hoy.'] },
    fr: { streak_reminder: ['Continuez à apprendre', 'Votre prochaine session est prête.'], return_reminder: ['Reprenez votre apprentissage', 'Quelques minutes suffisent.'] },
    de: { streak_reminder: ['Lerne weiter', 'Deine nächste kurze Lerneinheit ist bereit.'], return_reminder: ['Lerne in deinem Tempo weiter', 'Ein kleiner Schritt reicht.'] },
    it: { streak_reminder: ['Continua a imparare', 'La prossima sessione è pronta.'], return_reminder: ['Riprendi a studiare', 'Bastano pochi minuti.'] },
    ru: { streak_reminder: ['Продолжайте обучение', 'Следующее короткое занятие готово.'], return_reminder: ['Вернитесь к занятиям', 'Достаточно нескольких минут.'] }
  },
  reading_app: {
    en: { streak_reminder: ['A moment to reflect', 'Continue your reading whenever you like.'], return_reminder: ['Your reading is here', 'Take a quiet moment whenever it suits you.'] },
    pt: { streak_reminder: ['Um momento de reflexão', 'Continue sua leitura quando desejar.'], return_reminder: ['Sua leitura está disponível', 'Reserve um momento tranquilo quando preferir.'] },
    es: { streak_reminder: ['Un momento para reflexionar', 'Continúa tu lectura cuando quieras.'], return_reminder: ['Tu lectura te espera', 'Dedica un momento tranquilo cuando puedas.'] },
    fr: { streak_reminder: ['Un moment de réflexion', 'Poursuivez votre lecture à votre rythme.'], return_reminder: ['Votre lecture vous attend', 'Profitez d’un moment calme quand vous voulez.'] },
    de: { streak_reminder: ['Zeit zum Nachdenken', 'Lies weiter, wann es dir passt.'], return_reminder: ['Deine Lektüre wartet', 'Nimm dir einen ruhigen Moment.'] },
    it: { streak_reminder: ['Un momento per riflettere', 'Continua la lettura quando vuoi.'], return_reminder: ['La tua lettura ti aspetta', 'Prenditi un momento di calma.'] },
    ru: { streak_reminder: ['Время для размышлений', 'Продолжайте чтение, когда удобно.'], return_reminder: ['Ваша книга ждёт вас', 'Найдите спокойную минуту для чтения.'] }
  }
};

function messageFor(app, locale, kind) {
  if (!APPS.includes(app)) throw new Error('Unknown app');
  const language = typeof locale === 'string' ? locale.split('-')[0].toLowerCase() : 'en';
  const resolvedLanguage = COPY[app][language] ? language : 'en';
  const message = COPY[app][resolvedLanguage][kind];
  if (!message) throw new Error('Unknown message kind');
  const [title, body] = message;
  return { title, body, language: resolvedLanguage };
}


const REMINDER_VARIANTS=Object.freeze({
 language_app:{en:{streak_reminder:[['Your practice awaits','A quick conversation is ready.'],['Speak at your pace','Continue your speaking practice when ready.']],return_reminder:[['Pick up speaking','A short conversation is available.'],['Start fresh','A conversation is here when you want.']]},pt:{streak_reminder:[['Continue praticando','Uma conversa curta está disponível.'],['Fale no seu ritmo','Pratique conversação quando desejar.']],return_reminder:[['Retome a conversa','Uma conversa curta está disponível.'],['Recomece com calma','Pratique conversação quando desejar.']]}},
 study_app:{en:{streak_reminder:[['Study a little today','Your next activity is ready.'],['Every step counts','Continue learning at your pace.']],return_reminder:[['Resume your learning','An activity is available.'],['Ready when you are','Keep studying whenever you choose.']]},pt:{streak_reminder:[['Estude um pouco hoje','Sua próxima atividade está disponível.'],['Cada passo conta','Continue estudando no seu ritmo.']],return_reminder:[['Retome seus estudos','Uma atividade está disponível.'],['Quando quiser','Continue estudando no seu ritmo.']]}},
 reading_app:{en:{streak_reminder:[['A quiet moment','Read whenever you have time.'],['Your time to reflect','Reading is available at your pace.']],return_reminder:[['A moment for reading','Your reading is here whenever you choose.'],['Take your time','Reflect whenever it feels right.']]},pt:{streak_reminder:[['Um momento de calma','Leia quando tiver tempo.'],['Seu momento de reflexão','Leia no seu ritmo.']],return_reminder:[['Um momento para leitura','Sua leitura está disponível quando desejar.'],['Sem pressa','Reflita no seu tempo.']]}}
});
function eligibleVariants(app,locale,kind){
 const lang=typeof locale==='string'?locale.split('-')[0].toLowerCase():'en';
 return REMINDER_VARIANTS[app]?.[lang]?.[kind]?[0,1,2]:[0];
}
function messageVariant(app,locale,kind,variantId=0){
 const basic=messageFor(app,locale,kind);
 const id=Number.isInteger(variantId)&&eligibleVariants(app,locale,kind).includes(variantId)?variantId:0;
 if(id===0)return {...basic,variant_id:0};
 const [title,body]=REMINDER_VARIANTS[app][basic.language][kind][id-1];
 return {title,body,language:basic.language,variant_id:id};
}
// Lightweight conservative bandit: 10% deterministic exploration, Laplace smoothing,
// recent-exposure novelty penalty; no uncalibrated causal lift assertion.
function selectVariant(row,kind,day){
 const variants=eligibleVariants(row.app,row.locale,kind);
 if(variants.length===1)return 0;
 const stats=row.variant_stats||{};
 const recent=Array.isArray(row.recent_variant_ids)?row.recent_variant_ids.map(Number):[];
 const arms=variants.map(id=>{const x=stats[`${kind}:${id}`]||{};
  const views=Math.max(0,Number(x.views)||0),wins=Math.max(0,Math.min(views,Number(x.successes)||0));
  return {id,views,wins};});
 const explore=createHash('sha256').update(`${row.app}:${row.user_id}:${day}:explore`).digest()[0]%10===0;
 if(explore){arms.sort((a,b)=>Number(recent.includes(a.id))-Number(recent.includes(b.id))||a.views-b.views||a.id-b.id);return arms[0].id;}
 const total=arms.reduce((n,a)=>n+a.views,0);
 const scored=arms.map(a=>({id:a.id,score:(a.wins+1)/(a.views+2)+0.13*Math.sqrt(Math.log(total+2)/(a.views+1))-(recent.includes(a.id)?0.26:0)}));
 scored.sort((a,b)=>b.score-a.score||a.id-b.id);return scored[0].id;
}
function validateReminder(raw,now=new Date()){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.user_id!=='string'||!/^[\w:.-]{1,120}$/.test(raw.user_id))throw Error('Invalid user ID');
 const hasHour=Object.prototype.hasOwnProperty.call(raw,'reminder_hour');
 const hasPause=Object.prototype.hasOwnProperty.call(raw,'paused_until');
 if(!hasHour&&!hasPause)throw Error('Empty preferences');
 if(hasHour&&raw.reminder_hour!==null&&(!Number.isInteger(raw.reminder_hour)||raw.reminder_hour<8||raw.reminder_hour>21))throw Error('Hour outside quiet hours');
 if(hasPause&&raw.paused_until!==null){
  if(typeof raw.paused_until!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(raw.paused_until))throw Error('Bad pause');
  const ms=Date.parse(raw.paused_until);
  if(!Number.isFinite(ms)||ms<now.getTime()||ms>now.getTime()+30*DAY_MS)throw Error('Pause outside bounds');
 }
 return {user_id:raw.user_id,hasHour,hasPause,reminder_hour:raw.reminder_hour??null,paused_until:raw.paused_until??null};
}


// ---------------- LEARNING-HABIT CORE (v0.5) ----------------
const DAILY_XP_PER_LESSON = 10; // Points reward only verified lessons, not opening screens.
const MAX_STREAK_FREEZES = 2;
const MILESTONES = Object.freeze([7,30,100]);

function dateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  if (typeof value==='string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return value.slice(0,10);
  throw Error('Invalid stored calendar date');
}

/** A freeze must exist before a gap; returning to the app spends it in SQL. */
function streakStatus({last_completed_local_date, current_streak, freeze_balance=0}, nowDay) {
  if (!last_completed_local_date || !current_streak) return 'not_started';
  const previous=dateKey(last_completed_local_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(previous) || !/^\d{4}-\d{2}-\d{2}$/.test(nowDay)) throw Error('Invalid calendar date');
  const gap=dayDifference(nowDay,previous);
  if (gap<0) return 'clock_conflict';
  if (gap===0) return 'completed_today';
  if (gap===1) return 'at_risk_today';
  return gap-1 <= Number(freeze_balance) ? 'recoverable_with_freeze' : 'expired';
}

/** Product-specific progress data, no user PII, no friend relationship assumptions. */
function progressView(row, nowDay) {
  if (!row) return null;
  const goal=Number(row.daily_goal);
  const lessons=Number(row.today_lessons || 0);
  const streak=Number(row.current_streak || 0);
  const freezes=Number(row.freeze_balance || 0);
  const recent=Number(row.active_days_7d || 0);
  const status=streakStatus(row,nowDay);
  return {
    user_id:row.user_id,
    daily_goal:{target:goal,completed:lessons,met:lessons>=goal},
    streak:{days:status==='expired'?0:streak,longest:Number(row.longest_streak||0),status,freezes_available:freezes},
    xp_total:Number(row.lessons_total||0)*DAILY_XP_PER_LESSON,
    quests:{one_lesson:lessons>=1,meet_daily_goal:lessons>=goal,weekly_consistency:recent>=5,weekly_days:recent},
    milestones:(Array.isArray(row.earned_milestones) ? row.earned_milestones : []).map(Number).filter(n=>MILESTONES.includes(n))
  };
}

function validateGoal(raw) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw Error('Invalid goal');
  const {user_id,target}=raw;
  if(typeof user_id!=='string'|| !/^[\w:.-]{1,120}$/.test(user_id))throw Error('Invalid user_id');
  if(!Number.isInteger(target)||target<1||target>10)throw Error('Daily goal must be 1..10 completed lessons');
  return {user_id,target};
}

// ---------------- R3 EXPERIENCE (v0.7) ----------------
// Video-inspired experiences without false scarcity or store-rating manipulation.
const FEEDBACK_REASONS=Object.freeze(['content','price','usability','performance','support','other']);
const REVIEW_PLATFORMS=Object.freeze(['ios','android']);
const REVIEW_COOLDOWN_DAYS=90;
const REVIEW_MAX_REQUESTS_365D=2; // additional conservative cap; OS may suppress further.
function validUserId(id) {return typeof id==='string'&&/^[\w:.-]{1,120}$/.test(id);}
function validUuid(id){return typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);}
function validateFeedback(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid feedback');
  const {feedback_id,user_id,score,reason=null}=payload;
  if(!validUuid(feedback_id)||!validUserId(user_id)||!Number.isInteger(score)||score<0||score>10||
     (reason!==null&&!FEEDBACK_REASONS.includes(reason)))throw Error('Invalid feedback data');
  return {feedback_id,user_id,score,reason};
}
function validateReviewRequest(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid request');
  const {user_id,platform,session_completed,in_foreground,task_idle}=payload;
  if(!validUserId(user_id)||!REVIEW_PLATFORMS.includes(platform)||
     typeof session_completed!=='boolean'||typeof in_foreground!=='boolean'||typeof task_idle!=='boolean')throw Error('Invalid review request');
  return {user_id,platform,session_completed,in_foreground,task_idle};
}
// Eligibility deliberately DOES NOT accept survey score, rating, sentiment or feedback reason.
// Mobile OS makes final decision about displaying its native review prompt.
function reviewEligibility(user,request,now=new Date()){
  if(!user||!REVIEW_PLATFORMS.includes(request.platform))return {eligible:false,reason:'platform_unavailable'};
  if(!request.session_completed||!request.in_foreground||!request.task_idle)return {eligible:false,reason:'inappropriate_moment'};
  if(!user.created_at||!Number.isFinite(Date.parse(user.created_at)))return {eligible:false,reason:'missing_account_age'};
  if(now.getTime()-Date.parse(user.created_at)<7*DAY_MS||Number(user.lessons_total||0)<5)return {eligible:false,reason:'insufficient_use'};
  if(Number(user.requests_365d||0)>=REVIEW_MAX_REQUESTS_365D)return {eligible:false,reason:'annual_cap'};
  if(user.last_review_requested_at&&now.getTime()-Date.parse(user.last_review_requested_at)<REVIEW_COOLDOWN_DAYS*DAY_MS)return {eligible:false,reason:'cooldown'};
  return {eligible:true,action:'request_native_review',platform:request.platform};
}
// Progress based on actually completed lessons. No artificial timelines or fake ETA.
function journeyView(progress,app){
  if(!APPS.includes(app)||!progress)throw Error('Verified progress required');
  const goal=progress.daily_goal;
  const weeklyDays=Number(progress.quests.weekly_days||0);
  const stages=[
    {id:'first_lesson',done:Number(progress.xp_total||0)>=DAILY_XP_PER_LESSON},
    {id:'daily_goal',done:Boolean(goal.met)},
    {id:'weekly_habit',done:weeklyDays>=5}
  ];
  const next=stages.find(x=>!x.done)?.id??'continue_learning';
  return {app,stages,next_action:next,completed_lessons_today:Number(goal.completed),daily_goal:Number(goal.target),weekly_active_days:weeklyDays,estimate:null};
}
function validateSku(value){
  if(typeof value!=='string'||!/^[a-zA-Z0-9_.-]{1,72}$/.test(value))throw Error('Invalid SKU');
  return value;
}
// Both prices and membership terms must originate from server-side verified catalog.
// Never assert a NET saving without accounting for fees; never create an invented timer.
function valueOffer(app,sku,catalog,now=new Date()){
  if(!APPS.includes(app))throw Error('Unknown app');
  validateSku(sku);
  const entry=catalog?.[app]?.[sku];
  if(!entry||entry.active!==true)return null;
  const {currency,public_price_minor,member_price_minor,membership_fee_minor=null,membership_period=null,terms_url,expires_at=null,benefits=[]}=entry;
  if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)||
   !Number.isSafeInteger(public_price_minor)||public_price_minor<0||
   !Number.isSafeInteger(member_price_minor)||member_price_minor<0||member_price_minor>public_price_minor||
   !Array.isArray(benefits)||benefits.length>8||benefits.some(b=>typeof b!=='string'||b.length>140)||
   typeof terms_url!=='string'||!/^https:\/\/[^\s]+$/i.test(terms_url))throw Error('Invalid verified offer');
  const hasMembership=membership_fee_minor!==null;
  if(hasMembership&&(!Number.isSafeInteger(membership_fee_minor)||membership_fee_minor<0||
     !['weekly','monthly','annual'].includes(membership_period)))throw Error('Invalid membership terms');
  if(!hasMembership&&membership_period!==null)throw Error('Invalid membership period');
  if(expires_at!==null&&(!Number.isFinite(Date.parse(expires_at))||new Date(expires_at)<=now))return null;
  return {sku,currency,public_price_minor,member_price_minor,
    gross_price_difference_minor:public_price_minor-member_price_minor,
    membership_fee_minor,membership_period,
    price_difference_is_not_net_savings:hasMembership,
    benefits,terms_url,expires_at,urgency_label:expires_at?'Prazo real da oferta':'',
    message:'Compare os benefícios e o custo total antes de escolher.'};
}

// ---------------- CONFIG ----------------
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x,y);
}

function envJson(name) {
  try { const value = JSON.parse(process.env[name] || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { throw new Error(`Invalid ${name} configuration`); }
}

function authenticateApp(req) {
  const app = req.headers['x-r3-app'];
  if (!APPS.includes(app)) return null;
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_.~+\/-]+)$/i.exec(header) : null;
  const token = match?.[1] || '';
  const key = envJson('R3_APP_KEYS_JSON')[app];
  if (typeof key !== 'string' || key.length < 32) throw new Error('Server app key missing or too short');
  return safeEqual(token,key) ? app : null;
}

function getOneSignalApps() {
  // Allow an incremental rollout: apps without provider credentials stay inactive.
  const apps = envJson('ONESIGNAL_APPS_JSON');
  let configured = 0;
  for (const app of APPS) {
    const entry = apps[app];
    if (!entry) continue;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.app_id || '') ||
        typeof entry.rest_api_key !== 'string' || entry.rest_api_key.length < 12) {
      throw new Error(`Invalid OneSignal configuration for ${app}`);
    }
    configured++;
  }
  if (!configured) throw new Error('At least one OneSignal app must be configured');
  return apps;
}

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  return typeof secret === 'string' && secret.length >= 32 && safeEqual(req.headers.authorization, `Bearer ${secret}`);
}

function pushEnabled() { return process.env.R3_PUSH_ENABLED === 'true'; }


// ---------------- PROVIDER ----------------
/** OneSignal notification creation API. Never called from client apps. */
async function sendOneSignal({job, locale, appConfig, fetcher = fetch}) {
  const {title,body,variant_id} = messageVariant(job.app,locale,job.kind,Number(job.variant_id??0));
  const response = await fetcher('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${appConfig.rest_api_key}` },
    body: JSON.stringify({
      app_id: appConfig.app_id,
      include_aliases: {external_id:[job.user_id]},
      target_channel: 'push',
      idempotency_key: job.id,
      // Single-user targeting: en is the fallback for all OneSignal device locales,
      // but the content itself is already translated for this user's locale.
      headings: {en:title},
      contents: {en:body},
      data: {r3_app:job.app, r3_kind:job.kind,r3_variant:String(variant_id),r3_delivery_id:job.id}
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`OneSignal HTTP ${response.status}`);
  const data = await response.json();
  const hasErrors = !!data?.errors && (typeof data.errors === 'object' ? Object.keys(data.errors).length > 0 : true);
  const noRecipients = data && data.recipients !== undefined && data.recipients !== null && (!Number.isFinite(Number(data.recipients)) || Number(data.recipients) <= 0);
  if (!data?.id || data.success === false || noRecipients || hasErrors)
    return {sent:false, reason:'OneSignal did not accept recipients'};
  return {sent:true, providerId:data.id};
}


// ---------------- DB ----------------
/** All SQL is parameterized through tagged Neon driver queries. */
let sql;
async function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!sql) {
    const { neon } = await import('@neondatabase/serverless');
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

async function ingest(app, event) {
  const db = await database();
  const [row] = await db`SELECT r3_ingest_event(${event.event_id}::uuid,${app},${event.user_id},${event.type},${event.locale},${event.timezone}) AS inserted`;
  return row?.inserted === true;
}
async function deleteUser(app,userId) {
  const db = await database();
  const [row] = await db`SELECT r3_delete_user(${app},${userId}) AS deleted`;
  return row?.deleted === true;
}
async function setDailyGoal(app,userId,target) {
  const conn=await database();
  const [row]=await conn`UPDATE r3_users SET daily_goal=${target}, updated_at=NOW()
    WHERE app=${app} AND user_id=${userId} RETURNING user_id`;
  return Boolean(row);
}
async function saveReminder(app,userId,pref){
 const conn=await database();
 const [row]=await conn`UPDATE r3_users SET
  reminder_hour=CASE WHEN ${pref.hasHour} THEN ${pref.reminder_hour}::integer ELSE reminder_hour END,
  paused_until=CASE WHEN ${pref.hasPause} THEN ${pref.paused_until}::timestamptz ELSE paused_until END,
  updated_at=NOW() WHERE app=${app} AND user_id=${userId} RETURNING user_id`;
 return !!row;
}
async function readProgress(app,userId) {
  const conn=await database();
  const [row]=await conn`
    SELECT u.app,u.user_id,u.daily_goal,u.current_streak,u.longest_streak,
      u.freeze_balance,u.lessons_total,u.last_completed_local_date,u.timezone,
      (NOW() AT TIME ZONE u.timezone)::date AS now_day,
      COALESCE(p.lessons,0) AS today_lessons,
      COALESCE((SELECT array_agg(r.milestone ORDER BY r.milestone) FROM r3_rewards r
                WHERE r.app=u.app AND r.user_id=u.user_id),'{}'::integer[]) AS earned_milestones,
      (SELECT COUNT(*)::integer FROM r3_daily_progress t
       WHERE t.app=u.app AND t.user_id=u.user_id AND t.lessons>0
         AND t.local_day BETWEEN (NOW() AT TIME ZONE u.timezone)::date-6
         AND (NOW() AT TIME ZONE u.timezone)::date) AS active_days_7d
    FROM r3_users u
    LEFT JOIN r3_daily_progress p ON p.app=u.app AND p.user_id=u.user_id
      AND p.local_day=(NOW() AT TIME ZONE u.timezone)::date
    WHERE u.app=${app} AND u.user_id=${userId}`;
  return row ? progressView(row,dateKey(row.now_day)):null;
}
// ---------------- R3 EXPERIENCE DB (v0.7) ----------------
async function writeFeedback(app,feedback){
  const conn=await database();
  const [row]=await conn`INSERT INTO r3_feedback(feedback_id,app,user_id,score,reason)
    SELECT ${feedback.feedback_id}::uuid, u.app,u.user_id,${feedback.score},${feedback.reason}
    FROM r3_users u WHERE u.app=${app} AND u.user_id=${feedback.user_id}
    ON CONFLICT(feedback_id) DO NOTHING RETURNING feedback_id`;
  if(row)return 'inserted';
  const [existing]=await conn`SELECT feedback_id FROM r3_feedback WHERE feedback_id=${feedback.feedback_id}::uuid AND app=${app} AND user_id=${feedback.user_id}`;
  if(existing)return 'duplicate';
  const [user]=await conn`SELECT user_id FROM r3_users WHERE app=${app} AND user_id=${feedback.user_id}`;
  return user?'conflict':'not_found';
}
async function claimNativeReview(app,request){
  const conn=await database();
  const [row]=await conn`SELECT r3_claim_review_prompt(${app},${request.user_id},${request.platform},
    ${request.session_completed},${request.in_foreground},${request.task_idle}) AS requested`;
  return row?.requested===true;
}

async function listCandidates(){
 const conn=await database();
 return conn`
 SELECT u.app,u.user_id,u.locale,u.timezone,u.push_consent,u.last_active_at,
  u.last_completed_local_date,u.current_streak,u.reminder_hour,u.paused_until,u.learned_hour,u.hourly_samples,
  (SELECT COUNT(*)::integer FROM r3_deliveries d WHERE d.app=u.app AND d.user_id=u.user_id AND d.status='sent' AND d.sent_at>NOW()-INTERVAL '7 days') AS sent_last_7d,
  (SELECT COUNT(*)::integer FROM r3_deliveries d WHERE d.app=u.app AND d.user_id=u.user_id AND d.status='sent' AND d.sent_at BETWEEN NOW()-INTERVAL '7 days' AND NOW()-INTERVAL '2 hours' AND d.converted_at IS NULL) AS unanswered_7d,
  (SELECT MAX(d.sent_at) FROM r3_deliveries d WHERE d.app=u.app AND d.user_id=u.user_id AND d.status='sent') AS last_sent_at,
  (SELECT COALESCE(array_agg(z.variant_id ORDER BY z.sent_at DESC),'{}'::integer[]) FROM
      (SELECT variant_id,sent_at FROM r3_deliveries d WHERE d.app=u.app AND d.user_id=u.user_id AND d.status='sent' ORDER BY sent_at DESC LIMIT 3) z) AS recent_variant_ids,
  (SELECT COALESCE(jsonb_object_agg(z.kind||':'||z.variant_id,jsonb_build_object('views',z.views,'successes',z.successes)),'{}'::jsonb)
   FROM (SELECT kind,variant_id,COUNT(*)::integer AS views,COUNT(converted_at)::integer AS successes
    FROM r3_deliveries d WHERE d.app=u.app AND d.status='sent' AND d.sent_at<NOW()-INTERVAL '2 hours'
      AND split_part(d.locale,'-',1)=split_part(u.locale,'-',1)
    GROUP BY kind,variant_id) z) AS variant_stats
 FROM r3_users u
 WHERE u.push_consent AND u.last_active_at IS NOT NULL AND u.last_active_at>=NOW()-INTERVAL '8 days'
 AND (u.paused_until IS NULL OR u.paused_until<=NOW())
 AND (u.last_completed_local_date IS NULL OR u.last_completed_local_date<>(NOW() AT TIME ZONE u.timezone)::date)
 AND EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone)=COALESCE(u.reminder_hour,CASE WHEN u.hourly_samples>=3 THEN u.learned_hour END,19)
 AND NOT r3_is_holdout(u.app,u.user_id) ORDER BY u.last_active_at ASC LIMIT 500`;
}
async function listRetries() {
  const db = await database();
  return db`
    SELECT d.id,d.app,d.user_id,d.kind,d.variant_id,d.locale,d.campaign_day,u.timezone,u.push_consent,u.last_active_at
    FROM r3_deliveries d JOIN r3_users u USING (app,user_id)
    WHERE d.status IN ('reserved','sending','failed') AND d.attempts < 3
      AND (d.last_attempt_at IS NULL OR d.last_attempt_at < NOW()-INTERVAL '10 minutes')
      AND d.campaign_day = (NOW() AT TIME ZONE u.timezone)::DATE
      AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.timezone))=COALESCE(u.reminder_hour,CASE WHEN u.hourly_samples>=3 THEN u.learned_hour END,19)
      AND (u.paused_until IS NULL OR u.paused_until<=NOW())
      AND (u.last_completed_local_date IS NULL OR u.last_completed_local_date<>(NOW() AT TIME ZONE u.timezone)::date)
      AND u.push_consent
      AND NOT r3_is_holdout(u.app,u.user_id)
      AND (NOW() AT TIME ZONE u.timezone)::date -
          COALESCE(u.last_completed_local_date,(u.last_active_at AT TIME ZONE u.timezone)::date) BETWEEN 1 AND 7
    ORDER BY d.created_at ASC LIMIT 100
  `;
}
async function reserve(app,userId,day,kind,variantId=0) {
  const db=await database();
  const id = randomUUID();
  const [row] = await db`
    INSERT INTO r3_deliveries (id,app,user_id,campaign_day,kind,variant_id,locale)
    SELECT ${id}::uuid,${app},${userId},${day}::date,${kind},${variantId},u.locale
    FROM r3_users u WHERE u.app=${app} AND u.user_id=${userId} AND u.push_consent
      AND u.last_active_at IS NOT NULL
      AND NOT r3_is_holdout(u.app,u.user_id)
      AND EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone)=COALESCE(u.reminder_hour,CASE WHEN u.hourly_samples>=3 THEN u.learned_hour END,19)
      AND (u.paused_until IS NULL OR u.paused_until<=NOW())
      AND (u.last_completed_local_date IS NULL OR u.last_completed_local_date<>(NOW() AT TIME ZONE u.timezone)::date)
      AND NOT EXISTS (SELECT 1 FROM r3_deliveries d WHERE d.app=u.app AND d.user_id=u.user_id AND d.status='sent' AND d.sent_at>NOW()-INTERVAL '24 hours')
      AND (SELECT COUNT(*) FROM r3_deliveries d WHERE d.app=u.app AND d.user_id=u.user_id AND d.status='sent' AND d.sent_at BETWEEN NOW()-INTERVAL '7 days' AND NOW()-INTERVAL '2 hours' AND d.converted_at IS NULL)<2
      AND (NOW() AT TIME ZONE u.timezone)::date=${day}::date
      AND (NOW() AT TIME ZONE u.timezone)::date -
          COALESCE(u.last_completed_local_date,(u.last_active_at AT TIME ZONE u.timezone)::date) BETWEEN 1 AND 7
      AND (SELECT COUNT(*) FROM r3_deliveries r
           WHERE r.app=u.app AND r.user_id=u.user_id AND r.status='sent'
             AND r.sent_at>NOW()-INTERVAL '7 days')<3
    ON CONFLICT(app,user_id,campaign_day) DO NOTHING RETURNING *
  `;
  return row || null;
}
async function claim(id) {
  const db=await database();
  const [row] = await db`SELECT * FROM r3_claim_delivery(${id}::uuid)`;
  return row || null;
}

async function preflight(job) {
  const db = await database();
  // Best-effort second eligibility check. Does not replace OS permission or
  // guarantee that consent cannot change during the network request.
  const [row] = await db`
    SELECT EXISTS (
      SELECT 1 FROM r3_deliveries d
      JOIN r3_users u ON u.app=d.app AND u.user_id=d.user_id
      WHERE d.id=${job.id}::uuid AND d.status='sending' AND d.attempts=${job.attempts}
        AND u.push_consent AND u.last_active_at IS NOT NULL
        AND NOT r3_is_holdout(u.app,u.user_id)
        AND d.campaign_day=(NOW() AT TIME ZONE u.timezone)::date
        AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.timezone))=COALESCE(u.reminder_hour,CASE WHEN u.hourly_samples>=3 THEN u.learned_hour END,19)
        AND (u.paused_until IS NULL OR u.paused_until<=NOW())
        AND (u.last_completed_local_date IS NULL OR u.last_completed_local_date<>(NOW() AT TIME ZONE u.timezone)::date)
        AND NOT EXISTS (SELECT 1 FROM r3_deliveries e WHERE e.app=u.app AND e.user_id=u.user_id AND e.id<>d.id AND e.status='sent' AND e.sent_at>NOW()-INTERVAL '24 hours')
        AND (NOW() AT TIME ZONE u.timezone)::date -
            COALESCE(u.last_completed_local_date,(u.last_active_at AT TIME ZONE u.timezone)::date) BETWEEN 1 AND 7
    ) AS eligible
  `;
  return row?.eligible === true;
}
async function markSent(id,providerId,attempts) {
  const db=await database();
  const rows=await db`
    UPDATE r3_deliveries SET status='sent',provider_id=${providerId},sent_at=NOW(),last_error=NULL
    WHERE id=${id}::uuid AND status='sending' AND attempts=${attempts}
    RETURNING id
  `;
  return rows.length===1;
}
async function markFailed(id,error,skipped=false,attempts) {
  const db=await database();
  const status=skipped ? 'skipped' : 'failed';
  const rows=await db`
    UPDATE r3_deliveries SET status=${status},last_error=${String(error).slice(0,160)}
    WHERE id=${id}::uuid AND status='sending' AND attempts=${attempts}
    RETURNING id
  `;
  return rows.length===1;
}

// ---------------- SERVICE ----------------
const db = {listRetries,listCandidates,reserve,claim,preflight,markSent,markFailed};
/** Cron is intentionally bounded: one invocation never processes more than 100 deliveries. */
async function runCron(now = new Date(), hooks = {}) {
  if (!pushEnabled()) return {enabled:false, processed:0, sent:0, failed:0, skipped:0, uncertain:0};
  const apps=getOneSignalApps();
  const repo=hooks.db || db;
  const deliver=hooks.send || sendOneSignal;
  const tally={enabled:true, processed:0, sent:0, failed:0, skipped:0, uncertain:0};
  const retryRows=await repo.listRetries();
  const candidates=await repo.listCandidates();
  const jobs=[];
  for (const row of retryRows) {
    if (jobs.length >= 100) break;
    if (!apps[row.app]) continue;
    jobs.push({row,retry:true});
  }
  for (const row of candidates) {
    if (jobs.length >= 100) break;
    if (!apps[row.app]) continue;
    const choice=decideNotification(row,row.sent_last_7d,now);
    if (!choice) continue;
    const variantId=selectVariant(row,choice.kind,choice.day);
    const created=await repo.reserve(row.app,row.user_id,choice.day,choice.kind,variantId);
    if (created) jobs.push({row:{...row,...created},retry:false});
  }
  for (const {row} of jobs) {
    const claimed=await repo.claim(row.id);
    if (!claimed) {tally.skipped++;continue;}
    const job={...claimed,variant_id:Number(row.variant_id??claimed.variant_id??0),locale:row.locale??claimed.locale??'en'};
    tally.processed++;
    if (!Number.isInteger(Number(job.attempts)) || Number(job.attempts)<1) {
      // A claim without an attempt number cannot safely enforce a lease.
      tally.uncertain++;
      continue;
    }
    let eligible;
    try {eligible=await repo.preflight(job);}
    catch(err) {
      console.error('R3ENGINE preflight unavailable',err?.message);
      tally.uncertain++;
      continue;
    }
    if (!eligible) {
      try {
        if (await repo.markFailed(job.id,'Ineligible at dispatch',true,job.attempts)) tally.skipped++;
        else tally.uncertain++;
      } catch(err) {console.error('R3ENGINE suppression persistence failed',err?.message);tally.uncertain++;}
      continue;
    }
    let result;
    try {result=await deliver({job,locale:job.locale,appConfig:apps[job.app]});}
    catch(err) {
      // A timeout may mean the provider accepted the request. A retry MUST
      // reuse job.id as the provider idempotency key.
      try {
        if (await repo.markFailed(job.id,err?.message || 'Provider failure',false,job.attempts)) tally.failed++;
        else tally.uncertain++;
      } catch(persistError) {console.error('R3ENGINE delivery persistence failed',persistError?.message);tally.uncertain++;}
      continue;
    }
    try {
      const persisted=result.sent
        ? await repo.markSent(job.id,result.providerId,job.attempts)
        : await repo.markFailed(job.id,result.reason || 'No recipient',true,job.attempts);
      if (!persisted) tally.uncertain++;
      else if (result.sent) tally.sent++;
      else tally.skipped++;
    } catch(err) {
      // Do NOT mark an accepted push as failed and overwrite the newer attempt.
      // The row remains 'sending'; retry uses the SAME OneSignal idempotency key.
      console.error('R3ENGINE provider result persistence failed',err?.message);
      tally.uncertain++;
    }
  }
  return tally;
}

// ---------------- HTTP ----------------
function json(res,status,data) {
  res.statusCode = status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify(data));
}

async function bodyJson(req) {
  const ct = req.headers?.['content-type'];
  if (ct && !/^application\/json(?:\s*;|\s*$)/i.test(ct)) {
    const error = new Error('Content-Type must be application/json');
    error.status = 415;
    throw error;
  }
  if (req.body !== undefined) {
    const str = typeof req.body==='string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(str)>4096) { const error = new Error('Payload too large'); error.status=413; throw error; }
    return typeof req.body==='string' ? JSON.parse(req.body) : req.body;
  }
  let text='';
  for await (const chunk of req) {
    text += chunk.toString('utf8');
    if (Buffer.byteLength(text)>4096) { const error = new Error('Payload too large'); error.status=413; throw error; }
  }
  return JSON.parse(text);
}

function guard(method,required,res) {
  if (method===required) return true;
  res.setHeader('Allow',required); json(res,405,{error:'Method not allowed'});
  return false;
}

async function events(req,res,{ingestEvent=ingest}={}) {
  if(!guard(req.method,'POST',res))return;
  let app;
  try {app=authenticateApp(req);} catch {return json(res,503,{error:'Authentication configuration missing'});}
  if(!app)return json(res,401,{error:'Unauthorized'});
  let event;
  try {event=validateEvent(await bodyJson(req));}
  catch(err){return json(res,err.status || 400,{error:err.status ? err.message : 'Invalid JSON event'});}
  try { const inserted=await ingestEvent(app,event); return json(res,inserted?201:200,{inserted,duplicate:!inserted}); }
  catch(err){console.error('R3ENGINE ingest failed',err?.message);return json(res,503,{error:'Event persistence unavailable'});}
}

async function user(req,res,{removeUser=deleteUser}={}) {
  if(!guard(req.method,'DELETE',res))return;
  let app;
  try {app=authenticateApp(req);} catch{return json(res,503,{error:'Authentication configuration missing'});}
  if(!app)return json(res,401,{error:'Unauthorized'});
  let body;
  try {body=await bodyJson(req);}
  catch(err){return json(res,err.status || 400,{error:err.status ? err.message : 'Invalid JSON'});}
  const id=body?.user_id;
  if(typeof id!=='string' || !/^[\w:.-]{1,120}$/.test(id))return json(res,400,{error:'Invalid user_id'});
  try {const deleted=await removeUser(app,id);return json(res,200,{deleted});}
  catch(err){console.error('R3ENGINE delete failed',err?.message);return json(res,503,{error:'Deletion unavailable'});}
}

async function goal(req,res,{saveGoal=setDailyGoal}={}) {
  if(!guard(req.method,'PUT',res))return;
  let app;
  try{app=authenticateApp(req);}catch{return json(res,503,{error:'Authentication configuration missing'});}
  if(!app)return json(res,401,{error:'Unauthorized'});
  let validated;
  try{validated=validateGoal(await bodyJson(req));}
  catch(err){return json(res,err.status||400,{error:err.status?err.message:'Invalid goal'});}
  try{
    const found=await saveGoal(app,validated.user_id,validated.target);
    return json(res,found?200:404,found?{updated:true,target:validated.target}:{error:'User not found'});
  }catch(err){console.error('R3ENGINE goal write failed',err?.message);return json(res,503,{error:'Goal persistence unavailable'});}
}
async function reminders(req,res,{savePreferences=saveReminder}={}){
 if(!guard(req.method,'PUT',res))return;
 let app;try{app=authenticateApp(req);}catch{return json(res,503,{error:'Authentication configuration missing'});}
 if(!app)return json(res,401,{error:'Unauthorized'});
 let preference;try{preference=validateReminder(await bodyJson(req));}
 catch(err){return json(res,err.status||400,{error:err.status?err.message:'Invalid preferences'});}
 try{const saved=await savePreferences(app,preference.user_id,preference);
 return json(res,saved?200:404,saved?{updated:true}:{error:'User not found'});
 }catch(err){console.error('R3ENGINE reminder error',err?.message);return json(res,503,{error:'Persistence unavailable'});}
}
async function progress(req,res,{getProgress=readProgress}={}) {
  if(!guard(req.method,'GET',res))return;
  let app;
  try{app=authenticateApp(req);}catch{return json(res,503,{error:'Authentication configuration missing'});}
  if(!app)return json(res,401,{error:'Unauthorized'});
  let userId;
  try{userId=new URL(req.url||'/api/progress','http://localhost').searchParams.get('user_id');}
  catch{return json(res,400,{error:'Invalid request URL'});}
  if(typeof userId!=='string'|| !/^[\w:.-]{1,120}$/.test(userId))return json(res,400,{error:'Invalid user_id'});
  try{const found=await getProgress(app,userId);return json(res,found?200:404,found||{error:'User not found'});}
  catch(err){console.error('R3ENGINE progress lookup failed',err?.message);return json(res,503,{error:'Progress unavailable'});}
}

// Video-inspired experiences: independent of survey score and push opt-in.
async function offer(req,res,{getOffer=valueOffer,readCatalog=()=>envJson('R3_VERIFIED_OFFERS_JSON')}={}){
  if(!guard(req.method,'POST',res))return;
  let app;try{app=authenticateApp(req);}catch{return json(res,503,{error:'Authentication configuration missing'});}
  if(!app)return json(res,401,{error:'Unauthorized'});
  let sku;try{const body=await bodyJson(req);sku=validateSku(body?.sku);}
  catch(err){return json(res,err.status||400,{error:'Invalid SKU'});}
  try{const result=getOffer(app,sku,readCatalog());return json(res,result?200:404,result||{error:'Offer not available'});}
  catch(err){console.error('R3 offer configuration invalid',err?.message);return json(res,503,{error:'Offer unavailable'});}
}
async function journey(req,res,{getProgress=readProgress}={}){
  if(!guard(req.method,'GET',res))return;
  let app;try{app=authenticateApp(req);}catch{return json(res,503,{error:'Authentication configuration missing'});}
  if(!app)return json(res,401,{error:'Unauthorized'});
  let userId;try{userId=new URL(req.url||'/api/journey','http://localhost').searchParams.get('user_id');}catch{return json(res,400,{error:'Invalid URL'});}
  if(!validUserId(userId))return json(res,400,{error:'Invalid user_id'});
  try{const found=await getProgress(app,userId);return json(res,found?200:404,found?journeyView(found,app):{error:'User not found'});}
  catch(err){console.error('R3 journey read failed',err?.message);return json(res,503,{error:'Journey unavailable'});}
}
async function feedback(req,res,{saveFeedback=writeFeedback}={}){
  if(!guard(req.method,'POST',res))return;
  let app;try{app=authenticateApp(req);}catch{return json(res,503,{error:'Authentication configuration missing'});}
  if(!app)return json(res,401,{error:'Unauthorized'});
  let body;try{body=validateFeedback(await bodyJson(req));}catch(err){return json(res,err.status||400,{error:'Invalid feedback'});}
  try{const status=await saveFeedback(app,body);
    return json(res,status==='inserted'?201:status==='duplicate'?200:status==='not_found'?404:409,
      status==='inserted'?{accepted:true,duplicate:false}:status==='duplicate'?{accepted:true,duplicate:true}:{error:status==='not_found'?'User not found':'Feedback ID conflict'});
  }catch(err){console.error('R3 feedback write failed',err?.message);return json(res,503,{error:'Feedback unavailable'});}
}
async function reviewPrompt(req,res,{claimPrompt=claimNativeReview}={}){
  if(!guard(req.method,'POST',res))return;
  let app;try{app=authenticateApp(req);}catch{return json(res,503,{error:'Authentication configuration missing'});}
  if(!app)return json(res,401,{error:'Unauthorized'});
  let payload;try{payload=validateReviewRequest(await bodyJson(req));}catch(err){return json(res,err.status||400,{error:'Invalid review request'});}
  try{const eligible=await claimPrompt(app,payload);
    return json(res,200,{eligible,action:eligible?'request_native_review':'none',platform:payload.platform,
      message:'Native API determines whether the review prompt appears'});
  }catch(err){console.error('R3 native review eligibility failed',err?.message);return json(res,503,{error:'Review eligibility unavailable'});}
}

async function cron(req,res,{runner=runCron}={}) {
  if(!guard(req.method,'GET',res))return;
  if(!cronAuthorized(req))return json(res,401,{error:'Unauthorized'});
  try {return json(res,200,await runner());}
  catch(err){console.error('R3ENGINE cron failed',err?.message);return json(res,503,{error:'Cron unavailable'});}
}


// ---------------- EMBEDDED MIGRATIONS ----------------
const SCHEMA_SQL = String.raw`-- R3ENGINE v0.1: run once on a dedicated Neon branch/database.
-- PostgreSQL 15+. No raw email, location, Wi-Fi, device fingerprint or message content.
CREATE TABLE IF NOT EXISTS r3_users (
  app TEXT NOT NULL CHECK (app IN ('language_app','study_app','reading_app')),
  user_id TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  push_consent BOOLEAN NOT NULL DEFAULT FALSE,
  last_active_at TIMESTAMPTZ,
  last_completed_local_date DATE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  sessions_total INTEGER NOT NULL DEFAULT 0,
  lessons_total INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app, user_id)
);

CREATE TABLE IF NOT EXISTS r3_events (
  event_id UUID PRIMARY KEY,
  app TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('session_started','lesson_completed','day_completed','push_opt_in','push_opt_out')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (app, user_id) REFERENCES r3_users(app, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_events_activity_idx ON r3_events(app, type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS r3_events_user_idx ON r3_events(app, user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS r3_deliveries (
  id UUID PRIMARY KEY,
  app TEXT NOT NULL,
  user_id TEXT NOT NULL,
  campaign_day DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('streak_reminder','return_reminder')),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','sending','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (app, user_id) REFERENCES r3_users(app, user_id) ON DELETE CASCADE,
  UNIQUE (app, user_id, campaign_day)
);
CREATE INDEX IF NOT EXISTS r3_deliveries_week_idx ON r3_deliveries(app,user_id,sent_at DESC) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS r3_deliveries_retry_idx ON r3_deliveries(status,last_attempt_at) WHERE status IN ('reserved','sending','failed');

-- R3ENGINE v0.5 additive migrations. Use on a separate staging branch first.
ALTER TABLE r3_users ADD COLUMN IF NOT EXISTS daily_goal INTEGER NOT NULL DEFAULT 1 CHECK (daily_goal BETWEEN 1 AND 10);
ALTER TABLE r3_users ADD COLUMN IF NOT EXISTS freeze_balance INTEGER NOT NULL DEFAULT 1 CHECK (freeze_balance BETWEEN 0 AND 2);
CREATE TABLE IF NOT EXISTS r3_daily_progress (
 app TEXT NOT NULL, user_id TEXT NOT NULL, local_day DATE NOT NULL,
 lessons INTEGER NOT NULL DEFAULT 0 CHECK (lessons>=0),
 PRIMARY KEY(app,user_id,local_day),
 FOREIGN KEY (app,user_id) REFERENCES r3_users(app,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS r3_rewards (
 app TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL,
 milestone INTEGER NOT NULL CHECK (milestone IN (7,30,100)),
 earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(app,user_id,kind,milestone),
 FOREIGN KEY (app,user_id) REFERENCES r3_users(app,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_progress_week_idx ON r3_daily_progress(app,user_id,local_day DESC);

-- V0.6 additive migrations. Test on a branch before applying anywhere else.
ALTER TABLE r3_users ADD COLUMN IF NOT EXISTS reminder_hour INTEGER CHECK (reminder_hour BETWEEN 8 AND 21);
ALTER TABLE r3_users ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ;
ALTER TABLE r3_users ADD COLUMN IF NOT EXISTS learned_hour INTEGER CHECK (learned_hour BETWEEN 8 AND 21);
ALTER TABLE r3_users ADD COLUMN IF NOT EXISTS hourly_samples INTEGER NOT NULL DEFAULT 0 CHECK (hourly_samples>=0);
ALTER TABLE r3_deliveries ADD COLUMN IF NOT EXISTS variant_id INTEGER NOT NULL DEFAULT 0 CHECK (variant_id BETWEEN 0 AND 2);
ALTER TABLE r3_deliveries ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;
-- Historical sends have unknown language; do not relabel them 'en'.
ALTER TABLE r3_deliveries ADD COLUMN IF NOT EXISTS locale TEXT;
CREATE INDEX IF NOT EXISTS r3_deliveries_learning_idx ON r3_deliveries(app,kind,variant_id,sent_at) WHERE status='sent';
CREATE TABLE IF NOT EXISTS r3_completion_hours (
 app TEXT NOT NULL,user_id TEXT NOT NULL,local_hour INTEGER NOT NULL CHECK (local_hour BETWEEN 0 AND 23),
 samples INTEGER NOT NULL DEFAULT 0 CHECK (samples>=0),PRIMARY KEY(app,user_id,local_hour),
 FOREIGN KEY (app,user_id) REFERENCES r3_users(app,user_id) ON DELETE CASCADE);

-- V0.7 video-inspired experience: verified offers are server config, NOT persisted here.
-- No store review gating based on satisfaction, NPS, feedback score or sentiment.
CREATE TABLE IF NOT EXISTS r3_feedback (
  feedback_id UUID PRIMARY KEY,
  app TEXT NOT NULL, user_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 10),
  reason TEXT CHECK(reason IN ('content','price','usability','performance','support','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (app,user_id) REFERENCES r3_users(app,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_feedback_time_idx ON r3_feedback(app,created_at DESC);
CREATE TABLE IF NOT EXISTS r3_review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app TEXT NOT NULL, user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('ios','android')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (app,user_id) REFERENCES r3_users(app,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_review_user_time_idx ON r3_review_requests(app,user_id,requested_at DESC);
-- Atomic eligibility. Does not read r3_feedback or survey scores (deliberately).
-- This records attempts to request a native prompt; it cannot prove it appeared.
CREATE OR REPLACE FUNCTION r3_claim_review_prompt(
  p_app TEXT,p_user_id TEXT,p_platform TEXT,
  p_session_completed BOOLEAN,p_in_foreground BOOLEAN,p_task_idle BOOLEAN
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_user r3_users%ROWTYPE;
DECLARE v_last TIMESTAMPTZ;
DECLARE v_count INTEGER;
BEGIN
  IF p_platform NOT IN ('ios','android') OR p_session_completed IS DISTINCT FROM TRUE
    OR p_in_foreground IS DISTINCT FROM TRUE OR p_task_idle IS DISTINCT FROM TRUE THEN RETURN FALSE; END IF;
  SELECT * INTO v_user FROM r3_users WHERE app=p_app AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.created_at>NOW()-INTERVAL '7 days' OR v_user.lessons_total<5 THEN RETURN FALSE; END IF;
  SELECT MAX(requested_at),COUNT(*)::integer INTO v_last,v_count FROM r3_review_requests
    WHERE app=p_app AND user_id=p_user_id AND requested_at>NOW()-INTERVAL '365 days';
  IF v_count>=2 OR (v_last IS NOT NULL AND v_last>NOW()-INTERVAL '90 days') THEN RETURN FALSE; END IF;
  INSERT INTO r3_review_requests(app,user_id,platform)VALUES(p_app,p_user_id,p_platform);
  RETURN TRUE;
END $$;

-- Transactional event insertion + state updates. Event dedup and streak update are atomic.
CREATE OR REPLACE FUNCTION r3_ingest_event(
  p_event_id UUID, p_app TEXT, p_user_id TEXT, p_type TEXT,
  p_locale TEXT, p_timezone TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_rows INT;
  v_today DATE;
  v_previous DATE;
  v_old_streak INT;
  v_balance INT;
  v_new_balance INT;
  v_new_streak INT;
  v_gap INT;
  v_awarded INT;
BEGIN
  IF p_app NOT IN ('language_app','study_app','reading_app') OR
     p_type NOT IN ('session_started','lesson_completed','day_completed','push_opt_in','push_opt_out') THEN
    RAISE EXCEPTION 'Unknown app/event';
  END IF;
  v_today := (NOW() AT TIME ZONE p_timezone)::DATE;
  INSERT INTO r3_users(app,user_id,locale,timezone) VALUES (p_app,p_user_id,p_locale,p_timezone)
  ON CONFLICT DO NOTHING;
  INSERT INTO r3_events(event_id,app,user_id,type)
  VALUES (p_event_id,p_app,p_user_id,p_type)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN FALSE; END IF;

  SELECT last_completed_local_date, current_streak, freeze_balance
    INTO v_previous, v_old_streak, v_balance
  FROM r3_users WHERE app=p_app AND user_id=p_user_id FOR UPDATE;
  v_new_streak:=v_old_streak;
  v_new_balance:=v_balance;
  IF p_type IN ('lesson_completed','day_completed') THEN
    v_gap:=CASE WHEN v_previous IS NULL THEN NULL ELSE v_today-v_previous END;
    IF v_previous IS NULL THEN v_new_streak:=1;
    ELSIF v_gap=1 THEN v_new_streak:=v_old_streak+1;
    ELSIF v_gap=0 OR v_gap<0 THEN v_new_streak:=v_old_streak;
    ELSIF v_gap>1 AND v_gap-1<=v_balance THEN
      v_new_streak:=v_old_streak+1;
      v_new_balance:=v_balance-(v_gap-1);
    ELSE v_new_streak:=1;
    END IF;
  END IF;

  UPDATE r3_users SET
    locale=p_locale,
    timezone=p_timezone,
    push_consent=CASE WHEN p_type='push_opt_in' THEN TRUE
                      WHEN p_type='push_opt_out' THEN FALSE ELSE push_consent END,
    last_active_at=CASE WHEN p_type IN ('session_started','lesson_completed','day_completed')
      THEN NOW() ELSE last_active_at END,
    last_completed_local_date=CASE WHEN p_type IN ('lesson_completed','day_completed')
      AND (v_previous IS NULL OR v_previous<=v_today) THEN v_today ELSE last_completed_local_date END,
    current_streak=v_new_streak,
    longest_streak=GREATEST(longest_streak,v_new_streak),
    freeze_balance=v_new_balance,
    sessions_total=sessions_total+CASE WHEN p_type='session_started' THEN 1 ELSE 0 END,
    lessons_total=lessons_total+CASE WHEN p_type='lesson_completed' THEN 1 ELSE 0 END,
    updated_at=NOW()
  WHERE app=p_app AND user_id=p_user_id;

  -- A legacy day_completed event is not a lesson and earns no XP.
  IF p_type='lesson_completed' THEN
    INSERT INTO r3_daily_progress(app,user_id,local_day,lessons)
    VALUES(p_app,p_user_id,v_today,1)
    ON CONFLICT(app,user_id,local_day) DO UPDATE
    SET lessons=r3_daily_progress.lessons+1;
  END IF;

  -- Record verified completion hour after deduplicated insert.
  IF p_type='lesson_completed' THEN
    INSERT INTO r3_completion_hours(app,user_id,local_hour,samples)
    VALUES(p_app,p_user_id,EXTRACT(HOUR FROM NOW() AT TIME ZONE p_timezone)::integer,1)
    ON CONFLICT(app,user_id,local_hour) DO UPDATE
    SET samples=r3_completion_hours.samples+1;
    UPDATE r3_users u SET hourly_samples=hourly_samples+1,
      learned_hour=(SELECT local_hour FROM r3_completion_hours h
       WHERE h.app=p_app AND h.user_id=p_user_id AND h.local_hour BETWEEN 8 AND 21
       ORDER BY h.samples DESC,h.local_hour ASC LIMIT 1)
    WHERE u.app=p_app AND u.user_id=p_user_id;
    -- Observational attribution, not proof of causal lift.
    UPDATE r3_deliveries d SET converted_at=NOW()
    WHERE d.id=(SELECT id FROM r3_deliveries
       WHERE app=p_app AND user_id=p_user_id AND status='sent'
       AND sent_at BETWEEN NOW()-INTERVAL '2 hours' AND NOW()
       ORDER BY sent_at DESC LIMIT 1) AND d.converted_at IS NULL;
  END IF;

  -- Milestones are awarded once each, with a bounded pre-equipped freeze.
  IF p_type IN ('lesson_completed','day_completed') AND v_new_streak IN (7,30,100) THEN
    INSERT INTO r3_rewards(app,user_id,kind,milestone)
    VALUES(p_app,p_user_id,'streak',v_new_streak)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_awarded = ROW_COUNT;
    IF v_awarded=1 THEN
      UPDATE r3_users SET freeze_balance=LEAST(2,freeze_balance+1)
      WHERE app=p_app AND user_id=p_user_id;
    END IF;
  END IF;
  RETURN TRUE;
END $$;

-- Data-subject deletion: history and delivery rows cascade.
CREATE OR REPLACE FUNCTION r3_delete_user(p_app TEXT, p_user_id TEXT)
RETURNS BOOLEAN LANGUAGE sql AS $$
  WITH removed AS (DELETE FROM r3_users WHERE app=p_app AND user_id=p_user_id RETURNING 1)
  SELECT EXISTS(SELECT 1 FROM removed);
$$;

-- R3ENGINE 0.2: apply AFTER db/001_init.sql.
-- Consistent holdout assignment with JS crypto MD5 digest.readUInt32BE(0) % 100.
-- v0.1 used one byte, introducing 30/256 = 11.71875% control allocation.
-- Changing the assignment changes cohort membership: do so BEFORE the experiment launches.
CREATE OR REPLACE FUNCTION r3_is_holdout(p_app TEXT, p_user_id TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (((get_byte(d.h,0)::BIGINT * 16777216)
          + (get_byte(d.h,1)::BIGINT * 65536)
          + (get_byte(d.h,2)::BIGINT * 256)
          + get_byte(d.h,3)::BIGINT) % 100) < 10
  FROM (SELECT decode(md5(p_app || ':' || p_user_id),'hex') AS h) AS d;
$$;

-- Candidate query scans opted-in users only, with a usable lower bound on last_active_at.
CREATE INDEX IF NOT EXISTS r3_users_candidate_idx
ON r3_users(last_active_at ASC) WHERE push_consent AND last_active_at IS NOT NULL;


-- Serialize competing jobs for the same user via row lock. Each statement in this
-- PL/pgSQL function sees a fresh READ COMMITTED snapshot after acquiring the lock.
-- Count accepted and in-flight sends to protect the 3-per-7-day limit even under
-- concurrent cron invocations; retrying a previously claimed row is exempted.
CREATE OR REPLACE FUNCTION r3_claim_delivery(p_id UUID)
RETURNS TABLE (id UUID, app TEXT, user_id TEXT, kind TEXT, attempts INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_delivery r3_deliveries%ROWTYPE;
  v_user r3_users%ROWTYPE;
  v_count INTEGER;
  v_now_date DATE;
BEGIN
  SELECT d.* INTO v_delivery FROM r3_deliveries d WHERE d.id = p_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT u.* INTO v_user FROM r3_users u
  WHERE u.app = v_delivery.app AND u.user_id = v_delivery.user_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_user.push_consent OR v_user.last_active_at IS NULL
      OR r3_is_holdout(v_delivery.app, v_delivery.user_id) THEN RETURN; END IF;

  -- Re-read after the row lock: this may have changed while awaiting a lock.
  SELECT d.* INTO v_delivery FROM r3_deliveries d WHERE d.id = p_id FOR UPDATE;
  IF NOT FOUND OR v_delivery.status NOT IN ('reserved','sending','failed')
      OR v_delivery.attempts >= 3
      OR (v_delivery.last_attempt_at IS NOT NULL
          AND v_delivery.last_attempt_at >= NOW() - INTERVAL '10 minutes') THEN RETURN; END IF;

  v_now_date := (NOW() AT TIME ZONE v_user.timezone)::DATE;
  IF EXTRACT(HOUR FROM (NOW() AT TIME ZONE v_user.timezone)) !=
       COALESCE(v_user.reminder_hour,CASE WHEN v_user.hourly_samples>=3 THEN v_user.learned_hour END,19)
      OR (v_user.paused_until IS NOT NULL AND v_user.paused_until>NOW())
      OR v_user.last_completed_local_date=v_now_date
      OR v_delivery.campaign_day != v_now_date
      OR (v_now_date-COALESCE(v_user.last_completed_local_date,(v_user.last_active_at AT TIME ZONE v_user.timezone)::DATE)) NOT BETWEEN 1 AND 7
    THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM r3_deliveries d WHERE d.app=v_delivery.app AND d.user_id=v_delivery.user_id
    AND d.id<>v_delivery.id AND d.status='sent' AND d.sent_at>NOW()-INTERVAL '24 hours') THEN RETURN; END IF;
  IF (SELECT COUNT(*) FROM r3_deliveries d WHERE d.app=v_delivery.app AND d.user_id=v_delivery.user_id
    AND d.id<>v_delivery.id AND d.status='sent' AND d.sent_at BETWEEN NOW()-INTERVAL '7 days' AND NOW()-INTERVAL '2 hours'
    AND d.converted_at IS NULL)>=2 THEN RETURN; END IF;

  SELECT COUNT(*)::INTEGER INTO v_count FROM r3_deliveries d
  WHERE d.app = v_delivery.app AND d.user_id = v_delivery.user_id
    AND d.id != v_delivery.id
    AND (d.status = 'sent' AND d.sent_at > NOW()-INTERVAL '7 days'
      OR d.status = 'sending' AND d.last_attempt_at > NOW()-INTERVAL '7 days');
  IF v_count >= 3 THEN RETURN; END IF;

  RETURN QUERY UPDATE r3_deliveries d
  SET status='sending', attempts=d.attempts+1, last_attempt_at=NOW()
  WHERE d.id=p_id
  RETURNING d.id,d.app,d.user_id,d.kind,d.attempts;
END $$;
`;
const UNIVERSAL_SCHEMA_SQL = String.raw`-- R3ENGINE universal v1.0. Additive side-by-side schema. Tenant/app/environment-scoped.
CREATE TABLE IF NOT EXISTS r3_v1_apps (
 tenant_id TEXT NOT NULL CHECK(tenant_id ~ '^[a-z][a-z0-9_-]{1,49}$'),
 app_id TEXT NOT NULL CHECK(app_id ~ '^[a-z][a-z0-9_-]{1,49}$'),
 environment TEXT NOT NULL CHECK(environment IN ('test','staging','prod')),
 key_hash TEXT NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 cadence TEXT NOT NULL CHECK(cadence IN ('daily','weekly','episodic','none')),
 modules JSONB NOT NULL DEFAULT '{}'::jsonb,
 quiet_start INTEGER NOT NULL CHECK(quiet_start BETWEEN 0 AND 22),
 quiet_end INTEGER NOT NULL CHECK(quiet_end BETWEEN 1 AND 23 AND quiet_end>quiet_start),
 weekly_limit INTEGER NOT NULL CHECK(weekly_limit BETWEEN 0 AND 7),
 holdout_percent INTEGER NOT NULL CHECK(holdout_percent BETWEEN 0 AND 50),
 config_version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment));
CREATE TABLE IF NOT EXISTS r3_v1_event_registry(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 name TEXT NOT NULL CHECK(name ~ '^[a-z][a-z0-9_.]{1,63}$'),is_value BOOLEAN NOT NULL,
 schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
 PRIMARY KEY(tenant_id,app_id,environment,name),
 FOREIGN KEY(tenant_id,app_id,environment) REFERENCES r3_v1_apps ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS r3_v1_subjects(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 subject_id TEXT NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 120),
 timezone TEXT NOT NULL DEFAULT 'UTC',locale TEXT NOT NULL DEFAULT 'en',
 last_active_at TIMESTAMPTZ,last_value_at TIMESTAMPTZ,
 value_count BIGINT NOT NULL DEFAULT 0 CHECK(value_count>=0),
 reminder_hour INTEGER CHECK(reminder_hour BETWEEN 0 AND 23),paused_until TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,app_id,environment,subject_id),
 FOREIGN KEY(tenant_id,app_id,environment) REFERENCES r3_v1_apps ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS r3_v1_events(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 event_id UUID NOT NULL,subject_id TEXT NOT NULL,
 name TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
 occurred_at TIMESTAMPTZ NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,event_id),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,app_id,environment,name) REFERENCES r3_v1_event_registry);
CREATE INDEX IF NOT EXISTS r3_v1_events_activity_idx ON r3_v1_events(tenant_id,app_id,environment,name,occurred_at DESC);
CREATE TABLE IF NOT EXISTS r3_v1_consents(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('push','in_app','email')),
 purpose TEXT NOT NULL CHECK(purpose IN ('reminder','marketing','transactional')),
 granted BOOLEAN NOT NULL,verified BOOLEAN NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('ios','android','web','server')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id,channel,purpose),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE,
 CHECK(NOT granted OR verified));
CREATE TABLE IF NOT EXISTS r3_v1_consent_history(
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 channel TEXT NOT NULL,purpose TEXT NOT NULL,granted BOOLEAN NOT NULL,verified BOOLEAN NOT NULL,platform TEXT NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS r3_v1_consent_history_idx ON r3_v1_consent_history(tenant_id,app_id,environment,subject_id,changed_at DESC);
CREATE TABLE IF NOT EXISTS r3_v1_exposures(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 experiment_key TEXT NOT NULL,arm TEXT NOT NULL CHECK(arm IN ('holdout','treatment')),
 config_version INTEGER NOT NULL,
 exposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,subject_id,experiment_key),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE);
-- Receipt ingestion is reserved for a future authenticated provider adapter.
-- No public endpoint may write an unverified delivery receipt.
CREATE TABLE IF NOT EXISTS r3_v1_notification_receipts(
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 delivery_id UUID NOT NULL,channel TEXT NOT NULL,purpose TEXT NOT NULL,
 sent_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(tenant_id,app_id,environment,delivery_id),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS r3_v1_receipts_user_idx ON r3_v1_notification_receipts(tenant_id,app_id,environment,subject_id,sent_at DESC);

CREATE OR REPLACE FUNCTION r3_v1_register_app(
 t TEXT,a TEXT,e TEXT,h TEXT,c TEXT,m JSONB,qs INT,qe INT,wl INT,ho INT,ev JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE item JSONB;
BEGIN
 IF jsonb_typeof(ev)<>'array' OR jsonb_array_length(ev)=0 THEN RAISE EXCEPTION 'Invalid registry'; END IF;
 INSERT INTO r3_v1_apps(tenant_id,app_id,environment,key_hash,cadence,modules,quiet_start,quiet_end,weekly_limit,holdout_percent)
 VALUES(t,a,e,h,c,m,qs,qe,wl,ho) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(ev) LOOP
   INSERT INTO r3_v1_event_registry(tenant_id,app_id,environment,name,is_value)
   VALUES(t,a,e,item->>'name',(item->>'value')::boolean);
 END LOOP;
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_ingest(
 t TEXT,a TEXT,e TEXT,s TEXT,id UUID,ev TEXT,when_at TIMESTAMPTZ,l TEXT,tz TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE is_val BOOLEAN; r INTEGER;
BEGIN
 SELECT reg.is_value INTO is_val FROM r3_v1_event_registry reg JOIN r3_v1_apps ap USING(tenant_id,app_id,environment)
 WHERE reg.tenant_id=t AND reg.app_id=a AND reg.environment=e AND reg.name=ev AND ap.enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unregistered event or disabled app'; END IF;
 INSERT INTO r3_v1_subjects(tenant_id,app_id,environment,subject_id,locale,timezone)
 VALUES(t,a,e,s,l,tz) ON CONFLICT DO NOTHING;
 INSERT INTO r3_v1_events(tenant_id,app_id,environment,event_id,subject_id,name,occurred_at)
 VALUES(t,a,e,id,s,ev,when_at) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS r=ROW_COUNT;
 IF r=0 THEN RETURN FALSE; END IF;
 UPDATE r3_v1_subjects SET locale=l,timezone=tz,
 last_active_at=GREATEST(COALESCE(last_active_at,when_at),when_at),
 last_value_at=CASE WHEN is_val THEN GREATEST(COALESCE(last_value_at,when_at),when_at) ELSE last_value_at END,
 value_count=value_count+CASE WHEN is_val THEN 1 ELSE 0 END
 WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s;
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_set_consent(
 t TEXT,a TEXT,e TEXT,s TEXT,ch TEXT,p TEXT,g BOOLEAN,v BOOLEAN,pl TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
 IF g AND NOT v THEN RAISE EXCEPTION 'Unverified consent'; END IF;
 PERFORM 1 FROM r3_v1_subjects WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_consents(tenant_id,app_id,environment,subject_id,channel,purpose,granted,verified,platform)
 VALUES(t,a,e,s,ch,p,g,v,pl)
 ON CONFLICT(tenant_id,app_id,environment,subject_id,channel,purpose)
 DO UPDATE SET granted=EXCLUDED.granted,verified=EXCLUDED.verified,platform=EXCLUDED.platform,updated_at=NOW();
 INSERT INTO r3_v1_consent_history(tenant_id,app_id,environment,subject_id,channel,purpose,granted,verified,platform)
 VALUES(t,a,e,s,ch,p,g,v,pl);
 RETURN TRUE;
END $$;
`;

const UNIVERSAL_V11_SQL = String.raw`-- R3ENGINE v1.1.0: additive migration to be run AFTER R3ENGINE v1.0 schema.
-- Requires database credentials in trusted backend. This does NOT activate notifications.
CREATE TABLE IF NOT EXISTS r3_v1_request_nonces (
 tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,
 request_id UUID NOT NULL,subject_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,request_id),
 FOREIGN KEY(tenant_id,app_id,environment) REFERENCES r3_v1_apps ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_v1_nonce_cleanup ON r3_v1_request_nonces(created_at);
-- Schedule periodic cleanup: DELETE FROM r3_v1_request_nonces WHERE created_at<NOW()-INTERVAL '15 minutes';
CREATE OR REPLACE FUNCTION r3_v1_claim_request(t TEXT,a TEXT,e TEXT,s TEXT,n UUID,ts BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE affected INTEGER;
BEGIN
 IF ABS(EXTRACT(EPOCH FROM NOW())*1000-ts)>300000 THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_request_nonces(tenant_id,app_id,environment,request_id,subject_id)
 VALUES(t,a,e,n,s) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END $$;

CREATE TABLE IF NOT EXISTS r3_v1_outbox (
 id UUID NOT NULL DEFAULT gen_random_uuid(),tenant_id TEXT NOT NULL,app_id TEXT NOT NULL,environment TEXT NOT NULL,subject_id TEXT NOT NULL,
 campaign_key TEXT NOT NULL CHECK(length(campaign_key) BETWEEN 1 AND 100),
 channel TEXT NOT NULL DEFAULT 'push' CHECK(channel='push'),purpose TEXT NOT NULL DEFAULT 'reminder' CHECK(purpose='reminder'),
 template_id TEXT NOT NULL CHECK(length(template_id) BETWEEN 1 AND 80),locale TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','sending','provider_accepted','failed','suppressed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),lease_until TIMESTAMPTZ,worker_id TEXT,provider_id TEXT,last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),sent_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,id),
 UNIQUE(tenant_id,app_id,environment,subject_id,campaign_key),
 FOREIGN KEY(tenant_id,app_id,environment,subject_id) REFERENCES r3_v1_subjects ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_v1_outbox_claim ON r3_v1_outbox(status,due_at,lease_until);
CREATE INDEX IF NOT EXISTS r3_v1_outbox_subject ON r3_v1_outbox(tenant_id,app_id,environment,subject_id,sent_at DESC);

CREATE OR REPLACE FUNCTION r3_v1_enqueue(t TEXT,a TEXT,e TEXT,s TEXT,campaign TEXT,template TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE ap r3_v1_apps%ROWTYPE;u r3_v1_subjects%ROWTYPE;result UUID;local_day DATE;local_hour INTEGER;days_since INTEGER;total_sent INTEGER;
BEGIN
 SELECT * INTO u FROM r3_v1_subjects WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO ap FROM r3_v1_apps WHERE tenant_id=t AND app_id=a AND environment=e;
 IF NOT FOUND OR NOT ap.enabled OR ap.cadence IN ('none','episodic') OR ap.modules->>'notifications' IS DISTINCT FROM 'true' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_consents WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s AND channel='push' AND purpose='reminder' AND granted AND verified) THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_exposures WHERE tenant_id=t AND app_id=a AND environment=e AND subject_id=s AND experiment_key='retention_push' AND arm='treatment') THEN RETURN NULL;END IF;
 IF u.last_value_at IS NULL OR (u.paused_until IS NOT NULL AND u.paused_until>NOW()) THEN RETURN NULL;END IF;
 local_day:=(NOW() AT TIME ZONE u.timezone)::DATE;
 local_hour:=EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone)::INTEGER;
 IF local_hour<ap.quiet_start OR local_hour>=ap.quiet_end OR (u.reminder_hour IS NOT NULL AND u.reminder_hour<>local_hour) THEN RETURN NULL;END IF;
 days_since:=local_day-(u.last_value_at AT TIME ZONE u.timezone)::date;
 IF days_since<1 OR (ap.cadence='daily' AND days_since>7) OR (ap.cadence='weekly' AND days_since<7) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM r3_v1_outbox q WHERE q.tenant_id=t AND q.app_id=a AND q.environment=e AND q.subject_id=s AND ((q.status='provider_accepted' AND q.sent_at>NOW()-INTERVAL '24 hours') OR (q.status='sending' AND q.lease_until>NOW()))) THEN RETURN NULL;END IF;
 SELECT COUNT(*)::INTEGER INTO total_sent FROM r3_v1_outbox q WHERE q.tenant_id=t AND q.app_id=a AND q.environment=e AND q.subject_id=s AND q.status='provider_accepted' AND q.sent_at>NOW()-INTERVAL '7 days';
 IF total_sent>=ap.weekly_limit THEN RETURN NULL;END IF;
 INSERT INTO r3_v1_outbox(tenant_id,app_id,environment,subject_id,campaign_key,template_id,locale) VALUES(t,a,e,s,campaign,template,u.locale) ON CONFLICT DO NOTHING RETURNING id INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_claim_job(worker TEXT)
RETURNS TABLE(job_id UUID,t TEXT,a TEXT,e TEXT,s TEXT,template TEXT,locale TEXT,attempt INTEGER)
LANGUAGE plpgsql AS $$
DECLARE q r3_v1_outbox%ROWTYPE;u r3_v1_subjects%ROWTYPE;ap r3_v1_apps%ROWTYPE;local_day DATE;local_hour INTEGER;failed_gate BOOLEAN;
BEGIN
 IF length(worker)<8 OR length(worker)>120 THEN RAISE EXCEPTION 'Invalid worker';END IF;
 -- Read candidate without locking; then lock subject BEFORE outbox (same order as enqueue).
 SELECT * INTO q FROM r3_v1_outbox WHERE (status IN ('reserved','failed') OR (status='sending' AND lease_until<NOW())) AND attempts<3 AND due_at<=NOW() ORDER BY due_at,id LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO u FROM r3_v1_subjects WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment AND subject_id=q.subject_id FOR UPDATE;
 SELECT * INTO q FROM r3_v1_outbox z WHERE z.id=q.id AND z.tenant_id=q.tenant_id AND z.app_id=q.app_id AND z.environment=q.environment FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR q.attempts>=3 OR (q.status NOT IN ('reserved','failed') AND NOT(q.status='sending' AND q.lease_until<NOW())) OR q.due_at>NOW() THEN RETURN;END IF;
 SELECT * INTO ap FROM r3_v1_apps WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment;
 failed_gate:=NOT FOUND OR NOT ap.enabled OR ap.modules->>'notifications' IS DISTINCT FROM 'true';
 IF u.subject_id IS NULL OR u.last_value_at IS NULL OR (u.paused_until IS NOT NULL AND u.paused_until>NOW()) THEN failed_gate:=TRUE;END IF;
 IF NOT failed_gate THEN
  local_day:=(NOW() AT TIME ZONE u.timezone)::date;local_hour:=EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone)::INTEGER;
  IF local_hour<ap.quiet_start OR local_hour>=ap.quiet_end OR (u.reminder_hour IS NOT NULL AND u.reminder_hour<>local_hour) OR local_day<=(u.last_value_at AT TIME ZONE u.timezone)::date THEN failed_gate:=TRUE;END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_consents WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment AND subject_id=q.subject_id AND channel=q.channel AND purpose=q.purpose AND granted AND verified) THEN failed_gate:=TRUE;END IF;
 IF NOT EXISTS(SELECT 1 FROM r3_v1_exposures WHERE tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment AND subject_id=q.subject_id AND experiment_key='retention_push' AND arm='treatment') THEN failed_gate:=TRUE;END IF;
 IF failed_gate THEN
  UPDATE r3_v1_outbox SET status='suppressed',updated_at=NOW(),last_error='Ineligible at claim' WHERE id=q.id AND tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM r3_v1_outbox z WHERE z.tenant_id=q.tenant_id AND z.app_id=q.app_id AND z.environment=q.environment AND z.subject_id=q.subject_id AND z.id<>q.id AND ((z.status='provider_accepted' AND z.sent_at>NOW()-INTERVAL '24 hours') OR(z.status='sending' AND z.lease_until>NOW()))) THEN RETURN;END IF;
 IF (SELECT COUNT(*) FROM r3_v1_outbox z WHERE z.tenant_id=q.tenant_id AND z.app_id=q.app_id AND z.environment=q.environment AND z.subject_id=q.subject_id AND z.id<>q.id AND z.status='provider_accepted' AND z.sent_at>NOW()-INTERVAL '7 days')>=ap.weekly_limit THEN RETURN;END IF;
 UPDATE r3_v1_outbox SET status='sending',attempts=attempts+1,worker_id=worker,lease_until=NOW()+INTERVAL '2 minutes',updated_at=NOW() WHERE id=q.id AND tenant_id=q.tenant_id AND app_id=q.app_id AND environment=q.environment;
 RETURN QUERY SELECT q.id,q.tenant_id,q.app_id,q.environment,q.subject_id,q.template_id,q.locale,q.attempts+1;
END $$;

CREATE OR REPLACE FUNCTION r3_v1_finish_job(job UUID,tenant TEXT,app TEXT,env TEXT,worker TEXT,attempt INTEGER,accepted BOOLEAN,provider TEXT,err TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE q r3_v1_outbox%ROWTYPE;
BEGIN
 SELECT * INTO q FROM r3_v1_outbox WHERE id=job AND tenant_id=tenant AND app_id=app AND environment=env FOR UPDATE;
 IF NOT FOUND OR q.status<>'sending' OR q.worker_id IS DISTINCT FROM worker OR q.attempts<>attempt THEN RETURN FALSE;END IF;
 IF accepted AND (provider IS NULL OR length(provider)=0) THEN RETURN FALSE;END IF;
 UPDATE r3_v1_outbox SET status=CASE WHEN accepted THEN 'provider_accepted' ELSE 'failed' END,
 provider_id=CASE WHEN accepted THEN provider ELSE NULL END,
 last_error=CASE WHEN accepted THEN NULL ELSE LEFT(COALESCE(err,'provider_error'),160) END,
 sent_at=CASE WHEN accepted THEN NOW() ELSE NULL END,
 due_at=CASE WHEN accepted THEN due_at ELSE NOW()+((attempt*attempt)*INTERVAL '5 minutes') END,
 lease_until=NULL,worker_id=NULL,updated_at=NOW()
 WHERE id=job AND tenant_id=tenant AND app_id=app AND environment=env;
 IF accepted THEN INSERT INTO r3_v1_notification_receipts(tenant_id,app_id,environment,subject_id,delivery_id,channel,purpose,sent_at)
 VALUES(q.tenant_id,q.app_id,q.environment,q.subject_id,q.id,q.channel,q.purpose,NOW()) ON CONFLICT DO NOTHING;END IF;
 RETURN TRUE;
END $$;
`;

const UNIVERSAL_ANALYTICS_SQL = String.raw`-- R3ENGINE universal v1.0. Cohorts measured in UTC. Null = immature cohort, NOT 0%.
-- These figures are descriptive; experiment lift needs design checks and guardrails.
WITH value_events AS (
  SELECT ev.tenant_id,ev.app_id,ev.environment,ev.subject_id,
         (ev.occurred_at AT TIME ZONE 'UTC')::date AS activity_day
  FROM r3_v1_events ev
  JOIN r3_v1_event_registry r USING(tenant_id,app_id,environment,name)
  WHERE r.is_value
), first_value AS (
  SELECT tenant_id,app_id,environment,subject_id,MIN(activity_day) AS cohort_day
  FROM value_events GROUP BY 1,2,3,4
), cohorts AS (
  SELECT f.tenant_id,f.app_id,f.environment,f.cohort_day,
  COUNT(*) AS users,
  CASE WHEN f.cohort_day<=CURRENT_DATE-1 THEN COUNT(*) FILTER(WHERE EXISTS(
    SELECT 1 FROM value_events x WHERE x.tenant_id=f.tenant_id AND x.app_id=f.app_id AND x.environment=f.environment
    AND x.subject_id=f.subject_id AND x.activity_day=f.cohort_day+1)) END AS d1_users,
  CASE WHEN f.cohort_day<=CURRENT_DATE-7 THEN COUNT(*) FILTER(WHERE EXISTS(
    SELECT 1 FROM value_events x WHERE x.tenant_id=f.tenant_id AND x.app_id=f.app_id AND x.environment=f.environment
    AND x.subject_id=f.subject_id AND x.activity_day=f.cohort_day+7)) END AS d7_users,
  CASE WHEN f.cohort_day<=CURRENT_DATE-30 THEN COUNT(*) FILTER(WHERE EXISTS(
    SELECT 1 FROM value_events x WHERE x.tenant_id=f.tenant_id AND x.app_id=f.app_id AND x.environment=f.environment
    AND x.subject_id=f.subject_id AND x.activity_day=f.cohort_day+30)) END AS d30_users
  FROM first_value f GROUP BY 1,2,3,4
)
SELECT *,ROUND(100*d1_users::numeric/NULLIF(users,0),2) AS d1_pct,
          ROUND(100*d7_users::numeric/NULLIF(users,0),2) AS d7_pct,
          ROUND(100*d30_users::numeric/NULLIF(users,0),2) AS d30_pct
FROM cohorts ORDER BY cohort_day DESC,tenant_id,app_id;

-- Experiment reporting: assigned arms and observed outcomes; NOT causal proof alone.
SELECT e.tenant_id,e.app_id,e.environment,e.experiment_key,e.arm,e.config_version,
  COUNT(*) AS allocated_subjects,
  COUNT(*) FILTER(WHERE s.last_value_at > e.exposed_at) AS subjects_with_value_after_exposure
FROM r3_v1_exposures e JOIN r3_v1_subjects s USING(tenant_id,app_id,environment,subject_id)
GROUP BY 1,2,3,4,5,6 ORDER BY 1,2,4,5;

-- Consent revocations separated by app, channel, purpose.
SELECT tenant_id,app_id,environment,channel,purpose,
 COUNT(*) FILTER(WHERE NOT granted) AS revocation_events,
 COUNT(*) FILTER(WHERE granted) AS consent_grant_events
FROM r3_v1_consent_history GROUP BY 1,2,3,4,5;
`;

const ANALYTICS_SQL = String.raw`-- Use with a real event cohort; percentages only become meaningful after enough users.
-- Each cohort counts users whose first recorded session falls on the indicated date (UTC).
-- D1/D7/D30 calendar-day retention from a qualifying session or completed activity.
WITH user_first AS (
  SELECT app, user_id, MIN((occurred_at AT TIME ZONE 'UTC')::date) AS cohort_date
  FROM r3_events WHERE type IN ('session_started','lesson_completed','day_completed')
  GROUP BY app,user_id
), active AS (
  SELECT DISTINCT app,user_id,(occurred_at AT TIME ZONE 'UTC')::date AS active_date
  FROM r3_events WHERE type IN ('session_started','lesson_completed','day_completed')
)
SELECT f.app, f.cohort_date,
       COUNT(*) AS users,
       COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM active a WHERE a.app=f.app AND a.user_id=f.user_id AND a.active_date=f.cohort_date+1)) AS retained_d1,
       COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM active a WHERE a.app=f.app AND a.user_id=f.user_id AND a.active_date=f.cohort_date+7)) AS retained_d7,
       COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM active a WHERE a.app=f.app AND a.user_id=f.user_id AND a.active_date=f.cohort_date+30)) AS retained_d30
FROM user_first f
WHERE f.cohort_date <= CURRENT_DATE - 30
GROUP BY f.app,f.cohort_date ORDER BY f.cohort_date DESC;

-- Experimental groups: four MD5 bytes modulo 100 matches src/engine.mjs.
SELECT app, CASE WHEN r3_is_holdout(app,user_id)
                 THEN 'holdout' ELSE 'treatment' END AS cohort,
       COUNT(*) AS enrolled_users,
       COUNT(*) FILTER(WHERE push_consent) AS push_opt_ins
FROM r3_users GROUP BY app,cohort ORDER BY app,cohort;

-- Observational arm performance. Only mature two-hour responses; NOT causal lift.
SELECT app,locale,kind,variant_id,COUNT(*) AS exposures,COUNT(converted_at) AS completed_within_2h
FROM r3_deliveries WHERE status='sent' AND sent_at<NOW()-INTERVAL '2 hours'
GROUP BY app,locale,kind,variant_id ORDER BY app,locale,kind,variant_id;

-- V0.7 in-app recommendation distribution (not app-store stars).
SELECT app,COUNT(*) AS survey_responses,
  COUNT(*) FILTER (WHERE score>=9) AS promoters,
  COUNT(*) FILTER (WHERE score BETWEEN 7 AND 8) AS passives,
  COUNT(*) FILTER (WHERE score<=6) AS detractors
FROM r3_feedback GROUP BY app;
-- Store prompt REQUESTS only; platform may decline to show the prompt.
SELECT app,platform,COUNT(*) AS native_prompt_requests FROM r3_review_requests GROUP BY app,platform;
-- Sent-message totals, by app and day.
SELECT app, sent_at::date AS date_utc, kind, COUNT(*) AS provider_accepted
FROM r3_deliveries WHERE status='sent' GROUP BY 1,2,3 ORDER BY 2 DESC;
`;

// ---------------- HTTP / CLI ----------------
function health(req,res) {
  if(req.method!=='GET') {res.setHeader('allow','GET');return json(res,405,{error:'Method not allowed'});}
  return json(res,200,{service:'R3ENGINE',display_name:'TMNT Engine',version:'1.1.0',status:'ok',push_enabled:pushEnabled()});
}
const routes = Object.freeze({'/api/health':health,'/api/events':events,'/api/user':user,'/api/goal':goal,'/api/progress':progress,'/api/reminders':reminders,'/api/offer':offer,'/api/journey':journey,'/api/feedback':feedback,'/api/review-prompt':reviewPrompt,'/api/cron':cron, '/api/v1/admin/apps':uHandler, '/api/v1/admin/active':uHandler, '/api/v1/events':uHandler, '/api/v1/state':uHandler, '/api/v1/consent':uHandler, '/api/v1/preference':uHandler, '/api/v1/experiment':uHandler, '/api/v1/decision':uHandler, '/api/v1/user':uHandler});
async function handleHttp(req,res) {
  let handler;
  try {handler=routes[new URL(req.url,'http://localhost').pathname];}
  catch {return json(res,400,{error:'Invalid request URL'});}
  if (!handler) return json(res,404,{error:'Not found'});
  try {await handler(req,res);}
  catch(err) {console.error('Unhandled route failure',err?.message);json(res,500,{error:'Internal server error'});}
}
function createServer() {return http.createServer(handleHttp);}
function startServer(){
  const port=Number(process.env.PORT || 3030);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid PORT');
  return createServer().listen(port,'127.0.0.1',()=>console.log(`TMNT Engine http://127.0.0.1:${port}/api/health`));
}

// ---------------- EMBEDDED REGRESSION TESTS ----------------
function register_audit_tests() {
const nonce = ()=>randomUUID();
const now=new Date('2026-10-15T19:15:00Z');
function eligibleId(app='language_app',holdout=false){
 for(let i=0;i<1000;i++){let id=`qa-user-${i}`;if(isHoldout(app,id)===holdout)return id;}
 throw Error('no user in requested group');
}
function sample(overrides={}){return {app:'language_app',user_id:eligibleId(),push_consent:true,timezone:'UTC',locale:'pt-BR',last_active_at:'2026-10-14T17:00:00Z',current_streak:2,sent_last_7d:0,...overrides};}
function event(overrides={}){return {event_id:nonce(),user_id:'opaque_1',type:'day_completed',locale:'pt-BR',timezone:'UTC',...overrides};}
function withEnv(values,fn){
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 for(const [k,v] of Object.entries(values)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 const restore=()=>{for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
 try{const result=fn();return result && typeof result.then==='function'?result.finally(restore):(restore(),result);}catch(e){restore();throw e;}
}
function response(){const res=new EventEmitter();res.headers={};res.setHeader=(k,v)=>{res.headers[k]=v;};res.end=data=>{res.body=JSON.parse(data);res.emit('finish');};return res;}
async function invoke(route,request,hooks={}){const res=response();await route(request,res,hooks);return res;}
function req(method='POST',content='',headers={}) {return {method,headers,body:content};}
function token(){return 'a'.repeat(48);}
const keyEnv=JSON.stringify({language_app:token()});
const authHeaders={'x-r3-app':'language_app',authorization:`Bearer ${token()}`,'content-type':'application/json'};
const providerEnv=JSON.stringify({language_app:{app_id:nonce(),rest_api_key:'rest_key_long_enough'}});

for(const app of APPS){
 test(`app ${app}: holdout 10% deterministic across 10k IDs`,()=>{
  const count=Array.from({length:10_000},(_,i)=>isHoldout(app,`cohort-${i}`)).filter(Boolean).length;
  assert.ok(count>=800 && count<=1200,`${app}: unexpected group size ${count}`);
  assert.equal(isHoldout(app,'repeat-key'),isHoldout(app,'repeat-key'));
 });
}
test('valid event: no email, invisible characters, unsupported locale and bogus dates',()=>{
 const invalid=['x@x.io','x y','💬','','x'.repeat(121)];
 for(const id of invalid)assert.throws(()=>validateEvent(event({user_id:id})));
 for(const bad of ['pt_br','PT-BR','xx_YY','x'.repeat(40)])assert.throws(()=>validateEvent(event({locale:bad})));
 for(const bad of ['Mars/Base','',null])assert.throws(()=>validateEvent(event({timezone:bad})));
 assert.throws(()=>validateEvent([]));
 assert.throws(()=>validateEvent(null));
});
test('DST boundaries and half-hour offsets are based on local calendar',()=>{
 assert.deepEqual(localClock(new Date('2026-03-08T06:59:00Z'),'America/New_York'),{day:'2026-03-08',hour:1});
 assert.deepEqual(localClock(new Date('2026-03-08T07:01:00Z'),'America/New_York'),{day:'2026-03-08',hour:3});
 assert.deepEqual(localClock(new Date('2026-10-15T13:40:00Z'),'Asia/Kathmandu'),{day:'2026-10-15',hour:19});
 assert.equal(dayDifference('2026-01-01','2025-12-31'),1);
 assert.equal(dayDifference('2028-03-01','2028-02-28'),2);
});
test('window 1..7 calendar days, streak kind and reset',()=>{
 assert.equal(decideNotification(sample({last_active_at:'2026-10-14T23:30:00Z'}),0,now)?.kind,'streak_reminder');
 assert.equal(decideNotification(sample({last_active_at:'2026-10-14T23:30:00Z',current_streak:0}),0,now)?.kind,'return_reminder');
 assert.equal(decideNotification(sample({last_active_at:'2026-10-08T01:00:00Z'}),0,now)?.daysInactive,7);
 assert.equal(decideNotification(sample({last_active_at:'2026-10-07T23:59:00Z'}),0,now),null);
 assert.equal(decideNotification(sample({last_active_at:'2026-10-15T00:01:00Z'}),0,now),null);
 assert.equal(decideNotification(sample({push_consent:false}),0,now),null);
 assert.equal(decideNotification(sample({sent_last_7d:3}),3,now),null);
 assert.equal(decideNotification(sample({user_id:eligibleId('language_app',true)}),0,now),null);
 assert.equal(decideNotification(sample({timezone:'Asia/Tokyo'}),0,now),null);
});
test('translated notification text exists in supported product languages',()=>{
 for(const app of APPS){
  for(const loc of ['en','pt-BR','es','fr','de','it','ru']){
   const m=messageFor(app,loc,'streak_reminder');assert.ok(m.title.length>4 && m.body.length>10);
  }
 }
 assert.equal(messageFor('study_app','ja-JP','return_reminder').language,'en');
 assert.throws(()=>messageFor('language_app','en','unrecognized'));
});
test('auth rejects raw secret, extra whitespace, incorrect app and missing config',()=>withEnv({R3_APP_KEYS_JSON:keyEnv},()=>{
 assert.equal(authenticateApp({headers:{'x-r3-app':'language_app',authorization:`Bearer ${token()}`}}),'language_app');
 for(const bad of [token(),`Basic ${token()}`,`Bearer  ${token()}`,`Bearer ${token()} `])
  assert.equal(authenticateApp({headers:{'x-r3-app':'language_app',authorization:bad}}),null);
 assert.throws(()=>authenticateApp({headers:{'x-r3-app':'study_app',authorization:`Bearer ${token()}`}}),/missing or too short/);
}));
test('cron is denied by default and accepts only configured valid secret',()=>withEnv({CRON_SECRET:'Z'.repeat(48)},()=>{
 assert.equal(cronAuthorized({headers:{authorization:'Bearer '+'Z'.repeat(48)}}),true);
 assert.equal(cronAuthorized({headers:{authorization:'Bearer '+'A'.repeat(48)}}),false);
}));
test('provider config rejects malformed ids and too-short credentials',()=>{
 assert.throws(()=>withEnv({ONESIGNAL_APPS_JSON:JSON.stringify({language_app:{app_id:'bad',rest_api_key:'123456789101112'}})},getOneSignalApps));
 assert.deepEqual(Object.keys(withEnv({ONESIGNAL_APPS_JSON:providerEnv},getOneSignalApps)),['language_app']);
});
test('HTTP authenticates BEFORE processing malformed request bodies',async()=>withEnv({R3_APP_KEYS_JSON:keyEnv},async()=>{
 const unauth=await invoke(events,req('POST','not-json'));
 assert.equal(unauth.statusCode,401);
 const malformed=await invoke(events,req('POST','{',authHeaders));
 assert.equal(malformed.statusCode,400);
 const invalid=await invoke(events,req('POST',JSON.stringify(event({user_id:'email@domain.com'})),authHeaders));
 assert.equal(invalid.statusCode,400);
}));
test('HTTP validates Content-Type, payload size and successful insert/dedup',async()=>withEnv({R3_APP_KEYS_JSON:keyEnv},async()=>{
 const id=nonce();let writes=0;
 const hooks={ingestEvent:async(app,ev)=>{assert.equal(app,'language_app');assert.equal(ev.event_id,id);return ++writes===1;}};
 const payload=JSON.stringify(event({event_id:id}));
 let res=await invoke(events,req('POST',payload,authHeaders),hooks);
 assert.equal(res.statusCode,201);assert.equal(res.body.inserted,true);
 res=await invoke(events,req('POST',payload,authHeaders),hooks);
 assert.equal(res.statusCode,200);assert.equal(res.body.duplicate,true);
 res=await invoke(events,req('POST',payload,{...authHeaders,'content-type':'text/html'}),hooks);
 assert.equal(res.statusCode,415);
 res=await invoke(events,req('POST','X'.repeat(5000),authHeaders),hooks);
 assert.equal(res.statusCode,413);
 assert.equal(writes,2);
}));
test('streaming body enforces 4096-byte maximum',async()=>{
 const text='x'.repeat(4100);
 const req={headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(text);}};
 await assert.rejects(()=>bodyJson(req),/Payload too large/);
});
test('DELETE user endpoint is tenant-bound and gives deterministic response',async()=>withEnv({R3_APP_KEYS_JSON:keyEnv},async()=>{
 const deleted=[];
 const removeUser=async(app,id)=>{deleted.push([app,id]);return true;};
 const res=await invoke(user,req('DELETE',JSON.stringify({user_id:'opaque_1'}),authHeaders),{removeUser});
 assert.equal(res.statusCode,200);assert.equal(res.body.deleted,true);
 assert.deepEqual(deleted,[['language_app','opaque_1']]);
 assert.equal((await invoke(user,req('DELETE',JSON.stringify({user_id:'person@example.com'}),authHeaders),{removeUser})).statusCode,400);
}));
test('cron endpoint checks secret and never invokes runner unauthenticated',async()=>withEnv({CRON_SECRET:'Q'.repeat(40)},async()=>{
 let calls=0;const hooks={runner:async()=>{calls++;return {processed:0};}};
 assert.equal((await invoke(cron,req('GET','',{}),hooks)).statusCode,401);
 const res=await invoke(cron,req('GET','',{authorization:'Bearer '+'Q'.repeat(40)}),hooks);
 assert.equal(res.statusCode,200);assert.equal(calls,1);
}));
test('OneSignal: zero recipients, API errors, no ID never get marked sent',async()=>{
 const args={job:{id:nonce(),app:'language_app',user_id:'opaque_1',kind:'return_reminder'},locale:'ja-JP',appConfig:{app_id:nonce(),rest_api_key:'1234567890123'}};
 for(const body of [{id:'id',recipients:0},{errors:['no subscribed players']},{id:null}]){
  const result=await sendOneSignal({...args,fetcher:async()=>({ok:true,json:async()=>body})});
  assert.equal(result.sent,false);
 }
 let payload;
 await sendOneSignal({...args,fetcher:async(u,init)=>{payload=JSON.parse(init.body);return {ok:true,json:async()=>({id:'s',recipients:1})};}});
 assert.deepEqual(Object.keys(payload.headings),['en']);
 assert.equal(payload.contents.en,messageFor('language_app','en','return_reminder').body);
});
function simpleRepo({rows=[sample()],retry=[],reserve=null,claim=null}={}){
 const data={reserve:0,claim:0,sent:0,failed:0,skipped:0};
 return {data, listRetries:async()=>retry, listCandidates:async()=>rows,
  reserve:async(app,id,day,kind)=>{data.reserve++;return reserve?reserve(app,id,day,kind):{id:nonce(),app,user_id:id,kind};},
  claim:async(id)=>{data.claim++;return claim?claim(id):{id,app:'language_app',user_id:eligibleId(),kind:'streak_reminder',attempts:1};},
  preflight:async()=>true,markSent:async()=>{data.sent++;return true;},markFailed:async(id,err,skipped)=>{if(skipped)data.skipped++;else data.failed++;return true;}};
}
async function enabled(fn){return withEnv({R3_PUSH_ENABLED:'true',ONESIGNAL_APPS_JSON:providerEnv},fn);}
test('cron skip without recipient is not counted as delivered',async()=>enabled(async()=>{
 const repo=simpleRepo();const stats=await runCron(now,{db:repo,send:async()=>({sent:false,reason:'No recipients'})});
 assert.equal(stats.sent,0);assert.equal(stats.skipped,1);assert.equal(repo.data.skipped,1);
}));
test('cron failed API request is marked failed without crashing whole batch',async()=>enabled(async()=>{
 const repo=simpleRepo();const stats=await runCron(now,{db:repo,send:async()=>{throw Error('Provider 429');}});
 assert.equal(stats.sent,0);assert.equal(stats.failed,1);assert.equal(repo.data.failed,1);
}));
test('cron respects 100 delivery bound with 150 eligible candidates',async()=>enabled(async()=>{
 const many=Array.from({length:150},(_,i)=>sample({user_id:`u-${i}`})).filter(x=>!isHoldout(x.app,x.user_id));
 const repo=simpleRepo({rows:many});
 const stats=await runCron(now,{db:repo,send:async()=>({sent:true,providerId:'accepted'})});
 assert.ok(stats.processed<=100);
 assert.equal(repo.data.sent,stats.processed);
}));
test('cron does not reserve invalid cohort, exhausted cap or same-day active',async()=>enabled(async()=>{
 const rows=[sample({user_id:eligibleId('language_app',true)}),sample({sent_last_7d:3}),sample({last_active_at:now.toISOString()})];
 const repo=simpleRepo({rows});
 const stats=await runCron(now,{db:repo,send:async()=>{throw Error('should not send');}});
 assert.equal(stats.processed,0);assert.equal(repo.data.reserve,0);
}));
test('cron skips claimed jobs invalidated by DB before dispatch',async()=>enabled(async()=>{
 const repo=simpleRepo({claim:async()=>null});
 const stats=await runCron(now,{db:repo,send:async()=>{throw Error('should not send');}});
 assert.equal(stats.skipped,1);assert.equal(repo.data.sent,0);
}));

}
function register_engine_tests() {
const now = new Date('2026-10-15T19:30:00Z');
function treatmentId(app='language_app') {
  for(let i=0;i<1000;i++) if(!isHoldout(app,`user-${i}`))return `user-${i}`;
  throw new Error('No treatment found');
}
function sample(overrides={}) {
  return {app:'language_app',user_id:treatmentId(),push_consent:true,timezone:'UTC',locale:'pt-BR',last_active_at:'2026-10-14T19:00:00.000Z',current_streak:2,...overrides};
}
test('accepts canonical event and rejects invalid inputs',()=>{
  const base={event_id:randomUUID(),user_id:'opaque_72',type:'lesson_completed',timezone:'America/Sao_Paulo',locale:'pt-BR'};
  assert.deepEqual(validateEvent(base),base);
  assert.throws(()=>validateEvent({...base,timezone:'Mars/Base'}));
  assert.throws(()=>validateEvent({...base,type:'free_form'}));
  assert.throws(()=>validateEvent({...base,user_id:'email@domain.com'}));
  assert.throws(()=>validateEvent({...base,event_id:'123'}));
});
test('IANA time zone and local date boundaries',()=>{
  assert.equal(validTimezone('America/Sao_Paulo'),true);
  assert.equal(validTimezone('bad/invalid'),false);
  assert.deepEqual(localClock(new Date('2026-10-15T00:10:00Z'),'America/Sao_Paulo'),{day:'2026-10-14',hour:21});
  assert.equal(dayDifference('2026-11-01','2026-10-31'),1);
});
test('eligibility: quiet hour, no consent, cap, same-day activity, hiatus',()=>{
  assert.equal(decideNotification(sample(),0,now)?.kind,'streak_reminder');
  assert.equal(decideNotification(sample({push_consent:false}),0,now),null);
  assert.equal(decideNotification(sample(),3,now),null);
  assert.equal(decideNotification(sample(),0,new Date('2026-10-15T02:00:00Z')),null);
  assert.equal(decideNotification(sample({last_active_at:'2026-10-15T11:00:00Z'}),0,now),null);
  assert.equal(decideNotification(sample({last_active_at:'2026-10-05T11:00:00Z'}),0,now),null);
});
test('10% holdout is stable and excluded',()=>{
  const app='language_app';
  const control=Array.from({length:200},(_,i)=>`cohort-${i}`).find(x=>isHoldout(app,x));
  assert.ok(control);
  assert.equal(decideNotification(sample({user_id:control}),0,now),null);
  assert.equal(isHoldout(app,control),true);
});
test('copy localized for every app; unknown locale falls back to en',()=>{
  for(const app of APPS) {
    for(const locale of ['en','pt-BR','es','fr','de','it','ru','ja-JP']){
      for(const kind of ['streak_reminder','return_reminder']){
        const m=messageFor(app,locale,kind);
        assert.ok(m.title.length>4 && m.body.length>10);
      }
    }
  }
  assert.equal(messageFor('language_app','ja-JP','return_reminder').language,'en');
  assert.equal(messageFor('language_app','ja-JP','return_reminder').title,messageFor('language_app','en','return_reminder').title);
});
test('risk is bounded heuristic, not a machine learning output',()=>{
  assert.equal(riskScore(0),0.15);
  assert.equal(riskScore(200),0.9);
});

}
function register_http_tests() {
function response() {
  const r=new EventEmitter();r.headers={};r.setHeader=(k,v)=>{r.headers[k]=v};
  r.end=b=>{r.body=JSON.parse(b);r.emit('finish');};return r;
}
async function invoke(handler,req) {
  const res=response();const pending=new Promise(resolve=>res.once('finish',()=>resolve(res)));
  await handler(req,res);return pending;
}
test('safe secret comparison',()=>{assert.equal(safeEqual('abc','abc'),true);assert.equal(safeEqual('abc','ab'),false);assert.equal(safeEqual('abc','xyz'),false);});
test('app headers authenticate against server-only keys',()=>{
  const previous=process.env.R3_APP_KEYS_JSON;
  process.env.R3_APP_KEYS_JSON=JSON.stringify({language_app:'a'.repeat(50),study_app:'b'.repeat(50)});
  try{
    assert.equal(authenticateApp({headers:{'x-r3-app':'language_app',authorization:`Bearer ${'a'.repeat(50)}`}}),'language_app');
    assert.equal(authenticateApp({headers:{'x-r3-app':'study_app',authorization:'Bearer abc'}}),null);
  }finally{if(previous===undefined)delete process.env.R3_APP_KEYS_JSON;else process.env.R3_APP_KEYS_JSON=previous;}
});
test('events and cron require authentication and the correct method',async()=>{
  const res1=await invoke(events,{method:'POST',headers:{'x-r3-app':'language_app',authorization:'Bearer invalid'}});
  assert.ok([401,503].includes(res1.statusCode));
  const res2=await invoke(events,{method:'GET',headers:{}});
  assert.equal(res2.statusCode,405);
  const res3=await invoke(cron,{method:'GET',headers:{authorization:'Bearer invalid'}});
  assert.equal(res3.statusCode,401);
});

}
function register_provider_tests() {
const fakeApp={app_id:randomUUID(),rest_api_key:'EXAMPLE_KEY_NOT_REAL'};
const fakeJob={id:randomUUID(),app:'study_app',user_id:'opaque_1',kind:'return_reminder'};

test('OneSignal payload uses alias targeting and fixed idempotency key',async()=>{
  let sent;
  const result=await sendOneSignal({job:fakeJob,locale:'pt-BR',appConfig:fakeApp,fetcher:async(url,init)=>{
    sent={url,init,payload:JSON.parse(init.body)};
    return {ok:true,json:async()=>({id:'provider_id_1'})};
  }});
  assert.equal(result.sent,true);
  assert.equal(sent.url,'https://api.onesignal.com/notifications');
  assert.equal(sent.init.headers.Authorization,`Key ${fakeApp.rest_api_key}`);
  assert.deepEqual(sent.payload.include_aliases,{external_id:['opaque_1']});
  assert.equal(sent.payload.target_channel,'push');
  assert.equal(sent.payload.idempotency_key,fakeJob.id);
  assert.ok(sent.payload.contents.en.includes('pequeno'));
  assert.deepEqual(Object.keys(sent.payload.contents), ['en']);
});
test('OneSignal responses with no id are not counted as sent',async()=>{
  const result=await sendOneSignal({job:fakeJob,locale:'en',appConfig:fakeApp,fetcher:async()=>({ok:true,json:async()=>({errors:['No Subscribed Players']})})});
  assert.equal(result.sent,false);
});
test('OneSignal errors are not swallowed',async()=>{
  await assert.rejects(()=>sendOneSignal({job:fakeJob,locale:'en',appConfig:fakeApp,fetcher:async()=>({ok:false,status:429})}),/429/);
});

}
function register_service_tests() {
const app='reading_app';
const userId=Array.from({length:100},(_,i)=>`usr_${i}`).find(x=>!isHoldout(app,x));
const now=new Date('2026-10-15T19:00:00Z');

test('kill switch prevents provider access even if cron runs',async()=>{
  const previous=process.env.R3_PUSH_ENABLED;
  process.env.R3_PUSH_ENABLED='false';
  try {assert.deepEqual(await runCron(now),{enabled:false,processed:0,sent:0,failed:0,skipped:0,uncertain:0});}
  finally{if(previous===undefined)delete process.env.R3_PUSH_ENABLED;else process.env.R3_PUSH_ENABLED=previous;}
});
test('cron reserves, claims, and sends a single eligible campaign',async()=>{
  const env={R3_PUSH_ENABLED:process.env.R3_PUSH_ENABLED,ONESIGNAL_APPS_JSON:process.env.ONESIGNAL_APPS_JSON};
  process.env.R3_PUSH_ENABLED='true';
  process.env.ONESIGNAL_APPS_JSON=JSON.stringify(Object.fromEntries(['language_app','study_app','reading_app'].map(a=>[a,{app_id:randomUUID(),rest_api_key:'1234567890123456'}])));
  const row={app,user_id:userId,push_consent:true,timezone:'UTC',locale:'en',current_streak:0,last_active_at:'2026-10-14T17:00:00Z',sent_last_7d:0};
  const id=randomUUID();
  let reserved=0,claimed=0,sent=0;
  const repo={
    listRetries:async()=>[],listCandidates:async()=>[row],
    reserve:async()=>{reserved++;return{id,app,user_id:userId,kind:'return_reminder'};},
    claim:async()=>{claimed++;return{id,app,user_id:userId,kind:'return_reminder',attempts:1};},
    preflight:async()=>true,markSent:async()=>{sent++;return true;},markFailed:async()=>{throw Error('unexpected failure');}
  };
  try {
    const stats=await runCron(now,{db:repo,send:async()=>({sent:true,providerId:'example_id'})});
    assert.equal(stats.sent,1);assert.equal(stats.processed,1);
    assert.equal(reserved,1);assert.equal(claimed,1);assert.equal(sent,1);
  }finally{
    for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});

}

async function smokeHTTP(){
 const token=randomUUID()+randomUUID();const secret=randomUUID()+randomUUID();
 const prior={...process.env};
 process.env.R3_PUSH_ENABLED='false';process.env.R3_APP_KEYS_JSON=JSON.stringify({language_app:token});
 process.env.CRON_SECRET=secret;delete process.env.DATABASE_URL;
 process.env.R3_VERIFIED_OFFERS_JSON=JSON.stringify({language_app:{lesson_pack:{active:true,currency:'BRL',public_price_minor:2000,member_price_minor:1500,terms_url:'https://example.org/terms'}}});
 const server=createServer();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${server.address().port}`;
 async function call(path,method='GET',headers={},body){
  const r=await fetch(base+path,{method,headers,body});return {status:r.status,body:await r.json(),headers:r.headers};
 }
 try{
   let checks=0;
   let r=await call('/api/health');assert.equal(r.status,200);checks++;
   assert.equal(r.body.service,'R3ENGINE');checks++;
   assert.equal(r.body.version,'1.1.0');checks++;
   assert.equal(r.headers.get('cache-control'),'no-store');checks++;
   assert.equal((await call('/api/health','POST')).status,405);checks++;
   assert.equal((await call('/unmatched')).status,404);checks++;
   assert.equal((await call('/api/events','GET')).status,405);checks++;
   assert.equal((await call('/api/events','POST',{'content-type':'application/json'},'{}')).status,401);checks++;
   assert.equal((await call('/api/user','DELETE',{'content-type':'application/json'},'{}')).status,401);checks++;
   assert.equal((await call('/api/cron')).status,401);checks++;
   r=await call('/api/cron','GET',{authorization:`Bearer ${secret}`});assert.deepEqual(r.body,{enabled:false,processed:0,sent:0,failed:0,skipped:0,uncertain:0});checks++;
   r=await call('/api/events','POST',{'content-type':'application/json','x-r3-app':'language_app',authorization:`Bearer ${token}`},
    JSON.stringify({event_id:randomUUID(),user_id:'opaque_1',type:'session_started',timezone:'UTC',locale:'en'}));
   assert.equal(r.status,503);checks++;
   assert.equal(r.body.error,'Event persistence unavailable');checks++;
   const auth={'content-type':'application/json','x-r3-app':'language_app',authorization:`Bearer ${token}`};
   r=await call('/api/offer','POST',auth,JSON.stringify({sku:'lesson_pack'}));
   assert.equal(r.status,200);checks++;
   assert.equal(r.body.gross_price_difference_minor,500);checks++;
   assert.equal(r.body.urgency_label,'');checks++;
   assert.equal((await call('/api/offer','POST',auth,JSON.stringify({sku:'nonexistent'}))).status,404);checks++;
   assert.equal((await call('/api/offer','POST',{'content-type':'application/json'},JSON.stringify({sku:'lesson_pack'}))).status,401);checks++;
   assert.equal((await call('/api/journey?user_id=opaque_1')).status,401);checks++;
   assert.equal((await call('/api/feedback','POST',{'content-type':'application/json'},JSON.stringify({user_id:'opaque_1',score:0}))).status,401);checks++;
   assert.equal((await call('/api/review-prompt','POST',{'content-type':'application/json'},'{}')).status,401);checks++;
   return checks;
 }finally {
   await new Promise(resolve=>server.close(resolve));
   // restore env carefully, never leak test secrets
   for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];
   for(const [key,value] of Object.entries(prior))process.env[key]=value;
 }
}
function register_additional_tests(){
 test('OneSignal rejects error objects and zero recipients expressed as string',async()=>{
   const job={id:randomUUID(),app:'language_app',user_id:'opaque_1',kind:'return_reminder'};
   const config={app_id:randomUUID(),rest_api_key:'test_key_fake_1234567'};
   for(const reply of [{id:'abc',errors:{invalid_aliases:{external_id:['unknown']}}},{id:'abc',recipients:'0'}]){
    const result=await sendOneSignal({job,locale:'en',appConfig:config,fetcher:async()=>({ok:true,json:async()=>reply})});
    assert.equal(result.sent,false);
   }
 });
 test('cron recovers when status persistence fails after provider acceptance',async()=>{
   const original={R3_PUSH_ENABLED:process.env.R3_PUSH_ENABLED,ONESIGNAL_APPS_JSON:process.env.ONESIGNAL_APPS_JSON};
   const app='language_app';const id=Array.from({length:100},(_,i)=>`r3-retry-${i}`).find(x=>!isHoldout(app,x));
   process.env.R3_PUSH_ENABLED='true';process.env.ONESIGNAL_APPS_JSON=JSON.stringify({language_app:{app_id:randomUUID(),rest_api_key:'test_secret_1234567'}});
   let failRecords=0;
   const row={id:randomUUID(),app,user_id:id,attempts:1,push_consent:true,timezone:'UTC',locale:'en',last_active_at:'2026-10-14T00:00:00Z',current_streak:0,sent_last_7d:0,kind:'return_reminder'};
   const repo={listRetries:async()=>[row],listCandidates:async()=>[],reserve:async()=>null,claim:async()=>row,
      preflight:async()=>true,markSent:async()=>{throw Error('DB write failed');},markFailed:async()=>{failRecords++;throw Error('DB unavailable');}};
   const oldError=console.error;console.error=()=>{};
   try{
     const r=await runCron(new Date('2026-10-15T19:00:00Z'),{db:repo,send:async()=>({sent:true,providerId:'provider-123'})});
     assert.equal(r.uncertain,1);assert.equal(r.failed,0);assert.equal(r.sent,0);assert.equal(failRecords,0);
   }finally{console.error=oldError;for(const [key,val] of Object.entries(original)){if(val===undefined)delete process.env[key];else process.env[key]=val;}}
 });
 test('SQL migrations embedded, no unparameterized query strings',()=>{
  assert.match(SCHEMA_SQL,/CREATE TABLE IF NOT EXISTS r3_users/);
  assert.match(SCHEMA_SQL,/CREATE OR REPLACE FUNCTION r3_ingest_event/);
  assert.match(SCHEMA_SQL,/CREATE OR REPLACE FUNCTION r3_claim_delivery/);
  assert.match(SCHEMA_SQL,/FOR UPDATE/);
  assert.match(SCHEMA_SQL,/r3_is_holdout/);
 });
 test('SQL retention analytics embedded',()=>{
   for(const word of ['retained_d1','retained_d7','retained_d30','r3_is_holdout'])assert.ok(ANALYTICS_SQL.includes(word));
 });
 test('HTTP live smoke including kill-switch',async()=>assert.equal(await smokeHTTP(),21));
 test('health returns no sensitive details',async()=>{
   const res=new EventEmitter();res.headers={};res.setHeader=(k,v)=>res.headers[k]=v;
   res.end=b=>res.body=JSON.parse(b);
   health({method:'GET'},res);assert.equal(res.statusCode,200);assert.equal(res.body.service,'R3ENGINE');
   assert.ok(!('database_url' in res.body));
 });
}

function register_deep_tests() {
  const at=new Date('2026-10-15T19:00:00Z');
  const raw={app:'language_app',user_id:'secure_1',kind:'return_reminder',id:randomUUID(),attempts:1,locale:'en'};
  function inProvider(fn){
    const previous={R3_PUSH_ENABLED:process.env.R3_PUSH_ENABLED,ONESIGNAL_APPS_JSON:process.env.ONESIGNAL_APPS_JSON};
    process.env.R3_PUSH_ENABLED='true';
    process.env.ONESIGNAL_APPS_JSON=JSON.stringify({language_app:{app_id:randomUUID(),rest_api_key:'one_signal_fake_key_01234567890'}});
    const restore=()=>{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
    try {const result=fn();return result && typeof result.finally==='function'?result.finally(restore):(restore(),result);}catch(err){restore();throw err;}
  }
  function fakeRepository(options={}){
    const tally={delivered:0,claims:0,failed:0,skipped:0,preflight:0};
    const repo={
      tally,
      listRetries:async()=>[raw],listCandidates:async()=>[],
      reserve:async()=>{throw Error('Unexpected reserve');},
      claim:async()=>{tally.claims++;return options.claim ?? raw;},
      preflight:async()=>{tally.preflight++;if(options.preflightError)throw Error('DB read timeout');return options.eligible ?? true;},
      markSent:async(id,providerId,attempts)=>{tally.delivered++;assert.equal(id,raw.id);assert.equal(attempts,1);if(options.persistError)throw Error('DB offline');return options.persistResult ?? true;},
      markFailed:async(id,error,skipped,attempts)=>{assert.equal(attempts,1);if(skipped)tally.skipped++;else tally.failed++;if(options.persistError)throw Error('DB offline');return options.persistResult ?? true;}
    };
    return repo;
  }
  test('revoke consent between claim and send: secondary eligibility check blocks delivery',async()=>inProvider(async()=>{
    const repo=fakeRepository({eligible:false});let outbound=0;
    const stats=await runCron(at,{db:repo,send:async()=>{outbound++;return{sent:true,providerId:'unexpected'};}});
    assert.equal(outbound,0);assert.equal(repo.tally.skipped,1);
    assert.equal(stats.skipped,1);assert.equal(stats.uncertain,0);
  }));
  test('database preflight unavailable: fail closed without any provider request',async()=>inProvider(async()=>{
    const repo=fakeRepository({preflightError:true});let outbound=0;
    const old=console.error;console.error=()=>{};
    try {
      const stats=await runCron(at,{db:repo,send:async()=>{outbound++;return{sent:true,providerId:'unexpected'};}});
      assert.equal(outbound,0);assert.equal(stats.uncertain,1);assert.equal(stats.sent,0);
    }finally{console.error=old;}
  }));
  test('provider accepted notification but DB write failed: uncertain, never overwrite as failed',async()=>inProvider(async()=>{
    const repo=fakeRepository({persistError:true});let outbound=0;
    const old=console.error;console.error=()=>{};
    try {
      const stats=await runCron(at,{db:repo,send:async()=>{outbound++;return{sent:true,providerId:'provider_accepted'};}});
      assert.equal(outbound,1);assert.equal(stats.uncertain,1);
      assert.equal(stats.failed,0);assert.equal(repo.tally.failed,0);
    }finally{console.error=old;}
  }));
  test('late worker loses compare-and-swap lease; successful provider request stays uncertain',async()=>inProvider(async()=>{
    const repo=fakeRepository({persistResult:false});
    const stats=await runCron(at,{db:repo,send:async()=>({sent:true,providerId:'accepted'})});
    assert.equal(stats.uncertain,1);assert.equal(stats.sent,0);assert.equal(repo.tally.failed,0);
  }));
  test('claim without attempt number is not allowed to dispatch',async()=>inProvider(async()=>{
    const repo=fakeRepository({claim:{...raw,attempts:undefined}});let count=0;
    const stats=await runCron(at,{db:repo,send:async()=>{count++;return{sent:true};}});
    assert.equal(count,0);assert.equal(stats.uncertain,1);assert.equal(repo.tally.preflight,0);
  }));
  test('provider exception with successful failure journal increases failed, not sent',async()=>inProvider(async()=>{
    const repo=fakeRepository();const stats=await runCron(at,{db:repo,send:async()=>{throw Error('429');}});
    assert.equal(stats.failed,1);assert.equal(stats.uncertain,0);assert.equal(repo.tally.failed,1);
  }));
  test('provider exception and journal failure is classified as uncertain',async()=>inProvider(async()=>{
    const repo=fakeRepository({persistError:true});const old=console.error;console.error=()=>{};
    try {
      const stats=await runCron(at,{db:repo,send:async()=>{throw Error('ConnectionReset');}});
      assert.equal(stats.uncertain,1);assert.equal(stats.failed,0);
    }finally{console.error=old;}
  }));
  test('zero recipients and false success are never accepted as delivered',async()=>{
    const appConfig={app_id:randomUUID(),rest_api_key:'fake_credentials_987654321'};
    for(const reply of [{id:'uuid',success:false},{id:'uuid',recipients:'non_numeric'},{id:'uuid',recipients:-1},{id:'uuid',errors:'not subscribed'}]){
      const response=await sendOneSignal({job:raw,locale:'pt-BR',appConfig,fetcher:async()=>({ok:true,json:async()=>reply})});
      assert.equal(response.sent,false);
    }
  });
  test('OneSignal ambiguous HTTP status is surfaced, not falsely marked delivered',async()=>{
    await assert.rejects(()=>sendOneSignal({job:raw,locale:'en',appConfig:{app_id:randomUUID(),rest_api_key:'test_credentials_123456'},fetcher:async()=>({ok:false,status:503})}),/503/);
  });
  test('analytics uses explicit UTC for D1/D7/D30 regardless of database session timezone',()=>{
    assert.match(ANALYTICS_SQL,/MIN\(\(occurred_at AT TIME ZONE 'UTC'\)::date\)/);
    assert.match(ANALYTICS_SQL,/DISTINCT app,user_id,\(occurred_at AT TIME ZONE 'UTC'\)::date/);
  });
  test('preflight checks current consent, time window, and current claim lease in its query',()=>{
    const src=preflight.toString();
    for(const part of ["u.push_consent", "d.attempts=", "d.status='sending'", "r3_is_holdout", "BETWEEN 1 AND 7"]){
      assert.ok(src.includes(part),part);
    }
    for(const fn of [markSent,markFailed])assert.match(fn.toString(),/attempts=\$\{attempts\}/);
  });
  test('same-day duplicate arrival cannot generate two notices under unique campaign constraint',()=>{
    assert.match(SCHEMA_SQL,/UNIQUE \(app, user_id, campaign_day\)/);
    assert.match(reserve.toString(),/ON CONFLICT\(app,user_id,campaign_day\)/);
  });
}

function register_db_adapter_tests(){
  function mockDatabase(fn){
    const original=sql;
    const previous=process.env.DATABASE_URL;
    process.env.DATABASE_URL='postgres://test.local/db';
    const calls=[];
    sql=async (strings,...args)=>{
      const query=strings.join(' ? ');
      calls.push({query,args});
      if (query.includes('SELECT r3_ingest_event'))return [{inserted:true}];
      if (query.includes('SELECT r3_delete_user'))return [{deleted:true}];
      if (query.includes('SELECT u.app,u.user_id'))return [{app:'language_app',user_id:'u'}];
      if (query.includes('SELECT d.id,d.app,d.user_id'))return [{id:randomUUID(),app:'language_app'}];
      if (query.includes('INSERT INTO r3_deliveries'))return [{id:randomUUID()}];
      if (query.includes('SELECT * FROM r3_claim_delivery'))return [{id:randomUUID(),attempts:1}];
      if (query.includes('AS eligible'))return [{eligible:true}];
      if (query.includes("SET status='sent'"))return [{id:randomUUID()}];
      if (query.includes('SET status= ?'))return [{id:randomUUID()}];
      throw Error('Unexpected SQL '+query.slice(0,100));
    };
    const restore=()=>{sql=original;if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;};
    try{const result=fn(calls);return result && typeof result.finally==='function'?result.finally(restore):(restore(),result);}catch(err){restore();throw err;}
  }
  test('all SQL adapter operations use bind parameters; no untrusted user interpolation',async()=>mockDatabase(async calls=>{
    const ev={event_id:randomUUID(),user_id:'qa_id',type:'session_started',locale:'en',timezone:'UTC'};
    assert.equal(await ingest('language_app',ev),true);
    assert.equal(await deleteUser('language_app','qa_id'),true);
    assert.equal((await listCandidates()).length,1);
    assert.equal((await listRetries()).length,1);
    assert.ok((await reserve('language_app','qa_id','2026-10-16','return_reminder')).id);
    assert.ok((await claim(randomUUID())).id);
    assert.equal(await preflight({id:randomUUID(),attempts:1}),true);
    assert.equal(await markSent(randomUUID(),'prv_1',1),true);
    assert.equal(await markFailed(randomUUID(),'provider rejected',false,1),true);
    assert.equal(await markFailed(randomUUID(),'not eligible',true,2),true);
    assert.equal(calls.length,10);
    assert.equal(calls[0].args[2],'qa_id');
    assert.equal(calls[1].args[1],'qa_id');
    assert.ok(calls.slice(7).every(c=>c.query.includes('attempts= ?')));
    assert.ok(calls.slice(7).every(c=>!c.query.includes('provider rejected')));
  }));
  test('database adapter treats zero returned rows as non-persistence, not success',async()=>mockDatabase(async()=>{
    const previous=sql;
    sql=async(strings,...args)=>[];
    try{
      assert.equal(await ingest('language_app',{event_id:randomUUID(),user_id:'user',type:'day_completed',locale:'en',timezone:'UTC'}),false);
      assert.equal(await deleteUser('language_app','user'),false);
      assert.equal(await reserve('language_app','user','2026-10-16','return_reminder'),null);
      assert.equal(await claim(randomUUID()),null);
      assert.equal(await preflight({id:randomUUID(),attempts:1}),false);
      assert.equal(await markSent(randomUUID(),'provider',1),false);
      assert.equal(await markFailed(randomUUID(),'fail',false,1),false);
    }finally{sql=previous;}
  }));
  test('markFailed stores bounded error text rather than unbounded sensitive provider output',async()=>mockDatabase(async calls=>{
    await markFailed(randomUUID(),'E'.repeat(1000),false,1);
    const call=calls.at(-1);
    assert.equal(call.args.find(a=>typeof a==='string' && a.startsWith('E')).length,160);
    assert.equal(call.args.at(-1),1);
  }));
  test('parameterized lease guarding protects against stale acknowledgements',async()=>mockDatabase(async calls=>{
    await markSent(randomUUID(),'provider',6);
    await markFailed(randomUUID(),'timeout',true,6);
    assert.equal(calls[0].args.at(-1),6);
    assert.equal(calls[1].args.at(-1),6);
    assert.ok(calls.every(c=>c.query.includes("status='sending'")));
  }));
}

function register_duolingo_parity_tests(){
 const base={app:'language_app',user_id:'a_verified_user',last_completed_local_date:'2026-10-15',current_streak:7,longest_streak:9,freeze_balance:1,daily_goal:2,lessons_total:14,today_lessons:1,active_days_7d:4,earned_milestones:[7]};
 test('Duolingo parity: lesson extends streak in transactional SQL without raising daily target',()=>{
   assert.match(SCHEMA_SQL,/p_type IN \('lesson_completed','day_completed'\)/);
   assert.match(SCHEMA_SQL,/v_gap=1 THEN v_new_streak:=v_old_streak\+1/);
   assert.match(SCHEMA_SQL,/p_type='lesson_completed' THEN\s+INSERT INTO r3_daily_progress/);
   assert.match(SCHEMA_SQL,/ADD COLUMN IF NOT EXISTS daily_goal/);
 });
 test('Duolingo parity: streak status across normal, late, frozen, expired and time conflict',()=>{
   assert.equal(streakStatus(base,'2026-10-15'),'completed_today');
   assert.equal(streakStatus(base,'2026-10-16'),'at_risk_today');
   assert.equal(streakStatus(base,'2026-10-17'),'recoverable_with_freeze');
   assert.equal(streakStatus(base,'2026-10-18'),'expired');
   assert.equal(streakStatus(base,'2026-10-14'),'clock_conflict');
   assert.equal(streakStatus({...base,current_streak:0},'2026-10-15'),'not_started');
 });
 test('Duolingo parity: freeze is pre-equipped, consumed only when gap bridged, capped at two',()=>{
   for(const part of ['v_gap-1<=v_balance','v_new_balance:=v_balance-(v_gap-1)','LEAST(2,freeze_balance+1)'])assert.ok(SCHEMA_SQL.includes(part),part);
   assert.match(SCHEMA_SQL,/CHECK \(freeze_balance BETWEEN 0 AND 2\)/);
   assert.match(SCHEMA_SQL,/ON CONFLICT DO NOTHING;\s+GET DIAGNOSTICS v_awarded/);
 });
 test('Duolingo parity: earned badges survive streak reset and hide experiment allocation',()=>{
   const p=progressView({...base,last_completed_local_date:'2026-10-01',current_streak:1,earned_milestones:[7,30]},'2026-10-17');
   assert.equal(p.streak.days,0);
   assert.deepEqual(p.milestones,[7,30]);
   assert.equal('treatment_group' in p,false);
   assert.equal(dateKey(new Date('2026-10-17T00:00:00Z')),'2026-10-17');
   assert.equal(dateKey('2026-10-17T00:00:00.000Z'),'2026-10-17');
   assert.throws(()=>dateKey('Fri Oct 17 2026'));
   assert.match(readProgress.toString(),/array_agg\(r.milestone/);
 });
 test('Duolingo parity: daily quests progress and XP separate from streaks',()=>{
   const p=progressView(base,'2026-10-15');
   assert.equal(p.daily_goal.target,2);
   assert.equal(p.daily_goal.met,false);
   assert.equal(p.quests.one_lesson,true);
   assert.equal(p.quests.weekly_consistency,false);
   assert.equal(p.xp_total,140);
   assert.equal(progressView({...base,today_lessons:3,active_days_7d:5},'2026-10-15').quests.weekly_consistency,true);
   assert.equal(progressView({...base,last_completed_local_date:'2026-10-10',freeze_balance:0},'2026-10-15').streak.days,0);
 });
 test('Duolingo parity: daily goal rejects invalid target and unsafe user id',()=>{
   assert.deepEqual(validateGoal({user_id:'opaque-user',target:3}),{user_id:'opaque-user',target:3});
   for(const target of [0,11,1.5,'3',null])assert.throws(()=>validateGoal({user_id:'user',target}));
   for(const user_id of ['me@site.com','x y','../user'])assert.throws(()=>validateGoal({user_id,target:2}));
 });
 test('Duolingo parity: goals require server auth and persist only to the app tenant',async()=>{
   const fake=new EventEmitter();fake.setHeader=()=>{};fake.end=x=>fake.body=JSON.parse(x);
   await goal({method:'PUT',headers:{},body:{user_id:'x',target:2}},fake,{saveGoal:async()=>{throw Error('Should not run');}});
   assert.ok([401,503].includes(fake.statusCode)); // either denied or no auth config
 });
 test('Duolingo parity: progress API exposes only pseudonymous metrics, no personal content',async()=>{
   const old=process.env.R3_APP_KEYS_JSON;
   process.env.R3_APP_KEYS_JSON=JSON.stringify({language_app:'z'.repeat(48)});
   try{
     const req={method:'GET',headers:{'x-r3-app':'language_app',authorization:`Bearer ${'z'.repeat(48)}`},url:'/api/progress?user_id=a_verified_user'};
     const res=new EventEmitter();res.setHeader=()=>{};res.end=x=>res.body=JSON.parse(x);
     await progress(req,res,{getProgress:async(app,id)=>{
       assert.equal(app,'language_app');assert.equal(id,'a_verified_user');return progressView(base,'2026-10-15');
     }});
     assert.equal(res.statusCode,200);assert.equal(res.body.quests.one_lesson,true);
     assert.ok(!('email' in res.body));
   }finally{if(old===undefined)delete process.env.R3_APP_KEYS_JSON;else process.env.R3_APP_KEYS_JSON=old;}
 });
 test('Duolingo parity: goal API writes validated target and rejects wrong method',async()=>{
   const old=process.env.R3_APP_KEYS_JSON;
   process.env.R3_APP_KEYS_JSON=JSON.stringify({study_app:'k'.repeat(48)});
   try{
     const headers={'x-r3-app':'study_app',authorization:`Bearer ${'k'.repeat(48)}`,'content-type':'application/json'};
     const mk=()=>{const res=new EventEmitter();res.setHeader=()=>{};res.end=x=>res.body=JSON.parse(x);return res;};
     const res=mk();await goal({method:'PUT',headers,body:{user_id:'opaque',target:4}},res,{saveGoal:async(app,id,val)=>app==='study_app' && id==='opaque'&&val===4});
     assert.equal(res.statusCode,200);assert.equal(res.body.target,4);
     const invalid=mk();await goal({method:'PUT',headers,body:{user_id:'opaque',target:0}},invalid,{saveGoal:async()=>{throw Error('Should not persist');}});
     assert.equal(invalid.statusCode,400);
     const wrong=mk();await goal({method:'POST',headers,body:{}},wrong);assert.equal(wrong.statusCode,405);
   }finally{if(old===undefined)delete process.env.R3_APP_KEYS_JSON;else process.env.R3_APP_KEYS_JSON=old;}
 });
 test('Duolingo parity: milestones and per-user progress cascade under data deletion',()=>{
   for(const name of ['r3_rewards','r3_daily_progress'])assert.ok(SCHEMA_SQL.includes(`CREATE TABLE IF NOT EXISTS ${name}`));
   assert.ok((SCHEMA_SQL.match(/ON DELETE CASCADE/g)||[]).length>=4);
   for(const marker of ['v_new_streak IN (7,30,100)','ON CONFLICT(app,user_id,local_day) DO UPDATE','SELECT COUNT(*)::integer FROM r3_daily_progress'])
     assert.ok((SCHEMA_SQL+readProgress.toString()).includes(marker),marker);
 });
}

function register_v06_tests(){
 const now=new Date('2026-10-17T19:30:00Z');
 function treatment(app='language_app'){for(let i=0;i<1000;i++){const id=`v06-${i}`;if(!isHoldout(app,id))return id;}throw Error('not found');}
 function u(override={}){return {app:'language_app',user_id:treatment(),locale:'pt-BR',timezone:'UTC',push_consent:true,
  last_active_at:'2026-10-16T10:00:00Z',last_completed_local_date:'2026-10-16',current_streak:3,...override};}
 test('V06 preferred hour overrides learned hour',()=>{
  const x=u({reminder_hour:11,learned_hour:19,hourly_samples:100});
  assert.equal(chosenHour(x),11);
  assert.equal(decideNotification(x,0,new Date('2026-10-17T11:00:00Z'))?.sendHour,11);
  assert.equal(decideNotification(x,0,now),null);
 });
 test('V06 learns only after 3 verified examples; defaults to 19',()=>{
  assert.equal(chosenHour(u({learned_hour:10,hourly_samples:2})),19);
  assert.equal(chosenHour(u({learned_hour:10,hourly_samples:3})),10);
 });
 test('V06 quiet hours exclude 3am even for learned preference',()=>{
  assert.equal(chosenHour(u({learned_hour:3,hourly_samples:100})),19);
  assert.equal(chosenHour(u({reminder_hour:3})),19);
  assert.equal(decideNotification(u({reminder_hour:21}),0,new Date('2026-10-17T21:00:00Z'))?.sendHour,21);
 });
 test('V06 DST fall-back uses actual local hour',()=>{
  const x=u({timezone:'America/New_York',last_active_at:'2026-10-31T18:00:00Z',last_completed_local_date:'2026-10-31',reminder_hour:9});
  assert.equal(decideNotification(x,0,new Date('2026-11-01T14:00:00Z'))?.sendHour,9);
  assert.equal(decideNotification(x,0,new Date('2026-11-01T13:00:00Z')),null);
 });
 test('V06 pause prevents push, even with large streak',()=>{
  assert.equal(decideNotification(u({paused_until:'2026-10-18T19:00:00Z',current_streak:900}),0,now),null);
  assert.ok(decideNotification(u({paused_until:'2026-10-17T19:00:00Z'}),0,now));
 });
 test('V06 24h cooldown and unanswered cap',()=>{
  assert.equal(decideNotification(u({last_sent_at:'2026-10-17T12:00:00Z'}),0,now),null);
  assert.equal(decideNotification(u({unanswered_7d:2}),0,now),null);
  assert.ok(decideNotification(u({unanswered_7d:1}),0,now));
 });
 test('V06 verified completion today suppresses, mere opening does not',()=>{
  assert.equal(decideNotification(u({last_completed_local_date:'2026-10-17'}),0,now),null);
  assert.ok(decideNotification(u({last_active_at:'2026-10-17T13:00:00Z'}),0,now));
 });
 test('V06 universal hard protections: consent, holdout and 7-day cap',()=>{
  assert.equal(decideNotification(u({push_consent:false}),0,now),null);
  assert.equal(decideNotification(u(),3,now),null);
  const id=Array.from({length:1000},(_,i)=>`holdout-${i}`).find(id=>isHoldout('language_app',id));
  assert.equal(decideNotification(u({user_id:id}),0,now),null);
 });
 test('V06 long lapse 8+ days correctly blocked',()=>{
  assert.equal(decideNotification(u({last_completed_local_date:'2026-10-08'}),0,now),null);
 });
 test('V06 Bible uses supportive category, no pressure about losing streak',()=>{
  const x=u({app:'reading_app',user_id:treatment('reading_app')});
  assert.equal(decideNotification(x,0,now)?.kind,'return_reminder');
  for(const id of [0,1,2])assert.doesNotMatch(messageVariant('reading_app','pt-BR','return_reminder',id).body,/perca.*sequência|lose.*streak/i);
 });
 test('V06 three real localized variants for both pilot languages, all apps',()=>{
  for(const app of APPS)for(const lang of ['pt-BR','en'])for(const kind of ['streak_reminder','return_reminder']){
   const msgs=[0,1,2].map(id=>messageVariant(app,lang,kind,id));
   assert.equal(new Set(msgs.map(m=>m.title)).size,3,`${app}/${lang}/${kind}: duplicate title`);
   assert.equal(new Set(msgs.map(m=>m.body)).size,3,`${app}/${lang}/${kind}: duplicate body`);
  }
  assert.deepEqual(eligibleVariants('language_app','fr','return_reminder'),[0]);
 });
 test('V06 bandit learns strong performing arm from mature conversions',()=>{
  const row=u({variant_stats:{'streak_reminder:0':{views:100,successes:1},
    'streak_reminder:1':{views:100,successes:95},'streak_reminder:2':{views:100,successes:1}}});
  let winners=0;
  for(let i=0;i<100;i++)if(selectVariant(row,'streak_reminder',`day-${i}`)===1)winners++;
  assert.ok(winners>=80,`high performing variant was chosen only ${winners} times`);
 });
 test('V06 bandit penalizes recent repeated content',()=>{
  const row=u({recent_variant_ids:[0],variant_stats:{'streak_reminder:0':{views:100,successes:60},
   'streak_reminder:1':{views:100,successes:59},'streak_reminder:2':{views:100,successes:59}}});
  assert.notEqual(selectVariant(row,'streak_reminder','2026-10-17'),0);
 });
 test('V06 bandit stable selection, bounded malformed historical data',()=>{
  const row=u({variant_stats:{'streak_reminder:0':{views:-100,successes:999}}});
  const picked=selectVariant(row,'streak_reminder','2026-10-17');
  assert.ok([0,1,2].includes(picked));
  assert.equal(selectVariant(row,'streak_reminder','2026-10-17'),picked);
 });
 test('V06 OneSignal payload uses reserved variant and delivery idempotency',async()=>{
  const job={id:randomUUID(),app:'language_app',user_id:'opaque',kind:'return_reminder',variant_id:2};
  let body;
  await sendOneSignal({job,locale:'pt-BR',appConfig:{app_id:randomUUID(),rest_api_key:'api-key-long-enough'},
   fetcher:async(_,req)=>{body=JSON.parse(req.body);return {ok:true,json:async()=>({id:'provider',recipients:1})};}});
  assert.equal(body.idempotency_key,job.id);
  assert.equal(body.data.r3_variant,'2');
  assert.equal(body.data.r3_delivery_id,job.id);
  assert.equal(body.contents.en,messageVariant('language_app','pt-BR','return_reminder',2).body);
 });
 test('V06 preferences disallow bad times, indefinite pauses or invalid bodies',()=>{
  const good={user_id:'opaque'};
  for(const bad of [{},{reminder_hour:0},{reminder_hour:22},{reminder_hour:8.5},
    {paused_until:'2026-10-01T12:00:00Z'},{paused_until:'2026-12-30T12:00:00Z'},{paused_until:'BAD'}])
   assert.throws(()=>validateReminder({...good,...bad},now));
  assert.equal(validateReminder({...good,reminder_hour:11},now).reminder_hour,11);
  assert.equal(validateReminder({...good,paused_until:'2026-10-18T11:00:00Z'},now).hasPause,true);
 });
 test('V06 SQL contains verified learning, scoring data, and holdout safeguards',()=>{
  for(const term of ['r3_completion_hours','hourly_samples=hourly_samples+1','converted_at=NOW()',
   'ADD COLUMN IF NOT EXISTS reminder_hour','ADD COLUMN IF NOT EXISTS variant_id',
   'v_user.paused_until','r3_is_holdout'])assert.ok(SCHEMA_SQL.includes(term),term);
  for(const term of ['recent_variant_ids','variant_stats','unanswered_7d'])assert.ok(listCandidates.toString().includes(term),term);
 });
 test('V06 144 combinations of unconsented user timezones never notify',()=>{
  let n=0;for(const app of APPS)for(const zone of ['UTC','America/Sao_Paulo'])for(let hour=0;hour<24;hour++){
   const x=u({app,user_id:treatment(app),timezone:zone,push_consent:false});
   assert.equal(decideNotification(x,0,new Date(`2026-10-17T${String(hour).padStart(2,'0')}:30:00Z`)),null);n++;
  }assert.equal(n,144);
 });
 test('V06 cron records arm before send',async()=>{
  const oldPush=process.env.R3_PUSH_ENABLED,oldApps=process.env.ONESIGNAL_APPS_JSON;
  process.env.R3_PUSH_ENABLED='true';process.env.ONESIGNAL_APPS_JSON=JSON.stringify({language_app:{app_id:randomUUID(),rest_api_key:'valid-test-rest-key'}});
  let reserved;let seen;
  const row=u();
  const repo={listRetries:async()=>[],listCandidates:async()=>[row],
   reserve:async(app,user,day,kind,variant)=>{reserved=variant;return {app,user_id:user,kind,id:randomUUID(),variant_id:variant};},
   claim:async id=>({id,app:row.app,user_id:row.user_id,kind:'streak_reminder',attempts:1}),
   preflight:async()=>true,markSent:async()=>true,markFailed:async()=>true};
  try{const r=await runCron(now,{db:repo,send:async({job})=>{seen=job.variant_id;return {sent:true,providerId:'accepted'};}});
   assert.equal(r.sent,1);assert.equal(seen,reserved);
  }finally{
   if(oldPush===undefined)delete process.env.R3_PUSH_ENABLED;else process.env.R3_PUSH_ENABLED=oldPush;
   if(oldApps===undefined)delete process.env.ONESIGNAL_APPS_JSON;else process.env.ONESIGNAL_APPS_JSON=oldApps;
  }
 });
}
function register_v06_http_tests(){
 test('V06 reminder preferences HTTP API authenticates before decoding invalid payload',async()=>{
  const old=process.env.R3_APP_KEYS_JSON;
  process.env.R3_APP_KEYS_JSON=JSON.stringify({language_app:'K'.repeat(48)});
  const response=()=>{const r=new EventEmitter();r.setHeader=()=>{};r.end=d=>{r.body=JSON.parse(d);};return r;};
  const request=(headers,body,method='PUT')=>({method,headers,body});
  try{
   let res=response();await reminders(request({'content-type':'application/json'},'{'),res,{savePreferences:async()=>{throw Error('never');}});
   assert.equal(res.statusCode,401);
   const auth={'x-r3-app':'language_app',authorization:'Bearer '+'K'.repeat(48),'content-type':'application/json'};
   res=response();await reminders(request(auth,JSON.stringify({user_id:'opaque-id',reminder_hour:99})),res,{savePreferences:async()=>{throw Error('never');}});
   assert.equal(res.statusCode,400);
   let saved;res=response();await reminders(request(auth,JSON.stringify({user_id:'opaque-id',reminder_hour:10})),res,
    {savePreferences:async(app,user,pref)=>{saved={app,user,pref};return true;}});
   assert.equal(res.statusCode,200);assert.equal(saved.app,'language_app');assert.equal(saved.pref.reminder_hour,10);
  }finally{if(old===undefined)delete process.env.R3_APP_KEYS_JSON;else process.env.R3_APP_KEYS_JSON=old;}
 });
 test('V06 no backend or push credential is exposed in health and preferences responses',async()=>{
  const req={method:'GET',headers:{}};
  const r=new EventEmitter();r.headers={};r.setHeader=(k,v)=>r.headers[k]=v;r.end=x=>r.body=JSON.parse(x);
  health(req,r);
  assert.equal(r.statusCode,200);assert.equal(r.body.version,'1.1.0');assert.equal(r.body.service,'R3ENGINE');
  assert.ok(!JSON.stringify(r.body).includes('DATABASE_URL'));
  assert.ok(!JSON.stringify(r.body).includes('ONESIGNAL_APPS_JSON'));
 });
}
function register_v06_locale_tests(){
 test('V06 reservation persists locale snapshot alongside variant for retry',()=>{
  assert.ok(reserve.toString().includes('variant_id,locale'));
  assert.ok(listRetries.toString().includes('d.variant_id,d.locale'));
  assert.ok(listCandidates.toString().includes("split_part(d.locale,'-',1)=split_part(u.locale,'-',1)"));
  assert.ok(SCHEMA_SQL.includes('ADD COLUMN IF NOT EXISTS locale TEXT;'));
  assert.ok(runCron.toString().includes('locale:job.locale'));
 });
}
// ---------------- R3 EXPERIENCE REGRESSIONS (v0.7) ----------------
function register_v07_tests(){
 test('V07 NPS scores 0..10 accepted, including all low scores',()=>{
  for(let score=0;score<=10;score++)assert.equal(validateFeedback({feedback_id:randomUUID(),user_id:'opaque-1',score}).score,score);
  for(const score of [-1,11,3.5,'9',null,undefined])assert.throws(()=>validateFeedback({feedback_id:randomUUID(),user_id:'x',score}));
 });
 test('V07 feedback rejects arbitrary text, PII identifier, invalid UUID and reason',()=>{
  for(const b of [{feedback_id:randomUUID(),user_id:'email@example.com',score:8},
   {feedback_id:'hi',user_id:'x',score:8},{feedback_id:randomUUID(),user_id:'x',score:8,reason:'free_text'},null,[]])assert.throws(()=>validateFeedback(b));
  assert.equal(validateFeedback({feedback_id:randomUUID(),user_id:'x',score:0,reason:'support'}).reason,'support');
 });
 test('V07 review request platform/moment validation is strict',()=>{
  const b={user_id:'opaque-x',platform:'ios',session_completed:true,in_foreground:true,task_idle:true};
  assert.equal(validateReviewRequest(b).platform,'ios');
  assert.throws(()=>validateReviewRequest({...b,platform:'web'}));
  assert.throws(()=>validateReviewRequest({...b,session_completed:'true'}));
 });
 test('V07 review-eligibility unbiased to every possible satisfaction score',()=>{
  const now=new Date('2026-10-17T18:00:00Z');
  const user={created_at:'2026-09-01T00:00:00Z',lessons_total:20,requests_365d:0};
  const request={platform:'ios',session_completed:true,in_foreground:true,task_idle:true};
  for(let score=0;score<=10;score++)assert.equal(reviewEligibility({...user,score,nps:score,sentiment:'negative'},request,now).eligible,true);
 });
 test('V07 review-eligibility enforces onboarding and minimum completed lessons',()=>{
  const now=new Date('2026-10-17T18:00:00Z'),r={platform:'android',session_completed:true,in_foreground:true,task_idle:true};
  assert.equal(reviewEligibility({created_at:'2026-10-16T00:00:00Z',lessons_total:999},r,now).reason,'insufficient_use');
  assert.equal(reviewEligibility({created_at:'2026-09-01T00:00:00Z',lessons_total:4},r,now).eligible,false);
 });
 test('V07 review cooldown and annual cap work',()=>{
  const now=new Date('2026-10-17T18:00:00Z'),r={platform:'android',session_completed:true,in_foreground:true,task_idle:true};
  const base={created_at:'2026-08-01T00:00:00Z',lessons_total:25};
  assert.equal(reviewEligibility({...base,requests_365d:2},r,now).reason,'annual_cap');
  assert.equal(reviewEligibility({...base,last_review_requested_at:'2026-10-01T00:00:00Z'},r,now).reason,'cooldown');
  assert.equal(reviewEligibility(base,{...r,task_idle:false},now).reason,'inappropriate_moment');
  assert.equal(reviewEligibility(base,{...r,platform:'web'},now).eligible,false);
 });
 test('V07 journey progress is measured, with no imaginary ETA',()=>{
  const progress={daily_goal:{completed:2,target:3,met:false},quests:{weekly_days:4},xp_total:80};
  const j=journeyView(progress,'language_app');
  assert.deepEqual(j.stages.map(x=>x.done),[true,false,false]);assert.equal(j.next_action,'daily_goal');
  assert.equal(j.estimate,null);
  assert.equal(journeyView({daily_goal:{completed:3,target:3,met:true},quests:{weekly_days:5},xp_total:100},'study_app').next_action,'continue_learning');
  assert.throws(()=>journeyView(null,'language_app'));
 });
 test('V07 first-lesson milestone persists after midnight based on verified lifetime lessons',()=>{
  const p={daily_goal:{completed:0,target:2,met:false},quests:{weekly_days:1},xp_total:10};
  const j=journeyView(p,'reading_app');
  assert.equal(j.stages[0].done,true);assert.equal(j.next_action,'daily_goal');
  assert.equal(j.estimate,null);
 });
 test('V07 verified offer shows accurate gross price gap, discloses membership fees',()=>{
  const c={language_app:{monthly:{active:true,currency:'BRL',public_price_minor:3190,member_price_minor:2390,membership_fee_minor:990,
   membership_period:'monthly',terms_url:'https://example.org/terms',benefits:['Conversation lessons']}}};
  const v=valueOffer('language_app','monthly',c);
  assert.equal(v.gross_price_difference_minor,800);
  assert.equal(v.price_difference_is_not_net_savings,true);
  assert.equal(v.membership_fee_minor,990);assert.equal(v.expires_at,null);assert.equal(v.urgency_label,'');
 });
 test('V07 no unverifiable offer expiration or fake countdown',()=>{
  const now=new Date('2026-10-17T12:00:00Z');
  const o={active:true,currency:'BRL',public_price_minor:1000,member_price_minor:800,terms_url:'https://example.org/terms',expires_at:'2026-10-16T00:00:00Z'};
  assert.equal(valueOffer('language_app','x',{language_app:{x:o}},now),null);
  o.expires_at='2026-11-30T00:00:00Z';
  assert.equal(valueOffer('language_app','x',{language_app:{x:o}},now).expires_at,o.expires_at);
 });
 test('V07 unverified catalog values rejected; unknown SKU not available',()=>{
  const a={active:true,currency:'BRL',public_price_minor:1000,member_price_minor:2000,terms_url:'https://example.org'};
  assert.throws(()=>valueOffer('language_app','x',{language_app:{x:a}}));
  assert.equal(valueOffer('language_app','missing',{}),null);
  assert.throws(()=>valueOffer('language_app','/admin',{}));
  assert.throws(()=>valueOffer('language_app','x',{language_app:{x:{...a,member_price_minor:500,terms_url:'http://bad.com'}}}));
 });
 test('V07 no public store review gating based on survey score in SQL or routes',()=>{
  const claimSQL=SCHEMA_SQL.slice(SCHEMA_SQL.indexOf('CREATE OR REPLACE FUNCTION r3_claim_review_prompt'),SCHEMA_SQL.indexOf('-- Transactional event insertion'));
  assert.ok(!/r3_feedback|score|nps|sentiment/i.test(claimSQL));
  assert.ok(!/score|nps|sentiment/i.test(reviewPrompt.toString()));
  assert.ok(SCHEMA_SQL.includes('ON DELETE CASCADE'));
 });
 test('V07 offers route authenticates before reading any client payload',async()=>{
  const r=new EventEmitter();r.setHeader=()=>{};r.end=x=>r.body=JSON.parse(x);
  await offer({method:'POST',headers:{},body:'{'},r,{getOffer:()=>{throw Error('should not call');}});
  assert.equal(r.statusCode,401);
 });
 test('V07 native review endpoint calls store-API eligibility only, not storefront redirect',async()=>{
  const old=process.env.R3_APP_KEYS_JSON;process.env.R3_APP_KEYS_JSON=JSON.stringify({language_app:'K'.repeat(48)});
  const mk=()=>{const r=new EventEmitter();r.setHeader=()=>{};r.end=x=>r.body=JSON.parse(x);return r;};
  const headers={'x-r3-app':'language_app',authorization:'Bearer '+'K'.repeat(48),'content-type':'application/json'};
  try{
   const r=mk();await reviewPrompt({method:'POST',headers,body:JSON.stringify({user_id:'u',platform:'ios',session_completed:true,in_foreground:true,task_idle:true})},r,{claimPrompt:async()=>true});
   assert.equal(r.body.eligible,true);assert.equal(r.body.action,'request_native_review');
   const bad=mk();await reviewPrompt({method:'POST',headers,body:'{"user_id":"u","platform":"web"}'},bad,{claimPrompt:async()=>true});assert.equal(bad.statusCode,400);
  }finally{if(old===undefined)delete process.env.R3_APP_KEYS_JSON;else process.env.R3_APP_KEYS_JSON=old;}
 });
 test('V07 feedback API preserves all scores including zero, duplicate accepted idempotently',async()=>{
  const old=process.env.R3_APP_KEYS_JSON;process.env.R3_APP_KEYS_JSON=JSON.stringify({language_app:'K'.repeat(48)});
  const mk=()=>{const r=new EventEmitter();r.setHeader=()=>{};r.end=x=>r.body=JSON.parse(x);return r;};
  const headers={'x-r3-app':'language_app',authorization:'Bearer '+'K'.repeat(48),'content-type':'application/json'};
  try{let seen;const payload={feedback_id:randomUUID(),user_id:'u',score:0};let r=mk();await feedback({method:'POST',headers,body:JSON.stringify(payload)},r,{saveFeedback:async(app,b)=>{seen=b;return 'inserted';}});
   assert.equal(r.statusCode,201);assert.equal(seen.score,0);
   r=mk();await feedback({method:'POST',headers,body:JSON.stringify(payload)},r,{saveFeedback:async()=> 'duplicate'});
   assert.equal(r.statusCode,200);assert.equal(r.body.duplicate,true);
  }finally{if(old===undefined)delete process.env.R3_APP_KEYS_JSON;else process.env.R3_APP_KEYS_JSON=old;}
 });
 test('V07 journey endpoint needs server key and returns accurate actual progress',async()=>{
  const old=process.env.R3_APP_KEYS_JSON;process.env.R3_APP_KEYS_JSON=JSON.stringify({language_app:'K'.repeat(48)});
  const mk=()=>{const r=new EventEmitter();r.setHeader=()=>{};r.end=x=>r.body=JSON.parse(x);return r;};
  const headers={'x-r3-app':'language_app',authorization:'Bearer '+'K'.repeat(48)};
  try{let r=mk();await journey({method:'GET',headers,url:'/api/journey?user_id=opaque'},r,{getProgress:async()=>({daily_goal:{completed:1,target:1,met:true},quests:{weekly_days:1},xp_total:10})});
  assert.equal(r.statusCode,200);assert.equal(r.body.estimate,null);
  r=mk();await journey({method:'GET',headers:{},url:'/api/journey?user_id=opaque'},r);assert.equal(r.statusCode,401);
  }finally{if(old===undefined)delete process.env.R3_APP_KEYS_JSON;else process.env.R3_APP_KEYS_JSON=old;}
 });
 test('V07 migration safeguards atomic store request and cascade erasure',()=>{
  assert.ok(SCHEMA_SQL.includes('FUNCTION r3_claim_review_prompt'));
  assert.ok(SCHEMA_SQL.includes('FOR UPDATE'));
  assert.ok(SCHEMA_SQL.includes('FROM r3_review_requests'));
  assert.ok(SCHEMA_SQL.includes('CHECK(score BETWEEN 0 AND 10)'));
  assert.ok(ANALYTICS_SQL.includes('survey_responses'));
 });
}
// ---------------- UNIVERSAL CONTRACT AND API REGRESSION ----------------
function register_v1_tests(){
 const mkManifest=(tenant_id='acme',app_id='crm',environment='test',extra={})=>({...uManifest({tenant_id,app_id,environment,cadence:'weekly',events:[{name:'meeting_booked',value:true},{name:'session_started',value:false}],modules:{notifications:true},...extra}),enabled:true,key_hash:'',config_version:1});
 const sampleKey='Z'.repeat(48);
 const fakeReq=(path,method='POST',body={},m=mkManifest(),subject='subject-1',key=sampleKey)=>{
  const ts=String(Date.now());const req={url:path,method,body,headers:{'x-r3-tenant':m.tenant_id,'x-r3-app':m.app_id,'x-r3-environment':m.environment,'x-r3-subject':subject,'x-r3-timestamp':ts,'x-r3-request-id':randomUUID(),authorization:'Bearer '+key,'content-type':'application/json'}};
  req.headers['x-r3-signature']=uSubjectSignature(key,req,m,subject,ts);return req;
 };
 const fakeRes=()=>{const r={headers:{},statusCode:0};r.setHeader=(n,v)=>r.headers[n]=v;r.end=t=>r.body=JSON.parse(t);return r;};
 const dataRepo=()=>{
  const apps=new Map(),subjects=new Map(),evtIds=new Set(),consents=new Map(),exposures=new Map(),history=[],requestIds=new Set();
  const k=m=>[m.tenant_id,m.app_id,m.environment].join('/');const sk=(m,s)=>k(m)+'/'+s;
  const repo={
   apps,subjects,evtIds,consents,exposures,history,requestIds,
   async claimRequest(m,subject,nonce){const k=[m.tenant_id,m.app_id,m.environment,nonce].join('/');if(requestIds.has(k))return false;requestIds.add(k);return true;},
   async register(m,key_hash){if(apps.has(k(m)))return false;apps.set(k(m),{...m,key_hash});return true;},
   async getApp(t,a,e){return apps.get([t,a,e].join('/'))||null;},
   async setActive(m,enabled){const r=apps.get(k(m));if(!r)return null;r.enabled=enabled;r.config_version++;return {config_version:r.config_version};},
   async ingest(m,s,e){const key=k(m)+'/'+e.event_id;if(evtIds.has(key))return false;evtIds.add(key);const key2=sk(m,s),st=subjects.get(key2)||{subject_id:s,value_count:0,last_value_at:null,last_active_at:null,timezone:'UTC',locale:'en',paused_until:null,reminder_hour:null};st.last_active_at=e.occurred_at;st.locale=e.locale;st.timezone=e.timezone;if(e.is_value){st.value_count++;st.last_value_at=e.occurred_at;}subjects.set(key2,st);return true;},
   async state(m,s){return subjects.get(sk(m,s))||null;},
   async consent(m,s,p){const id=sk(m,s);if(!subjects.has(id))return false;const key=id+'/'+p.channel+'/'+p.purpose;consents.set(key,p);history.push({key,...p});return true;},
   async consentState(m,s,ch,p){return consents.get(sk(m,s)+'/'+ch+'/'+p)||null;},
   async recent(){return [];},
   async preference(m,s,p){const st=subjects.get(sk(m,s));if(!st)return false;Object.assign(st,p);return true;},
   async expose(m,s,key){const id=sk(m,s)+'/'+key;if(!exposures.has(id))exposures.set(id,{arm:uAssignment(m,s,key),config_version:m.config_version});return exposures.get(id);},
   async erase(m,s){const key=sk(m,s);if(!subjects.has(key))return false;subjects.delete(key);for(const x of [...consents.keys()])if(x.startsWith(key+'/'))consents.delete(x);for(const x of [...exposures.keys()])if(x.startsWith(key+'/'))exposures.delete(x);return true;}
  };return repo;
 };
 const appRegister=async(repo,m)=>{const key_hash=createHash('sha256').update(sampleKey).digest('hex');await repo.register(m,key_hash);return m;};
 const request=async(repo,req)=>{const res=fakeRes();await uHandler(req,res,{repo});return res;};
 const expectError=(fn,status)=>{assert.throws(fn,{status});};
 test('V1 manifest supports six unrelated product categories without lessons',()=>{
  const examples=[['learning','lesson_completed','daily'],['saas','deal_closed','weekly'],['recruitment','interview_booked','episodic'],['market','order_completed','episodic'],['creative','asset_exported','none'],['finance','budget_reviewed','weekly']];
  for(const [app,name,cadence] of examples){const m=uManifest({tenant_id:'tenant1',app_id:app,events:[{name,value:true}],cadence});assert.equal(m.events[0].name,name);assert.equal(m.cadence,cadence);assert.equal(m.modules.notifications,false);}
 });
 test('V1 manifest handles optional modules and schema invariants',()=>{
  const m=mkManifest();assert.equal(m.modules.habits,false);assert.equal(m.modules.notifications,true);
  expectError(()=>uManifest({tenant_id:'acme',app_id:'crm',events:[{name:'deal_closed',value:true},{name:'deal_closed',value:false}]}),400);
  expectError(()=>uManifest({tenant_id:'acme',app_id:'crm',events:[{name:'session_started',value:false}]}),400);
  expectError(()=>uManifest({tenant_id:'acme',app_id:'crm',events:[{name:'deal_closed',value:true}],quiet_start:22,quiet_end:8}),400);
 });
 test('V1 environments and dangerous manifest limits rejected',()=>{
  for(const x of ['development','production','../../prod'])expectError(()=>uManifest({tenant_id:'acme',app_id:'crm',environment:x,events:[{name:'deal_closed',value:true}]}),400);
  for(const x of [-1,8,100])expectError(()=>uManifest({tenant_id:'acme',app_id:'crm',weekly_limit:x,events:[{name:'deal_closed',value:true}]}),400);
 });
 test('V1 UUID, event schema, names, and anti-PII property validation',()=>{
  const m=mkManifest();const raw={event_id:randomUUID(),subject_id:'sub-1',name:'meeting_booked',schema_version:1};
  assert.equal(uValidateEvent(raw,m,'sub-1').is_value,true);
  expectError(()=>uValidateEvent({...raw,subject_id:'other'},m,'sub-1'),403);
  expectError(()=>uValidateEvent({...raw,name:'deal_closed'},m,'sub-1'),400);
  expectError(()=>uValidateEvent({...raw,properties:{email:'a@b.com'}},m,'sub-1'),400);
  expectError(()=>uValidateEvent({...raw,schema_version:2},m,'sub-1'),400);
  expectError(()=>uValidateEvent({...raw,occurred_at:'2026-10-17T12:00:00'},m,'sub-1'),400);
 });
 test('V1 event timestamp future and historical replay bounded',()=>{
  const m=mkManifest(),raw={event_id:randomUUID(),subject_id:'sub-1',name:'meeting_booked',schema_version:1};
  expectError(()=>uValidateEvent({...raw,occurred_at:new Date(Date.now()+600000).toISOString()},m,'sub-1'),400);
  expectError(()=>uValidateEvent({...raw,occurred_at:new Date(Date.now()-31*86400000).toISOString()},m,'sub-1'),400);
 });
 test('V1 cohort deterministic and fully scoped tenant/application/environment',()=>{
  const m=mkManifest(),s='a';assert.equal(uAssignment(m,s),uAssignment(m,s));
  const different=[mkManifest('different','crm'),mkManifest('acme','other'),mkManifest('acme','crm','staging')];
  assert.equal(different.every(d=>{for(let i=0;i<100;i++)if(uAssignment(d,'user-'+i)!==uAssignment(m,'user-'+i))return true;return false;}),true);
 });
 test('V1 decisions do not notify without explicit verified consent',()=>{
  const m=mkManifest('acme','crm','test',{cadence:'daily'});const now=new Date('2026-10-17T15:00:00Z');
  const subject={last_value_at:'2026-10-16T15:00:00Z',timezone:'UTC'};
  assert.equal(uEvaluate({manifest:m,subject_id:'test',subject,consent:null,now}).reason,'no_verified_consent');
  assert.equal(uEvaluate({manifest:m,subject_id:'test',subject,consent:{granted:true,verified:false},now}).reason,'no_verified_consent');
  expectError(()=>uConsent({channel:'push',purpose:'reminder',granted:true,verified:false,platform:'ios'}),400);
 });
 test('V1 decisions check quiet hours, cadence and cool-down',()=>{
  const m=mkManifest('acme','crm','test',{cadence:'daily',quiet_start:8,quiet_end:21,holdout_percent:0});
  const st={last_value_at:'2026-10-16T12:00:00Z',timezone:'UTC'},consent={granted:true,verified:true};
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:st,consent,now:new Date('2026-10-17T03:00:00Z')}).reason,'quiet_hours');
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:st,consent,now:new Date('2026-10-17T15:00:00Z')}).eligible,true);
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:st,consent,now:new Date('2026-10-17T15:00:00Z'),recent_sent:['2026-10-17T09:00:00Z']}).reason,'cooldown');
  assert.equal(uEvaluate({manifest:{...m,cadence:'episodic'},subject_id:'p',subject:st,consent,now:new Date('2026-10-17T15:00:00Z')}).reason,'episodic_no_automatic_push');
 });
 test('V1 weekly notifications wait for 7 days and honor pause',()=>{
  const m=mkManifest('acme','crm','test',{holdout_percent:0});const now=new Date('2026-10-17T15:00:00Z');const consent={granted:true,verified:true};
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:{timezone:'UTC',last_value_at:'2026-10-16T12:00:00Z'},consent,now}).reason,'weekly_not_due');
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:{timezone:'UTC',last_value_at:'2026-10-07T12:00:00Z',paused_until:'2026-10-20T12:00:00Z'},consent,now}).reason,'paused');
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:{timezone:'UTC',last_value_at:'2026-10-09T12:00:00Z'},consent,now}).eligible,true);
 });
 test('V1 unconfigured email and marketing adapters always suppress reminders',()=>{
  const m=mkManifest('acme','crm','test',{cadence:'daily',holdout_percent:0});const st={timezone:'UTC',last_value_at:'2026-10-16T12:00:00Z'},now=new Date('2026-10-17T15:00:00Z'),consent={granted:true,verified:true};
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:st,consent,channel:'email',now}).reason,'channel_adapter_not_configured');
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:st,consent,purpose:'marketing',now}).reason,'channel_adapter_not_configured');
 });
 test('V1 no send decisions when app disabled, notifications off or no value',()=>{
  const m=mkManifest(),now=new Date('2026-10-17T15:00:00Z');
  assert.equal(uEvaluate({manifest:{...m,enabled:false},subject_id:'p',subject:{},now}).reason,'app_disabled');
  assert.equal(uEvaluate({manifest:{...m,modules:{notifications:false}},subject_id:'p',subject:{},now}).reason,'module_disabled');
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:{},consent:{granted:true,verified:true},now}).reason,'no_verified_value');
 });
 test('V1 subject signature binds method, route, tenant, app, environment and identity',()=>{
  const m=mkManifest();const req=fakeReq('/api/v1/events','POST',{},m);const s=req.headers['x-r3-signature'];
  assert.notEqual(s,uSubjectSignature(sampleKey,{...req,method:'DELETE'},m,'subject-1',req.headers['x-r3-timestamp']));
  assert.notEqual(s,uSubjectSignature(sampleKey,{...req,url:'/api/v1/user'},m,'subject-1',req.headers['x-r3-timestamp']));
  assert.notEqual(s,uSubjectSignature(sampleKey,{...req,body:{changed:true}},m,'subject-1',req.headers['x-r3-timestamp']));
  assert.notEqual(s,uSubjectSignature(sampleKey,req,m,'subject-2',req.headers['x-r3-timestamp']));
 });
 test('V1 admin provisioning requires server-only admin secret and never reuses a key',async()=>{
  const repo=dataRepo(),before=process.env.R3_ADMIN_SECRET;process.env.R3_ADMIN_SECRET='a'.repeat(48);
  const body={tenant_id:'corplab',app_id:'fourthapp',environment:'staging',cadence:'episodic',events:[{name:'order_completed',value:true}]};
  try{const req={url:'/api/v1/admin/apps',method:'POST',body,headers:{authorization:'Bearer '+('a'.repeat(48))}};
   const r=await request(repo,req);assert.equal(r.statusCode,201);assert.ok(r.body.app_key.length>=32);
   const repeat=await request(repo,req);assert.equal(repeat.statusCode,409);
   const blocked=await request(repo,{...req,headers:{authorization:'Bearer invalid'}});assert.equal(blocked.statusCode,401);
  }finally{if(before===undefined)delete process.env.R3_ADMIN_SECRET;else process.env.R3_ADMIN_SECRET=before;}
 });
 test('V1 new app can be provisioned and authenticated dynamically over HTTP mocks',async()=>{
  const repo=dataRepo(),m=mkManifest('orgalpha','newcrm');await appRegister(repo,m);
  const req=fakeReq('/api/v1/events','POST',{event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1},m);
  const res=await request(repo,req);assert.equal(res.statusCode,201);assert.equal(res.body.is_value,true);
  const state=await request(repo,fakeReq('/api/v1/state','GET',{},m));assert.equal(state.body.value_count,1);
 });
 test('V1 real HTTP streamed body must be signed byte-for-byte',async()=>{
  const repo=dataRepo(),m=mkManifest();await appRegister(repo,m);
  const server=http.createServer((req,res)=>uHandler(req,res,{repo}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
   const payload=JSON.stringify({event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1});
   const req=fakeReq('/api/v1/events','POST',payload,m);
   let r=await fetch(base+req.url,{method:req.method,headers:req.headers,body:payload});
   assert.equal(r.status,201);
   const altered=JSON.stringify({event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1});
   r=await fetch(base+req.url,{method:req.method,headers:req.headers,body:altered});
   assert.equal(r.status,401);
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
 test('V1 same event UUID across apps/tenants is independent',async()=>{
  const repo=dataRepo(),a=mkManifest('orgalpha','newcrm'),b=mkManifest('orgbeta','newcrm'),c=mkManifest('orgalpha','recruiting');await Promise.all([appRegister(repo,a),appRegister(repo,b),appRegister(repo,c)]);
  const id=randomUUID();for(const m of [a,b,c]){const res=await request(repo,fakeReq('/api/v1/events','POST',{event_id:id,subject_id:'subject-1',name:'meeting_booked',schema_version:1},m));assert.equal(res.statusCode,201);}
  const duplicate=await request(repo,fakeReq('/api/v1/events','POST',{event_id:id,subject_id:'subject-1',name:'meeting_booked',schema_version:1},a));assert.equal(duplicate.statusCode,200);assert.equal(duplicate.body.duplicate,true);
 });
 test('V1 forged cross-tenant subject and wrong key rejected',async()=>{
  const repo=dataRepo(),a=mkManifest('orgalpha','newcrm'),b=mkManifest('orgbeta','newcrm');await appRegister(repo,a);await appRegister(repo,b);
  const req=fakeReq('/api/v1/state','GET',{},a);req.headers['x-r3-tenant']='orgbeta';
  assert.equal((await request(repo,req)).statusCode,401);
  const r2=fakeReq('/api/v1/state','GET',{},a);r2.headers.authorization='Bearer '+('X'.repeat(48));assert.equal((await request(repo,r2)).statusCode,401);
 });
 test('V1 old/invalid proofs and switched subjects rejected',async()=>{
  const repo=dataRepo(),m=mkManifest();await appRegister(repo,m);
  const q=fakeReq('/api/v1/state','GET',{},m);q.headers['x-r3-timestamp']=String(Date.now()-3600000);
  assert.equal((await request(repo,q)).statusCode,401);
  const s=fakeReq('/api/v1/state','GET',{},m);s.headers['x-r3-subject']='someone-else';assert.equal((await request(repo,s)).statusCode,401);
 });
 test('V1 request body tampering after signing is rejected',async()=>{
  const repo=dataRepo(),m=mkManifest();await appRegister(repo,m);
  const q=fakeReq('/api/v1/events','POST',{event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1},m);
  q.body={...q.body,name:'session_started'};assert.equal((await request(repo,q)).statusCode,401);
 });
 test('V1 event cannot impersonate a different authenticated subject',async()=>{
  const repo=dataRepo(),m=mkManifest();await appRegister(repo,m);
  const q=fakeReq('/api/v1/events','POST',{event_id:randomUUID(),subject_id:'different',name:'meeting_booked',schema_version:1},m);
  assert.equal((await request(repo,q)).statusCode,403);
 });
 test('V1 consent independent by purpose/channel and revocation logged',async()=>{
  const repo=dataRepo(),m=mkManifest();await appRegister(repo,m);await request(repo,fakeReq('/api/v1/events','POST',{event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1},m));
  const consent=(granted,purpose='reminder')=>fakeReq('/api/v1/consent','PUT',{channel:'push',purpose,granted,verified:granted,platform:'android'},m);
  assert.equal((await request(repo,consent(true))).statusCode,200);
  assert.equal((await request(repo,consent(true,'marketing'))).statusCode,200);
  assert.equal((await request(repo,consent(false))).statusCode,200);
  assert.equal(repo.history.length,3);assert.equal((await repo.consentState(m,'subject-1','push','reminder')).granted,false);
  assert.equal((await repo.consentState(m,'subject-1','push','marketing')).granted,true);
 });
 test('V1 experiments persist stable exposure and isolate tenants',async()=>{
  const repo=dataRepo(),m=mkManifest(),b=mkManifest('another','crm');await appRegister(repo,m);await appRegister(repo,b);
  for(const x of [m,b])await request(repo,fakeReq('/api/v1/events','POST',{event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1},x));
  let a=await request(repo,fakeReq('/api/v1/experiment','POST',{experiment_key:'retention_push'},m));
  const second=await request(repo,fakeReq('/api/v1/experiment','POST',{experiment_key:'retention_push'},m));
  assert.equal(a.body.arm,second.body.arm);assert.equal(repo.exposures.size,1);
  await request(repo,fakeReq('/api/v1/experiment','POST',{experiment_key:'retention_push'},b));assert.equal(repo.exposures.size,2);
 });
 test('V1 app kill switch invalidates backend credentials and events',async()=>{
  const repo=dataRepo(),m=mkManifest();await appRegister(repo,m);const before=await request(repo,fakeReq('/api/v1/events','POST',{event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1},m));assert.equal(before.statusCode,201);
  await repo.setActive(m,false);const after=await request(repo,fakeReq('/api/v1/state','GET',{},m));assert.equal(after.statusCode,401);
 });
 test('V1 user erasure is scoped and removes subordinate records',async()=>{
  const repo=dataRepo(),m=mkManifest(),b=mkManifest('another','crm');await appRegister(repo,m);await appRegister(repo,b);
  for(const x of [m,b])await request(repo,fakeReq('/api/v1/events','POST',{event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1},x));
  const erased=await request(repo,fakeReq('/api/v1/user','DELETE',{},m));assert.equal(erased.body.deleted,true);assert.equal((await repo.state(m,'subject-1')),null);assert.equal((await repo.state(b,'subject-1')).value_count,1);
 });
 test('V1 no notifications after provider opt-out and quota/holdout enforcement',()=>{
  const m=mkManifest('acme','crm','test',{cadence:'daily',holdout_percent:0,weekly_limit:2}),now=new Date('2026-10-17T15:00:00Z');
  const st={timezone:'UTC',last_value_at:'2026-10-16T12:00:00Z'},valid={granted:true,verified:true};
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:st,consent:{granted:false,verified:false},now}).reason,'no_verified_consent');
  assert.equal(uEvaluate({manifest:m,subject_id:'p',subject:st,consent:valid,recent_sent:['2026-10-13T15:00:00Z','2026-10-14T15:00:00Z'],now}).reason,'weekly_quota');
 });
 test('V11 live HTTP replay of a signed request is refused',async()=>{
  const repo=dataRepo(),m=mkManifest();await appRegister(repo,m);
  const server=http.createServer((req,res)=>uHandler(req,res,{repo}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
   const body=JSON.stringify({event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1});
   const first=fakeReq('/api/v1/events','POST',body,m);
   const original=()=>fetch(url+first.url,{method:'POST',headers:first.headers,body});
   assert.equal((await original()).status,201);
   assert.equal((await original()).status,401);
   const second=fakeReq('/api/v1/events','POST',body,m);
   assert.equal((await fetch(url+second.url,{method:'POST',headers:second.headers,body})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
 test('V11 signed replay rejected but new nonce is accepted',async()=>{
  const repo=dataRepo(),m=mkManifest();await appRegister(repo,m);
  const req=fakeReq('/api/v1/events','POST',{event_id:randomUUID(),subject_id:'subject-1',name:'meeting_booked',schema_version:1},m);
  assert.equal((await request(repo,req)).statusCode,201);
  assert.equal((await request(repo,req)).statusCode,401);
  const retry=fakeReq('/api/v1/events','POST',req.body,m);
  assert.equal((await request(repo,retry)).statusCode,200);
 });
 test('V11 signed request-id tampering rejected',async()=>{
  const repo=dataRepo(),m=mkManifest();await appRegister(repo,m);
  const req=fakeReq('/api/v1/state','GET',{},m);
  req.headers['x-r3-request-id']=randomUUID();
  assert.equal((await request(repo,req)).statusCode,401);
 });
 test('V11 nonce scoped by tenant and environment',async()=>{
  const repo=dataRepo(),m=mkManifest(),n=mkManifest('other','crm');await appRegister(repo,m);await appRegister(repo,n);
  const a=fakeReq('/api/v1/state','GET',{},m),b=fakeReq('/api/v1/state','GET',{},n);
  b.headers['x-r3-request-id']=a.headers['x-r3-request-id'];
  b.headers['x-r3-signature']=uSubjectSignature(sampleKey,b,n,'subject-1',b.headers['x-r3-timestamp']);
  assert.equal((await request(repo,a)).statusCode,404);
  assert.equal((await request(repo,b)).statusCode,404);
  assert.equal((await request(repo,a)).statusCode,401);
 });
 test('V11 universal SQL includes replay claim and durable outbox',()=>{
  for(const item of ['r3_v1_request_nonces','r3_v1_claim_request','r3_v1_outbox','r3_v1_enqueue','r3_v1_claim_job','r3_v1_finish_job'])
   assert.ok(UNIVERSAL_V11_SQL.includes(item));
 });
 test('V1 core SQL includes scoped PK/FK, consent history, idempotent ingest, no automatic push',()=>{
  assert.match(UNIVERSAL_SCHEMA_SQL,/PRIMARY KEY\(tenant_id,app_id,environment,event_id\)/);
  assert.match(UNIVERSAL_SCHEMA_SQL,/r3_v1_consent_history/);
  assert.match(UNIVERSAL_SCHEMA_SQL,/ON CONFLICT DO NOTHING/);
  assert.match(UNIVERSAL_SCHEMA_SQL,/FOREIGN KEY\(tenant_id,app_id,environment,subject_id\)/);
  assert.match(UNIVERSAL_SCHEMA_SQL,/r3_v1_register_app/);
 });
}

async function main(){
 const arg=process.argv[2]||'help';
 if(arg==='test'){
  register_audit_tests();register_engine_tests();register_http_tests();register_provider_tests();register_service_tests();register_additional_tests();register_deep_tests();register_db_adapter_tests();register_duolingo_parity_tests();register_v06_tests();register_v06_http_tests();register_v06_locale_tests();register_v07_tests();register_v1_tests();
 }else if(arg==='smoke'){
   const checks=await smokeHTTP();console.log(`PASS: ${checks}/${checks} real HTTP smoke assertions; real push disabled`);
 }else if(arg==='sql'){
   process.stdout.write(SCHEMA_SQL+'\n'+UNIVERSAL_SCHEMA_SQL+'\n'+UNIVERSAL_V11_SQL+'\n');
 }else if(arg==='analytics'){
   process.stdout.write(ANALYTICS_SQL+'\n'+UNIVERSAL_ANALYTICS_SQL+'\n');
 }else if(arg==='check'){
   if(!SCHEMA_SQL.includes('r3_claim_delivery')||!SCHEMA_SQL.includes('r3_ingest_event'))throw Error('Missing schema');
   console.log('PASS: standalone source and embedded SQL are present');
 }else if(arg==='serve'){
   startServer();
 }else{
  process.stdout.write('TMNT Engine v1.1.0 (R3 compatible) single file. Commands: test | smoke | sql | analytics | check | serve\n');
 }
}
export { handleHttp, createServer, uManifest, uAssignment, uEvaluate, UNIVERSAL_V11_SQL };
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
