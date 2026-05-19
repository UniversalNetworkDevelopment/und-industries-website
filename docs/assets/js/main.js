// U.N.D Industries — Main JS
// Real auth via Supabase. The anon key is public by design — Row Level Security
// on the database handles access control. Passwords are hashed server-side.
//
// SETUP: Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values.
// Dashboard → Project Settings → API → "Project URL" + "anon public" key.

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

  // ── Supabase ──────────────────────────────────────────────
  var SUPABASE_URL      = 'YOUR_SUPABASE_URL';
  var SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

  var supabase = null;
  if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  // ── Auth ─────────────────────────────────────────────────
  var Auth = {
    register: async function (email, password, displayName) {
      if (!supabase) return { ok: false, msg: 'Registration not yet open. Email officialtyzen@gmail.com to register interest.' };
      var res = await supabase.auth.signUp({
        email: email,
        password: password,
        options: { data: { display_name: displayName } }
      });
      if (res.error) return { ok: false, msg: res.error.message };
      return { ok: true, needsVerification: !res.data.session };
    },

    login: async function (email, password) {
      if (!supabase) return { ok: false, msg: 'Login not yet available. Check back soon.' };
      var res = await supabase.auth.signInWithPassword({ email: email, password: password });
      if (res.error) return { ok: false, msg: res.error.message };
      return { ok: true };
    },

    logout: async function () {
      if (supabase) await supabase.auth.signOut();
      window.location.href = 'index.html';
    },

    isLoggedIn: async function () {
      if (!supabase) return false;
      var res = await supabase.auth.getSession();
      return !!res.data.session;
    },

    getUser: async function () {
      if (!supabase) return null;
      var res = await supabase.auth.getSession();
      return res.data.session ? res.data.session.user : null;
    },

    getProfile: async function () {
      if (!supabase) return null;
      var sessionRes = await supabase.auth.getSession();
      if (!sessionRes.data.session) return null;
      var uid = sessionRes.data.session.user.id;
      var res = await supabase.from('profiles').select('*').eq('id', uid).single();
      return res.error ? null : res.data;
    }
  };

  window.UNDAuth = Auth;

  // ── Route guards ──────────────────────────────────────────
  // auth-loading hides page content during async session check (prevents flash).
  var body        = document.body;
  var isProtected = body.dataset.protected === 'true';
  var isAuthPage  = body.dataset.authPage  === 'true';

  if (isProtected || isAuthPage) {
    body.classList.add('auth-loading');
  }

  async function runRouteGuard() {
    var loggedIn = await Auth.isLoggedIn();

    if (isProtected && !loggedIn) {
      window.location.href = 'login.html';
      return;
    }
    if (isAuthPage && loggedIn) {
      window.location.href = 'dashboard.html';
      return;
    }

    body.classList.remove('auth-loading');
    initPage();
  }

  function initPage() {

    // ── Login form ──────────────────────────────────────────
    var loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var alertEl = document.getElementById('login-alert');
        var btn     = loginForm.querySelector('[type="submit"]');
        btn.disabled    = true;
        btn.textContent = 'Signing in…';

        var result = await Auth.login(
          document.getElementById('login-email').value.trim(),
          document.getElementById('login-password').value
        );

        btn.disabled    = false;
        btn.textContent = 'Sign In';

        if (result.ok) {
          window.location.href = 'dashboard.html';
        } else {
          alertEl.textContent = result.msg;
          alertEl.className   = 'auth-alert error visible';
        }
      });
    }

    // ── Register form ───────────────────────────────────────
    var registerForm = document.getElementById('register-form');
    if (registerForm) {
      registerForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var alertEl  = document.getElementById('reg-alert');
        var btn      = registerForm.querySelector('[type="submit"]');
        var password = document.getElementById('reg-password').value;
        var confirm  = document.getElementById('reg-confirm').value;
        var termsBox = document.getElementById('agree-terms');

        if (termsBox && !termsBox.checked) {
          alertEl.textContent = 'You must agree to the Terms of Use and Privacy Policy.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        if (password !== confirm) {
          alertEl.textContent = 'Passwords do not match.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        btn.disabled    = true;
        btn.textContent = 'Creating account…';

        var result = await Auth.register(
          document.getElementById('reg-email').value.trim(),
          password,
          document.getElementById('reg-name').value.trim()
        );

        btn.disabled    = false;
        btn.textContent = 'Create Account';

        if (result.ok) {
          if (result.needsVerification) {
            alertEl.textContent = 'Account created! Check your email to verify your address, then log in.';
          } else {
            alertEl.textContent = 'Account created. Redirecting…';
            setTimeout(function () { window.location.href = 'dashboard.html'; }, 1400);
          }
          alertEl.className = 'auth-alert success visible';
        } else {
          alertEl.textContent = result.msg;
          alertEl.className   = 'auth-alert error visible';
        }
      });
    }

    // ── Logout ──────────────────────────────────────────────
    document.querySelectorAll('[data-action="logout"]').forEach(function (btn) {
      btn.addEventListener('click', function () { Auth.logout(); });
    });

    // ── Dashboard profile + admin ────────────────────────────
    var userNameEl   = document.getElementById('dashboard-user-name');
    var adminSection = document.getElementById('admin-section');

    if (userNameEl || adminSection) {
      Auth.getProfile().then(function (profile) {
        if (profile) {
          if (userNameEl) userNameEl.textContent = profile.display_name || 'Studio';
          if (adminSection && profile.role === 'owner') {
            adminSection.removeAttribute('hidden');
          }
        }
      });
    }

    // ── Contact form ─────────────────────────────────────────
    var contactForm = document.getElementById('contact-form');
    if (contactForm) {
      contactForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var alertEl = document.getElementById('contact-alert');
        var btn     = contactForm.querySelector('[type="submit"]');
        btn.disabled    = true;
        btn.textContent = 'Sending…';

        var email   = document.getElementById('c-email').value.trim();
        var subject = document.getElementById('c-subject').value.trim();
        var message = document.getElementById('c-message').value.trim();

        if (supabase) {
          var user   = await Auth.getUser();
          var insert = await supabase.from('contact_messages').insert({
            user_id: user ? user.id : null,
            email:   email,
            subject: subject,
            message: message
          });
          if (insert.error) {
            alertEl.textContent = 'Message could not be sent. Email officialtyzen@gmail.com directly.';
            alertEl.className   = 'auth-alert error visible';
          } else {
            alertEl.textContent = 'Message sent. We’ll reply to ' + email + '.';
            alertEl.className   = 'auth-alert success visible';
            contactForm.reset();
          }
        } else {
          alertEl.textContent = 'For a guaranteed response, email officialtyzen@gmail.com directly.';
          alertEl.className   = 'auth-alert success visible';
        }

        btn.disabled    = false;
        btn.textContent = 'Send Message';
      });
    }
  }

  runRouteGuard();

})();
