-- ======================================================================================
-- QWEPSTORE SCHEMA (LOCAL SOVEREIGN DATABASE)
-- ======================================================================================
-- This schema is executed on Qwep's local machine (PostgreSQL / SQLite).
-- It enforces Zero-Shared-State and isolates fulfillment logic from the live web server.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- For UUID generation if using Postgres

-- 1. Core Jobs Table (Mirrors Supabase tickets but tracks local execution state)
CREATE TABLE IF NOT EXISTS jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(255) UNIQUE NOT NULL,
    user_id UUID NOT NULL,
    service_slug VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'intake_pending', 
    -- Status Enum: paid, intake_pending, intake_complete, in_progress, awaiting_review, completed, failed, failed_access, refunded
    amount_cents INTEGER NOT NULL,
    payment_id VARCHAR(255),
    intake_data JSONB, -- The raw requirements/goals provided by the client
    encrypted_credentials TEXT, -- AES-256-GCM encrypted API keys or access tokens
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Audit Trail & Evidence Table (Legal Protection)
CREATE TABLE IF NOT EXISTS changes (
    change_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(255) REFERENCES jobs(ticket_number) ON DELETE CASCADE,
    target_system VARCHAR(100) NOT NULL, -- e.g., 'website_github', 'shopify_theme_id', 'make_com'
    change_type VARCHAR(50) NOT NULL, -- e.g., 'file_edit', 'theme_update', 'workflow_add'
    before_snapshot_ref VARCHAR(500) NOT NULL, -- Absolute path to local immutable snapshot
    after_snapshot_ref VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Access Logs (Tracking what Qwep touches)
CREATE TABLE IF NOT EXISTS access_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(255) REFERENCES jobs(ticket_number) ON DELETE CASCADE,
    process_id VARCHAR(50) NOT NULL, -- Identifies the specific Qwep subagent thread
    target_system VARCHAR(100) NOT NULL,
    action VARCHAR(255) NOT NULL, -- e.g., 'git clone', 'api token decrypted'
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Automatically update the updated_at timestamp on jobs
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_jobs_modtime
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE PROCEDURE update_modified_column();
