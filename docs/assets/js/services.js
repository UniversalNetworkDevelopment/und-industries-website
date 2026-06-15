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
  var CART = [];
  try { var savedCart = localStorage.getItem('svc_cart'); if (savedCart) CART = JSON.parse(savedCart); } catch(e) {}

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

  // initialize cart
  renderCart();

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

  
  // ---- cart ui logic ----
  function saveCart() { try { localStorage.setItem('svc_cart', JSON.stringify(CART)); } catch(e) {} renderCart(); }
  function renderCart() {
    var cBadge = document.getElementById('cart-badge');
    var cItems = document.getElementById('cart-items');
    var cTotal = document.getElementById('cart-total');
    var cCheck = document.getElementById('cart-checkout');
    if (!cBadge || !cItems) return;
    
    var totalCents = 0;
    cBadge.textContent = CART.length;
    cBadge.style.display = CART.length > 0 ? 'flex' : 'none';
    
    if (CART.length === 0) {
      cItems.innerHTML = '<div class="cart-empty">Your cart is empty.</div>';
      cCheck.disabled = true;
      cTotal.textContent = '$0.00';
      return;
    }
    
    var html = '';
    for (var i = 0; i < CART.length; i++) {
      var key = CART[i];
      var eff = effective(key);
      var svc = SERVICES[key];
      if (!svc) continue;
      totalCents += eff.cents;
      html += '<div class="cart-item">' +
                '<div class="cart-item-info">' +
                  '<h4>' + esc(svc.name) + '</h4>' +
                  '<p>' + esc(money(eff.cents)) + '</p>' +
                '</div>' +
                '<button type="button" class="cart-item-remove" data-idx="' + i + '">Remove</button>' +
              '</div>';
    }
    cItems.innerHTML = html;
    cTotal.textContent = money(totalCents);
    cCheck.disabled = false;
    
    var rBtns = cItems.querySelectorAll('.cart-item-remove');
    for (var j = 0; j < rBtns.length; j++) {
      rBtns[j].addEventListener('click', function(e) {
        var idx = parseInt(e.target.getAttribute('data-idx'), 10);
        CART.splice(idx, 1);
        saveCart();
      });
    }
  }
  
  var cOverlay = document.getElementById('cart-overlay');
  var cPanel = document.getElementById('cart-panel');
  function toggleCart(forceOpen) {
    if (!cPanel) return;
    var isOpen = cPanel.classList.contains('open');
    if (isOpen && forceOpen !== true) {
      cPanel.classList.remove('open'); cOverlay.classList.remove('open'); document.body.style.overflow = '';
    } else {
      cPanel.classList.add('open'); cOverlay.classList.add('open'); document.body.style.overflow = 'hidden';
      renderCart();
    }
  }
  var cToggleBtn = document.getElementById('cart-toggle');
  var cCloseBtn = document.getElementById('cart-close');
  if (cToggleBtn) cToggleBtn.addEventListener('click', function() { toggleCart(); });
  if (cCloseBtn) cCloseBtn.addEventListener('click', function() { toggleCart(false); });
  if (cOverlay) cOverlay.addEventListener('click', function() { toggleCart(false); });
  
  var cCheckBtn = document.getElementById('cart-checkout');
  if (cCheckBtn) {
    cCheckBtn.addEventListener('click', function() {
      if (CART.length === 0) return;
      if (typeof toggleCart === 'function') toggleCart(false); // Close the cart so modal takes focus
      if (!sb) { window.location.href = 'contact.html'; return; }
      sb.auth.getSession().then(function (sres) {
        var session = sres && sres.data ? sres.data.session : null;
        if (!session) { promptLoginForCart(); return; }
        fetchRecent(session.user.id).then(function (recent) { showConsentForCart(recent); });
      });
    });
  }
  
  function addToCart(key) {
    var svc = SERVICES[key];
    if (!svc) return;
    CART.push(key);
    saveCart();
    toggleCart(true);
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
  function promptLoginForCart() {
    buildModal();
    mTitle.textContent = 'Create an account to checkout';
    mBody.innerHTML =
      '<p class="svc-modal-p">Checking out requires a free account &mdash; that’s how we log your order, your agreement, and give you a ticket number you can track.</p>' +
      '<p class="svc-modal-p svc-modal-muted">Already have one? Log in &mdash; you’ll come right back here to finish.</p>';
    showErr('');
    mGo.disabled = false;
    mGo.textContent = 'Create free account';
    mGo.onclick = function () { rememberIntent('cart'); window.location.href = 'register.html?next=services.html'; };
    mCancel.textContent = 'Log in';
    mCancel.onclick = function () { rememberIntent('cart'); window.location.href = 'login.html?next=services.html'; };
    openModal();
  }
  function rememberIntent(key) { try { sessionStorage.setItem('svc_intent', key); } catch (e) {} }

  // ---- consent modal ----
  
  // ---- consent modal for cart ----
  function showConsentForCart(recent) {
    buildModal();
    var effList = CART.map(function(k) { return { key: k, svc: SERVICES[k], eff: effective(k) }; });
    var totalCents = 0;
    var html = '<ul class="svc-modal-terms" style="margin-bottom: 8px">';
    effList.forEach(function(item) {
      totalCents += item.eff.cents;
      html += '<li style="padding-bottom: 4px"><strong>' + esc(item.svc.name) + '</strong> (' + esc(money(item.eff.cents)) + ')</li>';
    });
    html += '</ul>';
    
    mTitle.textContent = 'Complete Your Order';
    html = '<div class="svc-modal-price">' + esc(money(totalCents)) + '</div>' + html;

    html += '<ul class="svc-modal-terms">' +
      '<li><strong>Our guarantee:</strong> if we break something that was working, we fix it &mdash; free.</li>' +
      '<li>Fast turnaround, U.S.-based developer, no surprise charges.</li>' +
      '</ul>';

    html += '<label class="svc-modal-check"><input type="checkbox" id="svc-agree"> <span>' +
      'I agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a>, ' +
      '<a href="privacy.html" target="_blank" rel="noopener">Privacy</a>, and ' +
      '<a href="refund.html" target="_blank" rel="noopener">Refund Policy</a> — including that this service is ' +
      'governed by the law of the State of Florida and is non-refundable once work begins.</span></label>';

    mBody.innerHTML = html;
    showErr('');
    mCancel.textContent = 'Cancel';
    mCancel.onclick = closeModal;
    mGo.textContent = 'Agree & Checkout';

    var agree = mBody.querySelector('#svc-agree');
    function refresh() { mGo.disabled = !agree.checked; }
    if (agree) {
      agree.addEventListener('change', refresh);
      refresh();
    }
    mGo.onclick = function () { confirmAndPayCart(effList, totalCents, recent); };
    openModal();
  }

  function confirmAndPayCart(effList, totalCents, recent) {
    mGo.disabled = true;
    mGo.textContent = 'Recording your agreement…';
    showErr('');

    sb.auth.getSession().then(function (sres) {
      var session = sres && sres.data ? sres.data.session : null;
      if (!session) { showErr('Your session expired — please log in again.'); mGo.disabled = false; mGo.textContent = 'Agree & Checkout'; return; }
      var user = session.user;

      clientIp().then(function (ip) {
        var ua = navigator.userAgent;
        var consentRow = {
          user_id: user.id,
          doc: 'cart_checkout',
          version: TERMS_VERSION,
          detail: {
            items: effList.map(function(item) { return { slug: item.svc.slug, name: item.svc.name, cents: item.eff.cents }; }),
            amount_cents: totalCents,
            accepted: ['terms', 'privacy', 'refund'],
            non_refundable_ack: true,
            payment_final_ack: true,
            page: 'services'
          },
          ip: ip,
          user_agent: ua
        };

        sb.from('tos_consents').insert(consentRow).select('id').single().then(function (cIns) {
          if (cIns.error || !cIns.data) throw new Error(cIns.error ? cIns.error.message : 'consent insert failed');
          
          // Insert multiple tickets (one for each item in the cart)
          var ticketRows = effList.map(function(item) {
            return {
              user_id: user.id,
              service_slug: item.svc.slug,
              service_name: item.svc.name,
              status: 'checkout_started',
              amount_cents: item.eff.cents,
              consent_id: cIns.data.id,
              detail: { source: 'cart_checkout' }
            };
          });
          
          return sb.from('service_tickets').insert(ticketRows).select('ticket_number');
        }).then(function(tIns) {
          if (tIns.error || !tIns.data) throw new Error(tIns.error ? tIns.error.message : 'ticket insert failed');
          var ticketsStr = tIns.data.map(function(r) { return r.ticket_number; }).join(',');
          
          mBody.innerHTML = '<p class="svc-modal-p"><strong>Order recorded.</strong> Generating secure checkout link…</p>';
          mGo.style.display = 'none'; mCancel.style.display = 'none';
          
          var tkn = session.access_token;
          var payloadItems = effList.map(function(item) { return { slug: item.svc.slug, quantity: 1 }; });
          
          fetch('/api/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tkn },
            body: JSON.stringify({ items: payloadItems, ticket: ticketsStr })
          })
          .then(function(r) {
            if (!r.ok) {
              return r.text().then(function(text) {
                var msg = '';
                try {
                  var json = JSON.parse(text);
                  msg = json.error || 'Server error';
                  if (json.details) msg += ' (' + json.details + ')';
                } catch(e) {
                  msg = 'Server error (' + r.status + '): ' + text;
                }
                throw new Error(msg);
              });
            }
            return r.json();
          })
          .then(function(res) {
            if (res.url) {
              window.location.href = res.url;
            } else {
              throw new Error(res.error || 'No URL returned');
            }
          })
          .catch(function(err) {
            console.error(err);
            showErr('Checkout error: ' + err.message);
            mGo.disabled = false; mGo.textContent = 'Agree & Checkout';
            mGo.style.display = ''; mCancel.style.display = '';
          });
        }).catch(function (err) {
          showErr('We couldn’t record your agreement: ' + err.message);
          mGo.disabled = false; mGo.textContent = 'Agree & Checkout';
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
    addToCart(key);
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
