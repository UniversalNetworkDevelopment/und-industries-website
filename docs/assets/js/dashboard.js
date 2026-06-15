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
            const evidenceHtml = t.status === 'complete' 
                ? `<a href="https://wgcgzuflpxijhzlpphab.supabase.co/storage/v1/object/public/evidence_archives/${t.ticket_number}_evidence.zip" class="btn btn-outline btn-sm mt-12" target="_blank">Download Evidence Pack</a>`
                : '';
                
            return `
                <div class="card ticket-card mb-12">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <strong>${t.service_slug.toUpperCase()}</strong>
                        <span class="badge ${t.status === 'complete' ? 'badge-success' : 'badge-warning'}">${t.status.toUpperCase()}</span>
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
