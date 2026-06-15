const { createClient } = require('@supabase/supabase-js');
global.WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
const envVars = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val) acc[key.trim()] = val.join('=').trim();
    return acc;
}, {});

const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

console.log(`[QWEP RELAY] Initializing Realtime WebSocket listener on service_tickets...`);

const ticketSubscription = supabase
    .channel('custom-all-channel')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'service_tickets' }, (payload) => {
        const newRecord = payload.new;
        const oldRecord = payload.old;

        // Trigger condition 1: Real ticket paid
        const isRealPaid = newRecord.ticket_type === 'real' && newRecord.status === 'paid' && oldRecord.status !== 'paid';
        
        // Trigger condition 2: Owner test ticket marked ready
        const isTestReady = newRecord.ticket_type === 'test' && newRecord.status === 'ready' && oldRecord.status !== 'ready';

        if (isRealPaid || isTestReady) {
            console.log(`\n[ALERT] Job Detected! ID: ${newRecord.ticket_number} | Type: ${newRecord.ticket_type}`);
            handleNewJob(newRecord);
        }
    })
    .subscribe();

async function handleNewJob(ticket) {
    console.log(`[QWEP RELAY] Claiming job ${ticket.ticket_number}...`);
    
    // Idempotency / Claim Lock
    const { data, error } = await supabase
        .from('service_tickets')
        .update({ status: 'intake_pending', claimed_by: 'qwep_core_1' })
        .eq('ticket_number', ticket.ticket_number)
        .select();
        
    if (error) {
        console.error(`[QWEP RELAY ERROR] Failed to claim ticket ${ticket.ticket_number}:`, error.message);
        return;
    }
    
    console.log(`[QWEP RELAY] Successfully claimed ticket ${ticket.ticket_number}.`);
    
    const jobPacket = {
        ticket_id: ticket.ticket_number,
        ticket_type: ticket.ticket_type,
        user_id: ticket.user_id,
        service_type: ticket.service_slug,
        intake_data_ref: ticket.intake_data,
        status: 'intake_pending'
    };

    // Forward to QwepStore via local API
    console.log(`[QWEP RELAY] Pushing job packet to QwepStore.`);
    try {
        await fetch('http://127.0.0.1:3133/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jobPacket)
        });
        
        // Log to audit_logs
        await fetch('http://127.0.0.1:3133/api/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ticket_id: ticket.ticket_number,
                target_system: 'Supabase_Realtime',
                action: `Claimed ${ticket.ticket_type} ticket`,
                process_id: 'qwep_relay'
            })
        });
    } catch(err) {
        console.error(`[QWEP RELAY ERROR] Qwep API is offline:`, err.message);
    }
}
