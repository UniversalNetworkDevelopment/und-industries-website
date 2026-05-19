// U.N.D Industries — Main JS
// UI behavior only. No API keys. No secrets. No internal data.

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
  // Tracks page and section for future internal integration only.
  // No AI logic exposed here.
  var _ctx = { pageId: null, sectionId: null };

  window.setContext = function (pageId, sectionId) {
    _ctx.pageId    = pageId    || null;
    _ctx.sectionId = sectionId || null;
    window.dispatchEvent(new CustomEvent('und:context', {
      detail: { page: _ctx.pageId, section: _ctx.sectionId }
    }));
  };

  window.getContext = function () { return Object.assign({}, _ctx); };

  var body = document.body;
  if (body.dataset.page) {
    window.setContext(body.dataset.page, body.dataset.section || null);
  }

  // ── Auth ─────────────────────────────────────────────────
  //
  // IMPORTANT — FRONT-END DEMO ONLY.
  //
  // This authentication system is NOT production-safe and is NOT suitable
  // for storing real user credentials or sensitive data of any kind.
  //
  // What it does:
  //   - Stores a single user object { name, email, password } as plaintext
  //     JSON in the browser's localStorage under the key 'und_auth_user'.
  //   - Stores a randomly generated session token in localStorage under
  //     the key 'und_auth_token'.
  //
  // What it does NOT do:
  //   - No server-side validation.
  //   - No password hashing or encryption of any kind.
  //   - No secure session management.
  //   - No protection against local device access.
  //
  // This system exists solely to demonstrate gated UI flows (dashboard
  // access, route guards). It must not be used to protect real sensitive
  // content or real user accounts.
  //
  var AUTH_KEY  = 'und_auth_user';
  var TOKEN_KEY = 'und_auth_token';

  var Auth = {
    register: function (name, email, password) {
      // Stores plaintext credentials in localStorage — demo only.
      if (!name || !email || !password) return { ok: false, msg: 'All fields are required.' };
      if (password.length < 8)          return { ok: false, msg: 'Password must be at least 8 characters.' };
      var existing = localStorage.getItem(AUTH_KEY);
      if (existing && JSON.parse(existing).email === email)
        return { ok: false, msg: 'An account with this email already exists.' };
      localStorage.setItem(AUTH_KEY, JSON.stringify({ name: name, email: email, password: password }));
      return { ok: true };
    },

    login: function (email, password) {
      // Compares plaintext values — demo only. Not suitable for real passwords.
      var stored = localStorage.getItem(AUTH_KEY);
      if (!stored)                          return { ok: false, msg: 'No account found. Please register first.' };
      var user = JSON.parse(stored);
      if (user.email !== email || user.password !== password)
        return { ok: false, msg: 'Incorrect email or password.' };
      localStorage.setItem(TOKEN_KEY, 'und_' + Math.random().toString(36).slice(2) + Date.now());
      return { ok: true };
    },

    logout:    function () { localStorage.removeItem(TOKEN_KEY); },
    isLoggedIn:function () { return !!localStorage.getItem(TOKEN_KEY); },
    getUser:   function () { var s = localStorage.getItem(AUTH_KEY); return s ? JSON.parse(s) : null; }
  };

  window.UNDAuth = Auth;

  // ── Route guards ──────────────────────────────────────────
  if (body.dataset.protected === 'true' && !Auth.isLoggedIn()) {
    window.location.href = 'login.html';
  }

  if (body.dataset.authPage === 'true' && Auth.isLoggedIn()) {
    window.location.href = 'dashboard.html';
  }

  // ── Login form ────────────────────────────────────────────
  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var alert  = document.getElementById('login-alert');
      var result = Auth.login(
        document.getElementById('login-email').value.trim(),
        document.getElementById('login-password').value
      );
      if (result.ok) {
        window.location.href = 'dashboard.html';
      } else {
        alert.textContent = result.msg;
        alert.className   = 'auth-alert error visible';
      }
    });
  }

  // ── Register form ─────────────────────────────────────────
  var registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var alert    = document.getElementById('reg-alert');
      var password = document.getElementById('reg-password').value;
      var confirm  = document.getElementById('reg-confirm').value;
      var termsBox = document.getElementById('agree-terms');

      if (termsBox && !termsBox.checked) {
        alert.textContent = 'You must agree to the Terms of Use and Privacy Policy to create an account.';
        alert.className   = 'auth-alert error visible';
        return;
      }

      if (password !== confirm) {
        alert.textContent = 'Passwords do not match.';
        alert.className   = 'auth-alert error visible';
        return;
      }

      var result = Auth.register(
        document.getElementById('reg-name').value.trim(),
        document.getElementById('reg-email').value.trim(),
        password
      );

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

  // ── Logout (handles sidebar + mobile bar buttons) ─────────
  document.querySelectorAll('[data-action="logout"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      Auth.logout();
      window.location.href = 'index.html';
    });
  });

  // ── Dashboard user name ───────────────────────────────────
  var userNameEl = document.getElementById('dashboard-user-name');
  if (userNameEl) {
    var u = Auth.getUser();
    if (u) userNameEl.textContent = u.name;
  }

  // ── Contact form (static — no backend) ───────────────────
  var contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var alert = document.getElementById('contact-alert');
      alert.textContent = 'Message received. For fastest response, email directly using the address above.';
      alert.className   = 'auth-alert success visible';
    });
  }

})();
