// services.js — booking gate for the Services page.
// Why this exists: a service sale must be (1) tied to a logged-in user,
// (2) preceded by an explicit, logged agreement to the Terms/Refund policy,
// and (3) guarded against accidental double purchases — so we hold real,
// timestamped proof of consent. Only AFTER that record is written do we send
// the buyer to PayPal. If we can't write the record, we do NOT send them to pay.
//
// Runs as an external file on purpose: the page's CSP is `script-src 'self'`
// (no 'unsafe-inline'), so inline <script> is blocked. This is allowed.
(function () {
  'use strict';

  var SUPABASE_URL      = 'https://wgcgzuflpxijhzlpphab.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2d6dWZscHhpamh6bHBwaGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTc3MTgsImV4cCI6MjA5NDc5MzcxOH0.y96jBpi9ECy1RU76q4AuZQFlqPVrS6CJDwNyx__2K9A';
  var TERMS_VERSION = '2026-06-13';
  var RECENT_HOURS  = 12; // window for "you already started this order"

  // Public, fixed catalog. Amounts mirror the PayPal links exactly; the real
  // charge is enforced by PayPal's hosted page (these are just our record).
  var SERVICES = {
    quick:   { slug: 'website-fix-quick',    name: 'Website Quick Fix',    cents:  9900, pay: 'https://www.paypal.com/ncp/payment/SCTUJTJ77AK6Q' },
    bundle:  { slug: 'website-fix-bundle',   name: 'Website Fix Bundle',   cents: 19900, pay: 'https://www.paypal.com/ncp/payment/2H8HXYU2JMHPG' },
    cleanup: { slug: 'website-fix-cleanup',  name: 'Website Full Cleanup', cents: 34900, pay: 'https://www.paypal.com/ncp/payment/XFGQG3RN3MMS8' }
  };

  var sb = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  // footer year (the inline script that used to do this was removed for CSP)
  var yEl = document.querySelector('[data-year]');
  if (yEl) yEl.textContent = String(new Date().getFullYear());

  // ---- helpers ----
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(c) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((c || 0) / 100); }
    catch (e) { return '$' + ((c || 0) / 100).toFixed(2); }
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return iso; }
  }
  // Same-origin Cloudflare trace gives us the client IP without any cross-origin
  // call (CSP connect-src is 'self' + supabase only). Best-effort; null is fine.
  function clientIp() {
    return fetch('/cdn-cgi/trace')
      .then(function (r) { return r.text(); })
      .then(function (t) { var m = t.match(/(?:^|\n)ip=([^\n]+)/); return m ? m[1].trim() : null; })
      .catch(function () { return null; });
  }

  // ---- modal (built once, reused) ----
  var modal, mTitle, mBody, mErr, mGo, mCancel;
  function buildModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'svc-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'svc-modal-title');
    modal.innerHTML =
      '<div class="svc-modal-card">' +
        '<button type="button" class="svc-modal-x" aria-label="Close">×</button>' +
        '<h2 id="svc-modal-title" class="svc-modal-title"></h2>' +
        '<div class="svc-modal-body"></div>' +
        '<p class="svc-modal-err" hidden></p>' +
        '<div class="svc-modal-actions">' +
          '<button type="button" class="btn btn-outline svc-modal-cancel">Cancel</button>' +
          '<button type="button" class="btn btn-primary svc-modal-go" disabled>Agree &amp; Continue</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    mTitle  = modal.querySelector('.svc-modal-title');
    mBody   = modal.querySelector('.svc-modal-body');
    mErr    = modal.querySelector('.svc-modal-err');
    mGo     = modal.querySelector('.svc-modal-go');
    mCancel = modal.querySelector('.svc-modal-cancel');
    modal.querySelector('.svc-modal-x').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', function (e) { if (modal && !modal.hidden && e.key === 'Escape') closeModal(); });
  }
  function openModal() {
    buildModal();
    mGo.style.display = '';
    mCancel.style.display = '';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    if (modal) { modal.hidden = true; document.body.style.overflow = ''; }
  }
  function showErr(msg) { if (mErr) { mErr.textContent = msg || ''; mErr.hidden = !msg; } }

  // ---- login-required prompt ----
  function promptLogin(svc, key) {
    buildModal();
    mTitle.textContent = 'Create an account to book';
    mBody.innerHTML =
      '<p class="svc-modal-p">Booking <strong>' + esc(svc.name) + '</strong> (' + esc(money(svc.cents)) + ') needs a free account &mdash; that’s how we log your order and your agreement, and give you a ticket number you can track.</p>' +
      '<p class="svc-modal-p svc-modal-muted">Already have one? Log in &mdash; you’ll come right back here to finish.</p>';
    showErr('');
    mGo.disabled = false;
    mGo.textContent = 'Create free account';
    mGo.onclick = function () { rememberIntent(key); window.location.href = 'register.html?next=services.html'; };
    mCancel.textContent = 'Log in';
    mCancel.onclick = function () { rememberIntent(key); window.location.href = 'login.html?next=services.html'; };
    openModal();
  }
  function rememberIntent(key) { try { sessionStorage.setItem('svc_intent', key); } catch (e) {} }

  // ---- consent modal ----
  function showConsent(svc, recent) {
    buildModal();
    var dupes  = recent.filter(function (t) { return t.service_slug === svc.slug; });
    var others = recent.filter(function (t) { return t.service_slug !== svc.slug; });

    mTitle.textContent = 'Book ' + svc.name;
    var html = '<div class="svc-modal-price">' + esc(money(svc.cents)) + '</div>';

    if (dupes.length) {
      html += '<div class="svc-modal-warn"><strong>⚠ You already started this order.</strong><br>' +
        esc(svc.name) + ' &mdash; order ' + esc(dupes[0].ticket_number) + ' on ' + esc(fmtDate(dupes[0].created_at)) + '. ' +
        'Only continue if you truly mean to pay again. Duplicate payments are non-refundable.</div>';
    } else if (others.length) {
      html += '<div class="svc-modal-note">Heads up: you recently started an order for <strong>' +
        esc(others[0].service_name || others[0].service_slug) + '</strong> (' + esc(fmtDate(others[0].created_at)) +
        '). This is a different package &mdash; continue only if that’s intended.</div>';
    }

    html += '<ul class="svc-modal-terms">' +
      '<li><strong>What you get:</strong> a flat-rate ' + esc(svc.name) + ', delivered as described with before/after proof.</li>' +
      '<li><strong>Our guarantee:</strong> if we break something that was working, we fix it &mdash; free.</li>' +
      '<li>Fast turnaround, U.S.-based developer, no surprise charges.</li>' +
      '</ul>';

    // The legal acknowledgment lives here (calm, standard wording) — the full,
    // detailed policy is one click away. Florida governing law is bound at consent.
    html += '<label class="svc-modal-check"><input type="checkbox" id="svc-agree"> ' +
      'I agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a>, ' +
      '<a href="privacy.html" target="_blank" rel="noopener">Privacy</a>, and ' +
      '<a href="refund.html" target="_blank" rel="noopener">Refund Policy</a> — including that this service is ' +
      'governed by the law of the State of Florida and is non-refundable once work begins.</label>';

    if (dupes.length) {
      html += '<label class="svc-modal-check svc-modal-check-warn"><input type="checkbox" id="svc-dup"> ' +
        'I know I already placed an order for ' + esc(svc.name) + ' and I am <strong>intentionally paying again</strong>. ' +
        'I understand duplicate payments are non-refundable.</label>';
    }

    mBody.innerHTML = html;
    showErr('');
    mCancel.textContent = 'Cancel';
    mCancel.onclick = closeModal;
    mGo.textContent = 'Agree & Continue to PayPal';

    var agree = mBody.querySelector('#svc-agree');
    var dup   = mBody.querySelector('#svc-dup');
    function refresh() { mGo.disabled = !(agree.checked && (!dup || dup.checked)); }
    agree.addEventListener('change', refresh);
    if (dup) dup.addEventListener('change', refresh);
    refresh();
    mGo.onclick = function () { confirmAndPay(svc, recent, dupes); };
    openModal();
  }

  // ---- write the proof, then send to PayPal (fail closed) ----
  function confirmAndPay(svc, recent, dupes) {
    mGo.disabled = true;
    mGo.textContent = 'Recording your agreement…';
    showErr('');

    sb.auth.getSession().then(function (sres) {
      var session = sres && sres.data ? sres.data.session : null;
      if (!session) {
        showErr('Your session expired — please log in again.');
        mGo.disabled = false; mGo.textContent = 'Agree & Continue to PayPal';
        return;
      }
      var user = session.user;
      clientIp().then(function (ip) {
        var ua = navigator.userAgent;
        var consentRow = {
          user_id: user.id,
          doc: 'service:' + svc.slug,
          version: TERMS_VERSION,
          detail: {
            service_name: svc.name,
            amount_cents: svc.cents,
            accepted: ['terms', 'privacy', 'refund'],
            non_refundable_ack: true,
            payment_final_ack: true,
            duplicate_ack: dupes.length > 0,
            duplicate_of: dupes.map(function (t) { return t.ticket_number; }),
            recent_orders: recent.map(function (t) { return { ticket: t.ticket_number, slug: t.service_slug, at: t.created_at }; }),
            policy_shown: 'All sales final — no refunds. If we break something that was working we fix it free. If we cannot deliver the agreed fix at all, refund for undelivered work. PayPal payment is final once submitted.',
            page: 'services'
          },
          ip: ip,
          user_agent: ua
        };

        sb.from('tos_consents').insert(consentRow).select('id').single().then(function (cIns) {
          if (cIns.error || !cIns.data) throw new Error(cIns.error ? cIns.error.message : 'consent insert failed');
          var consentId = cIns.data.id;
          return sb.from('service_tickets').insert({
            user_id: user.id,
            service_slug: svc.slug,
            service_name: svc.name,
            status: 'checkout_started',
            amount_cents: svc.cents,
            consent_id: consentId,
            detail: { source: 'services_page', duplicate_ack: dupes.length > 0 }
          }).select('ticket_number').single();
        }).then(function (tIns) {
          if (tIns.error || !tIns.data) throw new Error(tIns.error ? tIns.error.message : 'ticket insert failed');
          var ticket = tIns.data.ticket_number;
          mBody.innerHTML = '<p class="svc-modal-p"><strong>Order ' + esc(ticket) + ' recorded.</strong> ' +
            'Taking you to secure PayPal checkout…</p>';
          mGo.style.display = 'none';
          mCancel.style.display = 'none';
          setTimeout(function () { window.location.href = svc.pay; }, 900);
        }).catch(function () {
          // Fail CLOSED: no proof recorded => do not send them to pay.
          showErr('We couldn’t record your agreement, so we did not send you to pay. Please try again, or contact us if it keeps happening.');
          mGo.disabled = false; mGo.textContent = 'Agree & Continue to PayPal';
        });
      });
    });
  }

  // ---- recent orders for this user (RLS: a user can read only their own) ----
  function fetchRecent(userId) {
    if (!sb) return Promise.resolve([]);
    var since = new Date(Date.now() - RECENT_HOURS * 3600 * 1000).toISOString();
    return sb.from('service_tickets')
      .select('ticket_number,service_slug,service_name,created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(function (res) { return (res && res.data) ? res.data : []; })
      .catch(function () { return []; });
  }

  // ---- click handler ----
  function book(key) {
    var svc = SERVICES[key];
    if (!svc) return;
    if (!sb) { window.location.href = 'contact.html'; return; } // graceful fallback
    sb.auth.getSession().then(function (sres) {
      var session = sres && sres.data ? sres.data.session : null;
      if (!session) { promptLogin(svc, key); return; }
      fetchRecent(session.user.id).then(function (recent) { showConsent(svc, recent); });
    });
  }

  var btns = document.querySelectorAll('[data-pay]');
  for (var i = 0; i < btns.length; i++) {
    (function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); book(a.getAttribute('data-pay')); });
    }(btns[i]));
  }

  // ---- resume after login: if we stored an intent and the user is now signed
  // in, reopen the consent modal automatically so they don't lose their place.
  if (sb) {
    var intent = null;
    try { intent = sessionStorage.getItem('svc_intent'); } catch (e) {}
    if (intent && SERVICES[intent]) {
      sb.auth.getSession().then(function (sres) {
        var session = sres && sres.data ? sres.data.session : null;
        if (session) {
          try { sessionStorage.removeItem('svc_intent'); } catch (e) {}
          fetchRecent(session.user.id).then(function (recent) { showConsent(SERVICES[intent], recent); });
        }
      });
    }
  }
}());
