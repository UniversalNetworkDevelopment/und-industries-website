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
    // Original Website Fixes
    quick:   { slug: 'website-fix-quick',    name: 'Website Quick Fix',    cents:  9900, pay: 'https://www.paypal.com/ncp/payment/SCTUJTJ77AK6Q' },
    bundle:  { slug: 'website-fix-bundle',   name: 'Website Fix Bundle',   cents: 19900, pay: 'https://www.paypal.com/ncp/payment/2H8HXYU2JMHPG' },
    cleanup: { slug: 'website-fix-cleanup',  name: 'Website Full Cleanup', cents: 34900, pay: 'https://www.paypal.com/ncp/payment/XFGQG3RN3MMS8' },
    
    // Shopify Services (Replace the placeholder links with your real Stripe Payment Links)
    shopify_quick: { slug: 'shopify-quick-cleanup', name: 'Shopify Quick Cleanup', cents: 14900, pay: 'https://buy.stripe.com/PLACEHOLDER_SHOPIFY_QUICK' },
    shopify_pro:   { slug: 'shopify-pro-upgrade',   name: 'Shopify Professionalization', cents: 29900, pay: 'https://buy.stripe.com/PLACEHOLDER_SHOPIFY_PRO' },
    shopify_drop:  { slug: 'shopify-dropshipping',  name: 'Dropshipping Integration', cents: 24900, pay: 'https://buy.stripe.com/PLACEHOLDER_SHOPIFY_DROP' },
    shopify_custom: { slug: 'shopify-custom-upgrade', name: 'Custom Shopify Upgrade', cents: 49900, pay: 'https://buy.stripe.com/PLACEHOLDER_SHOPIFY_CUSTOM' },

    // Automation Services
    auto_start:    { slug: 'auto-starter', name: 'Starter Automation', cents: 19900, pay: 'https://buy.stripe.com/PLACEHOLDER_AUTO_STARTER' },
    auto_adv:      { slug: 'auto-advanced', name: 'Advanced Automation', cents: 39900, pay: 'https://buy.stripe.com/PLACEHOLDER_AUTO_ADV' },

    // Growth & Consulting
    seo:           { slug: 'seo-overhaul', name: 'SEO Overhaul', cents: 24900, pay: 'https://buy.stripe.com/PLACEHOLDER_SEO' },
    consulting:    { slug: 'consulting-session', name: 'Consulting Session', cents: 14900, pay: 'https://buy.stripe.com/PLACEHOLDER_CONSULT' }
  };

  // Referral codes → a discount + the discounted PayPal links you create.
  // TO ACTIVATE: make discounted PayPal links (e.g. 10% off) the same way you
  // made the originals, then fill `pay` + `cents` below and uncomment a code.
  // Until then, codes simply won't validate (no broken half-discounts).
  var REFERRAL = {
    // 'FRIEND10': {
    //   off: 0.10, label: '10% off', referrer: 'launch-promo',
    //   pay:   { quick: '', bundle: '', cleanup: '' },          // discounted PayPal links
    //   cents: { quick: 8900, bundle: 17900, cleanup: 31400 }   // discounted amounts (display + record)
    // }
  };
  var activeRef = null;
  var currentKey = null;

  // Effective price + pay link for a package, honoring an applied referral.
  function effective(key) {
    var s = SERVICES[key] || {};
    if (activeRef && activeRef.pay && activeRef.pay[key]) {
      return { pay: activeRef.pay[key], cents: (activeRef.cents && activeRef.cents[key]) || s.cents, code: activeRef.code, off: activeRef.off, label: activeRef.label };
    }
    return { pay: s.pay, cents: s.cents, code: null, off: 0, label: '' };
  }
  function applyReferral(raw) {
    var code = (raw || '').trim().toUpperCase();
    var note = document.getElementById('ref-note');
    if (!code) { activeRef = null; try { sessionStorage.removeItem('svc_ref'); } catch (e) {} if (note) { note.textContent = ''; note.className = 'ref-note'; } return; }
    var r = REFERRAL[code];
    if (!r) { activeRef = null; if (note) { note.textContent = 'That code isn’t valid.'; note.className = 'ref-note ref-bad'; } return; }
    activeRef = { code: code, off: r.off, label: r.label, referrer: r.referrer, pay: r.pay || {}, cents: r.cents || {} };
    try { sessionStorage.setItem('svc_ref', code); } catch (e) {}
    if (note) { note.textContent = '✓ ' + code + ' applied — ' + (r.label || (Math.round(r.off * 100) + '% off')) + ' at checkout.'; note.className = 'ref-note ref-ok'; }
  }

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

    var eff = effective(currentKey);
    mTitle.textContent = 'Book ' + svc.name;
    var html = '<div class="svc-modal-price">' + esc(money(eff.cents));
    if (eff.code) html += ' <span style="font-size:.85rem;color:#39ff9d;font-weight:600">' + esc(eff.label || (Math.round(eff.off * 100) + '% off')) + ' · ' + esc(eff.code) + '</span>';
    html += '</div>';

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
    html += '<label class="svc-modal-check"><input type="checkbox" id="svc-agree"> <span>' +
      'I agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a>, ' +
      '<a href="privacy.html" target="_blank" rel="noopener">Privacy</a>, and ' +
      '<a href="refund.html" target="_blank" rel="noopener">Refund Policy</a> — including that this service is ' +
      'governed by the law of the State of Florida and is non-refundable once work begins.</span></label>';

    if (dupes.length) {
      html += '<label class="svc-modal-check svc-modal-check-warn"><input type="checkbox" id="svc-dup"> <span>' +
        'I know I already placed an order for ' + esc(svc.name) + ' and I am <strong>intentionally paying again</strong>. ' +
        'I understand duplicate payments are non-refundable.</span></label>';
    }

    mBody.innerHTML = html;
    showErr('');
    mCancel.textContent = 'Cancel';
    mCancel.onclick = closeModal;
    mGo.textContent = 'Agree & Continue to Checkout';

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
      var eff = effective(currentKey);

      function recordAndGo() {
        clientIp().then(function (ip) {
          var ua = navigator.userAgent;
          var consentRow = {
            user_id: user.id,
            doc: 'service:' + svc.slug,
            version: TERMS_VERSION,
            detail: {
              service_name: svc.name,
              amount_cents: eff.cents,
              referral_code: eff.code,
              accepted: ['terms', 'privacy', 'refund'],
              non_refundable_ack: true,
              payment_final_ack: true,
              duplicate_ack: dupes.length > 0,
              duplicate_of: dupes.map(function (t) { return t.ticket_number; }),
              recent_orders: recent.map(function (t) { return { ticket: t.ticket_number, slug: t.service_slug, at: t.created_at }; }),
              policy_shown: 'All sales final — no refunds. If we break something that was working we fix it free. If we cannot deliver the agreed fix at all, refund for undelivered work. Payment is final once submitted.',
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
              amount_cents: eff.cents,
              consent_id: consentId,
              detail: { source: 'services_page', duplicate_ack: dupes.length > 0, referral_code: eff.code }
            }).select('ticket_number').single();
          }).then(function (tIns) {
            if (tIns.error || !tIns.data) throw new Error(tIns.error ? tIns.error.message : 'ticket insert failed');
            var ticket = tIns.data.ticket_number;
            // Record the redemption — one per (account, code). The DB unique
            // constraint is the real backstop against reuse; this is best-effort.
            if (eff.code) {
              sb.from('referral_redemptions').insert({ user_id: user.id, code: eff.code, ticket_number: ticket }).then(function () {}, function () {});
            }
            mBody.innerHTML = '<p class="svc-modal-p"><strong>Order ' + esc(ticket) + ' recorded.</strong> ' +
              'Generating secure checkout link…</p>';
            mGo.style.display = 'none';
            mCancel.style.display = 'none';
            
            // Call the SDK to generate the Stripe Checkout Session
            sb.auth.getSession().then(function(s) {
              var tkn = s && s.data && s.data.session ? s.data.session.access_token : '';
              fetch('/api/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tkn },
                body: JSON.stringify({ slug: svc.slug })
              })
              .then(function(r) { return r.json(); })
              .then(function(res) {
                if (res.url) {
                  window.location.href = res.url;
                } else {
                  showErr('Error starting checkout: ' + (res.error || 'Unknown error'));
                  mGo.disabled = false; mGo.textContent = 'Agree & Continue to Checkout';
                  mGo.style.display = ''; mCancel.style.display = '';
                }
              })
              .catch(function() {
                showErr('Network error starting checkout. Please try again.');
                mGo.disabled = false; mGo.textContent = 'Agree & Continue to Checkout';
                mGo.style.display = ''; mCancel.style.display = '';
              });
            });
          }).catch(function () {
            // Fail CLOSED: no proof recorded => do not send them to pay.
            showErr('We couldn’t record your agreement, so we did not send you to pay. Please try again, or contact us if it keeps happening.');
            mGo.disabled = false; mGo.textContent = 'Agree & Continue to Checkout';
          });
        });
      }

      // Single-use per account: if this code was already redeemed by this user,
      // drop the discount (full price) — they'd need a different code to save again.
      if (eff.code) {
        sb.from('referral_redemptions').select('id').eq('user_id', user.id).eq('code', eff.code).maybeSingle().then(function (rr) {
          if (rr && rr.data) {
            var usedCode = eff.code;
            activeRef = null;
            try { sessionStorage.removeItem('svc_ref'); } catch (e) {}
            eff = effective(currentKey); // recompute at full price
            var note = document.getElementById('ref-note');
            if (note) { note.textContent = 'Code ' + usedCode + ' was already used on your account — booking at full price.'; note.className = 'ref-note ref-bad'; }
            var priceEl = mBody.querySelector('.svc-modal-price');
            if (priceEl) priceEl.textContent = money(eff.cents);
          }
          recordAndGo();
        }, function () { recordAndGo(); });
      } else {
        recordAndGo();
      }
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
    currentKey = key;
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

  // ---- package details ("What's included" → popup, then Book flows from it) ----
  var DETAILS = {
    quick: {
      name: 'Quick Fix', price: 9900, eta: 'Delivered in 24 hours',
      includes: [
        'One specific, defined problem — fixed',
        'Broken page, form, or link · mobile layout glitch · error / 500 / blank page',
        'Done on a copy first, then applied — I never break what works',
        'Before & after proof (screenshots at real screen sizes)'
      ],
      excludes: 'More than one issue (that\'s the Bundle), new features, redesigns, or new pages',
      note: 'Best when you know the one thing that\'s wrong.'
    },
    bundle: {
      name: 'Fix Bundle', price: 19900, eta: 'Delivered in 48 hours',
      includes: [
        'Up to 3 issues fixed',
        'A full once-over of your site (I look for what you missed)',
        'Mobile + speed check · broken-link sweep',
        'Before & after proof on each fix'
      ],
      excludes: 'More than 3 issues, full redesigns, or brand-new pages/features',
      note: 'Most popular — the best value if more than one thing is off.'
    },
    cleanup: {
      name: 'Full Cleanup', price: 34900, eta: 'Delivered in 72 hours',
      includes: [
        'Everything in the Bundle',
        'Speed optimization (image compression, load cleanup)',
        'SEO basics + a working contact form',
        'Mobile-perfect pass on every page',
        '30-day fix guarantee — if something I touched breaks, I fix it free'
      ],
      excludes: 'New features, custom builds, or a full redesign (those are a custom quote)',
      note: 'The whole-site tune-up.'
    }
  };
  function showDetails(key) {
    var d = DETAILS[key];
    if (!d) return;
    buildModal();
    mTitle.textContent = d.name;
    var html = '<div class="svc-modal-price">' + esc(money(d.price)) + ' · <span style="font-size:1rem;color:#4de8ff;font-weight:600">' + esc(d.eta) + '</span></div>';
    html += '<ul class="svc-modal-terms">' + d.includes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    html += '<p class="svc-modal-p svc-modal-muted"><strong>Not included:</strong> ' + esc(d.excludes) + '. ' + esc(d.note) + '</p>';
    mBody.innerHTML = html;
    showErr('');
    mCancel.textContent = 'Close';
    mCancel.onclick = closeModal;
    mGo.disabled = false;
    mGo.textContent = 'Book ' + d.name + ' →';
    mGo.onclick = function () { closeModal(); book(key); };
    openModal();
  }
  var dbtns = document.querySelectorAll('[data-details]');
  for (var j = 0; j < dbtns.length; j++) {
    (function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); showDetails(a.getAttribute('data-details')); });
    }(dbtns[j]));
  }

  // ---- AI / custom-build quote request (logs to the owner inbox via /api/contact) ----
  function showQuote() {
    buildModal();
    mTitle.textContent = 'Request a custom quote';
    mBody.innerHTML =
      '<p class="svc-modal-p svc-modal-muted">AI, automation, chatbots, custom tools, AI-in-Unity — tell me what you need and I’ll reply with a plan + a flat quote. No obligation.</p>' +
      '<input class="svc-modal-input" id="q-name" type="text" placeholder="Your name" autocomplete="name">' +
      '<input class="svc-modal-input" id="q-email" type="email" placeholder="Email I should reply to" autocomplete="email">' +
      '<input class="svc-modal-input" id="q-budget" type="text" placeholder="Rough budget (optional)">' +
      '<textarea class="svc-modal-input" id="q-msg" rows="4" placeholder="What do you want built? What problem are you solving?"></textarea>';
    showErr('');
    mCancel.textContent = 'Cancel'; mCancel.onclick = closeModal;
    mGo.disabled = false; mGo.textContent = 'Send request';
    mGo.onclick = submitQuote;
    openModal();
  }
  function submitQuote() {
    var name   = ((document.getElementById('q-name')   || {}).value || '').trim();
    var email  = ((document.getElementById('q-email')  || {}).value || '').trim();
    var budget = ((document.getElementById('q-budget') || {}).value || '').trim();
    var msg    = ((document.getElementById('q-msg')    || {}).value || '').trim();
    if (!name) { showErr('Please add your name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { showErr('Please enter a valid email.'); return; }
    if (msg.length < 5) { showErr('Tell me a bit about what you need.'); return; }
    mGo.disabled = true; mGo.textContent = 'Sending…'; showErr('');
    var payload = {
      name: name, email: email,
      subject: 'AI / Custom Build — Quote Request',
      message: msg + (budget ? '\n\nRough budget: ' + budget : '')
    };
    function send(token) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      fetch('/api/contact', { method: 'POST', headers: headers, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) {
            showErr((res.d && res.d.error) || 'Could not send — please try again.');
            mGo.disabled = false; mGo.textContent = 'Send request';
            return;
          }
          mBody.innerHTML = '<p class="svc-modal-p"><strong>Got it.</strong> I’ll reply to ' + esc(email) + ' within 1 business day with a plan + flat quote.</p>';
          mGo.style.display = 'none';
          mCancel.textContent = 'Close'; mCancel.onclick = closeModal;
        })
        .catch(function () { showErr('Network error — please try again.'); mGo.disabled = false; mGo.textContent = 'Send request'; });
    }
    if (sb) { sb.auth.getSession().then(function (r) { send(r && r.data && r.data.session ? r.data.session.access_token : null); }); }
    else { send(null); }
  }
  var qbtns = document.querySelectorAll('[data-quote]');
  for (var k = 0; k < qbtns.length; k++) {
    (function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); showQuote(); });
    }(qbtns[k]));
  }

  // ---- referral code (applies a discount + discounted PayPal link if configured) ----
  var refInput = document.getElementById('ref-input');
  var refBtn   = document.getElementById('ref-apply');
  if (refBtn && refInput) {
    refBtn.addEventListener('click', function (e) { e.preventDefault(); applyReferral(refInput.value); });
    refInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyReferral(refInput.value); } });
  }
  try { var savedRef = sessionStorage.getItem('svc_ref'); if (savedRef && refInput) { refInput.value = savedRef; applyReferral(savedRef); } } catch (e) {}

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
