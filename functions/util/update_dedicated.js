const fs = require('fs');

const pages = ['E:/und-industries-website/docs/shopify.html', 'E:/und-industries-website/docs/automation.html'];

const newCardCss = `
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
    }`;

const cartHtml = `
  <!-- Shopping Cart Panel -->
  <div class="cart-overlay" id="cart-overlay"></div>
  <aside class="cart-panel" id="cart-panel">
    <div class="cart-header">
      <h2 style="margin:0; font-size:1.2rem; display:flex; align-items:center; gap:8px;">
        Your Cart
        <span class="cart-toggle-badge" id="cart-badge" style="position:static; display:none">0</span>
      </h2>
      <button class="cart-close" id="cart-close">&times;</button>
    </div>
    <div class="cart-items" id="cart-items">
      <div class="cart-empty">Your cart is empty.</div>
    </div>
    <div class="cart-footer">
      <div class="cart-total-row">
        <span>Total</span>
        <span id="cart-total">$0.00</span>
      </div>
      <button type="button" class="btn btn-primary btn-full" id="cart-checkout" disabled>Checkout</button>
    </div>
  </aside>
`;

for (const p of pages) {
  let html = fs.readFileSync(p, 'utf8');
  
  // Update CSS
  html = html.replace(/\.svc-card\s*\{[^}]+\}\s*\.svc-card\.featured\s*\{[^}]+\}/, newCardCss + '\n    .svc-card.featured { border-color: #7c5cff; box-shadow: 0 0 0 1px #7c5cff, 0 12px 40px rgba(124,92,255,.18); }');
  
  // Inject Cart HTML right before the footer if it's not there
  if (html.indexOf('id="cart-panel"') === -1) {
    html = html.replace('<footer', cartHtml + '\n  <footer');
  }
  
  // Inject Cart floating toggle if not present
  const cartToggleHtml = `
  <!-- Cart Toggle Float -->
  <button class="cart-toggle" id="cart-toggle" aria-label="Open Cart">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>
  </button>
  `;
  if (html.indexOf('id="cart-toggle"') === -1) {
    html = html.replace('<footer', cartToggleHtml + '\n  <footer');
  }

  // Update Cart CSS if needed
  const cartCss = `
      /* Shopping Cart */
      .cart-toggle { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; background: #7c5cff; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(124,92,255,.4); border: none; color: #fff; cursor: pointer; z-index: 900; transition: transform 0.2s; }
      .cart-toggle:hover { transform: scale(1.05); }
      .cart-toggle-badge { position: absolute; top: -2px; right: -2px; background: #ff395c; color: #fff; font-size: 0.75rem; font-weight: bold; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid #08080c; }
      .cart-panel { position: fixed; top: 0; right: -400px; width: 100%; max-width: 400px; height: 100vh; background: #15151a; border-left: 1px solid rgba(255,255,255,.08); z-index: 1100; box-shadow: -10px 0 30px rgba(0,0,0,.6); transition: right .3s ease; display: flex; flex-direction: column; }
      .cart-panel.open { right: 0; }
      .cart-header { padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,.05); display: flex; justify-content: space-between; align-items: center; }
      .cart-close { background: none; border: none; color: var(--text-muted); font-size: 2rem; cursor: pointer; line-height: 1; }
      .cart-close:hover { color: #fff; }
      .cart-items { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
      .cart-item { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,.05); }
      .cart-item-info h4 { margin: 0 0 4px; font-size: 1.05rem; }
      .cart-item-info p { margin: 0; color: var(--text-muted); font-size: 0.9rem; }
      .cart-item-remove { background: none; border: none; color: #ff8a8a; font-size: 0.85rem; cursor: pointer; padding: 4px; }
      .cart-item-remove:hover { text-decoration: underline; }
      .cart-empty { color: var(--text-muted); text-align: center; margin-top: 40px; }
      .cart-footer { padding: 20px 24px; border-top: 1px solid rgba(255,255,255,.05); background: rgba(0,0,0,.2); }
      .cart-total-row { display: flex; justify-content: space-between; font-size: 1.2rem; font-weight: 700; margin-bottom: 16px; }
      .cart-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 1050; opacity: 0; pointer-events: none; transition: opacity .3s ease; }
      .cart-overlay.open { opacity: 1; pointer-events: auto; }
  `;
  if (html.indexOf('.cart-toggle {') === -1) {
    html = html.replace('/* Booking consent modal */', cartCss + '\n    /* Booking consent modal */');
  }

  // Also replace old `book('xxx')` or `book(this.dataset.pay)` calls with `addToCart('xxx')` logic.
  // Wait, in services.html the buttons have `data-pay="xyz" href="contact.html"`, but they are intercepted in JS:
  // var btns = document.querySelectorAll('.svc-paybtn');
  // for (var i = 0; i < btns.length; i++) {
  //   btns[i].addEventListener('click', function(e) {
  //     e.preventDefault();
  //     var key = e.target.getAttribute('data-pay');
  //     book(key);  // I already changed book() to addToCart(key) in services.js, so this should just work!
  //   });
  // }
  // Because shopify.html and automation.html ALSO use services.js, the click listeners are attached by services.js and will call book(key) which now correctly calls addToCart(key).
  // Thus, we ONLY need the cart HTML so that when addToCart(key) tries to render the cart and toggle it, the elements exist in the DOM!

  fs.writeFileSync(p, html);
}
