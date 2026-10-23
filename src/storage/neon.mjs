/** PostgreSQL adapter using existing r3_v1_* contracts. Injects URL at runtime only. */
function safeMoney(v){const n=BigInt(v);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw new RangeError('Money total exceeds safe JS integer');return Number(n);}
export async function createNeonRepository(databaseUrl,{sql:injectedSql}={}){
 if(!injectedSql&&(!databaseUrl||typeof databaseUrl!=='string'))throw Error('Database URL missing');
 // Injection makes the complete tagged-template contract testable without a live database.
 // Only a trusted backend may pass the SQL client, never browser-supplied data.
 const sql=injectedSql || (await import('@neondatabase/serverless')).neon(databaseUrl);
 if(typeof sql!=='function')throw new TypeError('Invalid trusted SQL client');
 return {
  nonceDurability:'persistent',
  async claimRequest(p){const r=await sql`SELECT r3_v1_claim_request(${p.tenant},${p.app},${p.environment},${p.subject},${p.requestId}::uuid,${p.timestampMs}) AS ok`;return r[0]?.ok===true;},
  async registerApp(p){const r=await sql`SELECT r3_v1_register_app(${p.tenant},${p.app},${p.environment},${p.keyHash},${p.cadence},${JSON.stringify(p.modules)}::jsonb,${p.quietStart},${p.quietEnd},${p.weeklyLimit},${p.holdoutPercent},${JSON.stringify(p.events)}::jsonb) AS ok`;return r[0]?.ok===true;},
  async track(p){const r=await sql`SELECT r3_v1_ingest(${p.tenant},${p.app},${p.environment},${p.subject},${p.eventId}::uuid,${p.event},${p.occurredAt}::timestamptz,${p.locale},${p.timezone}) AS ok`;return r[0]?.ok===true;},
  async consent(p){const r=await sql`SELECT r3_v1_set_consent(${p.tenant},${p.app},${p.environment},${p.subject},${p.channel},${p.purpose},${p.granted},${p.verified},${p.platform}) AS ok`;return r[0]?.ok===true;},
  async setABAnalyticsConsent(p){const r=await sql`INSERT INTO river_v1_analytics_consents(tenant_id,app_id,environment,subject_id,granted,verified)
    SELECT ${p.tenant},${p.app},${p.environment},${p.subject},${p.granted},${p.verified}
    WHERE EXISTS(SELECT 1 FROM r3_v1_subjects u JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
      WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment} AND u.subject_id=${p.subject}
      AND a.enabled AND a.modules->>'analytics'='true')
    ON CONFLICT(tenant_id,app_id,environment,subject_id) DO UPDATE SET granted=EXCLUDED.granted,verified=EXCLUDED.verified,updated_at=NOW()
    RETURNING granted`;return r.length===1;},
  async isABEligible(p){const r=await sql`SELECT 1 AS ok FROM r3_v1_subjects u JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
    JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
    WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment} AND u.subject_id=${p.subject}
    AND a.enabled AND a.modules->>'analytics'='true' AND c.granted AND c.verified LIMIT 1`;return r.length===1;},
  async getABAssignment(p){const r=await sql`SELECT variant,exposed_at FROM river_v1_ab_assignments
    WHERE tenant_id=${p.tenant} AND app_id=${p.app} AND environment=${p.environment} AND subject_id=${p.subject} AND flag_key=${p.flagKey}`;
    return r.length?{variant:r[0].variant,exposedAt:r[0].exposed_at}:null;},
  async claimABAssignment(p){const r=await sql`INSERT INTO river_v1_ab_assignments(tenant_id,app_id,environment,subject_id,flag_key,variant)
    SELECT ${p.tenant},${p.app},${p.environment},${p.subject},${p.flagKey},${p.variant}
    WHERE EXISTS(SELECT 1 FROM r3_v1_subjects u JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
      JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
      WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment} AND u.subject_id=${p.subject}
      AND a.enabled AND a.modules->>'analytics'='true' AND c.granted AND c.verified)
    ON CONFLICT DO NOTHING RETURNING variant,exposed_at`;
    if(r.length)return {variant:r[0].variant,exposedAt:r[0].exposed_at,firstExposure:true};
    const q=await this.getABAssignment(p);return q?{...q,firstExposure:false}:null;},
  async recordABConversion(p){const r=await sql`INSERT INTO river_v1_ab_conversions(tenant_id,app_id,environment,subject_id,flag_key,event_id,conversion_event)
    SELECT x.tenant_id,x.app_id,x.environment,x.subject_id,x.flag_key,v.event_id,v.name
    FROM river_v1_ab_assignments x
    JOIN r3_v1_events v ON v.tenant_id=x.tenant_id AND v.app_id=x.app_id AND v.environment=x.environment AND v.subject_id=x.subject_id
    JOIN r3_v1_event_registry reg ON reg.tenant_id=v.tenant_id AND reg.app_id=v.app_id AND reg.environment=v.environment AND reg.name=v.name
    JOIN river_v1_analytics_consents c ON c.tenant_id=x.tenant_id AND c.app_id=x.app_id AND c.environment=x.environment AND c.subject_id=x.subject_id
    WHERE x.tenant_id=${p.tenant} AND x.app_id=${p.app} AND x.environment=${p.environment} AND x.subject_id=${p.subject} AND x.flag_key=${p.flagKey}
     AND v.event_id=${p.eventId}::uuid AND v.name=${p.conversionEvent} AND reg.is_value AND v.occurred_at>=x.exposed_at AND x.variant=${p.expectedVariant} AND c.granted AND c.verified
    ON CONFLICT DO NOTHING RETURNING event_id`;
    return r.length?{variant:p.expectedVariant}:null;},
  async getABRetentionDataset(p){
   // Administrative only: query only consented subjects in the exact app and environment.
   const participants=await sql`SELECT x.tenant_id AS tenant,x.app_id AS app,x.environment,x.subject_id AS subject,x.flag_key AS "flagKey",x.variant,x.exposed_at AS "exposedAt"
    FROM river_v1_ab_assignments x
    JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
    JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
    WHERE x.tenant_id=${p.tenant} AND x.app_id=${p.app} AND x.environment=${p.environment} AND x.flag_key=${p.flagKey}
      AND c.granted AND c.verified AND a.enabled AND a.modules->>'analytics'='true'
    ORDER BY x.exposed_at LIMIT 10001`;
   if(participants.length>10000)throw new Error('Experiment exceeds reporting limit; query warehouse');
   const valueDays=await sql`SELECT DISTINCT x.tenant_id AS tenant,x.app_id AS app,x.environment,x.subject_id AS subject,
      TO_CHAR(v.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,true AS verified
    FROM river_v1_ab_assignments x
    JOIN river_v1_analytics_consents c USING(tenant_id,app_id,environment,subject_id)
    JOIN r3_v1_apps a USING(tenant_id,app_id,environment)
    JOIN r3_v1_events v ON v.tenant_id=x.tenant_id AND v.app_id=x.app_id AND v.environment=x.environment AND v.subject_id=x.subject_id
    JOIN r3_v1_event_registry reg ON reg.tenant_id=v.tenant_id AND reg.app_id=v.app_id AND reg.environment=v.environment AND reg.name=v.name
    WHERE x.tenant_id=${p.tenant} AND x.app_id=${p.app} AND x.environment=${p.environment} AND x.flag_key=${p.flagKey}
      AND c.granted AND c.verified AND a.enabled AND a.modules->>'analytics'='true' AND reg.is_value AND v.occurred_at>=x.exposed_at
    LIMIT 100001`;
   if(valueDays.length>100000)throw new Error('Experiment activity exceeds reporting limit; query warehouse');
   return {participants,valueDays};
  },
  async expose(p){const r=await sql`INSERT INTO r3_v1_exposures(tenant_id,app_id,environment,subject_id,experiment_key,arm,config_version) VALUES(${p.tenant},${p.app},${p.environment},${p.subject},${p.experiment},${p.arm},${p.configVersion}) ON CONFLICT DO NOTHING RETURNING arm`;
   if(r.length)return r[0].arm;
   const q=await sql`SELECT arm FROM r3_v1_exposures WHERE tenant_id=${p.tenant} AND app_id=${p.app} AND environment=${p.environment} AND subject_id=${p.subject} AND experiment_key=${p.experiment}`;return q[0]?.arm||null;},
  async enqueue(p){const r=await sql`SELECT r3_v1_enqueue(${p.tenant},${p.app},${p.environment},${p.subject},${p.campaignKey},${p.templateId}) AS id`;return r[0]?.id||null;},
  async reconcileHabit(p){const r=await sql`SELECT r3_v1_reconcile_habit(${p.tenant},${p.app},${p.environment},${p.subject}) AS ok`;if(r[0]?.ok!==true)return null;return this.getHabit(p);},
  async getHabit(p){
   const rows=await sql`SELECT last_day AS "lastDay",streak,longest_streak AS "longestStreak",today_count AS "todayCount",daily_goal AS "dailyGoal",xp,freeze_balance AS "freezeBalance" FROM r3_v1_habits WHERE tenant_id=${p.tenant} AND app_id=${p.app} AND environment=${p.environment} AND subject_id=${p.subject}`;
   if(!rows.length)return null;
   const row=rows[0],todayCount=Number(row.todayCount),dailyGoal=Number(row.dailyGoal);
   // Neon may decode DATE as a string or a JS Date. Expose a date-only API.
   const lastDay=row.lastDay instanceof Date?row.lastDay.toISOString().slice(0,10):row.lastDay==null?null:String(row.lastDay).slice(0,10);
   return {lastDay,streak:Number(row.streak),longestStreak:Number(row.longestStreak),todayCount,dailyGoal,xp:safeMoney(row.xp),freezeBalance:Number(row.freezeBalance),goalMet:todayCount>=dailyGoal};
  },
  async setHabitGoal(p){const r=await sql`SELECT r3_v1_set_habit_goal(${p.tenant},${p.app},${p.environment},${p.subject},${p.goal}) AS ok`;return r[0]?.ok===true;},
  async notificationContext(p){
   const rows=await sql`SELECT u.locale,u.timezone FROM r3_v1_subjects u WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment} AND u.subject_id=${p.subject}`;
   if(!rows.length)return null;
   const history=await sql`SELECT d.template_id FROM r3_v1_message_decisions d WHERE d.tenant_id=${p.tenant} AND d.app_id=${p.app} AND d.environment=${p.environment} AND d.subject_id=${p.subject} ORDER BY d.selected_at DESC LIMIT 3`;
   const scores=await sql`SELECT d.template_id,COUNT(*)::integer AS views,COUNT(o.delivery_id)::integer AS successes
    FROM r3_v1_message_decisions d JOIN r3_v1_outbox q ON q.tenant_id=d.tenant_id AND q.app_id=d.app_id AND q.environment=d.environment AND q.id=d.delivery_id
    LEFT JOIN r3_v1_message_outcomes o ON o.tenant_id=d.tenant_id AND o.app_id=d.app_id AND o.environment=d.environment AND o.delivery_id=d.delivery_id AND o.type='value'
    WHERE d.tenant_id=${p.tenant} AND d.app_id=${p.app} AND d.environment=${p.environment} AND d.kind=${p.kind} AND q.status='provider_accepted' AND q.sent_at<NOW()-INTERVAL '24 hours'
      AND split_part(q.locale,'-',1)=split_part(${rows[0].locale},'-',1)
    GROUP BY d.template_id`;
   const stats=Object.fromEntries(scores.map(x=>[x.template_id,{views:Number(x.views),successes:Number(x.successes)}]));
   return {recent:history.map(x=>x.template_id),stats,locale:rows[0].locale,timezone:rows[0].timezone};
  },
  async smartNotificationContext(p){
   // Scope all reads to the authenticated tenant, app, environment and subject.
   const users=await sql`SELECT cfg.enabled,cfg.modules,cfg.cadence,cfg.quiet_start,cfg.quiet_end,cfg.weekly_limit,
      u.timezone,u.locale,u.last_value_at,u.reminder_hour,u.reminder_hour_source,u.paused_until,
      c.granted,c.verified,x.arm,
      h.streak,h.daily_goal
     FROM r3_v1_subjects u JOIN r3_v1_apps cfg USING(tenant_id,app_id,environment)
     LEFT JOIN r3_v1_consents c ON c.tenant_id=u.tenant_id AND c.app_id=u.app_id AND c.environment=u.environment AND c.subject_id=u.subject_id AND c.channel='push' AND c.purpose='reminder'
     LEFT JOIN r3_v1_exposures x ON x.tenant_id=u.tenant_id AND x.app_id=u.app_id AND x.environment=u.environment AND x.subject_id=u.subject_id AND x.experiment_key='retention_push'
     LEFT JOIN r3_v1_habits h ON h.tenant_id=u.tenant_id AND h.app_id=u.app_id AND h.environment=u.environment AND h.subject_id=u.subject_id
     WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment} AND u.subject_id=${p.subject}`;
   if(!users.length)return null;
   const u=users[0];const app={enabled:u.enabled===true,modules:u.modules,cadence:u.cadence,quietStart:Number(u.quiet_start),quietEnd:Number(u.quiet_end),weeklyLimit:Number(u.weekly_limit)};
   const subject={timezone:u.timezone,locale:u.locale,lastValueAt:u.last_value_at,reminderHour:u.reminder_hour==null?null:Number(u.reminder_hour),reminderHourSource:u.reminder_hour_source,pausedUntil:u.paused_until};
   const consent={granted:u.granted===true,verified:u.verified===true};const arm=u.arm||null;
   // Avoid querying behavioral details without verified push consent and treatment exposure.
   if(!app.enabled||app.modules?.notifications!==true||!consent.granted||!consent.verified||arm!=='treatment')return {app,subject,consent,arm,existingCampaign:false,deliveries:[],habit:null,stats:{},recent:[],observations:[]};
   const delivery=await sql`SELECT status,sent_at,lease_until,
     EXISTS(SELECT 1 FROM r3_v1_message_outcomes o WHERE o.tenant_id=q.tenant_id AND o.app_id=q.app_id AND o.environment=q.environment AND o.delivery_id=q.id AND o.type='value') AS verified_value
     FROM r3_v1_outbox q WHERE q.tenant_id=${p.tenant} AND q.app_id=${p.app} AND q.environment=${p.environment} AND q.subject_id=${p.subject}
      AND (q.sent_at>=NOW()-INTERVAL '14 days' OR q.status='sending') ORDER BY q.created_at DESC LIMIT 100`;
   const exists=await sql`SELECT 1 AS present FROM r3_v1_outbox q WHERE q.tenant_id=${p.tenant} AND q.app_id=${p.app} AND q.environment=${p.environment} AND q.subject_id=${p.subject} AND q.campaign_key=${p.campaignKey} LIMIT 1`;
   const prior=await this.notificationContext({...p,kind:p.kind||'reminder'});
   const hours=await this.sendTimeContext(p);
   return {app,subject,consent,arm,existingCampaign:exists.length>0,
    deliveries:delivery.map(x=>({status:x.status,sentAt:x.sent_at,leaseUntil:x.lease_until,verifiedValue:x.verified_value===true})),
    habit:{streak:Number(u.streak||0),dailyGoal:Number(u.daily_goal||1)},stats:prior?.stats||{},recent:prior?.recent||[],observations:hours?.observations||[]};
  },
  async enqueueSelected(p){const r=await sql`SELECT r3_v1_enqueue_smart(${p.tenant},${p.app},${p.environment},${p.subject},${p.campaignKey},${p.templateId},${p.kind}) AS id`;return r[0]?.id||null;},
  async outcome(p){const r=await sql`SELECT r3_v1_record_outcome(${p.tenant},${p.app},${p.environment},${p.subject},${p.campaignKey},${p.type}) AS ok`;return r[0]?.ok===true;},
  async publishOffer(p){const r=await sql`SELECT r3_v1_publish_offer(${p.tenant},${p.app},${p.environment},${p.offerId},${p.conversionEvent},${p.currency},${p.listPriceMinor},${p.discountMinor},${p.startsAt}::timestamptz,${p.endsAt}::timestamptz,${p.maxRedemptions},${p.verificationRef}) AS ok`;return r[0]?.ok===true;},
  async listOffers(p){const r=await sql`SELECT * FROM r3_v1_list_offers(${p.tenant},${p.app},${p.environment},${p.subject},${p.personalized})`;return r.map(x=>({offerId:x.offer_id,currency:x.currency,listPriceMinor:Number(x.list_price_minor),discountMinor:Number(x.discount_minor),startsAt:new Date(x.starts_at).toISOString(),endsAt:new Date(x.ends_at).toISOString()}));},
  async redeemOffer(p){const r=await sql`SELECT * FROM r3_v1_redeem_offer(${p.tenant},${p.app},${p.environment},${p.subject},${p.offerId},${p.eventId}::uuid)`;return r[0]?{redemptionId:r[0].redemption_id,currency:r[0].currency,discountMinor:Number(r[0].discount_minor),status:r[0].status}:null;},
  async settleRedemption(p){const r=await sql`SELECT r3_v1_settle_redemption(${p.tenant},${p.app},${p.environment},${p.subject},${p.redemptionId}::uuid,${p.checkoutRef},${p.appliedDiscountMinor}) AS ok`;return r[0]?.ok===true;},
  async getSavings(p){const r=await sql`SELECT * FROM r3_v1_savings(${p.tenant},${p.app},${p.environment},${p.subject})`;return {totals:r.map(x=>({currency:x.currency,totalMinor:safeMoney(x.total_minor),count:Number(x.redemption_count)}))};},
  async recordFeedback(p){const r=await sql`SELECT r3_v1_record_feedback(${p.tenant},${p.app},${p.environment},${p.subject},${p.eventId}::uuid,${p.score},${p.reason}) AS ok`;return r[0]?.ok===true;},
  async claimReviewPrompt(p){const r=await sql`SELECT r3_v1_claim_review_prompt(${p.tenant},${p.app},${p.environment},${p.subject},${p.platform}) AS ok`;return r[0]?.ok===true;},
  async inviteFriend(p){const r=await sql`SELECT r3_v1_invite_friend(${p.tenant},${p.app},${p.environment},${p.subject},${p.friend}) AS ok`;return r[0]?.ok===true;},
  async respondFriend(p){const r=await sql`SELECT r3_v1_respond_friend(${p.tenant},${p.app},${p.environment},${p.subject},${p.friend},${p.accept}) AS ok`;return r[0]?.ok===true;},
  async removeFriend(p){const r=await sql`SELECT r3_v1_remove_friend(${p.tenant},${p.app},${p.environment},${p.subject},${p.friend}) AS ok`;return r[0]?.ok===true;},
  async startFriendQuest(p){const r=await sql`SELECT r3_v1_start_friend_quest(${p.tenant},${p.app},${p.environment},${p.subject},${p.friend},${p.questKey},${p.targetDays},${p.durationDays}) AS ok`;return r[0]?.ok===true;},
  async friendQuestStatus(p){const r=await sql`SELECT * FROM r3_v1_quest_status(${p.tenant},${p.app},${p.environment},${p.subject},${p.friend},${p.questKey})`;return r[0]?{targetDays:Number(r[0].target_days),daysCompleted:Number(r[0].days_completed),completed:r[0].completed,expired:r[0].expired}:null;},
  async sendTimeContext(p){
   const a=await sql`SELECT cfg.quiet_start,cfg.quiet_end,u.reminder_hour,u.timezone FROM r3_v1_apps cfg JOIN r3_v1_subjects u USING(tenant_id,app_id,environment) JOIN r3_v1_consents c ON c.tenant_id=u.tenant_id AND c.app_id=u.app_id AND c.environment=u.environment AND c.subject_id=u.subject_id AND c.channel='push' AND c.purpose='reminder' JOIN r3_v1_exposures x ON x.tenant_id=u.tenant_id AND x.app_id=u.app_id AND x.environment=u.environment AND x.subject_id=u.subject_id AND x.experiment_key='retention_push' WHERE u.tenant_id=${p.tenant} AND u.app_id=${p.app} AND u.environment=${p.environment} AND u.subject_id=${p.subject} AND cfg.enabled AND cfg.modules->>'notifications'='true' AND cfg.cadence IN ('daily','weekly') AND c.granted AND c.verified AND x.arm='treatment'`;
   if(!a.length)return null;
   const observations=await sql`SELECT * FROM r3_v1_send_time_observations(${p.tenant},${p.app},${p.environment},${p.subject})`;
   return {observations:observations.map(o=>({hour:Number(o.hour),converted:o.converted===true})),quietStart:Number(a[0].quiet_start),quietEnd:Number(a[0].quiet_end),defaultHour:a[0].reminder_hour??18};
  },
  async applyOptimizedHour(p){const r=await sql`SELECT r3_v1_apply_optimized_hour(${p.tenant},${p.app},${p.environment},${p.subject},${p.hour}) AS ok`;return r[0]?.ok===true;},
  async defineDailyMission(p){const r=await sql`SELECT r3_v1_define_daily_mission(${p.tenant},${p.app},${p.environment},${p.missionKey},${p.event},${p.target},${p.rewardXp}) AS ok`;return r[0]?.ok===true;},
  async dailyMissions(p){const r=await sql`SELECT * FROM r3_v1_daily_mission_status(${p.tenant},${p.app},${p.environment},${p.subject})`;
   return r.map(x=>({missionKey:x.mission_key,event:x.event_name,day:x.day instanceof Date?x.day.toISOString().slice(0,10):String(x.day).slice(0,10),target:Number(x.target),progress:Number(x.progress),completed:x.completed===true,rewardXp:Number(x.reward_xp),claimed:x.claimed===true}));
  },
  async claimDailyMission(p){const r=await sql`SELECT r3_v1_claim_daily_mission(${p.tenant},${p.app},${p.environment},${p.subject},${p.missionKey}) AS ok`;return r[0]?.ok===true;},
  async friendStreak(p){const r=await sql`SELECT * FROM r3_v1_friend_streak(${p.tenant},${p.app},${p.environment},${p.subject},${p.friend})`;
   return r[0]?{streak:Number(r[0].streak),longestStreak:Number(r[0].longest_streak),lastSharedDay:r[0].last_shared_day instanceof Date?r[0].last_shared_day.toISOString().slice(0,10):r[0].last_shared_day==null?null:String(r[0].last_shared_day).slice(0,10),timezone:'UTC'}:null;
  },
  async joinLeague(p){const r=await sql`SELECT r3_v1_join_league(${p.tenant},${p.app},${p.environment},${p.subject}) AS ok`;return r[0]?.ok===true;},
  async leaveLeague(p){const r=await sql`SELECT r3_v1_leave_league(${p.tenant},${p.app},${p.environment},${p.subject}) AS ok`;return r[0]?.ok===true;},
  async weeklyLeaderboard(p){const r=await sql`SELECT * FROM r3_v1_weekly_leaderboard(${p.tenant},${p.app},${p.environment},${p.subject},${p.limit})`;return r.map(x=>({rank:Number(x.rank),alias:`Player ${Number(x.rank)}`,score:Number(x.score),isSelf:x.is_self===true}));},
  async eraseSubject(p){const r=await sql`SELECT r3_v1_delete_subject(${p.tenant},${p.app},${p.environment},${p.subject}) AS deleted`;return r[0]?.deleted===true;}
 };
}
