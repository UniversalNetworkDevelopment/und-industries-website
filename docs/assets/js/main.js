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

  var body = document.body;

  // ── Supabase ──────────────────────────────────────────────
  var SUPABASE_URL      = 'https://wgcgzuflpxijhzlpphab.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2d6dWZscHhpamh6bHBwaGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTc3MTgsImV4cCI6MjA5NDc5MzcxOH0.y96jBpi9ECy1RU76q4AuZQFlqPVrS6CJDwNyx__2K9A';

  var supabase = null;
  if (window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Auth state listener — handles recovery and verification flows.
    // Registered before runRouteGuard() so it catches events fired during getSession().
    supabase.auth.onAuthStateChange(function (event, session) {

      // Password reset: hide request form, show set-password form.
      if (event === 'PASSWORD_RECOVERY') {
        var reqWrap = document.getElementById('reset-request-wrap');
        var setWrap = document.getElementById('reset-set-wrap');
        if (reqWrap && setWrap) {
          // On reset-password.html — show the form directly.
          // Flag this as an incomplete recovery so the route guard can block
          // access to protected pages if the user navigates away without
          // actually setting a new password.
          sessionStorage.setItem('und_recovery_pending', '1');
          reqWrap.hidden = true;
          setWrap.removeAttribute('hidden');
          body.classList.remove('auth-loading');
        } else {
          // On another page (e.g. verified.html caught a recovery code forwarded
          // from the homepage). Set a flag so reset-password.html can show the
          // form on arrival, then navigate there.
          sessionStorage.setItem('und_pwd_recovery', '1');
          window.location.replace('reset-password.html');
        }
      }

      // A normal sign-in clears any stale recovery flag so a user who
      // previously abandoned a reset flow can log in and navigate freely.
      if (event === 'SIGNED_IN') {
        sessionStorage.removeItem('und_recovery_pending');
        var pendingEl = document.getElementById('verified-pending');
        var successEl = document.getElementById('verified-success');
        if (pendingEl && successEl) {
          pendingEl.hidden = true;
          successEl.removeAttribute('hidden');
          body.classList.remove('auth-loading');
        }
      }
    });
  }

  // On reset-password.html with a recovery code in the URL, hide the page until
  // the PASSWORD_RECOVERY event fires so the request form never flashes.
  if (document.getElementById('reset-request-wrap') &&
      new URLSearchParams(window.location.search).get('code')) {
    body.classList.add('auth-loading');
  }

  // On verified.html with a verification code in the URL, hide the page until
  // the SIGNED_IN event fires.
  if (document.getElementById('verified-pending') &&
      new URLSearchParams(window.location.search).get('code')) {
    body.classList.add('auth-loading');
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
      var res = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: 'https://wyrmm999.github.io/und-industries-website/verified.html'
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
      var redirectUrl = 'https://wyrmm999.github.io/und-industries-website/reset-password.html';
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
    },

    getDataMode: async function () {
      if (!supabase) return 'standard';
      var sessionRes = await supabase.auth.getSession();
      if (!sessionRes.data.session) return 'standard';
      var uid = sessionRes.data.session.user.id;
      var res = await supabase.from('profiles').select('data_mode').eq('id', uid).single();
      return (res.data && res.data.data_mode) ? res.data.data_mode : 'standard';
    },

    setDataMode: async function (mode) {
      if (!supabase) return { ok: false, msg: 'Unavailable.' };
      var sessionRes = await supabase.auth.getSession();
      if (!sessionRes.data.session) return { ok: false, msg: 'Not signed in.' };
      var uid = sessionRes.data.session.user.id;
      var res = await supabase.from('profiles').update({ data_mode: mode }).eq('id', uid);
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
  var isProtected = body.dataset.protected === 'true';
  var isAuthPage  = body.dataset.authPage  === 'true';

  if (isProtected || isAuthPage) {
    body.classList.add('auth-loading');
  }

  async function runRouteGuard() {
    var loggedIn = await Auth.isLoggedIn();

    // If a recovery session is active but the user navigated away from the
    // reset-password page without completing the password update, the recovery
    // session must not grant access to the rest of the site.
    // Sign them out and send them back to finish (or abandon) the reset.
    if (loggedIn && sessionStorage.getItem('und_recovery_pending') === '1') {
      var onResetPage = !!document.getElementById('reset-request-wrap');
      if (!onResetPage) {
        sessionStorage.removeItem('und_recovery_pending');
        if (supabase) await supabase.auth.signOut();
        window.location.href = 'reset-password.html';
        return;
      }
    }

    if (isProtected && !loggedIn) {
      window.location.href = 'login.html';
      return;
    }
    if (isAuthPage && loggedIn) {
      window.location.href = 'dashboard.html';
      return;
    }

    body.classList.remove('auth-loading');
    updateNavAuth(loggedIn);
    initPage();
  }

  // ── Nav auth state ────────────────────────────────────────
  function updateNavAuth(loggedIn) {
    var navCta = document.querySelector('.nav-cta');
    if (!navCta) return;
    navCta.innerHTML = loggedIn
      ? '<a href="dashboard.html" class="btn btn-outline btn-sm">Dashboard</a>'
      : '<a href="login.html" class="btn btn-outline btn-sm">Login</a>';
  }

  // ── Tab switching (dashboard) ─────────────────────────────
  function initTabs() {
    var allTabBtns = document.querySelectorAll('.sidebar-tab-btn, .dash-tab-btn');
    var panels     = document.querySelectorAll('.dash-tab-content');
    if (!panels.length) return;

    function switchTab(tabName) {
      panels.forEach(function (p) {
        p.hidden = (p.id !== 'tab-' + tabName);
      });
      allTabBtns.forEach(function (btn) {
        var active = btn.dataset.tab === tabName;
        btn.classList.toggle('active', active);
        if (btn.hasAttribute('aria-selected')) {
          btn.setAttribute('aria-selected', String(active));
        }
      });
    }

    allTabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!btn.hidden) switchTab(btn.dataset.tab);
      });
    });
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

  // ── Owner stats ──────────────────────────────────────────
  function loadOwnerStats() {
    var statsRow   = document.getElementById('owner-stats-row');
    var statInbox  = document.getElementById('owner-stat-inbox');
    var statAuth   = document.getElementById('owner-stat-auth');
    var statUsers  = document.getElementById('owner-stat-users');
    var statActive = document.getElementById('owner-stat-active');
    if (!statsRow) return;

    statsRow.removeAttribute('hidden');
    if (statAuth) statAuth.textContent = supabase ? 'Connected' : 'Offline';
    if (!supabase) return;

    if (statInbox) {
      supabase
        .from('contact_messages')
        .select('id', { count: 'exact', head: true })
        .then(function (res) {
          statInbox.textContent = res.error ? '—' : String(res.count || 0);
        });
    }

    if (statUsers) {
      supabase.rpc('count_total_users').then(function (res) {
        statUsers.textContent = (res.error || res.data === null) ? '—' : String(res.data);
      });
    }

    if (statActive) {
      supabase.rpc('count_active_users', { minutes_ago: 10 }).then(function (res) {
        statActive.textContent = (res.error || res.data === null) ? '—' : String(res.data);
      });
    }
  }

  // ── Chat ──────────────────────────────────────────────────
  // Reads/writes public.chat_messages (room='general').
  // No realtime yet — load on open + manual refresh button.
  var Chat = {
    render: function (messages) {
      var container = document.getElementById('chat-messages');
      if (!container) return;
      if (!messages || messages.length === 0) {
        container.innerHTML = '<p class="chat-empty">No messages yet. Be the first.</p>';
        return;
      }
      container.innerHTML = messages.map(function (msg) {
        var time = new Date(msg.created_at).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit'
        });
        var date = new Date(msg.created_at).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric'
        });
        return '<div class="chat-message">' +
          '<div class="chat-message-header">' +
            '<span class="chat-message-name">' + escapeHtml(msg.display_name || 'Anonymous') + '</span>' +
            '<span class="chat-message-time">' + escapeHtml(date + ' ' + time) + '</span>' +
          '</div>' +
          '<div class="chat-message-text">' + escapeHtml(msg.content) + '</div>' +
        '</div>';
      }).join('');
      container.scrollTop = container.scrollHeight;
    },

    load: function () {
      if (!supabase) return;
      supabase
        .from('chat_messages')
        .select('id, display_name, content, created_at')
        .eq('room', 'general')
        .order('created_at', { ascending: true })
        .limit(50)
        .then(function (res) {
          if (!res.error) Chat.render(res.data);
        });
    },

    send: async function (content, displayName) {
      if (!supabase) return { ok: false, msg: 'Chat unavailable.' };
      var sessionRes = await supabase.auth.getSession();
      if (!sessionRes.data.session) return { ok: false, msg: 'Not signed in.' };
      var res = await supabase.from('chat_messages').insert({
        user_id:      sessionRes.data.session.user.id,
        display_name: displayName || 'Anonymous',
        room:         'general',
        content:      content
      });
      if (res.error) return { ok: false, msg: res.error.message };
      return { ok: true };
    }
  };

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

    // ── Recovery redirect fallback ───────────────────────────
    // Set when PASSWORD_RECOVERY fires on a non-reset page (e.g. verified.html
    // received a recovery code forwarded from the homepage). The recovery session
    // is already established in localStorage so updateUser() will succeed.
    var recoveryFlag = sessionStorage.getItem('und_pwd_recovery');
    if (recoveryFlag) {
      sessionStorage.removeItem('und_pwd_recovery');
      var recReq = document.getElementById('reset-request-wrap');
      var recSet = document.getElementById('reset-set-wrap');
      if (recReq && recSet) {
        recReq.hidden = true;
        recSet.removeAttribute('hidden');
      }
    }

    // ── Verified page fallback (no session in this browser) ──
    var pendingEl  = document.getElementById('verified-pending');
    var nosessionEl = document.getElementById('verified-nosession');
    if (pendingEl && nosessionEl) {
      // If SIGNED_IN event already fired, this block is never reached.
      // Only runs when the page loaded without a ?code (different browser).
      pendingEl.hidden = true;
      nosessionEl.removeAttribute('hidden');
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
          sessionStorage.removeItem('und_recovery_pending');
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
          var loginMsg = result.msg;
          if (/invalid login credentials/i.test(loginMsg)) {
            loginMsg = 'Incorrect email or password. If you just registered, check your email to verify your account first.';
          } else if (/email not confirmed/i.test(loginMsg)) {
            loginMsg = 'Please verify your email before signing in. Check your inbox for the confirmation link.';
          }
          alertEl.textContent = loginMsg;
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

    // ── Dashboard tabs + profile + role-based UI ────────────
    initTabs();

    var userNameEl      = document.getElementById('dashboard-user-name');
    var roleBadgeEl     = document.getElementById('dashboard-role-badge');
    var profileEditWrap = document.getElementById('profile-edit-wrap');
    var backendStatusEl = document.getElementById('backend-status-bar');
    var sidebarAdminBtn = document.getElementById('sidebar-tab-admin');
    var mobileAdminBtn  = document.getElementById('mobile-tab-admin');

    if (backendStatusEl) {
      if (supabase) {
        backendStatusEl.innerHTML = '<span class="backend-dot online"></span> Connected';
        backendStatusEl.classList.add('online');
      } else {
        backendStatusEl.innerHTML = '<span class="backend-dot"></span> Offline';
      }
    }

    if (userNameEl || profileEditWrap || sidebarAdminBtn) {
      Auth.getProfile().then(async function (profile) {
        var user        = await Auth.getUser();
        var isOwner     = profile && profile.role === 'owner';
        var displayName = (profile && profile.display_name) || 'Studio';
        var currentMode = (profile && profile.data_mode) || 'standard';

        // Header: name + role badge
        if (userNameEl) userNameEl.textContent = displayName;
        if (roleBadgeEl) {
          roleBadgeEl.textContent = isOwner ? 'Owner' : 'Member';
          roleBadgeEl.className   = 'role-badge ' + (isOwner ? 'role-badge-owner' : 'role-badge-member');
          roleBadgeEl.removeAttribute('hidden');
        }

        // Account info panel (settings tab)
        var emailEl     = document.getElementById('account-email-display');
        var roleEl      = document.getElementById('account-role-display');
        var acctModeEl  = document.getElementById('account-mode-display');
        if (emailEl)    emailEl.textContent    = (user && user.email) ? user.email : '—';
        if (roleEl)     roleEl.textContent     = isOwner ? 'Owner' : 'Member';
        if (acctModeEl) acctModeEl.textContent = currentMode === 'advanced' ? 'Advanced' : 'Standard';

        // Pre-fill display name input
        var nameInput = document.getElementById('profile-display-name');
        if (nameInput && profile) nameInput.value = profile.display_name || '';

        // Admin tab — owner only
        if (isOwner) {
          if (sidebarAdminBtn) sidebarAdminBtn.removeAttribute('hidden');
          if (mobileAdminBtn)  mobileAdminBtn.removeAttribute('hidden');
          loadOwnerStats();
          loadInbox();
        }

        // Update last_seen
        if (supabase && user) {
          supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', user.id);
        }

        // Settings: data mode toggle
        if (supabase) {
          var stdBtn   = document.getElementById('settings-mode-standard');
          var advBtn   = document.getElementById('settings-mode-advanced');
          var setAlert = document.getElementById('settings-alert');

          function applyModeUI(mode) {
            if (stdBtn) stdBtn.classList.toggle('active', mode === 'standard');
            if (advBtn) advBtn.classList.toggle('active', mode === 'advanced');
            var curModeEl   = document.getElementById('settings-current-mode');
            var acctModeEl2 = document.getElementById('account-mode-display');
            if (curModeEl)   curModeEl.textContent   = mode === 'advanced' ? 'Advanced' : 'Standard';
            if (acctModeEl2) acctModeEl2.textContent = mode === 'advanced' ? 'Advanced' : 'Standard';
          }
          applyModeUI(currentMode);

          function handleModeBtn(btn) {
            if (!btn) return;
            btn.addEventListener('click', async function () {
              var chosen = btn.dataset.mode;
              if (btn.classList.contains('active')) return;
              var result = await Auth.setDataMode(chosen);
              if (result.ok) {
                applyModeUI(chosen);
                if (setAlert) {
                  setAlert.textContent = chosen === 'advanced'
                    ? 'Advanced mode enabled.'
                    : 'Standard mode enabled.';
                  setAlert.className = 'auth-alert success visible';
                  setTimeout(function () { setAlert.className = 'auth-alert'; }, 3000);
                }
              } else {
                if (setAlert) {
                  setAlert.textContent = result.msg || 'Could not save setting.';
                  setAlert.className = 'auth-alert error visible';
                }
              }
            });
          }
          handleModeBtn(stdBtn);
          handleModeBtn(advBtn);

          // Chat: wire form in its own tab
          Chat.load();
          var chatForm    = document.getElementById('chat-form');
          var chatInput   = document.getElementById('chat-input');
          var chatAlert   = document.getElementById('chat-alert');
          var chatRefresh = document.getElementById('chat-refresh');

          if (chatRefresh) {
            chatRefresh.addEventListener('click', function () { Chat.load(); });
          }

          if (chatForm) {
            chatForm.addEventListener('submit', async function (e) {
              e.preventDefault();
              var content = chatInput ? chatInput.value.trim() : '';
              if (!content) return;

              if (!applyRateLimit('chat-send', 3000)) {
                if (chatAlert) {
                  chatAlert.textContent = 'Slow down — one message at a time.';
                  chatAlert.className   = 'auth-alert error visible';
                  setTimeout(function () { chatAlert.className = 'auth-alert'; }, 2000);
                }
                return;
              }

              var result = await Chat.send(content, displayName);
              if (result.ok) {
                if (chatInput) chatInput.value = '';
                if (chatAlert) chatAlert.className = 'auth-alert';
                Chat.load();
              } else {
                if (chatAlert) {
                  chatAlert.textContent = result.msg || 'Message could not be sent.';
                  chatAlert.className   = 'auth-alert error visible';
                }
              }
            });
          }
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

    // ── Change password form (dashboard settings tab) ────────
    var changePasswordForm = document.getElementById('change-password-form');
    if (changePasswordForm) {
      changePasswordForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var alertEl = document.getElementById('change-password-alert');
        var btn     = document.getElementById('change-password-submit');
        var newPwd  = document.getElementById('change-new-password').value;
        var confirm = document.getElementById('change-confirm-password').value;

        if (!supabase) {
          alertEl.textContent = 'Authentication service is unavailable.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }
        if (newPwd.length < 8) {
          alertEl.textContent = 'Password must be at least 8 characters.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }
        if (newPwd !== confirm) {
          alertEl.textContent = 'Passwords do not match.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }
        if (!applyRateLimit('change-password', 30000)) {
          alertEl.textContent = 'Please wait before trying again.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        btn.disabled    = true;
        btn.textContent = 'Updating…';

        var result = await supabase.auth.updateUser({ password: newPwd });

        btn.disabled    = false;
        btn.textContent = 'Update Password';

        if (result.error) {
          alertEl.textContent = result.error.message || 'Could not update password.';
          alertEl.className   = 'auth-alert error visible';
        } else {
          alertEl.textContent = 'Password updated successfully.';
          alertEl.className   = 'auth-alert success visible';
          changePasswordForm.reset();
          setTimeout(function () { alertEl.className = 'auth-alert'; }, 4000);
        }
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
