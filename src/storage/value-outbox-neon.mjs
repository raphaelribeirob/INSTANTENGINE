/** Use a server-only Neon SQL client; claim is atomic (UPDATE...SKIP LOCKED). */
export async function createRiverValueOutboxNeonRepository(databaseUrl,{sql:injectedSql}={}){
 if(!injectedSql&&!databaseUrl)throw new TypeError('Database URL missing');
 const sql=injectedSql||(await import('@neondatabase/serverless')).neon(databaseUrl);
 if(typeof sql!=='function')throw new TypeError('SQL client required');
 return Object.freeze({
  async claimValueOutbox({allowProduction=false}={}){
   const rows=await sql`WITH pick AS (
       SELECT tenant_id,app_id,environment,event_id FROM river_v1_verified_value_outbox
       WHERE attempts<20 AND (${allowProduction===true} OR environment<>'prod') AND ((status='pending' AND available_at<=NOW()) OR (status='leased' AND lease_until<NOW()))
       ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
      ) UPDATE river_v1_verified_value_outbox q SET status='leased', attempts=q.attempts+1,
          lease_until=NOW()+INTERVAL '90 seconds',lease_token=gen_random_uuid(),updated_at=NOW()
      FROM pick WHERE q.tenant_id=pick.tenant_id AND q.app_id=pick.app_id AND q.environment=pick.environment AND q.event_id=pick.event_id
      RETURNING q.tenant_id AS tenant,q.app_id AS app,q.environment,q.event_id::text AS "eventId",q.lease_token::text AS "leaseToken"`;
   return rows[0]||null;
  },
  async getVerifiedOutboxEvent(p){
   const rows=await sql`SELECT e.tenant_id AS tenant,e.app_id AS app,e.environment,e.event_id::text AS "eventId",
     e.subject_id AS subject,e.name AS "eventName",r.is_value AS "verifiedValue"
     FROM r3_v1_events e JOIN r3_v1_event_registry r USING(tenant_id,app_id,environment,name)
     JOIN river_v1_verified_value_outbox q ON q.tenant_id=e.tenant_id AND q.app_id=e.app_id AND q.environment=e.environment AND q.event_id=e.event_id
     WHERE e.tenant_id=${p.tenant} AND e.app_id=${p.app} AND e.environment=${p.environment} AND e.event_id=${p.eventId}::uuid
     AND q.status='leased' LIMIT 1`;
   return rows[0]||null;
  },
  async isABEligible(p){
   const rows=await sql`SELECT 1 AS ok FROM river_v1_analytics_consents c
     JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
     WHERE c.tenant_id=${p.tenant} AND c.app_id=${p.app} AND c.environment=${p.environment} AND c.subject_id=${p.subject}
       AND c.granted AND c.verified AND a.enabled AND a.modules->>'analytics'='true' LIMIT 1`;
   return rows.length===1;
  },
  async completeValueOutbox(p){
   if(!['acknowledged','discarded','retry'].includes(p.status))throw new TypeError('Invalid completion');
   const rows=await sql`UPDATE river_v1_verified_value_outbox SET
     status=CASE WHEN ${p.status}='retry' THEN CASE WHEN attempts>=20 THEN 'dead' ELSE 'pending' END ELSE ${p.status} END,
     available_at=CASE WHEN ${p.status}='retry' THEN NOW()+make_interval(secs=>LEAST(3600,POWER(2,LEAST(attempts,12))::integer)) ELSE available_at END,
     lease_token=NULL,lease_until=NULL,updated_at=NOW()
     WHERE tenant_id=${p.tenant} AND app_id=${p.app} AND environment=${p.environment} AND event_id=${p.eventId}::uuid
       AND status='leased' AND lease_token=${p.leaseToken}::uuid RETURNING event_id`;
   return rows.length===1;
  }
 });
}
