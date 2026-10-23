/** TMNT Engine platform-neutral worker. Server-side only. No real deliveries unless explicitly enabled. */
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const ALLOWED_ENV = new Set(['test', 'staging', 'prod']);
const APP_KEY = /^[a-z][a-z0-9_-]{1,49}\/[a-z][a-z0-9_-]{1,49}\/(test|staging|prod)$/;
const TEMPLATE_KEY = /^[a-zA-Z0-9_.-]{1,80}$/;
export function safeEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string')return false;
  const aa=Buffer.from(a),bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}
function envJson(name,env){
  if(!env[name])return {};
  try {const result=JSON.parse(env[name]);if(!result||Array.isArray(result)||typeof result!=='object')throw Error();return result;}
  catch{throw new Error(`Invalid ${name}`);}
}
export function validateSettings(env=process.env){
  const enabled=env.R3_PUSH_ENABLED==='true';
  const allowed=env.TMNT_ALLOWED_PUSH_ENVIRONMENTS ? env.TMNT_ALLOWED_PUSH_ENVIRONMENTS.split(',').map(s=>s.trim()) : [];
  if(allowed.some(s=>!ALLOWED_ENV.has(s)) || new Set(allowed).size!==allowed.length || (enabled && allowed.length===0))throw Error('Invalid allowed environments');
  const apps=envJson('TMNT_ONESIGNAL_APPS_JSON',env),templates=envJson('TMNT_TEMPLATES_JSON',env);
  const providerAppIds=new Set();
  for(const [key,item] of Object.entries(apps)){
    if(!APP_KEY.test(key)||!item||typeof item.app_id!=='string'||typeof item.rest_api_key!=='string'||item.app_id.length<8||item.rest_api_key.length<12||providerAppIds.has(item.app_id))throw Error('Invalid OneSignal configuration');
    providerAppIds.add(item.app_id);
  }
  for(const [key,m] of Object.entries(templates)){
    if(!TEMPLATE_KEY.test(key)||!m||typeof m!=='object'||Array.isArray(m)||!m.en||typeof m.en.title!=='string'||typeof m.en.body!=='string')throw Error('Invalid template');
  }
  if(env.TMNT_POSTHOG_PROJECT_KEY && (!env.TMNT_ANALYTICS_HASH_SECRET || env.TMNT_ANALYTICS_HASH_SECRET.length<32))throw Error('Strong analytics hashing secret required');
  return {enabled,allowed,apps,templates,posthogHost:env.TMNT_POSTHOG_HOST||'https://us.i.posthog.com',posthogKey:env.TMNT_POSTHOG_PROJECT_KEY||'',hashSecret:env.TMNT_ANALYTICS_HASH_SECRET||''};
}
export function messageFor(job,settings){
  const variants=settings.templates[job.template];
  if(!variants)throw Error('Template unavailable');
  const locale=String(job.locale||'en').split('-')[0].toLowerCase();
  const value=variants[locale]||variants.en;
  if(!value||typeof value.title!=='string'||typeof value.body!=='string'||value.title.length>100||value.body.length>280||!value.title.trim()||!value.body.trim())throw Error('Template invalid');
  return {title:value.title,body:value.body};
}
export async function sendOneSignal(job,settings,{fetchImpl=fetch}={}){
  const key=`${job.t}/${job.a}/${job.e}`;
  const app=settings.apps[key];
  if(!app)throw Error('Provider not configured');
  const msg=messageFor(job,settings);
  const response=await fetchImpl('https://api.onesignal.com/notifications',{
    method:'POST',
    headers:{Authorization:`Key ${app.rest_api_key}`,'Content-Type':'application/json'},
    body:JSON.stringify({app_id:app.app_id,idempotency_key:job.job_id,
      include_aliases:{external_id:[job.s]},target_channel:'push',
      headings:{en:msg.title},contents:{en:msg.body},
      data:{r3_delivery_id:job.job_id,r3_app:job.a,r3_environment:job.e}}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Error(`OneSignal HTTP ${response.status}`);
  const body=await response.json();
  const errors=body?.errors && (typeof body.errors==='object'?Object.keys(body.errors).length>0:true);
  const zero=body?.recipients!==undefined && Number(body.recipients)<=0;
  if(!body?.id||body?.success===false||errors||zero)throw Error('OneSignal did not accept recipients');
  return {providerId:body.id}; // accepted, not guaranteed device delivery
}
export async function posthogEvent(event,properties,settings,{fetchImpl=fetch,isEligible=null}={}){
  if(!settings.posthogKey)return {skipped:true};
  if(!['https://us.i.posthog.com','https://eu.i.posthog.com'].includes(settings.posthogHost))throw Error('Invalid PostHog host');
  // Match createPostHogEmitter's scoped identity when the same secret is configured.
  if(typeof settings.hashSecret!=='string'||settings.hashSecret.length<32)throw Error('Strong analytics hashing secret required');
  if(typeof isEligible!=='function')return {skipped:true,reason:'consent_required'};
  try{if(await isEligible(properties)!==true)return {skipped:true,reason:'consent_required'};}catch{return {skipped:true,reason:'eligibility_unavailable'};}
  const distinct=createHmac('sha256',settings.hashSecret).update([properties.tenant,properties.app,properties.environment,properties.subject].join('\x1f')).digest('hex');
  try{
    const response=await fetchImpl(settings.posthogHost+'/capture/',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({api_key:settings.posthogKey,event,distinct_id:distinct,properties:{tenant_id:properties.tenant,app_id:properties.app,environment:properties.environment,delivery_id:properties.id,provider_accepted:properties.accepted}}),
      signal:AbortSignal.timeout(5000)
    });
    return {ok:response.ok};
  }catch{return {ok:false};} // analytics is best-effort, never re-send push for PostHog failure
}
export async function runCycle({db,settings=validateSettings(),fetchImpl=fetch,deliver=null,telemetry=null,workerId=`tmnt-${randomUUID()}`,maxJobs=3}={}){
  if(!settings.enabled)return {status:'disabled',claimed:0,accepted:0,failed:0};
  if(!db)throw Error('Database adapter missing');
  if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>25)throw Error('Invalid batch size');
  const providerScopes=Object.keys(settings.apps).filter(key=>settings.allowed.includes(key.split('/').at(-1)));
  if(providerScopes.length===0)throw Error('No eligible push providers configured');
  let claimed=0,accepted=0,failed=0;
  for(let i=0;i<maxJobs;i++){
    const job=await db.claim(workerId,settings.allowed,providerScopes);
    if(!job)break;
    if(!settings.allowed.includes(job.e)||!providerScopes.includes(`${job.t}/${job.a}/${job.e}`))throw Error('Unsafe claim: job outside configured app/environment scopes; database lease must expire');
    claimed++;
    let providerId=null,error=null;
    try {
      // A second check immediately before the network call catches revoked consent,
      // completed activity and disabled apps after the initial DB claim.
      if(!await db.preflight(job,workerId)){
        if(!await db.suppress(job,workerId,'Ineligible before provider request'))throw Error('Suppression failed');
        continue;
      }
      const delivery = deliver ? await deliver(job, settings, {fetchImpl}) : await sendOneSignal(job,settings,{fetchImpl});
      if(!delivery?.providerId)throw Error('Provider did not accept notification');
      providerId=delivery.providerId;
    }catch(e){error=String(e?.message||'provider_error').slice(0,160);}
    const done=await db.finish(job,workerId,!!providerId,providerId,error);
    if(!done)throw Error('Outbox finalization failed; inspect lease before retry');
    if(providerId)accepted++;else failed++;
    const auditPayload={tenant:job.t,app:job.a,environment:job.e,subject:job.s,id:job.job_id,accepted:!!providerId};
    if(telemetry) {try{await telemetry('tmnt_push_provider_result',auditPayload);}catch{/* never duplicate push for telemetry errors */}}
    else await posthogEvent('tmnt_push_provider_result',auditPayload,settings,{fetchImpl,isEligible:typeof db.analyticsEligible==='function'?p=>db.analyticsEligible(p):null});
  }
  return {status:'processed',claimed,accepted,failed};
}
export async function neonAdapter(url,{sql:injectedSql}={}){
  if(!injectedSql&&!url)throw Error('DATABASE_URL missing');
  const sql=injectedSql||(await import('@neondatabase/serverless')).neon(url);
  if(typeof sql!=='function')throw new TypeError('Invalid trusted SQL client');
  return {
    async analyticsEligible(p){
      const r=await sql`SELECT 1 AS ok FROM r3_v1_subjects u JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
       JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
       WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment} AND u.subject_id=${p.subject}
       AND a.enabled AND a.modules->>'analytics'='true' AND c.granted AND c.verified LIMIT 1`;
      return r.length===1;
    },
    async claim(worker,allowed,scopes){
      if(!Array.isArray(allowed)||!allowed.length||allowed.some(x=>!ALLOWED_ENV.has(x)) ||
         !Array.isArray(scopes)||!scopes.length||scopes.some(x=>typeof x!=='string'||!APP_KEY.test(x)||!allowed.includes(x.split('/').at(-1))))
         throw Error('Worker app/environment scope required');
      const rows=await sql`SELECT * FROM r3_v1_claim_job_scoped(${worker},${allowed.join(',')},${scopes.join(',')})`;
      return rows[0]||null;
    },
    async preflight(job,worker){
      const rows=await sql`SELECT EXISTS(
        SELECT 1 FROM r3_v1_outbox q
        JOIN r3_v1_apps a ON a.tenant_id=q.tenant_id AND a.app_id=q.app_id AND a.environment=q.environment
        JOIN r3_v1_subjects u ON u.tenant_id=q.tenant_id AND u.app_id=q.app_id AND u.environment=q.environment AND u.subject_id=q.subject_id
        JOIN r3_v1_consents c ON c.tenant_id=q.tenant_id AND c.app_id=q.app_id AND c.environment=q.environment AND c.subject_id=q.subject_id AND c.channel='push' AND c.purpose='reminder'
        JOIN r3_v1_exposures x ON x.tenant_id=q.tenant_id AND x.app_id=q.app_id AND x.environment=q.environment AND x.subject_id=q.subject_id AND x.experiment_key='retention_push'
        WHERE q.tenant_id=${job.t} AND q.app_id=${job.a} AND q.environment=${job.e} AND q.id=${job.job_id}::uuid
          AND q.status='sending' AND q.worker_id=${worker} AND q.attempts=${job.attempt}
          AND a.enabled AND a.modules->>'notifications'='true' AND c.granted AND c.verified
          AND x.arm='treatment' AND u.last_value_at IS NOT NULL
          AND (u.paused_until IS NULL OR u.paused_until<=NOW())
          AND q.lease_until>NOW() AND q.due_at<=NOW()
          AND a.cadence IN ('daily','weekly')
          AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.timezone))>=a.quiet_start
          AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.timezone))<a.quiet_end
          AND (u.reminder_hour IS NULL OR u.reminder_hour=EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.timezone)))
          AND (NOW() AT TIME ZONE u.timezone)::date>(u.last_value_at AT TIME ZONE u.timezone)::date
          AND (a.cadence<>'daily' OR (NOW() AT TIME ZONE u.timezone)::date-(u.last_value_at AT TIME ZONE u.timezone)::date<=7)
          AND (a.cadence<>'weekly' OR (NOW() AT TIME ZONE u.timezone)::date-(u.last_value_at AT TIME ZONE u.timezone)::date>=7)
          AND NOT EXISTS (SELECT 1 FROM r3_v1_outbox p WHERE p.tenant_id=q.tenant_id AND p.app_id=q.app_id AND p.environment=q.environment AND p.subject_id=q.subject_id
            AND p.id<>q.id AND p.status='provider_accepted' AND p.sent_at>NOW()-INTERVAL '24 hours')
          AND (SELECT COUNT(*) FROM r3_v1_outbox w WHERE w.tenant_id=q.tenant_id AND w.app_id=q.app_id AND w.environment=q.environment AND w.subject_id=q.subject_id
            AND w.id<>q.id AND w.status='provider_accepted' AND w.sent_at>NOW()-INTERVAL '7 days')<a.weekly_limit
          -- Safety backstop for legacy scheduling paths: stop sending when four or more
          -- mature provider-accepted pushes produced no verified value in 14 days.
          AND NOT ((SELECT COUNT(*) FROM r3_v1_outbox fatigue WHERE fatigue.tenant_id=q.tenant_id AND fatigue.app_id=q.app_id
              AND fatigue.environment=q.environment AND fatigue.subject_id=q.subject_id AND fatigue.status='provider_accepted'
              AND fatigue.sent_at>=NOW()-INTERVAL '14 days' AND fatigue.sent_at<=NOW()-INTERVAL '24 hours')>=4
            AND NOT EXISTS(SELECT 1 FROM r3_v1_outbox response
              JOIN r3_v1_message_outcomes mv ON mv.tenant_id=response.tenant_id AND mv.app_id=response.app_id
                AND mv.environment=response.environment AND mv.delivery_id=response.id AND mv.type='value'
              WHERE response.tenant_id=q.tenant_id AND response.app_id=q.app_id AND response.environment=q.environment
                AND response.subject_id=q.subject_id AND response.status='provider_accepted'
                AND response.sent_at>=NOW()-INTERVAL '14 days' AND response.sent_at<=NOW()-INTERVAL '24 hours'))
      ) AS eligible`;
      return rows[0]?.eligible===true;
    },
    async suppress(job,worker,reason){
      const rows=await sql`UPDATE r3_v1_outbox SET status='suppressed',last_error=${reason},updated_at=NOW(),worker_id=NULL,lease_until=NULL
      WHERE tenant_id=${job.t} AND app_id=${job.a} AND environment=${job.e} AND id=${job.job_id}::uuid
      AND status='sending' AND worker_id=${worker} AND attempts=${job.attempt} RETURNING id`;
      return rows.length===1;
    },
    async finish(job,worker,accepted,id,error){const rows=await sql`SELECT r3_v1_finish_job(${job.job_id}::uuid,${job.t},${job.a},${job.e},${worker},${job.attempt},${accepted},${id},${error}) AS finished`;return rows[0]?.finished===true;}
  };
}
/** Platform-neutral HTTP handler: call from an authenticated scheduler, queue consumer or API server. */
export async function tickHandler(request,{env=process.env,dbFactory=neonAdapter,fetchImpl=fetch}={}){
  const headers=request.headers;
  const getHeader=n=>typeof headers?.get==='function'?headers.get(n):headers?.[n];
  const secret=env.CRON_SECRET;
  if(!secret||secret.length<32||!safeEqual(getHeader('authorization'),`Bearer ${secret}`))return {status:401,body:{error:'Unauthorized'}};
  if(request.method!=='GET')return {status:405,body:{error:'Method not allowed'}};
  let settings;
  try{settings=validateSettings(env);}catch{return {status:503,body:{error:'Invalid configuration'}};}
  if(!settings.enabled)return {status:200,body:{status:'disabled',delivery_enabled:false}};
  if(!env.DATABASE_URL)return {status:503,body:{error:'Database not configured'}};
  try{
    const db=await dbFactory(env.DATABASE_URL);
    const result=await runCycle({db,settings,fetchImpl,maxJobs:3});
    return {status:200,body:result};
  }catch(e){return {status:503,body:{error:'Worker processing failed'}};}
}

/** Backwards-compatible name retained for existing consumers. */
export const cronHandler = tickHandler;
