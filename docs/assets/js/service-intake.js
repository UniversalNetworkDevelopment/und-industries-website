// service-intake.js — post-payment secure order-intake page.
// Loads ONLY on service-intake.html.
// Flow: user arrives with ?ticket=<ticket_number> (or multiple comma-separated).
//   1. Fetch their service_tickets where intake_status='awaiting_intake' (RLS: own rows only).
//   2. For each ticket render a form: target URL + exact problem + desired outcome + access picker.
//   3. On submit → UPDATE service_tickets via the anon client (RLS policy "client submit intake"
//      authorises the buyer to UPDATE their own ticket while intake_status='awaiting_intake').
//   4. On any hard failure → show email fallback with the ticket #.
//
// No secrets stored. Access method is a free-form declaration; actual credentials
// (invites, keys) are sent via separate secure channels — NEVER this form.
//
// CSP: script-src 'self' https://cdn.jsdelivr.net — this is an external file, compliant.
(function () {
  'use strict';

  var SUPABASE_URL      = 'https://wgcgzuflpxijhzlpphab.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2d6dWZscHhpamh6bHBwaGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTc3MTgsImV4cCI6MjA5NDc5MzcxOH0.y96jBpi9ECy1RU76q4AuZQFlqPVrS6CJDwNyx__2K9A';
  var FALLBACK_EMAIL    = 'contact.undindustries@gmail.com';

  // Access methods with real steps the buyer follows. No passwords — invites/scoped only.
  var ACCESS_METHODS = {
    github_collaborator: {
      label: 'GitHub Collaborator Invite',
      steps: 'Go to your repository → Settings → Collaborators & teams → Add people → enter <strong>undindustries</strong> as the collaborator. We\'ll accept within 1 hour.'
    },
    shopify_staff: {
      label: 'Shopify Staff Account (preferred for Shopify work)',
      steps: 'In Shopify admin: Settings → Users and permissions → Add staff → enter <strong>contact.undindustries@gmail.com</strong>. Set permissions to what the job needs (Themes, Products, etc.). No full-owner access needed.'
    },
    cms_temp_admin: {
      label: 'WordPress / CMS Temporary Admin',
      steps: 'Create a new Administrator user with email <strong>contact.undindustries@gmail.com</strong> and a temporary password you generate. After work is done, delete the user or change the password. Never send us your main credentials.'
    },
    scoped_api_key: {
      label: 'Scoped API Key / Read-Write Token',
      steps: 'Create a limited API key in your platform dashboard with only the scopes needed (e.g. theme read+write, not billing). Paste the key in the "Anything else?" field below — we\'ll delete it from our copy when work is done.'
    },
    temp_user: {
      label: 'Temporary User Account',
      steps: 'Create a new user/login on your platform (separate from your own). Give it the minimum required role. Share the login to the email/inbox we\'ll send you. Delete or disable the user after the work is complete.'
    },
    file_upload: {
      label: 'File / Export Upload',
      steps: 'Export the relevant theme files, templates, or assets as a ZIP. Reply to our confirmation email with the attachment, or share a temporary download link (Google Drive, Dropbox, etc.).'
    },
    screen_share: {
      label: 'Scheduled Screen Share',
      steps: 'We\'ll email you a Google Meet / Zoom link. You share your screen and we walk through the work together. We never take control unless you grant it. Good for quick fixes or sensitive setups.'
    }
  };

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  var rootEl = document.getElementById('si-root');
  if (!rootEl) return;

  if (!window.supabase || !window.supabase.createClient) {
    showFatalError('Could not load required libraries. Try refreshing.');
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Parse ?ticket= param
  var params     = new URLSearchParams(window.location.search);
  var ticketParam = (params.get('ticket') || '').trim();

  sb.auth.getSession().then(function (sRes) {
    var session = sRes && sRes.data ? sRes.data.session : null;
    if (!session) {
      rootEl.innerHTML =
        '<div class="si-card">' +
          '<p class="si-msg">You need to be signed in to submit your order details.</p>' +
          '<div class="si-actions">' +
            '<a href="login.html?next=service-intake.html' + (ticketParam ? '?ticket=' + encodeURIComponent(ticketParam) : '') + '" class="btn btn-primary">Sign In</a>' +
          '</div>' +
        '</div>';
      return;
    }
    loadTickets(session);
  }).catch(function () {
    showFatalError('Session check failed. Please refresh.');
  });

  function loadTickets(session) {
    rootEl.innerHTML = '<p class="si-loading">Loading your order…</p>';

    var query = sb.from('service_tickets')
      .select('id,ticket_number,service_name,service_slug,intake_status,created_at')
      .eq('user_id', session.user.id)
      .eq('intake_status', 'awaiting_intake')
      .order('created_at', { ascending: false })
      .limit(10);

    // If ticket param provided, narrow to that ticket (belt-and-suspenders; RLS owns the real guard)
    if (ticketParam) {
      var nums = ticketParam.split(',').map(function(t){ return t.trim(); }).filter(Boolean);
      if (nums.length === 1) {
        query = query.eq('ticket_number', nums[0]);
      } else {
        query = query.in('ticket_number', nums);
      }
    }

    query.then(function (res) {
      if (res.error) {
        console.error('[intake] fetch error', res.error);
        showFatalError('Could not load your order.', ticketParam || 'your ticket');
        return;
      }
      var tickets = res.data || [];
      if (!tickets.length) {
        // Check if already submitted
        var doneQuery = sb.from('service_tickets')
          .select('ticket_number,service_name,intake_status')
          .eq('user_id', session.user.id)
          .in('intake_status', ['submitted','in_progress','complete'])
          .order('created_at', { ascending: false })
          .limit(5);

        if (ticketParam) {
          var nums2 = ticketParam.split(',').map(function(t){ return t.trim(); }).filter(Boolean);
          if (nums2.length) doneQuery = doneQuery.in('ticket_number', nums2);
        }

        doneQuery.then(function(doneRes) {
          var done = doneRes.data || [];
          if (done.length) {
            var listHtml = done.map(function(t) {
              return '<li><strong>#' + esc(String(t.ticket_number)) + '</strong> &mdash; ' + esc(t.service_name) + ' (' + esc(t.intake_status) + ')</li>';
            }).join('');
            rootEl.innerHTML =
              '<div class="si-card">' +
                '<div class="si-ok-icon" aria-hidden="true">&#10003;</div>' +
                '<h2 class="si-title">Already submitted</h2>' +
                '<p class="si-msg">Your order details are in. We\'ll be in touch within 24 hours.</p>' +
                '<ul class="si-done-list">' + listHtml + '</ul>' +
                '<div class="si-actions"><a href="dashboard.html" class="btn btn-outline">View Dashboard</a></div>' +
              '</div>';
          } else {
            var nfCard = document.createElement('div');
            nfCard.className = 'si-card';
            var nfP = document.createElement('p');
            nfP.className = 'si-msg';
            nfP.textContent = 'No pending intake orders found for your account.' +
              (ticketParam ? ' (Ticket #' + ticketParam + ')' : '');
            nfCard.appendChild(nfP);
            nfCard.appendChild(buildFallbackNode(ticketParam || 'your ticket'));
            var nfActions = document.createElement('div');
            nfActions.className = 'si-actions';
            var nfLink = document.createElement('a');
            nfLink.href = 'dashboard.html';
            nfLink.className = 'btn btn-outline';
            nfLink.textContent = 'Dashboard';
            nfActions.appendChild(nfLink);
            nfCard.appendChild(nfActions);
            rootEl.innerHTML = '';
            rootEl.appendChild(nfCard);
          }
        }).catch(function() {
          rootEl.innerHTML = '<div class="si-card"><p class="si-msg">No pending intake orders found.</p><div id="si-fallback-a"></div></div>';
          var fa = document.getElementById('si-fallback-a');
          if (fa) fa.parentNode.insertBefore(buildFallbackNode(ticketParam || 'your ticket'), fa.nextSibling);
        });
        return;
      }
      renderForms(tickets, session);
    }).catch(function (e) {
      console.error('[intake] query threw', e);
      showFatalError('Could not load your order.', ticketParam || 'your ticket');
    });
  }

  function renderForms(tickets, session) {
    var html = '<div class="si-intro">' +
      '<h2 class="si-page-title">Submit Your Order Details</h2>' +
      '<p class="si-page-sub">This takes 2 minutes. Fill out the form for each service below so we can start immediately.</p>' +
    '</div>';

    tickets.forEach(function(ticket, idx) {
      html += buildTicketForm(ticket, idx);
    });

    rootEl.innerHTML = html;

    // Wire up each form after rendering
    tickets.forEach(function(ticket, idx) {
      wireForm(ticket, idx, session);
    });
  }

  function buildTicketForm(ticket, idx) {
    var formId    = 'si-form-' + idx;
    var statusId  = 'si-status-' + idx;
    var successId = 'si-success-' + idx;

    var accessOptions = Object.keys(ACCESS_METHODS).map(function(key) {
      return '<option value="' + esc(key) + '">' + esc(ACCESS_METHODS[key].label) + '</option>';
    }).join('');

    return '<div class="si-card" id="si-card-' + idx + '">' +
      '<div class="si-card-header">' +
        '<span class="si-ticket-num">Ticket #' + esc(String(ticket.ticket_number)) + '</span>' +
        '<span class="si-service-name">' + esc(ticket.service_name) + '</span>' +
      '</div>' +

      '<form id="' + formId + '" novalidate class="si-form">' +

        '<div class="si-field">' +
          '<label class="si-label" for="si-url-' + idx + '">Target URL <span class="si-req">*</span></label>' +
          '<input class="si-input" type="url" id="si-url-' + idx + '" placeholder="https://yourwebsite.com" required>' +
        '</div>' +

        '<div class="si-field">' +
          '<label class="si-label" for="si-problem-' + idx + '">Exact Problem / What Needs Done <span class="si-req">*</span></label>' +
          '<textarea class="si-textarea" id="si-problem-' + idx + '" rows="4" placeholder="Be specific. What is broken? What page? What should it do instead?" required></textarea>' +
        '</div>' +

        '<div class="si-field">' +
          '<label class="si-label" for="si-outcome-' + idx + '">Desired Outcome <span class="si-req">*</span></label>' +
          '<input class="si-input" type="text" id="si-outcome-' + idx + '" placeholder="e.g. Mobile menu works on iPhone 14, contact form sends email" required>' +
        '</div>' +

        '<div class="si-field">' +
          '<label class="si-label" for="si-access-' + idx + '">How You\'ll Grant Access <span class="si-req">*</span></label>' +
          '<select class="si-select" id="si-access-' + idx + '" required>' +
            '<option value="">-- Choose an access method --</option>' +
            accessOptions +
          '</select>' +
          '<div class="si-access-steps" id="si-steps-' + idx + '" hidden></div>' +
        '</div>' +

        '<div class="si-field">' +
          '<label class="si-label" for="si-notes-' + idx + '">Anything Else (optional)</label>' +
          '<textarea class="si-textarea" id="si-notes-' + idx + '" rows="2" placeholder="Platform, deadlines, preferences, or a scoped key if unavoidable"></textarea>' +
        '</div>' +

        '<div class="si-consent-row">' +
          '<label class="si-check-label">' +
            '<input type="checkbox" id="si-confirm-' + idx + '" required> ' +
            '<span>I\'ve read the access steps above and will complete them within 24 hours so work can begin. I understand that credentials should be temporary and revokable.</span>' +
          '</label>' +
        '</div>' +

        '<div class="si-secure-note">' +
          '<strong>&#128274; No passwords here.</strong> Send any credentials (API keys, logins) only via reply to the confirmation email we send you. Never in this form.' +
        '</div>' +

        '<button type="submit" class="si-btn" id="si-btn-' + idx + '" disabled>Submit Order Details</button>' +
        '<p class="si-err" id="' + statusId + '" hidden></p>' +

      '</form>' +

      '<div class="si-success" id="' + successId + '" hidden>' +
        '<div class="si-ok-icon" aria-hidden="true">&#10003;</div>' +
        '<h3 class="si-success-title">Details received!</h3>' +
        '<p class="si-success-sub">We\'ll review and confirm the plan within 24 hours. Check your email from ' + esc(FALLBACK_EMAIL) + '.</p>' +
      '</div>' +

    '</div>';
  }

  function wireForm(ticket, idx, session) {
    var form        = document.getElementById('si-form-' + idx);
    var accessSel   = document.getElementById('si-access-' + idx);
    var stepsEl     = document.getElementById('si-steps-' + idx);
    var confirmChk  = document.getElementById('si-confirm-' + idx);
    var submitBtn   = document.getElementById('si-btn-' + idx);
    var statusEl    = document.getElementById('si-status-' + idx);
    var successEl   = document.getElementById('si-success-' + idx);
    if (!form) return;

    // Show access steps when method selected
    accessSel.addEventListener('change', function() {
      var method = accessSel.value;
      if (method && ACCESS_METHODS[method]) {
        stepsEl.innerHTML = '<div class="si-steps-inner"><strong>Steps for you:</strong><br>' + ACCESS_METHODS[method].steps + '</div>';
        stepsEl.hidden = false;
      } else {
        stepsEl.hidden = true;
        stepsEl.innerHTML = '';
      }
      updateSubmitState();
    });

    confirmChk.addEventListener('change', updateSubmitState);

    function updateSubmitState() {
      submitBtn.disabled = !(confirmChk.checked && accessSel.value);
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var url     = (document.getElementById('si-url-' + idx) || {}).value || '';
      var problem = (document.getElementById('si-problem-' + idx) || {}).value || '';
      var outcome = (document.getElementById('si-outcome-' + idx) || {}).value || '';
      var access  = accessSel.value;
      var notes   = (document.getElementById('si-notes-' + idx) || {}).value || '';

      url     = url.trim();
      problem = problem.trim();
      outcome = outcome.trim();
      notes   = notes.trim();

      if (!url) { showErr(statusEl, 'Please enter the target URL.'); return; }
      if (!problem) { showErr(statusEl, 'Please describe the problem.'); return; }
      if (!outcome) { showErr(statusEl, 'Please describe your desired outcome.'); return; }
      if (!access) { showErr(statusEl, 'Please choose an access method.'); return; }
      if (!confirmChk.checked) { showErr(statusEl, 'Please confirm you will complete the access steps.'); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      showErr(statusEl, '');

      var orderDetails = {
        target_url:     url,
        problem:        problem,
        desired_outcome: outcome,
        notes:          notes || null,
        access_method_label: ACCESS_METHODS[access] ? ACCESS_METHODS[access].label : access,
        submitted_at:   new Date().toISOString()
      };

      // Re-verify session freshness before write
      sb.auth.getSession().then(function(sRes2) {
        var sess2 = sRes2 && sRes2.data ? sRes2.data.session : null;
        if (!sess2 || sess2.user.id !== session.user.id) {
          showErr(statusEl, 'Your session expired. Please sign in again and return to this page.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Order Details';
          return;
        }

        sb.from('service_tickets')
          .update({
            order_details:    orderDetails,
            access_method:    access,
            access_confirmed: true,
            intake_status:    'submitted'
          })
          .eq('id', ticket.id)
          .eq('user_id', sess2.user.id)       // belt-and-suspenders; RLS owns the real gate
          .eq('intake_status', 'awaiting_intake') // only while still open
          .select('id')
          .single()
          .then(function(uRes) {
            if (uRes.error || !uRes.data) {
              var msg = uRes.error ? uRes.error.message : 'Update returned no data';
              console.error('[intake] update error', msg);
              // If the ticket is already submitted (race condition / double submit)
              if (uRes.error && uRes.error.code === 'PGRST116') {
                showSuccess(form, successEl);
                return;
              }
              showErrWithFallback(statusEl, 'Could not save.', String(ticket.ticket_number));
              submitBtn.disabled = false;
              submitBtn.textContent = 'Submit Order Details';
              return;
            }
            showSuccess(form, successEl);
          })
          .catch(function(err) {
            console.error('[intake] update threw', err);
            showErrWithFallback(statusEl, 'Network error.', String(ticket.ticket_number));
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Order Details';
          });
      }).catch(function() {
        showErr(statusEl, 'Session check failed. Please refresh.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Order Details';
      });
    });
  }

  function showSuccess(form, successEl) {
    form.hidden = true;
    successEl.hidden = false;
  }

  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  // Like showErr but appends a DOM fallback node (email link) after the message text.
  function showErrWithFallback(el, msg, ticketRef) {
    if (!el) return;
    el.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    el.appendChild(document.createTextNode(' '));
    var fb = buildFallbackNode(ticketRef);
    // Inline the fallback content nodes directly into el (not as a <p> wrapper)
    while (fb.firstChild) el.appendChild(fb.firstChild);
    el.hidden = false;
  }

  function showFatalError(msg, ticketRef) {
    if (!rootEl) return;
    var card = document.createElement('div');
    card.className = 'si-card';
    var p = document.createElement('p');
    p.className = 'si-msg si-err-txt';
    p.textContent = msg;
    card.appendChild(p);
    if (ticketRef) card.appendChild(buildFallbackNode(ticketRef));
    rootEl.innerHTML = '';
    rootEl.appendChild(card);
  }

  // Returns a <p> DOM node with the fallback "email us" message.
  // All text set via textContent; only the mailto href is set programmatically — no innerHTML.
  function buildFallbackNode(ticketRef) {
    var p = document.createElement('p');
    p.className = 'si-msg';
    p.appendChild(document.createTextNode('Please email '));
    var a = document.createElement('a');
    a.href = 'mailto:' + FALLBACK_EMAIL;
    a.textContent = FALLBACK_EMAIL;
    p.appendChild(a);
    p.appendChild(document.createTextNode(' with your ticket # '));
    var strong = document.createElement('strong');
    strong.textContent = ticketRef;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(" and we'll get you set up."));
    return p;
  }

}());
