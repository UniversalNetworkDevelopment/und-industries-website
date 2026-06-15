-- ======================================================================================
-- SUPABASE SCHEMA (LIVE PRODUCTION)
-- ======================================================================================
-- This schema extends the existing `service_tickets` table to support the full Qwep fulfillment lifecycle.

-- 1. Ensure `service_tickets` exists and has the required fields
-- Note: Assuming the table already exists from previous checkouts, we ALTER it safely.
-- If the table does not exist, you must create it first.

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='service_tickets' AND column_name='status') THEN
        ALTER TABLE service_tickets ADD COLUMN status VARCHAR(50) DEFAULT 'pending';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='service_tickets' AND column_name='intake_data') THEN
        ALTER TABLE service_tickets ADD COLUMN intake_data JSONB;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='service_tickets' AND column_name='claimed_by') THEN
        ALTER TABLE service_tickets ADD COLUMN claimed_by VARCHAR(50);
    END IF;
END $$;

-- 2. Create the Intake UI Security Table (If handling secure keys on Supabase before pulling to local)
-- Qwep prefers local intake, but if the client submits via the website, it hits this table temporarily.
CREATE TABLE IF NOT EXISTS secure_intakes (
    intake_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(255) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    encrypted_payload TEXT NOT NULL, -- AES-256-GCM encrypted frontend payload
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Row Level Security (RLS) for Secure Intakes
ALTER TABLE secure_intakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own intakes" 
ON secure_intakes FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own intakes" 
ON secure_intakes FOR SELECT 
USING (auth.uid() = user_id);

-- 3. Enable Realtime on service_tickets
-- This allows Qwep's ticket-relay to listen via WebSocket instead of polling.
alter publication supabase_realtime add table service_tickets;
