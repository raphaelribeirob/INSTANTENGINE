-- TMNT v1.4: scoped and durable notification choices and observational outcomes.
-- Apply after universal r3_v1 schema, in a new staging branch first.
-- All user-level identifiers remain opaque. No vendor secrets in DB rows.
CREATE TABLE IF NOT EXISTS r3_v1_message_decisions (
 tenant_id TEXT NOT NULL,
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL,
 delivery_id UUID NOT NULL,
 subject_id TEXT NOT NULL,
 campaign_key TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'reminder',
 template_id TEXT NOT NULL,
 policy_version INTEGER NOT NULL DEFAULT 1,
 selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,delivery_id),
 UNIQUE(tenant_id,app_id,environment,subject_id,campaign_key),
 FOREIGN KEY(tenant_id,app_id,environment,delivery_id)
 REFERENCES r3_v1_outbox(tenant_id,app_id,environment,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS r3_v1_message_decisions_history
 ON r3_v1_message_decisions(tenant_id,app_id,environment,subject_id,selected_at DESC);
CREATE TABLE IF NOT EXISTS r3_v1_message_outcomes (
 tenant_id TEXT NOT NULL,
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL,
 delivery_id UUID NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('opened','value')),
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,app_id,environment,delivery_id,type),
 FOREIGN KEY(tenant_id,app_id,environment,delivery_id)
 REFERENCES r3_v1_message_decisions(tenant_id,app_id,environment,delivery_id) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION r3_v1_enqueue_smart(
 t TEXT,a TEXT,e TEXT,s TEXT,campaign TEXT,template TEXT,kind TEXT
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE delivery UUID;
BEGIN
 delivery:=r3_v1_enqueue(t,a,e,s,campaign,template);
 IF delivery IS NULL THEN RETURN NULL; END IF;
 INSERT INTO r3_v1_message_decisions(tenant_id,app_id,environment,delivery_id,subject_id,campaign_key,kind,template_id)
 VALUES(t,a,e,delivery,s,campaign,kind,template);
 RETURN delivery;
END $$;
CREATE OR REPLACE FUNCTION r3_v1_record_outcome(
 t TEXT,a TEXT,e TEXT,s TEXT,campaign TEXT,outcome_type TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE delivery UUID;
DECLARE since_at TIMESTAMPTZ;
DECLARE affected INTEGER;
BEGIN
 IF outcome_type NOT IN ('opened','value') THEN RETURN FALSE; END IF;
 SELECT q.id,q.sent_at INTO delivery,since_at
 FROM r3_v1_outbox q JOIN r3_v1_message_decisions d
 ON d.tenant_id=q.tenant_id AND d.app_id=q.app_id AND d.environment=q.environment AND d.delivery_id=q.id
 WHERE q.tenant_id=t AND q.app_id=a AND q.environment=e AND q.subject_id=s
   AND q.campaign_key=campaign AND q.status='provider_accepted'
   AND q.sent_at<=NOW() AND q.sent_at>NOW()-INTERVAL '24 hours';
 IF delivery IS NULL THEN RETURN FALSE; END IF;
 IF outcome_type='value' AND NOT EXISTS (
  SELECT 1 FROM r3_v1_events ev JOIN r3_v1_event_registry reg USING(tenant_id,app_id,environment,name)
  WHERE ev.tenant_id=t AND ev.app_id=a AND ev.environment=e AND ev.subject_id=s
    AND reg.is_value AND ev.occurred_at>=since_at AND ev.occurred_at<=NOW()
 ) THEN RETURN FALSE; END IF;
 INSERT INTO r3_v1_message_outcomes(tenant_id,app_id,environment,delivery_id,type)
 VALUES(t,a,e,delivery,outcome_type) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END $$;
