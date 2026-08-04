// services.js — booking gate for the Services page.
// Why this exists: a service sale must be (1) tied to a logged-in user,
// (2) preceded by an explicit, logged agreement to the Terms/Refund policy,
// and (3) guarded against accidental double purchases — so we hold real,
// timestamped proof of consent. Only AFTER that record is written do we send
// the buyer to Stripe checkout. If we can't write the record, we do NOT send them to pay.
//
// Runs as an external file on purpose: the page's CSP is `script-src 'self'`
// (no 'unsafe-inline'), so inline <script> is blocked. This is allowed.
(function () {
  'use strict';

  var SUPABASE_URL      = 'https://wgcgzuflpxijhzlpphab.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2d6dWZscHhpamh6bHBwaGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTc3MTgsImV4cCI6MjA5NDc5MzcxOH0.y96jBpi9ECy1RU76q4AuZQFlqPVrS6CJDwNyx__2K9A';
  var TERMS_VERSION = '2026-06-13';
  var RECENT_HOURS  = 12; // window for "you already started this order"

  // Public, fixed catalog. Amounts mirror the Supabase store_products price for
  // each slug; the real charge is resolved server-side by Stripe (our record/display).
  // Keys whose `pay` starts with 'https://buy.stripe.com/PLACEHOLDER_' are treated
  // as NOT YET LIVE: their buttons render as "Coming soon" and are non-clickable.
  var SERVICES = {
    // Original Website Fixes — LIVE via STRIPE Checkout (/api/create-checkout-session).
    // PayPal removed 2026-07-10 — see PAYMENTS-DECISION-remove-paypal.md for the reason.
    // The 'stripe' sentinel (no 'paypal.com', no 'PLACEHOLDER_') routes these through the
    // server-side Stripe session, which resolves the price from Supabase by SLUG — exactly how
    // PayPal did it, so the same products are charged the same amounts. Reverse by restoring
    // pay:'https://www.paypal.com/checkout' if ever needed.
    quick:   { slug: 'website-fix-quick',    name: 'Website Quick Fix',    cents:  9900, pay: 'stripe' },
    bundle:  { slug: 'website-fix-bundle',   name: 'Website Fix Bundle',   cents: 19900, pay: 'stripe' },
    cleanup: { slug: 'website-fix-cleanup',  name: 'Website Full Cleanup', cents: 34900, pay: 'stripe' },

    // Shopify Services — LIVE 2026-07-28. These were never waiting on Stripe payment links; the
    // PLACEHOLDER URLs were a gate, and the working path never used a payment link at all. All 8
    // slugs below were verified present in Supabase store_products, published, with price_cents
    // matching the cents shown here, so the 'stripe' sentinel resolves them exactly like the three
    // Website Fixes above. See the same-day query in NOTE-PROTOCOL-2.md Rule 0.
    shopify_quick:  { slug: 'shopify-quick-cleanup',   name: 'Shopify Quick Cleanup',        cents: 14900, pay: 'stripe' },
    shopify_pro:    { slug: 'shopify-pro-upgrade',     name: 'Shopify Professionalization',   cents: 29900, pay: 'stripe' },
    shopify_drop:   { slug: 'shopify-dropshipping',    name: 'Dropshipping Integration',      cents: 24900, pay: 'stripe' },
    shopify_custom: { slug: 'shopify-custom-upgrade',  name: 'Custom Shopify Upgrade',        cents: 49900, pay: 'stripe' },

    // Automation Services — LIVE 2026-07-28
    auto_start: { slug: 'auto-starter',  name: 'Starter Automation',  cents: 19900, pay: 'stripe' },
    auto_adv:   { slug: 'auto-advanced', name: 'Advanced Automation',  cents: 39900, pay: 'stripe' },

    // Growth & Consulting — LIVE 2026-07-28
    seo:        { slug: 'seo-overhaul',       name: 'SEO Overhaul',        cents: 24900, pay: 'stripe' },
    consulting: { slug: 'consulting-session', name: 'Consulting Session',  cents: 14900, pay: 'stripe' }
  };

  // Returns true if a service is live (has a non-placeholder payment link).
  function isLive(key) {
    var s = SERVICES[key];
    return !!(s && s.pay && s.pay.indexOf('PLACEHOLDER_') === -1);
  }

  // Referral codes → a discount + the discounted checkout links you create.
  // TO ACTIVATE: make discounted checkout links (e.g. 10% off) the same way you
  // made the originals, then fill `pay` + `cents` below and uncomment a code.
  // Until then, codes simply won't validate (no broken half-discounts).
  var REFERRAL = {
    // 'FRIEND10': {
    //   off: 0.10, label: '10% off', referrer: 'launch-promo',
    //   pay:   { quick: '', bundle: '', cleanup: '' },          // discounted checkout links
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
  // Determine signed-in state immediately so the cart can state the account
  // requirement up front rather than only when checkout blocks the buyer.
  refreshAuthState();

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
  // ── SIGNED-IN STATE, SURFACED IN THE UI ────────────────────────────────────
  // 2026-07-28. Checking out requires a free account, and until now the site never
  // said so until the buyer had already picked a service, opened the cart, and
  // pressed "Proceed to Checkout" — three steps in. Only THEN did an account
  // modal appear. The modal itself was fine; the problem was that the
  // requirement was invisible right up to the moment it blocked you, and an
  // unexplained wall at the end of a purchase reads as a broken site, not as a
  // sign-up step. People leave instead of registering.
  //
  // So the requirement is now stated where it is incurred: in the cart, the
  // moment there is something to buy.
  var IS_SIGNED_IN = null; // null = not determined yet
  function refreshAuthState() {
    if (!sb) { IS_SIGNED_IN = false; renderCart(); return; }
    sb.auth.getSession().then(function (r) {
      IS_SIGNED_IN = !!(r && r.data && r.data.session);
      renderCart();
    }).catch(function () {
      // Unknown is NOT the same as signed in. Telling someone an account is
      // needed when it turns out they had one costs a sentence; hiding it
      // costs the sale.
      IS_SIGNED_IN = false;
      renderCart();
    });
  }
  if (sb && sb.auth && sb.auth.onAuthStateChange) {
    sb.auth.onAuthStateChange(function () { refreshAuthState(); });
  }

  function renderCart() {
    var cBadge = document.getElementById('cart-badge');
    var cItems = document.getElementById('cart-items');
    var cTotal = document.getElementById('cart-total');
    var cCheck = document.getElementById('cart-checkout');
    if (!cBadge || !cItems) return;

    // Say it plainly, in the cart, as soon as there is something in it.
    var notice = document.getElementById('cart-auth-notice');
    if (!notice && cCheck && cCheck.parentNode) {
      notice = document.createElement('p');
      notice.id = 'cart-auth-notice';
      notice.style.cssText = 'margin:0 0 10px;font-size:.82rem;line-height:1.4;color:#cbb8ff;' +
        'background:rgba(124,92,255,.12);border:1px solid rgba(124,92,255,.35);' +
        'border-radius:10px;padding:10px 12px;';
      cCheck.parentNode.insertBefore(notice, cCheck);
    }
    if (notice) {
      var needsAccount = (IS_SIGNED_IN === false) && CART.length > 0;
      notice.hidden = !needsAccount;
      if (needsAccount) {
        notice.innerHTML = 'You’ll need a free account to check out — it takes about 30 seconds, ' +
          'and it’s how you get a ticket number to track your order.';
      }
    }
    if (cCheck) {
      cCheck.textContent = (IS_SIGNED_IN === false && CART.length > 0)
        ? 'Sign in & Checkout'
        : 'Proceed to Checkout';
    }

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
    // W-CART-1 (2026-07-28): a service may appear in the cart AT MOST ONCE.
    // Before this, every click pushed another copy — click "Add to Cart" three times and you
    // got three line items, three charges and three tickets for one job. It also made the
    // ticket-reuse guard below unsound, because reuse is keyed by SLUG: with duplicates allowed,
    // two line items would collapse onto one reused ticket and the buyer would be charged twice
    // for a single ticket. Uniqueness here is what makes that guard correct.
    if (CART.indexOf(key) !== -1) { toggleCart(true); return; }
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

        // All services check out through Stripe (server-side Checkout Session;
        // price resolved from Supabase by slug). PayPal was removed 2026-07-10 —
        // see PAYMENTS-DECISION-remove-paypal.md.

        sb.from('tos_consents').insert(consentRow).select('id').single().then(function (cIns) {
          if (cIns.error || !cIns.data) throw new Error(cIns.error ? cIns.error.message : 'consent insert failed');

          // Insert multiple tickets (one for each item in the cart)
          var ticketRows = effList.map(function(item) {
            return {
              user_id: user.id,
              service_slug: item.svc.slug,
              service_name: item.svc.name,
              status: 'checkout_started',
              intake_status: 'awaiting_intake',
              amount_cents: item.eff.cents,
              consent_id: cIns.data.id,
              detail: { source: 'cart_checkout' }
            };
          });

          // W-CART-1 (2026-07-28): REUSE AN UNPAID TICKET RATHER THAN MINTING A SECOND ONE.
          //
          // Tickets are written BEFORE the Stripe session exists, so an abandoned or failed
          // checkout leaves a row behind. Every retry used to insert a whole new set, so one
          // buyer who tried three times produced three tickets for one job — and the database
          // then claimed orders that were never paid. That is the mirror image of
          // `stripe_orphan_payment` (05_system_logs.sql:12): money with no record, versus
          // record with no money. Both make the books lie.
          //
          // A ticket still sitting at 'checkout_started' for this user and slug IS the earlier
          // attempt, so we reuse its number instead of adding another. Safe only because
          // addToCart() now guarantees one entry per slug.
          //
          // FAILS OPEN, DELIBERATELY. If the lookup errors we fall through to the plain insert,
          // i.e. exactly the old behaviour. A bookkeeping guard must never be the reason a
          // paying customer cannot check out.
          var slugs = effList.map(function (item) { return item.svc.slug; });
          return sb.from('service_tickets')
            .select('ticket_number,service_slug')
            .eq('user_id', user.id)
            .eq('status', 'checkout_started')
            .in('service_slug', slugs)
            .then(function (prior) {
              if (prior.error || !prior.data || !prior.data.length) {
                return sb.from('service_tickets').insert(ticketRows).select('ticket_number');
              }
              var reused = {};
              prior.data.forEach(function (r) {
                if (!reused[r.service_slug]) reused[r.service_slug] = r.ticket_number;
              });
              var fresh = ticketRows.filter(function (r) { return !reused[r.service_slug]; });
              var carried = Object.keys(reused).map(function (s) {
                return { ticket_number: reused[s] };
              });
              if (!fresh.length) return { data: carried, error: null };
              return sb.from('service_tickets').insert(fresh).select('ticket_number')
                .then(function (ins) {
                  if (ins.error || !ins.data) return ins;
                  return { data: ins.data.concat(carried), error: null };
                });
            });
        }).then(function(tIns) {
          if (tIns.error || !tIns.data) throw new Error(tIns.error ? tIns.error.message : 'ticket insert failed');
          var ticketsStr = tIns.data.map(function(r) { return r.ticket_number; }).join(',');

          mBody.innerHTML = '<p class="svc-modal-p"><strong>Order recorded.</strong> Redirecting to payment…</p>';
          mGo.style.display = 'none'; mCancel.style.display = 'none';

          // Stripe path: create a server-side Checkout Session.
          var tkn = session.access_token;
          var payloadItems = effList.map(function(item) { return { slug: item.svc.slug, quantity: 1 }; });

          fetch('/api/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tkn },
            body: JSON.stringify({ items: payloadItems, ticket: ticketsStr, returnTo: 'services' })
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
          showErr("We couldn't record your agreement: " + err.message);
          mGo.disabled = false; mGo.textContent = 'Agree & Checkout';
          // Line ~375 sets BOTH buttons to display:none for "Redirecting to payment…".
          // The inner fetch .catch restores them; this outer one did not — so any throw
          // AFTER the tickets were inserted (e.g. a null session while reading
          // session.access_token) left the buyer staring at "Order recorded" plus an
          // error with NO buttons at all. A dead end in the middle of paying, with a
          // ticket already in the database. Restore here too, matching the inner catch.
          mGo.style.display = ''; mCancel.style.display = '';
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
    if (!isLive(key)) {
      // Placeholder: show a "Coming soon" modal instead of sending to checkout.
      buildModal();
      var svc = SERVICES[key] || {};
      mTitle.textContent = (svc.name || 'This service') + ' — Coming Soon';
      mBody.innerHTML =
        '<p class="svc-modal-p">This service isn\'t available for purchase yet. We\'re finishing the setup and will open it soon.</p>' +
        '<p class="svc-modal-p svc-modal-muted">In the meantime, <a href="contact.html">contact us</a> if you\'d like to discuss this service or request a custom quote.</p>';
      showErr('');
      mGo.style.display = 'none';
      mCancel.textContent = 'Close';
      mCancel.onclick = function () { closeModal(); mGo.style.display = ''; };
      openModal();
      return;
    }
    addToCart(key);
  }

  // ── AVAILABILITY RENDERING ──────────────────────────────────────────────────
  // Rewritten 2026-07-19. Availability is now DATA in Supabase
  // (store_products.availability), not a hardcoded PLACEHOLDER string. Alex can pause
  // one service, or the whole store, from the dashboard with NO DEPLOY. That is the fix
  // for the 2026-06-17 gate that stayed shut 32 days because reopening needed a push.
  //
  // FAIL CLOSED, ALWAYS. The HTML ships every button `disabled`; this code only ever
  // UNLOCKS. So if Supabase is unreachable, if this script throws, or if a slug is
  // unknown, nothing is purchasable. Never take money we cannot verify we are meant to
  // take. (site-state.js deliberately fails OPEN on the site banner — inventing an
  // outage is its own harm. Availability is the opposite trade, on purpose.)
  //
  // `inquiry` added 2026-08-02 — the INQUIRY LANE (E:\Plans\INQUIRY-LANE-AND-AUTONOMY-LADDER.md).
  // A service in this state does not sell itself: the button opens the quote modal, Alex is
  // emailed, and he quotes and fulfils by hand. That is deliberate and temporary. The fulfilment
  // chain is already human-approval-only (admin-job.js refuses agent-initiated delivery), so this
  // makes the FRONT DOOR tell the truth about how the business actually runs, instead of taking
  // money up front for a pipeline that has never once completed.
  //
  // It costs no deploy to move a service either way — availability is a column in Supabase, so
  // `inquiry` -> `live` is a dashboard edit the moment the autonomous path is trusted. That is the
  // whole point: this is a bridge with the switch left in.
  var SVC_STATE = {
    live:     { text: 'Add to Cart',             enabled: true,  title: '' },
    inquiry:  { text: 'Request a Quote',          enabled: true,  title: 'Tell us what you need — we reply with a plan and a flat quote. No obligation.' },
    soon:     { text: '🔒 Coming Soon', enabled: false, title: 'Not yet available' },
    paused:   { text: 'Temporarily Unavailable',  enabled: false, title: 'Paused — at capacity' },
    waitlist: { text: 'Join the Waitlist',        enabled: true,  title: 'Join the waitlist' },
    hidden:   { text: '',                         enabled: false, title: '' }
  };

  function paintButton(a, key) {
    var svc = SERVICES[key];
    if (!svc) return;
    var slug = svc.slug;
    var st = 'soon', note = null;

    if (window.UNDSiteState) {
      st = window.UNDSiteState.availabilityOf(slug);
      note = window.UNDSiteState.noteOf(slug);
      var mode = window.UNDSiteState.get().mode;

      // SITE-WIDE OVERRIDES. Deliberate, not incidental:
      //   maintenance → EVERYTHING stops, waitlist included. The site is being worked
      //                 on; capturing a signup we might drop is worse than nothing.
      //   closed      → no PURCHASING, but a waitlist stays open. Being at capacity is
      //                 exactly when you want to capture demand rather than lose it.
      if (mode === 'maintenance') {
        st = (st === 'hidden') ? 'hidden' : 'paused';
      } else if (mode === 'closed' && st === 'live') {
        st = 'paused';
      }
    }
    var cfg = SVC_STATE[st] || SVC_STATE.soon;

    if (st === 'hidden') {
      var card = a.closest ? a.closest('.svc-card') : null;
      if (card) card.style.display = 'none';
      return;
    }

    a.textContent = cfg.text;
    a.setAttribute('title', cfg.title);
    a.setAttribute('data-svc-state', st);
    if (cfg.enabled) {
      a.removeAttribute('disabled');
      a.removeAttribute('aria-disabled');
      a.classList.remove('btn-cs');
      a.classList.add('btn', 'btn-primary', 'btn-full', 'svc-paybtn');
    } else {
      a.setAttribute('disabled', 'disabled');
      a.setAttribute('aria-disabled', 'true');
      a.classList.add('btn-cs');
      a.classList.remove('btn-primary', 'svc-paybtn');
    }

    // Optional per-service note ("Back Aug 1", "2 slots left") straight from the DB.
    var noteEl = a.parentNode ? a.parentNode.querySelector('.svc-avail-note') : null;
    if (note) {
      if (!noteEl) {
        noteEl = document.createElement('div');
        noteEl.className = 'svc-avail-note';
        a.parentNode.insertBefore(noteEl, a.nextSibling);
      }
      noteEl.textContent = note;
    } else if (noteEl) {
      noteEl.remove();
    }
  }

  var btns = document.querySelectorAll('[data-pay]');
  for (var i = 0; i < btns.length; i++) {
    (function (a) {
      var key = a.getAttribute('data-pay');
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (a.hasAttribute('disabled')) return;   // hard stop on a locked button

        // INQUIRY LANE. The state is read at CLICK time, not at wiring time, because
        // paintButton() runs after Supabase answers — reading it here means the routing always
        // matches the label the customer is actually looking at. A button that says "Request a
        // Quote" and then charges a card would be the worst possible version of this bug.
        if (a.getAttribute('data-svc-state') === 'inquiry') { showQuote(key); return; }

        book(key);
      });
    }(btns[i]));
  }

  // Paint when real availability arrives, and repaint on every change. site-state.js
  // re-polls every 60s and on tab focus, so pausing a service in Supabase reaches open
  // browsers within a minute — no deploy, no developer.
  // THE PAGE MUST NOT CONTRADICT THE STORE. Added 2026-07-26.
  //
  // services.html carried a hardcoded "Online ordering coming soon" banner whose primary CTA
  // sent people to the contact page, plus a second "coming soon" line under the packages -
  // while four services were LIVE and sellable and the checkout worked end to end. ~1.94k
  // visitors, zero purchases. The store was open and the page told every single visitor it
  // was shut. A hardcoded status string is a claim about live state that nothing verifies:
  // exactly the defect class that made a health endpoint say OPERATIONAL while it was down.
  //
  // So the banner is now DERIVED, never asserted: it is shown only while nothing is actually
  // purchasable, and it disappears the moment any service goes 'live' in Supabase. Flip a
  // product live and the page corrects itself within a minute - no deploy, no developer, and
  // no way for the copy to drift from the truth again. Same rule in reverse: pause everything
  // and the banner comes back on its own, so customers are never sent to a dead checkout.
  // 'inquiry' COUNTS AS OPEN (fixed 2026-08-03). This tested `st === 'live'` only, so the moment
  // every service was moved to the inquiry lane the banner came back on — telling visitors
  // "Online ordering coming soon, contact us directly" directly above a page of working
  // "Request a Quote" buttons. Two competing calls to action, and the louder one sent people to a
  // generic contact form instead of the per-service quote modal that names what they want.
  //
  // That is the SAME defect this function was written to kill, just inverted: the page contradicting
  // the store. The banner's real job is "there is no way to start here" — and in inquiry mode there
  // very much is one. So the test is now "can a visitor begin at all", not "can they pay instantly".
  function syncComingSoonBanner() {
    var banner = document.querySelector('.cs-banner');
    var payNote = document.querySelector('.svc-pay-note');
    if (!banner && !payNote) return;
    var anyActionable = false;
    for (var k in SERVICES) {
      if (!Object.prototype.hasOwnProperty.call(SERVICES, k)) continue;
      var st = window.UNDSiteState
        ? window.UNDSiteState.availabilityOf(SERVICES[k].slug)
        : null;
      if (st === 'live' || st === 'inquiry') { anyActionable = true; break; }
    }
    // Unknown availability (site-state not loaded / DB unreachable) is treated as NOT actionable,
    // so we still fail toward the honest "coming soon" message rather than toward a dead button.
    if (banner)  banner.style.display  = anyActionable ? 'none' : '';
    if (payNote) payNote.style.display = anyActionable ? 'none' : '';
  }

  function repaintAll() {
    var list = document.querySelectorAll('[data-pay]');
    for (var n = 0; n < list.length; n++) {
      paintButton(list[n], list[n].getAttribute('data-pay'));
    }
    syncComingSoonBanner();
  }
  if (window.UNDSiteState) {
    window.UNDSiteState.ready(repaintAll);
    document.addEventListener('und:site-state', repaintAll);
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
  // `key` added 2026-08-02 for the inquiry lane. Optional on purpose: called with no argument this
  // is still the generic "custom build" quote it always was, so the existing [data-quote] hook is
  // unchanged. Called WITH a service key it names the service, so the email that reaches Alex says
  // what the customer actually wants instead of arriving as an unattributed "AI / Custom Build".
  // Knowing which service was clicked is the difference between a lead and a guess.
  var QUOTE_SVC = null;
  function showQuote(key) {
    QUOTE_SVC = (key && SERVICES[key]) ? SERVICES[key] : null;
    buildModal();
    mTitle.textContent = QUOTE_SVC
      ? ('Request a quote — ' + (QUOTE_SVC.name || QUOTE_SVC.slug))
      : 'Request a custom quote';
    mBody.innerHTML =
      (QUOTE_SVC
        ? '<p class="svc-modal-p svc-modal-muted">Tell me about your site and what you need done, and I’ll reply with a plan and a flat quote. No obligation, and nothing is charged until you approve it.</p>'
        : '<p class="svc-modal-p svc-modal-muted">AI, automation, chatbots, custom tools, AI-in-Unity — tell me what you need and I’ll reply with a plan + a flat quote. No obligation.</p>') +
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
    // Name the service in BOTH the subject and the body. The subject is what Alex sees in a phone
    // notification and decides whether to open; the body is what survives if the subject is ever
    // rewritten or truncated by a mail client. Belt and braces on the one field that turns a
    // generic contact form into an actionable lead.
    var payload = {
      name: name, email: email,
      subject: QUOTE_SVC
        ? ('Quote request — ' + (QUOTE_SVC.name || QUOTE_SVC.slug))
        : 'AI / Custom Build — Quote Request',
      message: msg
        + (budget ? '\n\nRough budget: ' + budget : '')
        + (QUOTE_SVC ? '\n\nService requested: ' + (QUOTE_SVC.name || QUOTE_SVC.slug)
                       + ' (' + QUOTE_SVC.slug + ')' : '')
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

  // ---- referral code (applies a discount + discounted checkout link if configured) ----
  var refInput = document.getElementById('ref-input');
  var refBtn   = document.getElementById('ref-apply');

  // Do not advertise a feature that cannot succeed. The REFERRAL map is empty (codes are
  // commented-out examples), so every code a customer typed returned "That code isn't valid."
  // - a visible input with a 100% failure rate, which reads as a broken site. Meanwhile the
  // REAL discount path already works: create-checkout-session.js sets allow_promotion_codes,
  // so Stripe's own checkout shows a promo field that actually validates, server-side.
  // Hidden while the map is empty, and it reappears by itself the moment a code is added.
  var hasCodes = false;
  for (var rk in REFERRAL) { if (Object.prototype.hasOwnProperty.call(REFERRAL, rk)) { hasCodes = true; break; } }
  if (!hasCodes) {
    var refBox = document.querySelector('.svc-referral');
    if (refBox) refBox.style.display = 'none';
  }

  if (hasCodes && refBtn && refInput) {
    refBtn.addEventListener('click', function (e) { e.preventDefault(); applyReferral(refInput.value); });
    refInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyReferral(refInput.value); } });
  }
  try { var savedRef = sessionStorage.getItem('svc_ref'); if (savedRef && refInput) { refInput.value = savedRef; applyReferral(savedRef); } } catch (e) {}

  // ---- resume after login: if we stored an intent and the user is now signed
  // in, reopen the consent modal automatically so they don't lose their place.
  // Intent 'cart' is a sentinel meaning "reopen the cart checkout consent".
  // Any other value was a single-service key (legacy path — no longer used now
  // that all services go through the cart, but kept for safety).
  if (sb) {
    var intent = null;
    try { intent = sessionStorage.getItem('svc_intent'); } catch (e) {}
    if (intent === 'cart' && CART.length > 0) {
      sb.auth.getSession().then(function (sres) {
        var session = sres && sres.data ? sres.data.session : null;
        if (session) {
          try { sessionStorage.removeItem('svc_intent'); } catch (e) {}
          fetchRecent(session.user.id).then(function (recent) { showConsentForCart(recent); });
        }
      });
    } else if (intent && SERVICES[intent]) {
      // Legacy single-item path (kept for forward-compat with any bookmarks).
      sb.auth.getSession().then(function (sres) {
        var session = sres && sres.data ? sres.data.session : null;
        if (session) {
          try { sessionStorage.removeItem('svc_intent'); } catch (e) {}
          // Single-item intent: add to cart and open checkout if cart is empty.
          if (CART.length === 0) { CART.push(intent); saveCart(); }
          fetchRecent(session.user.id).then(function (recent) { showConsentForCart(recent); });
        }
      });
    }
  }
}());
