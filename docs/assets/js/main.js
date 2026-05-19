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
    },

    requestPasswordReset: async function (email) {
      if (!supabase) return { ok: false, msg: 'Password reset is not yet available. Email officialtyzen@gmail.com for account help.' };
      var redirectUrl = window.location.origin + (window.location.pathname.includes('und-industries-website') ? '/und-industries-website' : '') + '/reset-password.html';
      var res = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
      if (res.error) return { ok: false, msg: res.error.message };
      return { ok: true };
    },

    updateProfile: async function (displayName) {
      if (!supabase) return { ok: false, msg: 'Profile editing is not yet available.' };
      var sessionRes = await supabase.auth.getSession();
      if (!sessionRes.data.session) return { ok: false, msg: 'Not signed in.' };
      var uid = sessionRes.data.session.user.id;
      var res = await supabase.from('profiles').update({ display_name: displayName }).eq('id', uid);
      if (res.error) return { ok: false, msg: res.error.message };
      return { ok: true };
    }
  };

  // ── Rate limiting (placeholder) ───────────────────────────
  // TODO: Implement per-form submission rate limiting before going to production.
  // Suggested approach: track last submission timestamp per form ID in sessionStorage.
  // Reject submissions within a configurable cooldown window (e.g. 30s for contact, 5s for auth).
  // Server-side: configure Supabase Auth rate limits in project settings (default: 3 signups/hour per IP).
  function applyRateLimit(formId, cooldownMs) {
    var key     = 'ratelimit_' + formId;
    var lastStr = sessionStorage.getItem(key);
    var now     = Date.now();
    if (lastStr && now - parseInt(lastStr, 10) < cooldownMs) {
      return false; // blocked
    }
    sessionStorage.setItem(key, String(now));
    return true; // allowed
  }

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
    var userNameEl      = document.getElementById('dashboard-user-name');
    var roleBadgeEl     = document.getElementById('dashboard-role-badge');
    var adminSection    = document.getElementById('admin-section');
    var profileEditWrap = document.getElementById('profile-edit-wrap');
    var backendStatusEl = document.getElementById('backend-status-bar');

    // Show backend connection status
    if (backendStatusEl) {
      if (supabase) {
        backendStatusEl.innerHTML = '<span class="backend-dot online"></span> Backend connected';
        backendStatusEl.style.background    = 'rgba(16,185,129,0.06)';
        backendStatusEl.style.borderColor   = 'rgba(16,185,129,0.2)';
        backendStatusEl.style.color         = '#6ee7b7';
      } else {
        backendStatusEl.innerHTML = '<span class="backend-dot"></span> Backend offline — authentication and data storage are not yet active';
      }
    }

    if (userNameEl || adminSection || profileEditWrap) {
      Auth.getProfile().then(function (profile) {
        if (profile) {
          if (userNameEl) userNameEl.textContent = profile.display_name || 'Studio';
          if (roleBadgeEl) {
            roleBadgeEl.textContent  = profile.role === 'owner' ? 'Owner' : 'Member';
            roleBadgeEl.className    = 'role-badge ' + (profile.role === 'owner' ? 'role-badge-owner' : 'role-badge-member');
            roleBadgeEl.removeAttribute('hidden');
          }
          if (adminSection && profile.role === 'owner') {
            adminSection.removeAttribute('hidden');
          }
        }
        // Show profile edit section once we know auth is live
        if (profileEditWrap) profileEditWrap.removeAttribute('hidden');
      });
    }

    // ── Profile edit form ────────────────────────────────────
    var profileForm = document.getElementById('profile-edit-form');
    if (profileForm) {
      profileForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var alertEl     = document.getElementById('profile-edit-alert');
        var btn         = profileForm.querySelector('[type="submit"]');
        var displayName = document.getElementById('profile-display-name').value.trim();

        btn.disabled    = true;
        btn.textContent = 'Saving…';

        var result = await Auth.updateProfile(displayName);

        btn.disabled    = false;
        btn.textContent = 'Save';

        alertEl.textContent = result.ok ? 'Profile updated.' : result.msg;
        alertEl.className   = 'auth-alert ' + (result.ok ? 'success' : 'error') + ' visible';

        if (result.ok && userNameEl) userNameEl.textContent = displayName || 'Studio';
      });
    }

    // ── Reset password form (reset-password.html) ────────────
    var resetForm = document.getElementById('reset-form');
    if (resetForm) {
      resetForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var alertEl = document.getElementById('reset-alert');
        var btn     = resetForm.querySelector('[type="submit"]');
        var email   = document.getElementById('reset-email').value.trim();

        btn.disabled    = true;
        btn.textContent = 'Sending…';

        var result = await Auth.requestPasswordReset(email);

        btn.disabled    = false;
        btn.textContent = 'Send Reset Link';

        alertEl.textContent = result.ok
          ? 'Reset link sent. Check your inbox (and spam folder).'
          : result.msg;
        alertEl.className = 'auth-alert ' + (result.ok ? 'success' : 'offline') + ' visible';
      });
    }

    // ── Contact form ─────────────────────────────────────────
    var contactForm = document.getElementById(‘contact-form’);
    if (contactForm) {
      // Show offline notice immediately if no backend is connected
      var contactOfflineEl = document.getElementById(‘contact-offline-notice’);
      if (!supabase && contactOfflineEl) {
        contactOfflineEl.hidden = false;
        var submitBtn = contactForm.querySelector(‘[type="submit"]’);
        if (submitBtn) submitBtn.disabled = true;
      }

      contactForm.addEventListener(‘submit’, async function (e) {
        e.preventDefault();
        var alertEl = document.getElementById(‘contact-alert’);
        var btn     = contactForm.querySelector(‘[type="submit"]’);

        if (!supabase) {
          alertEl.textContent = ‘This form is currently offline. Please email officialtyzen@gmail.com directly.’;
          alertEl.className   = ‘auth-alert offline visible’;
          return;
        }

        btn.disabled    = true;
        btn.textContent = ‘Sending…’;

        var email   = document.getElementById(‘c-email’).value.trim();
        var subject = document.getElementById(‘c-subject’).value.trim();
        var message = document.getElementById(‘c-message’).value.trim();

        var user   = await Auth.getUser();
        var insert = await supabase.from(‘contact_messages’).insert({
          user_id: user ? user.id : null,
          email:   email,
          subject: subject,
          message: message
        });

        btn.disabled    = false;
        btn.textContent = ‘Send Message’;

        if (insert.error) {
          alertEl.textContent = ‘Message could not be sent. Please email officialtyzen@gmail.com directly.’;
          alertEl.className   = ‘auth-alert error visible’;
        } else {
          alertEl.textContent = ‘Message sent. We\’ll reply to ‘ + email + ‘ soon.’;
          alertEl.className   = ‘auth-alert success visible’;
          contactForm.reset();
        }
      });
    }
  }

  runRouteGuard();

})();
