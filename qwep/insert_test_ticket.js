require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

// Must use global.WebSocket for node 20
global.WebSocket = require('ws');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function createTestTicket() {
    const { data: users, error: userError } = await supabase.auth.admin.listUsers();
    if (userError || !users.users || users.users.length === 0) {
        console.error('[TEST INJECTOR ERROR] Could not fetch a valid user_id from auth.users', userError);
        return;
    }
    const userId = users.users[0].id;

    const ticketNumber = 'TEST-' + Math.floor(Math.random() * 100000);
    console.log(`[TEST INJECTOR] Creating test ticket: ${ticketNumber} for user ${userId}`);

    const { data: insertData, error: insertError } = await supabase
        .from('service_tickets')
        .insert([{
            ticket_number: ticketNumber,
            user_id: userId,
            service_slug: 'full_website_build_test',
            status: 'pending'
        }])
        .select();

    if (insertError) {
        console.error('[TEST INJECTOR ERROR] Insert failed:', insertError);
        return;
    }

    console.log(`[TEST INJECTOR] Injected as pending. Triggering UPDATE event to ready...`);

    const { data: updateData, error: updateError } = await supabase
        .from('service_tickets')
        .update({ status: 'ready' })
        .eq('ticket_number', ticketNumber)
        .select();

    if (updateError) {
        console.error('[TEST INJECTOR ERROR] Update failed:', updateError);
    } else {
        console.log(`[TEST INJECTOR] Successfully fired UPDATE for ${ticketNumber}.`);
        
        // Push directly to Qwep to simulate Realtime listener (since realtime publication might not be enabled on dashboard)
        console.log(`[TEST INJECTOR] Manually pushing job packet to Qwep Store...`);
        const jobPacket = {
            ticket_id: ticketNumber,
            ticket_type: 'test',
            user_id: userId,
            service_type: 'full_website_build_test',
            intake_data_ref: { target_repo_name: 'web-builder-ai' },
            status: 'intake_pending'
        };
        
        try {
            const res = await fetch('http://127.0.0.1:3133/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(jobPacket)
            });
            console.log(`[TEST INJECTOR] Qwep Response: ${res.status}`);
        } catch(e) {
            console.error(`[TEST INJECTOR] Failed to reach Qwep:`, e.message);
        }
    }
}

createTestTicket();
