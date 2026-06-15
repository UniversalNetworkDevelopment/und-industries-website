const fs = require('fs');

// --- 1. Update dashboard.html ---
let dash = fs.readFileSync('E:/und-industries-website/docs/dashboard.html', 'utf8');

// Add to sidebar nav
dash = dash.replace(
  '<button type="button" class="sidebar-link sidebar-tab-btn" data-tab="chat">',
  '<button type="button" class="sidebar-link sidebar-tab-btn" data-tab="tickets"><span class="sidebar-link-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg></span> Tickets &amp; Orders</button>\n        <button type="button" class="sidebar-link sidebar-tab-btn" data-tab="chat">'
);

// Add to mobile nav
dash = dash.replace(
  '<button type="button" class="dash-tab-btn" data-tab="chat" role="tab" aria-selected="false">Community</button>',
  '<button type="button" class="dash-tab-btn" data-tab="tickets" role="tab" aria-selected="false">Tickets &amp; Orders</button>\n        <button type="button" class="dash-tab-btn" data-tab=\"chat\" role=\"tab\" aria-selected=\"false\">Community</button>'
);

// Add tab content
const ticketsTab = `
      <!-- TAB: Tickets & Orders -->
      <div id="tab-tickets" class="dash-tab-content" role="tabpanel" hidden>
        <div class="card">
          <h4 class="mb-16">Your Service Tickets &amp; Orders</h4>
          <p class="text-muted mb-20">Track the status of your services or cancel pending checkout sessions.</p>
          <div id="tickets-list-container" class="tickets-grid">
            <div class="loading-spinner"></div>
          </div>
        </div>
      </div>
`;
dash = dash.replace('<!-- TAB: Community Chat -->', ticketsTab + '\n      <!-- TAB: Community Chat -->');

fs.writeFileSync('E:/und-industries-website/docs/dashboard.html', dash);

// --- 2. Update main.js ---
let main = fs.readFileSync('E:/und-industries-website/docs/assets/js/main.js', 'utf8');

const ticketsLogic = `
  // ==== Tickets Tab ====
  function loadTickets() {
    var c = document.getElementById('tickets-list-container');
    if (!c || !user) return;
    sb.from('service_tickets')
      .select('ticket_number,service_name,status,amount_cents,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(function(res) {
        if (res.error) { c.innerHTML = '<p class="text-error">Could not load tickets.</p>'; return; }
        if (!res.data || res.data.length === 0) {
          c.innerHTML = '<p class="text-muted">You have no tickets or orders yet.</p>'; return;
        }
        var html = '';
        res.data.forEach(function(t) {
          var dateStr = new Date(t.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          var amt = '$' + (t.amount_cents / 100).toFixed(2);
          var badgeClass = 'bg-accent';
          var statusText = t.status.replace('_', ' ').toUpperCase();
          if (t.status === 'paid') badgeClass = 'bg-success';
          if (t.status === 'cancelled') badgeClass = 'bg-error';
          if (t.status === 'checkout_started') statusText = 'PENDING PAYMENT';
          
          html += '<div class="card" style="margin-bottom: 12px; padding: 16px; border-color: rgba(255,255,255,0.05)">' +
                    '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px">' +
                      '<div>' +
                        '<h5 style="margin:0 0 4px">' + Auth.esc(t.service_name) + '</h5>' +
                        '<p class="text-muted" style="margin:0; font-size:0.85rem">Ticket: ' + Auth.esc(t.ticket_number) + ' &bull; ' + dateStr + '</p>' +
                      '</div>' +
                      '<div style="text-align:right">' +
                        '<div style="font-weight:bold; margin-bottom:4px">' + amt + '</div>' +
                        '<span class="badge ' + badgeClass + '" style="font-size:0.7rem">' + statusText + '</span>' +
                      '</div>' +
                    '</div>';
          
          if (t.status === 'checkout_started') {
            html += '<div style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.05); text-align:right">' +
                      '<button type="button" class="btn btn-outline btn-sm cancel-ticket-btn" data-ticket="' + Auth.esc(t.ticket_number) + '">Cancel Order</button>' +
                    '</div>';
          }
          html += '</div>';
        });
        c.innerHTML = html;
        
        var cancelBtns = c.querySelectorAll('.cancel-ticket-btn');
        for (var i=0; i<cancelBtns.length; i++) {
          cancelBtns[i].addEventListener('click', function(e) {
            var tnum = e.target.getAttribute('data-ticket');
            if (confirm('Are you sure you want to cancel ticket ' + tnum + '?')) {
              e.target.disabled = true;
              e.target.textContent = 'Canceling...';
              sb.from('service_tickets')
                .update({ status: 'cancelled' })
                .eq('ticket_number', tnum)
                .eq('user_id', user.id) // security check
                .eq('status', 'checkout_started') // strictly only pending
                .then(function(upd) {
                  loadTickets();
                });
            }
          });
        }
      });
  }
`;

main = main.replace('// restored tab from URL hash', ticketsLogic + '\n    if (user) loadTickets();\n\n    // restored tab from URL hash');
// If that replace failed, fallback
if (main.indexOf('function loadTickets') === -1) {
   main = main.replace('// Dashboard tabs + profile + role-based UI', ticketsLogic + '\n    // Dashboard tabs + profile + role-based UI');
}

fs.writeFileSync('E:/und-industries-website/docs/assets/js/main.js', main);

let styles = fs.readFileSync('E:/und-industries-website/docs/assets/css/styles.css', 'utf8');
styles += '\n\n/* Ticket Tab Badges */\n.bg-accent { background: rgba(124,58,237,0.2); color: #c4b5fd; padding: 2px 6px; border-radius: 4px; }\n.bg-success { background: rgba(16,185,129,0.2); color: #6ee7b7; padding: 2px 6px; border-radius: 4px; }\n.bg-error { background: rgba(239,68,68,0.2); color: #fca5a5; padding: 2px 6px; border-radius: 4px; }\n';
fs.writeFileSync('E:/und-industries-website/docs/assets/css/styles.css', styles);

// Fix services.html .svc-card
let servicesHtml = fs.readFileSync('E:/und-industries-website/docs/services.html', 'utf8');
servicesHtml = servicesHtml.replace(/\.svc-card \{[\s\S]*?\}/, `
    .svc-card {
      background: rgba(21, 21, 26, 0.7);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 16px;
      padding: 26px;
      display: flex;
      flex-direction: column;
      position: relative;
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    }
    .svc-card:hover {
      transform: translateY(-4px);
      border-color: rgba(124,92,255,0.4);
      box-shadow: 0 12px 40px rgba(124,92,255,0.15);
    }`);
fs.writeFileSync('E:/und-industries-website/docs/services.html', servicesHtml);
