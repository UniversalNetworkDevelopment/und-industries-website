// feedback.js — site-wide floating Feedback button + modal.
//
// Why a separate file (not inlined into main.js):
//   • main.js is a ~2,900-line monolith already identified for future splitting.
//     Adding feedback there grows the blast-radius; a throw here can't break nav/auth.
//   • This module is self-contained: it creates its own DOM nodes, binds its own
//     listeners, and uses its own sb client scoped to this IIFE. Zero shared state
//     with main.js, so load order doesn't matter (deferred by placement at </body>).
//   • CSP: script-src 'self' — this is an external file, compliant.
//     The supabase UMD is already loaded by main.js's <script> tag above ours;
//     we share the global window.supabase that it sets, no double-load.
//
// DB: feedback table (LIVE per DB-SCHEMA-REGISTRY.md) columns:
//   page TEXT, message TEXT NOT NULL, email TEXT (nullable), created_at TIMESTAMPTZ.
//   RLS policy: anon INSERT allowed (no auth required).
//
// Design rules:
//   • No inline <script> (CSP 'self' only).
//   • No passwords or secrets in code.
//   • Fails silently if supabase is unavailable — the button still appears but
//     on submit it shows an email fallback.
//   • Never breaks existing nav, auth handlers, or page JS — purely additive DOM.
(function () {
  'use strict';

  var SUPABASE_URL      = 'https://wgcgzuflpxijhzlpphab.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2d6dWZscHhpamh6bHBwaGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTc3MTgsImV4cCI6MjA5NDc5MzcxOH0.y96jBpi9ECy1RU76q4AuZQFlqPVrS6CJDwNyx__2K9A';
  var FALLBACK_EMAIL    = 'contact.undindustries@gmail.com';

  var sb = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  // Current page identifier — use data-page attr when available, else the path.
  function currentPage() {
    var attr = document.body && document.body.dataset && document.body.dataset.page;
    if (attr) return attr;
    try {
      var p = window.location.pathname.split('/').pop().replace(/\.html$/, '') || 'index';
      return p;
    } catch (_) { return 'unknown'; }
  }

  // Inject styles via a <style> tag — keeping CSS co-located with the module.
  // 'unsafe-inline' is allowed for style-src on this site (see CSP headers).
  function injectStyles() {
    var id = 'fb-widget-styles';
    if (document.getElementById(id)) return;
    var style = document.createElement('style');
    style.id = id;
    style.textContent = [
      /* Floating trigger button */
      '.fb-trigger{position:fixed;bottom:24px;right:24px;z-index:9000;',
        'background:#7c5cff;color:#fff;border:none;border-radius:999px;',
        'padding:10px 18px;font-size:0.88rem;font-weight:700;cursor:pointer;',
        'box-shadow:0 4px 18px rgba(124,92,255,0.45);',
        'display:flex;align-items:center;gap:7px;',
        'transition:background 0.2s,transform 0.15s;}',
      '.fb-trigger:hover{background:#6d4fe0;transform:translateY(-2px);}',
      '.fb-trigger:focus-visible{outline:2px solid #fff;outline-offset:3px;}',

      /* Overlay backdrop */
      '.fb-overlay{display:none;position:fixed;inset:0;z-index:8999;',
        'background:rgba(0,0,0,0.55);}',
      '.fb-overlay.open{display:block;}',

      /* Modal card */
      '.fb-modal{display:none;position:fixed;bottom:80px;right:24px;z-index:9001;',
        'width:min(340px,calc(100vw - 32px));',
        'background:#15151a;border:1px solid rgba(255,255,255,0.10);',
        'border-radius:14px;padding:1.4rem 1.4rem 1.2rem;',
        'box-shadow:0 8px 40px rgba(0,0,0,0.55);}',
      '.fb-modal.open{display:block;}',
      '.fb-modal-header{display:flex;align-items:center;justify-content:space-between;',
        'margin-bottom:1rem;}',
      '.fb-modal-title{font-size:1rem;font-weight:700;color:#e8e8ec;margin:0;}',
      '.fb-close{background:none;border:none;color:#888;font-size:1.2rem;',
        'cursor:pointer;padding:2px 6px;border-radius:4px;line-height:1;}',
      '.fb-close:hover{color:#e8e8ec;background:rgba(255,255,255,0.07);}',
      '.fb-field{margin-bottom:0.85rem;}',
      '.fb-label{display:block;font-size:0.75rem;font-weight:600;',
        'color:#888;margin-bottom:0.35rem;letter-spacing:0.04em;text-transform:uppercase;}',
      '.fb-input,.fb-textarea{width:100%;background:#0d0d0f;',
        'border:1px solid rgba(255,255,255,0.10);border-radius:7px;',
        'padding:0.55rem 0.75rem;font-size:0.9rem;color:#e8e8ec;',
        'outline:none;transition:border-color 0.2s;',
        'font-family:inherit;box-sizing:border-box;}',
      '.fb-input:focus,.fb-textarea:focus{border-color:#7c5cff;}',
      '.fb-textarea{resize:vertical;min-height:80px;}',
      '.fb-submit{width:100%;padding:0.65rem;background:#7c5cff;color:#fff;',
        'border:none;border-radius:7px;font-size:0.9rem;font-weight:700;',
        'cursor:pointer;transition:background 0.2s;margin-top:0.2rem;}',
      '.fb-submit:hover:not(:disabled){background:#6d4fe0;}',
      '.fb-submit:disabled{opacity:0.55;cursor:not-allowed;}',
      '.fb-status{font-size:0.82rem;margin-top:0.6rem;padding:0.5rem 0.7rem;',
        'border-radius:6px;display:none;}',
      '.fb-status.ok{display:block;background:rgba(74,222,128,0.10);',
        'color:#4ade80;border:1px solid rgba(74,222,128,0.25);}',
      '.fb-status.err{display:block;background:rgba(248,113,113,0.10);',
        'color:#f87171;border:1px solid rgba(248,113,113,0.25);}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function buildWidget() {
    // Overlay (closes modal on outside click)
    var overlay = document.createElement('div');
    overlay.className = 'fb-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    // Modal
    var modal = document.createElement('div');
    modal.className = 'fb-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'fb-modal-title');

    // Header row: title + close button
    var header = document.createElement('div');
    header.className = 'fb-modal-header';

    var title = document.createElement('h2');
    title.id = 'fb-modal-title';
    title.className = 'fb-modal-title';
    title.textContent = 'Share Feedback';
    header.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'fb-close';
    closeBtn.setAttribute('aria-label', 'Close feedback');
    closeBtn.textContent = '×'; // ×
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Message field (required)
    var msgField = document.createElement('div');
    msgField.className = 'fb-field';
    var msgLabel = document.createElement('label');
    msgLabel.className = 'fb-label';
    msgLabel.setAttribute('for', 'fb-message');
    msgLabel.textContent = 'Your feedback';
    var msgInput = document.createElement('textarea');
    msgInput.className = 'fb-textarea';
    msgInput.id = 'fb-message';
    msgInput.placeholder = 'What\'s on your mind? Bug, suggestion, question…';
    msgInput.setAttribute('autocomplete', 'off');
    msgField.appendChild(msgLabel);
    msgField.appendChild(msgInput);
    modal.appendChild(msgField);

    // Email field (optional)
    var emailField = document.createElement('div');
    emailField.className = 'fb-field';
    var emailLabel = document.createElement('label');
    emailLabel.className = 'fb-label';
    emailLabel.setAttribute('for', 'fb-email');
    emailLabel.textContent = 'Email (optional — for a reply)';
    var emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.className = 'fb-input';
    emailInput.id = 'fb-email';
    emailInput.placeholder = 'you@example.com';
    emailInput.setAttribute('autocomplete', 'email');
    emailField.appendChild(emailLabel);
    emailField.appendChild(emailInput);
    modal.appendChild(emailField);

    // Submit button
    var submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'fb-submit';
    submitBtn.textContent = 'Send Feedback';
    modal.appendChild(submitBtn);

    // Status message (ok / err)
    var statusEl = document.createElement('p');
    statusEl.className = 'fb-status';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    modal.appendChild(statusEl);

    // Floating trigger button
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'fb-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'fb-modal-title');
    // Icon + label via text nodes only (no innerHTML)
    var iconSpan = document.createElement('span');
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = '💬'; // 💬
    trigger.appendChild(iconSpan);
    trigger.appendChild(document.createTextNode(' Feedback'));

    document.body.appendChild(overlay);
    document.body.appendChild(modal);
    document.body.appendChild(trigger);

    // ---- interactions ----
    function openModal() {
      modal.classList.add('open');
      overlay.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      msgInput.focus();
    }
    function closeModal() {
      modal.classList.remove('open');
      overlay.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', function () {
      if (modal.classList.contains('open')) { closeModal(); } else { openModal(); }
    });
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });

    function setStatus(type, text) {
      statusEl.textContent = text;
      statusEl.className = 'fb-status ' + type;
    }
    function clearStatus() {
      statusEl.textContent = '';
      statusEl.className = 'fb-status';
    }

    submitBtn.addEventListener('click', function () {
      var msg   = msgInput.value.trim();
      var email = emailInput.value.trim();

      if (!msg) {
        setStatus('err', 'Please enter a message before sending.');
        return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        setStatus('err', 'That email doesn\'t look right — fix it or leave it blank.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      clearStatus();

      var row = {
        page:    currentPage(),
        message: msg,
        email:   email || null
      };

      if (!sb) {
        // No Supabase — soft-fail with email fallback
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Feedback';
        setStatus('err', 'Could not send right now. Email us at ' + FALLBACK_EMAIL + ' — we read everything.');
        return;
      }

      sb.from('feedback').insert(row).then(function (res) {
        if (res.error) {
          console.error('[feedback] insert error', res.error);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Feedback';
          setStatus('err', 'Couldn\'t send. Email ' + FALLBACK_EMAIL + ' — we read every message.');
          return;
        }
        // Success — show thank you, reset form, auto-close after 3 s
        msgInput.value  = '';
        emailInput.value = '';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Feedback';
        setStatus('ok', 'Thanks! We got it and will look into it.');
        setTimeout(function () { closeModal(); clearStatus(); }, 3000);
      }).catch(function (err) {
        console.error('[feedback] insert threw', err);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Feedback';
        setStatus('err', 'Network error. Email ' + FALLBACK_EMAIL + ' directly.');
      });
    });
  }

  // Boot after DOM is ready. main.js is already loaded before us (placement at
  // end of <body>), so document.body exists; but guard for safety.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { injectStyles(); buildWidget(); });
  } else {
    injectStyles();
    buildWidget();
  }

}());
