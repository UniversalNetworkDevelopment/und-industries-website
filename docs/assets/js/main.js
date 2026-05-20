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
  var SUPABASE_URL      = 'https://wgcgzuflpxijhzlpphab.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2d6dWZscHhpamh6bHBwaGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTc3MTgsImV4cCI6MjA5NDc5MzcxOH0.y96jBpi9ECy1RU76q4AuZQFlqPVrS6CJDwNyx__2K9A';

  var supabase = null;
  if (window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  // Inject offline banner only when backend is unavailable
  if (!supabase) {
    var _banner = document.getElementById('auth-status-banner');
    if (_banner) {
      _banner.className = 'auth-offline-banner';
      _banner.setAttribute('role', 'alert');
      _banner.innerHTML = '<strong>Authentication is currently offline.</strong> This feature activates once the backend is connected. No data is stored or transmitted right now.';
    }
  }

  // ── Auth ─────────────────────────────────────────────────
  var Auth = {
    register: async function (email, password, displayName) {
      if (!supabase) return { ok: false, msg: 'Registration is currently unavailable.' };
      var base = window.location.origin + (window.location.pathname.includes('und-industries-website') ? '/und-industries-website' : '');
      var res = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: base + '/dashboard.html'
        }
      });
      if (res.error) return { ok: false, msg: res.error.message };
      return { ok: true, needsVerification: !res.data.session };
    },

    login: async function (email, password) {
      if (!supabase) return { ok: false, msg: 'Login is currently unavailable.' };
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
      if (!supabase) return { ok: false, msg: 'Password reset is currently unavailable.' };
      var redirectUrl = window.location.origin + (window.location.pathname.includes('und-industries-website') ? '/und-industries-website' : '') + '/reset-password.html';
      var res = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
      if (res.error) return { ok: false, msg: res.error.message };
      return { ok: true };
    },

    updateProfile: async function (displayName) {
      if (!supabase) return { ok: false, msg: 'Profile editing is currently unavailable.' };
      var sessionRes = await supabase.auth.getSession();
      if (!sessionRes.data.session) return { ok: false, msg: 'Not signed in.' };
      var uid = sessionRes.data.session.user.id;
      var res = await supabase.from('profiles').update({ display_name: displayName }).eq('id', uid);
      if (res.error) return { ok: false, msg: res.error.message };
      return { ok: true };
    }
  };

  // ── Rate limiting ─────────────────────────────────────────
  // Client-side cooldown via sessionStorage. Prevents rapid-fire submissions.
  // Not a substitute for server-side rate limits in Supabase project settings.
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

  // ── HTML escaping ─────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Owner contact inbox ───────────────────────────────────
  // Requires RLS SELECT policy for owner on contact_messages:
  //   CREATE POLICY "owner_select_contact_messages"
  //   ON public.contact_messages FOR SELECT
  //   USING (EXISTS (
  //     SELECT 1 FROM public.profiles
  //     WHERE profiles.id = auth.uid() AND profiles.role = 'owner'
  //   ));
  function loadInbox() {
    var inboxEl = document.getElementById('admin-inbox');
    if (!inboxEl || !supabase) return;

    supabase
      .from('contact_messages')
      .select('id, name, email, subject, message, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(function (res) {
        if (res.error) {
          inboxEl.innerHTML = '<p class="inbox-empty">Messages could not be loaded. Ensure the owner SELECT policy is configured in Supabase.</p>';
          inboxEl.className = 'inbox-placeholder';
          return;
        }
        if (!res.data || res.data.length === 0) {
          inboxEl.innerHTML = '<p class="inbox-empty">No messages yet.</p>';
          inboxEl.className = 'inbox-placeholder';
          return;
        }
        var html = res.data.map(function (msg) {
          var date = new Date(msg.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          });
          return '<div class="inbox-message">' +
            '<div class="inbox-message-header">' +
              '<span class="inbox-message-from">' + escapeHtml(msg.name || 'Anonymous') + '</span>' +
              '<span class="inbox-message-email">' + escapeHtml(msg.email) + '</span>' +
              '<span class="inbox-message-date">' + date + '</span>' +
            '</div>' +
            '<div class="inbox-message-subject">' + escapeHtml(msg.subject) + '</div>' +
            '<div class="inbox-message-body">' + escapeHtml(msg.message) + '</div>' +
          '</div>';
        }).join('');
        inboxEl.innerHTML = html;
        inboxEl.className = 'inbox-list';
      });
  }

  function initPage() {

    // ── Recovery token detection (reset-password.html) ───────
    // Supabase appends #access_token=...&type=recovery to the reset email link.
    // Detect this hash, swap UI to "set new password" mode, and exchange the token.
    var resetRequestWrap = document.getElementById('reset-request-wrap');
    var resetSetWrap     = document.getElementById('reset-set-wrap');

    if (resetRequestWrap && resetSetWrap) {
      var hashParams   = new URLSearchParams(window.location.hash.substring(1));
      var isRecovery   = hashParams.get('type') === 'recovery';
      var accessToken  = hashParams.get('access_token');
      var refreshToken = hashParams.get('refresh_token') || '';

      if (isRecovery) {
        resetRequestWrap.hidden = true;
        resetSetWrap.removeAttribute('hidden');

        var setAlertEl   = document.getElementById('set-password-alert');
        var setSubmitBtn = document.getElementById('set-password-submit');

        if (!supabase || !accessToken) {
          setAlertEl.textContent = 'This reset link is invalid or has expired. Please request a new one.';
          setAlertEl.className   = 'auth-alert error visible';
          if (setSubmitBtn) setSubmitBtn.disabled = true;
        } else {
          supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
            .then(function (res) {
              if (res.error) {
                setAlertEl.textContent = 'This reset link has expired or has already been used. Please request a new one.';
                setAlertEl.className   = 'auth-alert error visible';
                if (setSubmitBtn) setSubmitBtn.disabled = true;
              }
            });
        }
      }
    }

    // ── Set new password form ────────────────────────────────
    var setPasswordForm = document.getElementById('set-password-form');
    if (setPasswordForm) {
      setPasswordForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var alertEl  = document.getElementById('set-password-alert');
        var btn      = document.getElementById('set-password-submit');
        var password = document.getElementById('new-password').value;
        var confirm  = document.getElementById('confirm-new-password').value;

        if (!supabase) {
          alertEl.textContent = 'Authentication service is unavailable. Please try again later.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        if (password.length < 8) {
          alertEl.textContent = 'Password must be at least 8 characters.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        if (password !== confirm) {
          alertEl.textContent = 'Passwords do not match.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        btn.disabled    = true;
        btn.textContent = 'Updating…';

        var result = await supabase.auth.updateUser({ password: password });

        btn.disabled    = false;
        btn.textContent = 'Set Password';

        if (result.error) {
          alertEl.textContent = result.error.message || 'Could not update password. Please request a new reset link.';
          alertEl.className   = 'auth-alert error visible';
        } else {
          alertEl.textContent = 'Password updated. Redirecting to sign in…';
          alertEl.className   = 'auth-alert success visible';
          await supabase.auth.signOut();
          setTimeout(function () { window.location.href = 'login.html'; }, 2000);
        }
      });
    }

    // ── Login form ──────────────────────────────────────────
    var loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var alertEl = document.getElementById('login-alert');
        var btn     = loginForm.querySelector('[type="submit"]');

        if (!applyRateLimit('login', 30000)) {
          alertEl.textContent = 'Please wait before trying again.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

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

        if (password.length < 8) {
          alertEl.textContent = 'Password must be at least 8 characters.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        if (password !== confirm) {
          alertEl.textContent = 'Passwords do not match.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        if (!applyRateLimit('register', 30000)) {
          alertEl.textContent = 'Please wait before trying again.';
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

    if (backendStatusEl) {
      if (supabase) {
        backendStatusEl.innerHTML = '<span class="backend-dot online"></span> Backend connected';
        backendStatusEl.classList.add('online');
      } else {
        backendStatusEl.innerHTML = '<span class="backend-dot"></span> Backend offline — authentication and data storage are not yet active';
      }
    }

    if (userNameEl || adminSection || profileEditWrap) {
      Auth.getProfile().then(function (profile) {
        if (profile) {
          if (userNameEl) userNameEl.textContent = profile.display_name || 'Studio';
          if (roleBadgeEl) {
            roleBadgeEl.textContent = profile.role === 'owner' ? 'Owner' : 'Member';
            roleBadgeEl.className   = 'role-badge ' + (profile.role === 'owner' ? 'role-badge-owner' : 'role-badge-member');
            roleBadgeEl.removeAttribute('hidden');
          }
          if (adminSection && profile.role === 'owner') {
            adminSection.removeAttribute('hidden');
            loadInbox();
          }
          if (profileEditWrap) profileEditWrap.removeAttribute('hidden');
        } else if (profileEditWrap && supabase) {
          // Auth is live but profile row is missing (trigger may not have fired).
          profileEditWrap.removeAttribute('hidden');
        }
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

    // ── Reset password request form ───────────────────────────
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
    var contactForm = document.getElementById('contact-form');
    if (contactForm) {
      var contactOfflineEl = document.getElementById('contact-offline-notice');
      if (!supabase && contactOfflineEl) {
        contactOfflineEl.hidden = false;
        var submitBtn = contactForm.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
      }

      contactForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var alertEl = document.getElementById('contact-alert');
        var btn     = contactForm.querySelector('[type="submit"]');

        if (!supabase) {
          alertEl.textContent = 'This form is currently offline. Please email us directly.';
          alertEl.className   = 'auth-alert offline visible';
          return;
        }

        if (!applyRateLimit('contact', 60000)) {
          alertEl.textContent = 'Please wait a moment before sending another message.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        btn.disabled    = true;
        btn.textContent = 'Sending…';

        var name    = document.getElementById('c-name').value.trim();
        var email   = document.getElementById('c-email').value.trim();
        var subject = document.getElementById('c-subject').value.trim();
        var message = document.getElementById('c-message').value.trim();

        var user   = await Auth.getUser();
        var insert = await supabase.from('contact_messages').insert({
          user_id: user ? user.id : null,
          name:    name,
          email:   email,
          subject: subject,
          message: message
        });

        btn.disabled    = false;
        btn.textContent = 'Send Message';

        if (insert.error) {
          alertEl.textContent = 'Message could not be sent. Please email us directly.';
          alertEl.className   = 'auth-alert error visible';
        } else {
          alertEl.textContent = 'Message sent. We\'ll reply to ' + escapeHtml(email) + ' soon.';
          alertEl.className   = 'auth-alert success visible';
          contactForm.reset();
        }
      });
    }
  }

  runRouteGuard();

})();
