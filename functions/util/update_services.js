const fs = require('fs');
let code = fs.readFileSync('E:/und-industries-website/docs/assets/js/services.js', 'utf8');

// 1. Add Cart Variables
code = code.replace('var currentKey = null;', `var currentKey = null;
  var CART = [];
  try { var savedCart = localStorage.getItem('svc_cart'); if (savedCart) CART = JSON.parse(savedCart); } catch(e) {}`);

// 2. Insert Cart UI Logic before modal
const cartLogic = `
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
`;
code = code.replace('// ---- modal (built once, reused) ----', cartLogic + '\n  // ---- modal (built once, reused) ----');

// 3. Update book() to addToCart()
code = code.replace(/function book\([^)]*\) \{[\s\S]*?var btns = document/m, `function book(key) {
    addToCart(key);
  }

  var btns = document`);

// 4. Update promptLogin and showConsent
code = code.replace(/function promptLogin\([^)]*\) \{[\s\S]*?function rememberIntent\(key\)/m, `function promptLoginForCart() {
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
  function rememberIntent(key)`);

// 5. Rewrite Consent & Checkout
const consentCode = `
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
                try {
                  var json = JSON.parse(text);
                  throw new Error(json.error || 'Server error');
                } catch(e) {
                  throw new Error('Server error (' + r.status + '): ' + text.substring(0, 100));
                }
              });
            }
            return r.json();
          })
          .then(function(res) {
            if (res.url) {
              CART = []; saveCart(); // Clear cart on success
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
`;

code = code.replace(/function showConsent\([\s\S]*?function fetchRecent\(userId\)/m, consentCode + '\n  // ---- recent orders for this user (RLS: a user can read only their own) ----\n  function fetchRecent(userId)');

// 6. Ensure cart loads on start
code = code.replace('// footer year', `// initialize cart\n  renderCart();\n\n  // footer year`);

fs.writeFileSync('E:/und-industries-website/docs/assets/js/services.js', code);
