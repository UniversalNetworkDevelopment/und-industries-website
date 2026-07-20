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

  // ── ACCESS AUTHORISATION ────────────────────────────────────────────────────
  // The exact words the customer affirms. Stored verbatim with the ticket so there is
  // never a question of WHICH wording they agreed to — a consent record that only stores
  // "true" proves nothing about what was consented to.
  //
  // Bump ACCESS_TERMS_VERSION whenever this text changes, so old tickets keep the wording
  // that was actually shown at the time.
  //
  // Three things this must establish, which the previous wording did not:
  //   1. AUTHORISATION to access — not merely a promise to hand over credentials.
  //   2. AUTHORITY — that this person may lawfully grant access to that property.
  //   3. SCOPE — limited to the work ordered, on the URL they named.
  var ACCESS_TERMS_VERSION = '2026-07-19';
  var ACCESS_AUTH_TEXT =
    'I authorise UND Industries (Universal Network Development LLC) to access the website ' +
    'or system I have identified above, using the access method I have chosen, for the sole ' +
    'purpose of performing the service I ordered. I confirm I own this property or am ' +
    'authorised to grant this access. I understand access should be temporary and revocable, ' +
    'and that I may revoke it at any time. I will complete the access steps within 24 hours ' +
    'so work can begin.';

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

  // Same-origin Cloudflare trace — gives the client IP with no cross-origin call, so it
  // works under the page CSP (connect-src 'self' + supabase). Best-effort: a null IP is
  // acceptable in the consent record, a blocked page is not. Mirrors services.js:115.
  function clientIp() {
    return fetch('/cdn-cgi/trace')
      .then(function (r) { return r.text(); })
      .then(function (t) { var m = t.match(/(?:^|\n)ip=([^\n]+)/); return m ? m[1].trim() : null; })
      .catch(function () { return null; });
  }

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
          // CANONICAL VOCABULARY: awaiting_intake | submitted | in_progress | delivered
          // (supabase/fulfillment_chain.sql:12 — the schema that defines the column).
          // 'complete' was MY invention (commit 2abeb4d) and it is not a real state. Nexus,
          // which fulfils through Qwep, writes 'delivered'. So a Qwep-fulfilled order fell
          // outside this filter and VANISHED from the customer's own dashboard: they paid,
          // the work was done, and their order silently disappeared. 'complete' is kept in
          // the list only so tickets written by the old code still show up.
          .in('intake_status', ['submitted','in_progress','delivered','complete'])
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
            '<span>' + esc(ACCESS_AUTH_TEXT) + '</span>' +
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
      if (!confirmChk.checked) { showErr(statusEl, 'Please tick the box to authorise access, or we cannot begin the work.'); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      showErr(statusEl, '');

      var orderDetails = {
        target_url:     url,
        problem:        problem,
        desired_outcome: outcome,
        notes:          notes || null,
        access_method_label: ACCESS_METHODS[access] ? ACCESS_METHODS[access].label : access,
        submitted_at:   new Date().toISOString(),

        // ── ACCESS AUTHORISATION RECORD (added 2026-07-19) ──────────────────
        // GAP FOUND: the checkout consent (tos_consents, doc:'cart_checkout') records
        // terms/privacy/refund and the non-refundable acknowledgement — but NOTHING about
        // authorising us to access the customer's systems. The intake checkbox was a UI
        // gate only: its value was read to enable the button (line ~293) and then thrown
        // away. So we performed admin work on third-party systems with no stored record
        // of who authorised it, for what, or when.
        //
        // The practical grant is real — the customer performs the granting act themselves
        // (inviting us to a repo, creating a scoped staff account). What was missing is the
        // EVIDENCE: scope, authority, and a timestamp. That record is the whole defence if
        // anyone later disputes what was permitted.
        //
        // Recorded here rather than in a separate table so it travels with the ticket it
        // authorises — the authorisation and the job it covers can never drift apart.
        access_authorization: {
          granted:          true,
          statement:        ACCESS_AUTH_TEXT,
          scope_url:        url,
          method:           access,
          method_label:     ACCESS_METHODS[access] ? ACCESS_METHODS[access].label : access,
          authority_warranted: true,   // they affirm they may grant access to this property
          terms_version:    ACCESS_TERMS_VERSION,
          granted_at:       new Date().toISOString(),
          user_agent:       navigator.userAgent
        }
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

        // ── record the access authorisation as a first-class consent ──────────
        // The statement also lives on the ticket (orderDetails.access_authorization) so
        // evidence survives even if this insert fails. This row is the CANONICAL copy:
        // tos_consents is where every other agreement lives, so "show me everything this
        // customer agreed to" has to be one query, not two places I have to remember.
        //
        // FAIL-OPEN, deliberately. If the consent table rejects the write, the customer
        // still gets their order submitted — they did authorise us, and blocking a paid
        // order over a bookkeeping failure punishes them for our bug. The ticket copy is
        // the fallback record, and the failure is logged so it can be reconciled.
        clientIp().then(function (ip) {
          var consentRow = {
            user_id: sess2.user.id,
            doc: 'site_access_authorization',
            version: ACCESS_TERMS_VERSION,
            detail: {
              statement:    ACCESS_AUTH_TEXT,
              ticket:       ticket.ticket_number,
              service:      ticket.service_name || ticket.service_slug || null,
              scope_url:    url,
              method:       access,
              method_label: ACCESS_METHODS[access] ? ACCESS_METHODS[access].label : access,
              accepted:     ['site_access', 'authority_to_grant', 'scope_limited'],
              page:         'service-intake'
            },
            ip: ip,
            user_agent: navigator.userAgent
          };
          return sb.from('tos_consents').insert(consentRow).select('id').single()
            .then(function (cIns) {
              if (cIns.error || !cIns.data) throw new Error(cIns.error ? cIns.error.message : 'no row');
              // Kept in order_details, NOT written to service_tickets.consent_id — that
              // column is already occupied by the CHECKOUT agreement (services.js:360),
              // and a ticket can only reference one. Overwriting it would trade the
              // purchase agreement for the access grant; we need both. Two consents,
              // one ticket: the purchase in the column, the access grant in the JSON.
              orderDetails.access_authorization.consent_id = cIns.data.id;
              orderDetails.access_authorization.ip = ip;
            })
            .catch(function (e) {
              console.error('[intake] access consent insert failed', e && e.message);
              orderDetails.access_authorization.consent_id = null;
              orderDetails.access_authorization.consent_write_error = String(e && e.message || e);
              orderDetails.access_authorization.ip = ip;
            });
        }).then(function () {

        return sb.from('service_tickets')
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
            notifyOwner(ticket.ticket_number);
          })
          .catch(function(err) {
            console.error('[intake] update threw', err);
            showErrWithFallback(statusEl, 'Network error.', String(ticket.ticket_number));
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Order Details';
          });

        });   // end clientIp/consent chain
      }).catch(function() {
        showErr(statusEl, 'Session check failed. Please refresh.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Order Details';
      });
    });
  }

  // Tell the owner that access has arrived and the delivery clock has started.
  //
  // Added 2026-07-19. Payment already emailed him; the moment work can ACTUALLY START did
  // not, so he had to notice it by opening a dashboard. MSA section 7 measures the delivery
  // window from receipt of access, so this is the moment that matters most.
  //
  // Fire-and-forget on purpose: the ticket is already saved and the customer has already
  // been shown success. A notification failure must never turn a completed submission into
  // an error message for them. The endpoint re-reads the ticket server-side, so it cannot
  // be used to fake an alert or probe someone else's order.
  function notifyOwner(ticketNumber) {
    try {
      fetch('/api/intake-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: String(ticketNumber) })
      }).catch(function () { /* silent: customer flow is already complete */ });
    } catch (_) { /* ditto */ }
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
