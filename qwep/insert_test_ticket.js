require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

// Must use global.WebSocket for node 20
global.WebSocket = require('ws');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function createTestTicket() {
    const ticketNumber = 'TEST-' + Math.floor(Math.random() * 100000);
    console.log(`[TEST INJECTOR] Creating test ticket: ${ticketNumber}`);

    const { data, error } = await supabase
        .from('service_tickets')
        .insert([{
            ticket_number: ticketNumber,
            ticket_type: 'test',
            service_slug: 'full_website_build_test',
            status: 'ready'
        }])
        .select();

    if (error) {
        console.error('[TEST INJECTOR ERROR]', error);
    } else {
        console.log(`[TEST INJECTOR] Successfully injected ${ticketNumber}.`);
    }
}

createTestTicket();
