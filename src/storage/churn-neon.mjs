/** Scoped Neon adapter for v3.0 minimal engagement and daily churn snapshots.
 * Server-only: use a least-privileged role, never browser or agent SQL credentials.
 */
import {validateChurnScope,normalizeEngagement} from '../churn-prediction.mjs';
const SUBJECT=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const validSubject=s=>{if(!SUBJECT.test(s??''))throw new TypeError('Invalid authenticated subject');};
export async function createRiverChurnNeonRepository(databaseUrl,{sql:injectedSql}={}){
 if(!databaseUrl&&!injectedSql)throw new TypeError('Backend Neon URL required');
 const sql=injectedSql||(await import('@neondatabase/serverless')).neon(databaseUrl);
 if(typeof sql!=='function')throw new TypeError('Neon SQL tag required');
 return Object.freeze({
  async recordEngagement(p){
   validateChurnScope(p);validSubject(p.subject);
   const event=normalizeEngagement(p);
   const rows=await sql`INSERT INTO river_v1_engagement_events
    (tenant_id,app_id,environment,event_id,subject_id,kind,source,occurred_at)
    SELECT ${p.tenant},${p.app},${p.environment},${event.eventId}::uuid,${p.subject},${event.kind},${event.source},${event.occurredAt}::timestamptz
     FROM r3_v1_subjects u
     JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
     JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
     WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment} AND u.subject_id=${p.subject}
       AND a.enabled AND a.modules->>'analytics'='true' AND c.granted AND c.verified
       AND c.updated_at<${event.occurredAt}::timestamptz AND c.updated_at<=NOW()
    ON CONFLICT DO NOTHING RETURNING event_id`;
   return rows.length===1;
  },
  async listChurnFeatures(p){
   validateChurnScope(p);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(p.asOf)||!Number.isInteger(p.limit)||p.limit<1||p.limit>500||typeof p.afterSubject!=='string'||p.afterSubject.length>128)throw new TypeError('Invalid churn page');
   // All reads recheck CURRENT analytics opt-in; no pre-consent events can appear.
   const rows=await sql`SELECT u.subject_id AS subject,
    MAX(e.occurred_at) AS "lastSeen",
    COUNT(DISTINCT (e.occurred_at AT TIME ZONE 'UTC')::date)
     FILTER(WHERE e.occurred_at>=(${p.asOf}::date-6))::integer AS "activeDays7",
    COUNT(DISTINCT (e.occurred_at AT TIME ZONE 'UTC')::date)
     FILTER(WHERE e.occurred_at>=(${p.asOf}::date-13) AND e.occurred_at<(${p.asOf}::date-6))::integer AS "activeDaysPrev7",
    COUNT(*) FILTER(WHERE e.kind IN ('lesson_completed','value_completed') AND e.occurred_at>=(${p.asOf}::date-6))::integer AS "completed7",
    COUNT(*) FILTER(WHERE e.kind='action_failed' AND e.occurred_at>=(${p.asOf}::date-6))::integer AS "failed7",
    COUNT(*) FILTER(WHERE e.kind='app_crashed' AND e.occurred_at>=(${p.asOf}::date-6))::integer AS "crashes7",
    COUNT(*) FILTER(WHERE e.kind='app_opened' AND e.occurred_at>=(${p.asOf}::date-6))::integer AS "opens7"
   FROM r3_v1_subjects u
   JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
   JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
   LEFT JOIN river_v1_engagement_events e
     ON e.tenant_id=u.tenant_id AND e.app_id=u.app_id AND e.environment=u.environment AND e.subject_id=u.subject_id
     AND e.occurred_at>=(${p.asOf}::date-44) AND e.occurred_at<(${p.asOf}::date+1)
     AND e.occurred_at>c.updated_at
   WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment}
    AND u.subject_id>${p.afterSubject} AND a.enabled AND a.modules->>'analytics'='true' AND c.granted AND c.verified
   GROUP BY u.subject_id HAVING COUNT(e.event_id)>0
   ORDER BY u.subject_id LIMIT ${p.limit}`;
   const utc=new Date(p.asOf+'T00:00:00Z').getTime();
   // Compare UTC *calendar dates*, not 24h elapsed from a midnight snapshot.
   // A user last active yesterday 23:59 UTC is still one inactive day today.
   const utcDaysSinceOpen=(lastSeen)=>{
    const observed=new Date(lastSeen);
    if(!Number.isFinite(observed.getTime()))throw new TypeError('Invalid lastSeen from database');
    const lastDay=Date.parse(observed.toISOString().slice(0,10)+'T00:00:00Z');
    return Math.min(365,Math.max(0,Math.round((utc-lastDay)/86400000)));
   };
   return rows.map(r=>({subject:r.subject,features:{
    daysSinceOpen:utcDaysSinceOpen(r.lastSeen),
    activeDays7:Number(r.activeDays7),activeDaysPrev7:Number(r.activeDaysPrev7),
    completed7:Number(r.completed7),failed7:Number(r.failed7),crashes7:Number(r.crashes7),opens7:Number(r.opens7)
   }}));
  },
  async upsertChurnScore(p){
   validateChurnScope(p);validSubject(p.subject);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(p.asOf)||!p.score||!['low','medium','high'].includes(p.score.riskTier))throw new TypeError('Invalid churn score');
   const probability=p.score.returnProbabilityTomorrow,riskIndex=p.score.riskIndex;
   if((probability===null)===(!Number.isInteger(riskIndex))||probability!==null&&(!Number.isFinite(probability)||probability<0||probability>1))throw new TypeError('Invalid score type');
   const reasons=p.score.reasonCodes??[];
   if(!Array.isArray(reasons)||reasons.length>10||reasons.some(x=>typeof x!=='string'||!/^[a-z_]{2,50}$/.test(x)))throw new TypeError('Invalid score reasons');
   const rows=await sql`INSERT INTO river_v1_churn_daily_scores
    (tenant_id,app_id,environment,subject_id,score_day,model_version,risk_tier,risk_index,probability_return,reason_codes)
    SELECT ${p.tenant},${p.app},${p.environment},${p.subject},${p.asOf}::date,${p.score.modelVersion},${p.score.riskTier},${riskIndex??null},${probability},${reasons}
     FROM r3_v1_subjects u
     JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
     JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
     WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment} AND u.subject_id=${p.subject}
      AND c.granted AND c.verified AND a.enabled AND a.modules->>'analytics'='true'
    ON CONFLICT(tenant_id,app_id,environment,subject_id,score_day) DO UPDATE SET
     model_version=EXCLUDED.model_version,risk_tier=EXCLUDED.risk_tier,risk_index=EXCLUDED.risk_index,
     probability_return=EXCLUDED.probability_return,reason_codes=EXCLUDED.reason_codes,scored_at=NOW()
    RETURNING score_day`;
   return rows.length===1;
  },
  /** Retention cap and revoked-consent purge. Must be called by scoped operator job. */
  async purgeExpired(p){
   validateChurnScope(p);
   const events=await sql`DELETE FROM river_v1_engagement_events e
      WHERE e.tenant_id=${p.tenant} AND e.app_id=${p.app} AND e.environment=${p.environment}
       AND (e.recorded_at<NOW()-INTERVAL '90 days' OR NOT EXISTS(
        SELECT 1 FROM river_v1_analytics_consents c WHERE c.tenant_id=e.tenant_id AND c.app_id=e.app_id AND c.environment=e.environment AND c.subject_id=e.subject_id AND c.granted AND c.verified)) RETURNING event_id`;
   const scores=await sql`DELETE FROM river_v1_churn_daily_scores s
      WHERE s.tenant_id=${p.tenant} AND s.app_id=${p.app} AND s.environment=${p.environment}
       AND (s.score_day<CURRENT_DATE-30 OR NOT EXISTS(
        SELECT 1 FROM river_v1_analytics_consents c WHERE c.tenant_id=s.tenant_id AND c.app_id=s.app_id AND c.environment=s.environment AND c.subject_id=s.subject_id AND c.granted AND c.verified)) RETURNING subject_id`;
   return {deletedEvents:events.length,deletedScores:scores.length};
  },
 });
}

export {createRiverChurnNeonRepository as createInstantChurnNeonRepository};
