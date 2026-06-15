-- ======================================================================================
-- U.N.D INDUSTRIES MASTER DATABASE SCHEMA (WITH OWNER TEST MODE)
-- ======================================================================================

-- ==========================================
-- 1. SUPABASE (LIVE PRODUCTION)
-- ==========================================

-- A. service_tickets
ALTER TABLE service_tickets 
ADD COLUMN IF NOT EXISTS ticket_type VARCHAR(20) DEFAULT 'real', -- 'real' | 'test'
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS intake_data JSONB,
ADD COLUMN IF NOT EXISTS claimed_by VARCHAR(50);

-- D. access_credentials (secure_intakes)
CREATE TABLE IF NOT EXISTS secure_intakes (
    intake_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    encrypted_payload TEXT NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);
ALTER TABLE secure_intakes ENABLE ROW LEVEL SECURITY;

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE service_tickets;

-- ==========================================
-- 2. QWEPSTORE (LOCAL SOVEREIGN DB)
-- ==========================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- B. jobs
CREATE TABLE IF NOT EXISTS jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) UNIQUE NOT NULL,
    ticket_type VARCHAR(20) DEFAULT 'real',
    user_id UUID NOT NULL,
    client_email VARCHAR(255),
    service_type VARCHAR(255) NOT NULL,
    payment_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'intake_pending', 
    intake_data JSONB,
    encrypted_credentials TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- C. job_status_history
CREATE TABLE IF NOT EXISTS job_status_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) REFERENCES jobs(ticket_id) ON DELETE CASCADE,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- E. changes (snapshots)
CREATE TABLE IF NOT EXISTS changes (
    change_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) REFERENCES jobs(ticket_id) ON DELETE CASCADE,
    target_system VARCHAR(100) NOT NULL, 
    change_type VARCHAR(50) NOT NULL, 
    before_snapshot_ref VARCHAR(500) NOT NULL, 
    after_snapshot_ref VARCHAR(500) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- F. evidence_packs
CREATE TABLE IF NOT EXISTS evidence_packs (
    pack_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) REFERENCES jobs(ticket_id) ON DELETE CASCADE,
    archive_path VARCHAR(500) NOT NULL,
    markdown_summary TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- G. audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) REFERENCES jobs(ticket_id) ON DELETE CASCADE,
    process_id VARCHAR(50) NOT NULL, 
    target_system VARCHAR(100) NOT NULL,
    action VARCHAR(255) NOT NULL, 
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- H. automation_workflows
CREATE TABLE IF NOT EXISTS automation_workflows (
    workflow_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) REFERENCES jobs(ticket_id) ON DELETE CASCADE,
    platform VARCHAR(100) NOT NULL,
    blueprint_json JSONB NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- I. shopify_theme_versions
CREATE TABLE IF NOT EXISTS shopify_theme_versions (
    theme_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) REFERENCES jobs(ticket_id) ON DELETE CASCADE,
    store_url VARCHAR(255) NOT NULL,
    live_theme_id VARCHAR(100) NOT NULL,
    draft_theme_id VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- J. website_snapshots
CREATE TABLE IF NOT EXISTS website_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) REFERENCES jobs(ticket_id) ON DELETE CASCADE,
    repo_url VARCHAR(255) NOT NULL,
    commit_hash VARCHAR(40) NOT NULL,
    snapshot_type VARCHAR(20) NOT NULL, -- 'before' | 'after'
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- K. error_reports
CREATE TABLE IF NOT EXISTS error_reports (
    error_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) REFERENCES jobs(ticket_id) ON DELETE CASCADE,
    error_code VARCHAR(100) NOT NULL,
    stack_trace TEXT,
    requires_rollback BOOLEAN DEFAULT FALSE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
