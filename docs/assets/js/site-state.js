// site-state.js — U.N.D single source of truth for "what is the site doing right now".
//
// Reads public.site_status (one row) and exposes it to every page. Handles:
//   1. SITE MODE      — open / notice / degraded / maintenance / closed
//   2. SPLASH+BANNER  — full-screen splash for maintenance, banner for the softer modes
//   3. AUTO-RELOAD    — when build_version changes (a deploy), refresh the page SAFELY
//   4. AVAILABILITY   — per-service live/soon/paused/waitlist/hidden, for services.js
//
// WHY THIS EXISTS
// Availability used to live in a hardcoded JS object, so turning one service off needed a
// code edit AND a deploy. That is how the buy buttons stayed disabled for 32 days after
// 2026-06-17 with no way to flip them back. Now it is DATA — changeable from the Supabase
// dashboard on a phone, no deploy, no developer.
//
// CSP: the site runs `script-src 'self'` (no unsafe-inline), so this is an external file
// and injects its styles via a <style> element rather than inline attributes.
(function () {
  'use strict';

  var SUPABASE_URL = 'https://wgcgzuflpxijhzlpphab.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2d6dWZscHhpamh6bHBwaGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTc3MTgsImV4cCI6MjA5NDc5MzcxOH0.y96jBpi9ECy1RU76q4AuZQFlqPVrS6CJDwNyx__2K9A';

  var POLL_MS = 60000;          // how often to re-check site status / build version
  var STATE = {
    mode: 'open', headline: null, message: null, eta: null,
    buildVersion: null, availability: {}, loaded: false
  };

  // Pages where a full-screen maintenance splash must NEVER appear, because blocking them
  // would strand a customer who has already paid or is mid-transaction.
  var SPLASH_EXEMPT = ['purchase-complete', 'service-intake', 'maintenance', 'dashboard'];

  function currentPage() {
    var p = (location.pathname || '').split('/').pop() || 'index';
    return p.replace(/\.html$/, '');
  }

  function isExempt() {
    return SPLASH_EXEMPT.indexOf(currentPage()) !== -1;
  }

  // ── styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('und-site-state-css')) return;
    var s = document.createElement('style');
    s.id = 'und-site-state-css';
    s.textContent = [
      '.und-banner{position:relative;z-index:60;padding:11px 46px 11px 18px;font-size:.92rem;',
      '  line-height:1.45;text-align:center;border-bottom:1px solid rgba(255,255,255,.08);}',
      '.und-banner strong{font-weight:700;}',
      '.und-banner .und-eta{opacity:.75;margin-left:6px;}',
      '.und-banner--notice{background:rgba(124,92,255,.14);color:#d8ccff;border-bottom-color:rgba(124,92,255,.35);}',
      '.und-banner--degraded{background:rgba(245,158,11,.13);color:#fcd9a0;border-bottom-color:rgba(245,158,11,.38);}',
      '.und-banner--closed{background:rgba(248,113,113,.12);color:#ffc9c9;border-bottom-color:rgba(248,113,113,.35);}',
      '.und-banner-x{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;',
      '  border:0;color:inherit;opacity:.6;cursor:pointer;font-size:1.15rem;line-height:1;padding:4px 8px;}',
      '.und-banner-x:hover{opacity:1;}',

      '.und-splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;',
      '  background:radial-gradient(1200px 700px at 50% -10%,rgba(124,92,255,.16),transparent 60%),#07070b;',
      '  padding:24px;}',
      '.und-splash-card{max-width:520px;width:100%;text-align:center;padding:40px 32px;border-radius:18px;',
      '  background:rgba(20,20,27,.72);border:1px solid rgba(124,92,255,.28);',
      '  box-shadow:0 24px 70px rgba(0,0,0,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);}',
      '.und-splash-dot{width:11px;height:11px;border-radius:50%;background:#f59e0b;display:inline-block;',
      '  margin-right:9px;box-shadow:0 0 0 0 rgba(245,158,11,.6);animation:und-pulse 2s infinite;}',
      '@keyframes und-pulse{70%{box-shadow:0 0 0 12px rgba(245,158,11,0);}100%{box-shadow:0 0 0 0 rgba(245,158,11,0);}}',
      '.und-splash-kicker{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.74rem;letter-spacing:.16em;',
      '  text-transform:uppercase;color:#9a8cff;margin-bottom:18px;}',
      '.und-splash h1{margin:0 0 12px;font-size:1.6rem;color:#f4f4f7;line-height:1.25;}',
      '.und-splash p{margin:0 0 8px;color:#a9a9b6;line-height:1.6;font-size:.98rem;}',
      '.und-splash .und-splash-eta{color:#d8ccff;font-weight:600;margin-top:14px;}',
      '.und-splash-links{margin-top:26px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}',
      '.und-splash-links a{color:#c9bcff;text-decoration:none;font-size:.9rem;padding:9px 16px;border-radius:9px;',
      '  border:1px solid rgba(124,92,255,.3);transition:background .15s;}',
      '.und-splash-links a:hover{background:rgba(124,92,255,.14);}',

      '.und-reload{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:9998;',
      '  display:flex;align-items:center;gap:14px;padding:13px 18px;border-radius:13px;',
      '  background:rgba(20,20,27,.94);border:1px solid rgba(124,92,255,.4);color:#e8e8ee;',
      '  box-shadow:0 14px 44px rgba(0,0,0,.55);font-size:.92rem;',
      '  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);max-width:calc(100vw - 32px);}',
      '.und-reload button{background:#7c5cff;color:#fff;border:0;border-radius:8px;padding:8px 15px;',
      '  font-weight:600;cursor:pointer;font-size:.88rem;white-space:nowrap;}',
      '.und-reload button:hover{background:#6b4ae0;}',
      '.und-reload .und-later{background:none;color:#9a9aa6;padding:8px 6px;font-weight:400;}',
      '@media(max-width:520px){.und-reload{flex-direction:column;align-items:stretch;text-align:center;}}'
    ].join('');
    document.head.appendChild(s);
  }

  // ── banner (soft modes) ───────────────────────────────────────────────────
  function renderBanner() {
    var existing = document.getElementById('und-banner');
    if (existing) existing.remove();
    if (STATE.mode === 'open' || STATE.mode === 'maintenance') return;

    // A dismissed notice stays dismissed for that build only — a NEW announcement
    // (or a new deploy) shows again. Degraded/closed are never dismissible: they
    // change what the customer can actually do, so they must not be hidable.
    var key = 'und_banner_dismissed_' + STATE.mode + '_' + (STATE.buildVersion || '0');
    if (STATE.mode === 'notice') {
      try { if (sessionStorage.getItem(key) === '1') return; } catch (e) {}
    }

    var b = document.createElement('div');
    b.id = 'und-banner';
    b.className = 'und-banner und-banner--' + STATE.mode;
    b.setAttribute('role', 'status');

    var txt = document.createElement('span');
    if (STATE.headline) {
      var st = document.createElement('strong');
      st.textContent = STATE.headline;
      txt.appendChild(st);
      if (STATE.message) txt.appendChild(document.createTextNode(' — '));
    }
    if (STATE.message) txt.appendChild(document.createTextNode(STATE.message));
    if (STATE.eta) {
      var e = document.createElement('span');
      e.className = 'und-eta';
      e.textContent = '(' + STATE.eta + ')';
      txt.appendChild(e);
    }
    b.appendChild(txt);

    if (STATE.mode === 'notice') {
      var x = document.createElement('button');
      x.className = 'und-banner-x';
      x.setAttribute('aria-label', 'Dismiss');
      x.textContent = '×';
      x.onclick = function () {
        try { sessionStorage.setItem(key, '1'); } catch (e2) {}
        b.remove();
      };
      b.appendChild(x);
    }
    document.body.insertBefore(b, document.body.firstChild);
  }

  // ── splash (maintenance) ──────────────────────────────────────────────────
  function renderSplash() {
    // NEVER strand someone who already paid or is completing intake — they get the
    // softer banner instead of a wall.
    if (isExempt()) { renderBanner(); return; }
    // The splash covers the screen, so a banner behind it is just noise. Found by test
    // 2026-07-19: entering maintenance from another mode left the old banner mounted.
    var stale = document.getElementById('und-banner');
    if (stale) stale.remove();
    if (document.getElementById('und-splash')) return;

    injectStyles();
    var wrap = document.createElement('div');
    wrap.id = 'und-splash';
    wrap.className = 'und-splash';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');

    var card = document.createElement('div');
    card.className = 'und-splash-card';

    var kicker = document.createElement('div');
    kicker.className = 'und-splash-kicker';
    var dot = document.createElement('span');
    dot.className = 'und-splash-dot';
    kicker.appendChild(dot);
    kicker.appendChild(document.createTextNode('System Maintenance'));
    card.appendChild(kicker);

    var h = document.createElement('h1');
    h.textContent = STATE.headline || 'We’ll be right back';
    card.appendChild(h);

    var p = document.createElement('p');
    p.textContent = STATE.message ||
      'U.N.D Industries is being updated. Nothing is wrong — we’re shipping an improvement.';
    card.appendChild(p);

    if (STATE.eta) {
      var eta = document.createElement('p');
      eta.className = 'und-splash-eta';
      eta.textContent = 'Expected back: ' + STATE.eta;
      card.appendChild(eta);
    }

    var links = document.createElement('div');
    links.className = 'und-splash-links';
    [['Contact us', 'contact.html'], ['Check status', 'maintenance.html']].forEach(function (l) {
      var a = document.createElement('a');
      a.textContent = l[0];
      a.href = l[1];
      links.appendChild(a);
    });
    card.appendChild(links);

    wrap.appendChild(card);
    document.body.appendChild(wrap);
    document.documentElement.style.overflow = 'hidden';
  }

  function clearSplash() {
    var s = document.getElementById('und-splash');
    if (s) s.remove();
    document.documentElement.style.overflow = '';
  }

  // ── auto-reload on deploy ─────────────────────────────────────────────────
  // SAFETY IS THE WHOLE POINT HERE. Reloading a page out from under someone who is
  // typing, or mid-checkout, destroys their work and can cost the sale — which is
  // worse than the stale page we are trying to fix. So we NEVER reload silently
  // when the user could lose something. We offer, and we say why.
  function userIsBusy() {
    var el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
    // any visibly non-empty form field on the page
    var fields = document.querySelectorAll('input, textarea');
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.type === 'hidden' || f.type === 'submit' || f.type === 'button') continue;
      if (f.value && String(f.value).trim() !== '') return true;
    }
    // an open modal / checkout step
    if (document.querySelector('.svc-modal.open, .modal.open, [data-checkout-open="1"]')) return true;
    // never interrupt these
    if (isExempt()) return true;
    return false;
  }

  function offerReload() {
    if (document.getElementById('und-reload')) return;
    injectStyles();
    var bar = document.createElement('div');
    bar.id = 'und-reload';
    bar.className = 'und-reload';
    bar.setAttribute('role', 'status');

    var msg = document.createElement('span');
    msg.textContent = 'A new version of the site is available.';
    bar.appendChild(msg);

    var go = document.createElement('button');
    go.textContent = 'Refresh now';
    go.onclick = function () { location.reload(); };
    bar.appendChild(go);

    var later = document.createElement('button');
    later.className = 'und-later';
    later.textContent = 'Not now';
    later.onclick = function () { bar.remove(); };
    bar.appendChild(later);

    document.body.appendChild(bar);
  }

  function handleVersion(v) {
    if (!v) return;
    if (STATE.buildVersion === null) { STATE.buildVersion = v; return; }
    if (v === STATE.buildVersion) return;
    STATE.buildVersion = v;
    // Safe to refresh outright? Do it. Otherwise ask, and let them finish first.
    if (!userIsBusy()) { location.reload(); return; }
    offerReload();
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  function rest(path) {
    return fetch(SUPABASE_URL + '/rest/v1/' + path, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    }).then(function (r) { return r.ok ? r.json() : null; });
  }

  function refresh(first) {
    return Promise.all([
      rest('site_status?select=mode,headline,message,eta,build_version&id=eq.1'),
      first ? rest('store_products?select=slug,availability,availability_note') : Promise.resolve(null)
    ]).then(function (res) {
      var st = res[0] && res[0][0];
      if (st) {
        var prevMode = STATE.mode;
        STATE.mode = st.mode || 'open';
        STATE.headline = st.headline;
        STATE.message = st.message;
        STATE.eta = st.eta;

        if (STATE.mode === 'maintenance') renderSplash();
        else { if (prevMode === 'maintenance') clearSplash(); renderBanner(); }

        handleVersion(st.build_version);
      }
      if (res[1]) {
        var map = {};
        res[1].forEach(function (p) {
          map[p.slug] = { availability: p.availability || 'soon', note: p.availability_note || null };
        });
        STATE.availability = map;
      }
      STATE.loaded = true;
      document.dispatchEvent(new CustomEvent('und:site-state', { detail: STATE }));
      return STATE;
    }).catch(function () {
      // FAIL OPEN, DELIBERATELY. If Supabase is unreachable we must NOT show a
      // maintenance splash over a site that is actually fine — that would invent an
      // outage. services.js separately fails CLOSED on availability (unknown => not
      // buyable), so we never take money we cannot verify is meant to be taken.
      STATE.loaded = true;
      document.dispatchEvent(new CustomEvent('und:site-state', { detail: STATE }));
      return STATE;
    });
  }

  // ── public API ────────────────────────────────────────────────────────────
  window.UNDSiteState = {
    get: function () { return STATE; },
    ready: function (cb) {
      if (STATE.loaded) { cb(STATE); return; }
      document.addEventListener('und:site-state', function h(e) {
        document.removeEventListener('und:site-state', h);
        cb(e.detail);
      });
    },
    // Availability for one slug. Unknown => 'soon' (fail closed: never sell by accident).
    availabilityOf: function (slug) {
      var a = STATE.availability[slug];
      return a ? a.availability : 'soon';
    },
    noteOf: function (slug) {
      var a = STATE.availability[slug];
      return a ? a.note : null;
    },
    // True only when the whole site permits purchasing AND the service is live.
    canPurchase: function (slug) {
      if (STATE.mode === 'maintenance' || STATE.mode === 'closed') return false;
      return this.availabilityOf(slug) === 'live';
    },
    refresh: refresh
  };

  function boot() {
    injectStyles();
    refresh(true);
    setInterval(function () { refresh(false); }, POLL_MS);
    // Re-check the moment someone returns to the tab — they may have been away
    // across a deploy, and a stale tab is exactly what this is for.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
