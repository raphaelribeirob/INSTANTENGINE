/** Server-only analytics SQL: every query filters tenant/app/environment, current verified consent,
 * active app and registered backend-verified value events. Never returns subject IDs.
 */
export async function createRiverObserverNeonRepository(databaseUrl,{sql:injectedSql}={}){
 if(!injectedSql&&!databaseUrl)throw new TypeError('Backend database URL required');
 const sql=injectedSql||(await import('@neondatabase/serverless')).neon(databaseUrl);
 if(typeof sql!=='function')throw new TypeError('SQL driver required');
 return Object.freeze({
  async getObserverCatalog(p){
   const apps=await sql`SELECT enabled,modules FROM r3_v1_apps WHERE tenant_id=${p.tenant} AND app_id=${p.app} AND environment=${p.environment} LIMIT 1`;
   if(!apps.length)return {configured:false,enabled:false,analyticsEnabled:false,events:[]};
   const cfg=apps[0];const events=await sql`SELECT name,is_value AS value FROM r3_v1_event_registry WHERE tenant_id=${p.tenant} AND app_id=${p.app} AND environment=${p.environment} ORDER BY name LIMIT 50`;
   const modules=typeof cfg.modules==='string'?JSON.parse(cfg.modules):cfg.modules;
   return {configured:true,enabled:cfg.enabled===true,analyticsEnabled:modules?.analytics===true,events:events.map(x=>({name:x.name,value:x.value===true}))};
  },
  async getObserverOverview(p){
   const rows=await sql`SELECT TO_CHAR(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
      COUNT(DISTINCT e.subject_id)::integer AS active,COUNT(*) FILTER(WHERE r.is_value)::integer AS "valueEvents"
    FROM r3_v1_events e
    JOIN r3_v1_event_registry r USING(tenant_id,app_id,environment,name)
    JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
    JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
    WHERE e.tenant_id=${p.tenant} AND e.app_id=${p.app} AND e.environment=${p.environment}
      AND a.enabled AND a.modules->>'analytics'='true' AND c.granted AND c.verified AND c.updated_at<e.recorded_at AND c.updated_at<=e.occurred_at AND r.is_value
      AND e.occurred_at>=(${p.asOf}::date - ${p.days-1}::integer)
      AND e.occurred_at<(${p.asOf}::date + 1)
    GROUP BY day ORDER BY day`;
   return rows;
  },
  async getObserverRetention(p){
   // First verified value day is the cohort; only mature exact UTC D1/7/30 users count.
   // Filtering current opt-outs automatically excludes users who revoked analytics access.
   const rows=await sql`WITH value_days AS (
     SELECT DISTINCT e.subject_id,(e.occurred_at AT TIME ZONE 'UTC')::date AS day
       FROM r3_v1_events e
       JOIN r3_v1_event_registry r USING(tenant_id,app_id,environment,name)
       JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
       JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
       WHERE e.tenant_id=${p.tenant} AND e.app_id=${p.app} AND e.environment=${p.environment}
        AND r.is_value AND c.granted AND c.verified AND c.updated_at<e.recorded_at AND c.updated_at<=e.occurred_at AND a.enabled AND a.modules->>'analytics'='true'
        AND e.occurred_at<(${p.asOf}::date + 1)
   ), cohorts AS (SELECT subject_id,MIN(day) AS first_day FROM value_days GROUP BY subject_id),
   windows AS (SELECT x.day FROM (VALUES(1),(7),(30)) x(day))
   SELECT w.day,COUNT(*)::integer AS eligible,
     COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM value_days d WHERE d.subject_id=c.subject_id AND d.day=c.first_day+w.day))::integer AS retained
   FROM cohorts c CROSS JOIN windows w
   WHERE c.first_day + w.day < ${p.asOf}::date
   GROUP BY w.day ORDER BY w.day`;
   return rows;
  },
  /** Daily churn distribution, never individual scores or subject IDs. */
  async getObserverChurn(p){
   const rows=await sql`SELECT s.risk_tier AS tier,COUNT(DISTINCT s.subject_id)::integer AS participants
     FROM river_v1_churn_daily_scores s
     JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
     JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
     WHERE s.tenant_id=${p.tenant} AND s.app_id=${p.app} AND s.environment=${p.environment}
      AND s.score_day=${p.asOf}::date AND c.granted AND c.verified
      AND a.enabled AND a.modules->>'analytics'='true'
     GROUP BY s.risk_tier ORDER BY s.risk_tier`;
   return rows;
  },
  async getObserverPipeline(p){
   const rows=await sql`SELECT COUNT(*) FILTER(WHERE status='pending')::integer AS pending,
     COUNT(*) FILTER(WHERE status='leased')::integer AS leased,
     COUNT(*) FILTER(WHERE status='dead')::integer AS dead,
     COUNT(*) FILTER(WHERE status='acknowledged')::integer AS acknowledged
      FROM river_v1_verified_value_outbox WHERE tenant_id=${p.tenant} AND app_id=${p.app} AND environment=${p.environment}`;
   return rows[0]||null;
  },
  async getObserverExperiment(p){
   const rows=await sql`SELECT x.variant,
      COUNT(DISTINCT x.subject_id)::integer AS participants,
      COUNT(DISTINCT c.subject_id) FILTER(WHERE v.event_id IS NOT NULL AND r.is_value)::integer AS converters,
      COUNT(DISTINCT v.event_id) FILTER(WHERE r.is_value)::integer AS conversions
    FROM river_v1_ab_assignments x
    JOIN river_v1_analytics_consents ac USING(tenant_id,app_id,environment,subject_id)
    JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
    LEFT JOIN river_v1_ab_conversions c ON c.tenant_id=x.tenant_id AND c.app_id=x.app_id AND c.environment=x.environment AND c.subject_id=x.subject_id AND c.flag_key=x.flag_key
    LEFT JOIN r3_v1_events v ON v.tenant_id=c.tenant_id AND v.app_id=c.app_id AND v.environment=c.environment AND v.event_id=c.event_id AND v.subject_id=x.subject_id AND v.occurred_at>=x.exposed_at
    LEFT JOIN r3_v1_event_registry r ON r.tenant_id=v.tenant_id AND r.app_id=v.app_id AND r.environment=v.environment AND r.name=v.name
    WHERE x.tenant_id=${p.tenant} AND x.app_id=${p.app} AND x.environment=${p.environment} AND x.flag_key=${p.flagKey}
      AND x.exposed_at<(${p.asOf}::date + 1) AND ac.granted AND ac.verified AND ac.updated_at<x.exposed_at AND a.enabled AND a.modules->>'analytics'='true'
    GROUP BY x.variant ORDER BY x.variant`;
   return rows;
  },
 });
}
