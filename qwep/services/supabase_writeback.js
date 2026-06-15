require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');
global.WebSocket = require('ws');
const fs = require('fs');

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

async function markComplete(ticketId, evidencePath) {
    if (!supabase) {
        console.warn('[SUPABASE WRITEBACK] No keys found. Simulating completion writeback.');
        return;
    }

    try {
        console.log(`[SUPABASE] Uploading evidence pack to storage bucket...`);
        const fileBuffer = fs.readFileSync(evidencePath);
        const fileName = `${ticketId}_evidence.zip`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('evidence_archives')
            .upload(fileName, fileBuffer, { contentType: 'application/zip' });

        if (uploadError) throw uploadError;

        console.log(`[SUPABASE] Marking service_ticket ${ticketId} as complete...`);
        const { error: updateError } = await supabase
            .from('service_tickets')
            .update({ 
                status: 'complete',
                completed_at: new Date().toISOString()
            })
            .eq('ticket_number', ticketId);

        if (updateError) throw updateError;
        
        console.log(`[SUPABASE WRITEBACK] Sync complete for ${ticketId}.`);
    } catch (error) {
        console.error('[SUPABASE WRITEBACK ERROR]', error.message);
        throw error;
    }
}

module.exports = { markComplete };
