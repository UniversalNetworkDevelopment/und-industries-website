(function () {
  var SUPABASE_URL      = 'https://wgcgzuflpxijhzlpphab.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2d6dWZscHhpamh6bHBwaGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTc3MTgsImV4cCI6MjA5NDc5MzcxOH0.y96jBpi9ECy1RU76q4AuZQFlqPVrS6CJDwNyx__2K9A';

  var statusEl = document.getElementById('pc-status');

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
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

  var sessionId = new URLSearchParams(location.search).get('session_id');

  // Clear the cart now that the purchase is complete
  try { localStorage.removeItem('svc_cart'); } catch(e) {}

  if (!sessionId) {
    statusEl.innerHTML = '<p class="pc-note">Your payment was received. View your orders and any license keys on your Dashboard.</p>';
    return;
  }

  if (!window.supabase || !window.supabase.createClient) {
    statusEl.innerHTML = '<p class="pc-note">Your payment was received. Visit your Dashboard to view your order.</p>';
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function renderSummary(purchase, entitlement) {
    var html = '<div class="pc-summary">';
    html += '<div class="pc-summary-row"><span>Product</span><span>' + esc(purchase.title || purchase.product_slug) + '</span></div>';
    html += '<div class="pc-summary-row"><span>Amount</span><span>' + esc(formatAmount(purchase.amount_cents, purchase.currency)) + '</span></div>';
    html += '<div class="pc-summary-row"><span>Status</span><span>' + esc(purchase.status || 'paid') + '</span></div>';
    html += '</div>';

    if (entitlement && entitlement.license_key) {
      html += '<div class="pc-license">';
      html += '<p class="pc-license-label">Your license key</p>';
      html += '<div class="pc-license-box">';
      html += '<code id="pc-license-key">' + esc(entitlement.license_key) + '</code>';
      html += '<button type="button" class="btn btn-outline btn-sm" id="pc-copy-btn">Copy</button>';
      html += '</div>';
      html += '</div>';
    } else {
      html += '<p class="pc-access">Access unlocked. Find your purchase on your Dashboard.</p>';
    }

    statusEl.innerHTML = html;

    var copyBtn = document.getElementById('pc-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var key = entitlement.license_key;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(key).then(function () {
            copyBtn.textContent = 'Copied';
            setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000);
          }).catch(function () {
            copyBtn.textContent = 'Copy failed';
          });
        }
      });
    }
  }

  function renderTimeout() {
    statusEl.innerHTML =
      '<p class="pc-note">Payment received &mdash; your order is being finalized. ' +
      'Refresh in a moment or check your Dashboard.</p>' +
      '<div class="pc-actions"><button type="button" class="btn btn-outline" id="pc-refresh-btn">Refresh</button></div>';
    var refreshBtn = document.getElementById('pc-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () { location.reload(); });
    }
  }

  (async function () {
    var sessionRes = await sb.auth.getSession();
    var session    = sessionRes && sessionRes.data ? sessionRes.data.session : null;

    if (!session) {
      statusEl.innerHTML =
        '<p class="pc-note">Your payment was received. ' +
        'Sign in to view your order and license key.</p>' +
        '<div class="pc-actions"><a href="login.html" class="btn btn-primary">Sign In</a></div>';
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
