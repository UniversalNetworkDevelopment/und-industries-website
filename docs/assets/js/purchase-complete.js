// purchase-complete.js — post-payment landing page logic.
//
// Two purchase paths land here:
//
//   A. STRIPE product purchase (store items):
//      URL has ?session_id=cs_… — poll purchases + entitlements, render
//      the order summary and license key (existing behaviour, preserved).
//
//   B. PAYPAL service purchase (website fixes, etc.):
//      URL has ?ticket=<ticket_number>[,…] — PayPal returns the buyer here
//      with the ticket number(s) services.js stored in sessionStorage before
//      redirecting them to PayPal. Show the intake CTA and link them to
//      service-intake.html?ticket=… so we can collect what we need to fulfill.
//      Also triggered when there is NO ?session_id at all (buyer arrived from
//      PayPal with no Stripe param) — same treatment.
//
// No inline <script> — this is an external file. CSP: script-src 'self' OK.
(function () {
  'use strict';

  var SUPABASE_URL      = 'https://wgcgzuflpxijhzlpphab.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2d6dWZscHhpamh6bHBwaGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTc3MTgsImV4cCI6MjA5NDc5MzcxOH0.y96jBpi9ECy1RU76q4AuZQFlqPVrS6CJDwNyx__2K9A';

  var statusEl     = document.getElementById('pc-status');
  var serviceSection = document.getElementById('pc-service-section');
  var intakeLink   = document.getElementById('pc-intake-link');
  var subText      = document.getElementById('pc-sub-text');

  // Clear the cart — purchase is done regardless of path.
  try { localStorage.removeItem('svc_cart'); } catch (e) {}

  var params    = new URLSearchParams(location.search);
  var sessionId = params.get('session_id');
  var ticketParam = (params.get('ticket') || '').trim();

  // ---- helpers ----
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatAmount(cents, currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: (currency || 'USD').toUpperCase()
      }).format((cents || 0) / 100);
    } catch (_) {
      return '$' + ((cents || 0) / 100).toFixed(2);
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ---- Path B: service purchase (PayPal) ----
  // Called when there is no Stripe session_id, or when ?ticket= is present.
  // Shows the intake CTA and wires the "Submit Order Details" link.
  function showServiceIntakeCTA(ticket) {
    if (!serviceSection || !intakeLink) return;

    // Build the intake URL — carry the ticket number if we have one.
    // If we don't have one yet (buyer arrived without it), link to the page
    // without a param; service-intake.js will load all their awaiting tickets.
    var href = 'service-intake.html';
    if (ticket) {
      href += '?ticket=' + encodeURIComponent(ticket);
    }
    intakeLink.href = href;
    serviceSection.removeAttribute('hidden');

    // Update the subtitle so it's clear what's next.
    if (subText) {
      subText.textContent = 'Payment received — complete the form below to get started.';
    }

    // statusEl gets a brief confirmation note (no intake form here — that's
    // on service-intake.html, which is the dedicated secure collection page).
    if (statusEl) {
      var note = document.createElement('p');
      note.className = 'pc-note';
      note.textContent =
        'Your payment was received. Fill out the short form below — we cannot begin work without it.';
      statusEl.appendChild(note);
    }
  }

  // ---- Path A: product purchase (Stripe) ----
  function renderSummary(purchase, entitlement) {
    if (!statusEl) return;
    var html = '<div class="pc-summary">';
    html += '<div class="pc-summary-row"><span>Product</span><span>' + esc(purchase.title || purchase.product_slug) + '</span></div>';
    html += '<div class="pc-summary-row"><span>Amount</span><span>'  + esc(formatAmount(purchase.amount_cents, purchase.currency)) + '</span></div>';
    html += '<div class="pc-summary-row"><span>Status</span><span>'  + esc(purchase.status || 'paid') + '</span></div>';
    html += '</div>';

    if (entitlement && entitlement.license_key) {
      html += '<div class="pc-license">';
      html += '<p class="pc-license-label">Your license key</p>';
      html += '<div class="pc-license-box">';
      html += '<code id="pc-license-key">' + esc(entitlement.license_key) + '</code>';
      html += '<button type="button" class="btn btn-outline btn-sm" id="pc-copy-btn">Copy</button>';
      html += '</div></div>';
    } else {
      html += '<p class="pc-access">Access unlocked. Find your purchase on your Dashboard.</p>';
    }

    statusEl.innerHTML = html;

    var copyBtn = document.getElementById('pc-copy-btn');
    if (copyBtn && entitlement && entitlement.license_key) {
      copyBtn.addEventListener('click', function () {
        var key = entitlement.license_key;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(key).then(function () {
            copyBtn.textContent = 'Copied';
            setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000);
          }).catch(function () { copyBtn.textContent = 'Copy failed'; });
        }
      });
    }
  }

  function renderTimeout() {
    if (!statusEl) return;
    var p = document.createElement('p');
    p.className = 'pc-note';
    p.textContent =
      'Payment received — your order is being finalized. Refresh in a moment or check your Dashboard.';
    var actions = document.createElement('div');
    actions.className = 'pc-actions';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline';
    btn.textContent = 'Refresh';
    btn.addEventListener('click', function () { location.reload(); });
    actions.appendChild(btn);
    statusEl.appendChild(p);
    statusEl.appendChild(actions);
  }

  // ---- Route ----

  // If ?ticket= is present, this is always a service purchase regardless of
  // whether session_id is also set — show the intake CTA immediately.
  if (ticketParam) {
    showServiceIntakeCTA(ticketParam);
    return;
  }

  // No session_id → PayPal return (service purchase) with no ticket in URL.
  // Check sessionStorage for a ticket the services.js flow may have saved,
  // then show the intake CTA.
  if (!sessionId) {
    var savedTicket = '';
    try { savedTicket = sessionStorage.getItem('svc_last_ticket') || ''; } catch (e) {}
    showServiceIntakeCTA(savedTicket || '');
    return;
  }

  // sessionId present → Stripe product purchase path.
  if (!window.supabase || !window.supabase.createClient) {
    if (statusEl) {
      var fallbackP = document.createElement('p');
      fallbackP.className = 'pc-note';
      fallbackP.textContent = 'Your payment was received. Visit your Dashboard to view your order.';
      statusEl.appendChild(fallbackP);
    }
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  (async function () {
    var sessionRes = await sb.auth.getSession();
    var session    = sessionRes && sessionRes.data ? sessionRes.data.session : null;

    if (!session) {
      if (statusEl) {
        var p2 = document.createElement('p');
        p2.className = 'pc-note';
        p2.textContent = 'Your payment was received. Sign in to view your order and license key.';
        var div = document.createElement('div');
        div.className = 'pc-actions';
        var a = document.createElement('a');
        a.href = 'login.html';
        a.className = 'btn btn-primary';
        a.textContent = 'Sign In';
        div.appendChild(a);
        statusEl.appendChild(p2);
        statusEl.appendChild(div);
      }
      return;
    }

    var maxAttempts = 10;
    for (var i = 0; i < maxAttempts; i++) {
      try {
        var pRes = await sb
          .from('purchases')
          .select('product_slug,title,amount_cents,currency,status,created_at')
          .eq('stripe_session_id', sessionId)
          .maybeSingle();

        if (pRes && pRes.data) {
          var entitlement = null;
          try {
            var eRes = await sb
              .from('entitlements')
              .select('product_slug,license_key,status')
              .eq('stripe_session_id', sessionId);
            if (eRes && eRes.data && eRes.data.length) {
              entitlement = eRes.data[0];
            }
          } catch (_) {}

          renderSummary(pRes.data, entitlement);
          return;
        }
      } catch (_) {}

      if (i < maxAttempts - 1) await sleep(1500);
    }

    renderTimeout();
  })();
}());
