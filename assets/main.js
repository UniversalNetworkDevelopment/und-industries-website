// U.N.D Industries — Main JS
// UI behavior only. No API keys. No secrets. No internal data.
// All user input uses textContent — no XSS risk.

(function () {
  'use strict';

  // ── Year ──────────────────────────────────────────────────
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // ── Scrolled nav shadow ───────────────────────────────────
  var nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', function () {
      nav.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }

  // ── Mobile nav toggle ─────────────────────────────────────
  var hamburger = document.getElementById('nav-hamburger');
  var navLinks  = document.querySelector('.nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      var expanded = hamburger.getAttribute('aria-expanded') === 'true';
      hamburger.setAttribute('aria-expanded', String(!expanded));
      navLinks.classList.toggle('mobile-open', !expanded);
    });

    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        hamburger.setAttribute('aria-expanded', 'false');
        navLinks.classList.remove('mobile-open');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navLinks.classList.contains('mobile-open')) {
        hamburger.setAttribute('aria-expanded', 'false');
        navLinks.classList.remove('mobile-open');
      }
    });
  }

  // ── Elijah Context System ─────────────────────────────────
  // Tracks current page and section for future internal Elijah integration.
  // No AI logic. No Elijah internals. Integration happens server-side only.
  var _ctx = { pageId: null, sectionId: null };

  window.setContext = function (pageId, sectionId) {
    _ctx.pageId    = pageId    || null;
    _ctx.sectionId = sectionId || null;
    window.dispatchEvent(new CustomEvent('und:context', { detail: { page: _ctx.pageId, section: _ctx.sectionId } }));
  };

  window.getContext = function () { return Object.assign({}, _ctx); };

  // Set context from data attributes on <body> if present
  var body = document.body;
  if (body.dataset.page) {
    window.setContext(body.dataset.page, body.dataset.section || null);
  }

  // ── Auth System (localStorage mock — NOT real security) ───
  // This is a UI demonstration layer only.
  // Replace with real server-side auth before storing any sensitive data.

  var AUTH_KEY  = 'und_auth_user';
  var TOKEN_KEY = 'und_auth_token';

  function bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  function constantTimeEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var result = 0;
    for (var i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  async function derivePasswordHash(password, saltHex) {
    var enc = new TextEncoder();
    var keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    var saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(function (h) { return parseInt(h, 16); }));
    var bits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );
    return bytesToHex(new Uint8Array(bits));
  }

  var Auth = {
    register: async function (name, email, password) {
      if (!name || !email || !password) return { ok: false, msg: 'All fields are required.' };
      if (password.length < 8)          return { ok: false, msg: 'Password must be at least 8 characters.' };
      var existing = localStorage.getItem(AUTH_KEY);
      if (existing) {
        var user = JSON.parse(existing);
        if (user.email === email)        return { ok: false, msg: 'An account with this email already exists.' };
      }
      var salt = new Uint8Array(16);
      window.crypto.getRandomValues(salt);
      var saltHex = bytesToHex(salt);
      var passwordHash = await derivePasswordHash(password, saltHex);
      var newUser = { name: name, email: email, passwordHash: passwordHash, passwordSalt: saltHex, created: Date.now() };
      localStorage.setItem(AUTH_KEY, JSON.stringify(newUser));
      return { ok: true };
    },

    login: async function (email, password) {
      var stored = localStorage.getItem(AUTH_KEY);
      if (!stored) return { ok: false, msg: 'No account found. Please register first.' };
      var user = JSON.parse(stored);
      if (user.email !== email)    return { ok: false, msg: 'Incorrect email or password.' };
      var computedHash = await derivePasswordHash(password, user.passwordSalt || '');
      if (!constantTimeEqual(user.passwordHash || '', computedHash)) return { ok: false, msg: 'Incorrect email or password.' };
      var token = 'und_' + Math.random().toString(36).slice(2) + Date.now();
      localStorage.setItem(TOKEN_KEY, token);
      return { ok: true, user: user };
    },

    logout: function () {
      localStorage.removeItem(TOKEN_KEY);
    },

    isLoggedIn: function () {
      return !!localStorage.getItem(TOKEN_KEY);
    },

    getUser: function () {
      var stored = localStorage.getItem(AUTH_KEY);
      return stored ? JSON.parse(stored) : null;
    }
  };

  window.UNDAuth = Auth;

  // ── Guard: Redirect to login if not authenticated ─────────
  if (body.dataset.protected === 'true') {
    if (!Auth.isLoggedIn()) {
      window.location.href = 'login.html';
    }
  }

  // ── Guard: Redirect to dashboard if already logged in ─────
  if (body.dataset.authPage === 'true') {
    if (Auth.isLoggedIn()) {
      window.location.href = 'dashboard.html';
    }
  }

  // ── Login Form ────────────────────────────────────────────
  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email    = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;
      var alert    = document.getElementById('login-alert');

      var result = Auth.login(email, password);
      if (result.ok) {
        window.location.href = 'dashboard.html';
      } else {
        alert.textContent = result.msg;
        alert.className   = 'auth-alert error visible';
      }
    });
  }

  // ── Register Form ─────────────────────────────────────────
  var registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name     = document.getElementById('reg-name').value.trim();
      var email    = document.getElementById('reg-email').value.trim();
      var password = document.getElementById('reg-password').value;
      var confirm  = document.getElementById('reg-confirm').value;
      var alert    = document.getElementById('reg-alert');

      if (password !== confirm) {
        alert.textContent = 'Passwords do not match.';
        alert.className   = 'auth-alert error visible';
        return;
      }

      var result = Auth.register(name, email, password);
      if (result.ok) {
        alert.textContent = 'Account created. Redirecting to login…';
        alert.className   = 'auth-alert success visible';
        setTimeout(function () { window.location.href = 'login.html'; }, 1400);
      } else {
        alert.textContent = result.msg;
        alert.className   = 'auth-alert error visible';
      }
    });
  }

  // ── Logout Button ─────────────────────────────────────────
  var logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      Auth.logout();
      window.location.href = 'index.html';
    });
  }

  // ── Dashboard: Populate user name ─────────────────────────
  var userNameEl = document.getElementById('dashboard-user-name');
  if (userNameEl) {
    var dashUser = Auth.getUser();
    if (dashUser) {
      userNameEl.textContent = dashUser.name;
    }
  }

  // ── Contact Form (static — no backend submission) ─────────
  var contactForm = document.getElementById('contact-form');
  if (contactForm) {
    var contactAlert = document.getElementById('contact-alert');
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      contactAlert.textContent = 'Message received. This form is not yet connected to a backend — please email directly using the address above.';
      contactAlert.className   = 'auth-alert success visible';
    });
  }

})();
