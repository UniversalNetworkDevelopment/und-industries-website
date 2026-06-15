CREATE TABLE IF NOT EXISTS forensic_events (
  uuid UUID,
  role TEXT,
  ip TEXT,
  device TEXT,
  event_type TEXT,
  risk_score INT,
  anomaly_flags JSONB,
  prompt_hash TEXT,
  mode_triggered TEXT,
  escalation_target TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_incidents (
  incident_id UUID DEFAULT gen_random_uuid(),
  uuid UUID,
  role TEXT,
  description TEXT,
  severity TEXT,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS credential_anomalies (
  uuid UUID,
  credential_id TEXT,
  anomaly_type TEXT,
  risk_score INT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
