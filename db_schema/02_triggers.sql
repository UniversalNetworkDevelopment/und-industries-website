-- 1. Create a function that sends a payload to the Qwep local server
-- Note: In production, Qwep will be hosted on a public domain or via a secure tunnel (e.g. ngrok)
-- For local dev, replace the URL with your ngrok/Cloudflare tunnel URL
CREATE OR REPLACE FUNCTION trigger_qwep_job()
RETURNS trigger AS $$
DECLARE
  job_payload jsonb;
BEGIN
  -- Only trigger when status changes to 'paid'
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    job_payload := json_build_object(
      'ticket_id', NEW.ticket_number,
      'ticket_type', NEW.service_slug,
      'user_id', NEW.user_id,
      'event', 'PAYMENT_RECEIVED'
    );
    
    -- Call the Qwep server (replace URL with actual Qwep endpoint in production)
    PERFORM net.http_post(
        url := 'http://127.0.0.1:3133/api/jobs',
        body := job_payload
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach the trigger to the service_tickets table
DROP TRIGGER IF EXISTS qwep_job_trigger ON service_tickets;

CREATE TRIGGER qwep_job_trigger
AFTER UPDATE ON service_tickets
FOR EACH ROW
EXECUTE FUNCTION trigger_qwep_job();
