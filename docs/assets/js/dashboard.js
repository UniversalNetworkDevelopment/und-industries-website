// Dashboard Ticket Loader
(async function() {
    'use strict';
    
    async function loadTickets() {
        const container = document.getElementById('tickets-list-container');
        if (!container) return;

        if (!window.supabase) {
            container.innerHTML = '<p class="text-muted">Authentication offline. Cannot load tickets.</p>';
            return;
        }

        const sessionRes = await supabase.auth.getSession();
        if (!sessionRes.data.session) return;

        const userId = sessionRes.data.session.user.id;
        
        const { data: tickets, error } = await supabase
            .from('service_tickets')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching tickets:', error);
            container.innerHTML = '<p class="text-muted">Failed to load tickets.</p>';
            return;
        }

        if (!tickets || tickets.length === 0) {
            container.innerHTML = '<p class="text-muted">You have no active or past service tickets.</p>';
            return;
        }

        container.innerHTML = tickets.map(t => {
            const date = new Date(t.created_at).toLocaleDateString();
            // EVIDENCE PACK — deliberately OFF. Do not "fix" this by flipping it on.
            //
            // This was gated on `status === 'complete'`, which is not a real value (the
            // canonical set is new|scoped|paid|in_progress|delivered|closed), so the link
            // never rendered. That bug was accidentally load-bearing: the storage bucket
            // it points at DOES NOT EXIST — see SUPABASE_MISSING.md:14. Correcting the
            // status alone would hand every paying customer a 404 at the exact moment
            // they are happiest with us.
            //
            // Two things must be true before this returns: (1) the `evidence_archives`
            // bucket exists, and (2) the ticket records that a pack was actually uploaded
            // FOR IT — a per-ticket fact, not an inference from delivery status. Guessing
            // the object URL from the ticket number is what produced the 404 in the first
            // place. EVIDENCE_SYSTEM_SPEC.md has the intent.
            const evidenceHtml = '';
                
            return `
                <div class="card ticket-card mb-12">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <strong>${t.service_slug.toUpperCase()}</strong>
                        <span class="badge ${t.status === 'delivered' ? 'badge-success' : 'badge-warning'}">${t.status.toUpperCase()}</span>
                    </div>
                    <div class="text-sm text-muted">Ticket #: ${t.ticket_number}</div>
                    <div class="text-sm text-muted">Date: ${date}</div>
                    ${evidenceHtml}
                </div>
            `;
        }).join('');
    }

    // Hook into main.js Auth initialization flow or run after DOM load
    document.addEventListener('DOMContentLoaded', () => {
        // Wait a brief moment to ensure Supabase is initialized by main.js
        setTimeout(loadTickets, 500);
    });
})();
