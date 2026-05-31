// U.N.D Industries — Main JS
// Real auth via Supabase. The anon key is public by design — Row Level Security
// on the database handles access control. Passwords are hashed server-side.
//
// SETUP: Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values.
// Dashboard → Project Settings → API → "Project URL" + "anon public" key.

(function () {
  'use strict';

  var _lastError = null;

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
          localStorage.setItem('und_recovery_pending', '1');
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
        localStorage.removeItem('und_recovery_pending');
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
  // ── Cloudflare Turnstile helper ───────────────────────────
  // Reads the CAPTCHA token from the widget on the current page.
  // Returns '' if no widget is present (e.g. CAPTCHA not enabled yet).
  function getCaptchaToken() {
    try {
      if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
        return window.turnstile.getResponse() || '';
      }
    } catch (_) {}
    var el = document.querySelector('[name="cf-turnstile-response"]');
    return el ? el.value : '';
  }

  function resetCaptcha() {
    try { if (window.turnstile) window.turnstile.reset(); } catch (_) {}
  }

  var Auth = {
    register: async function (email, password, displayName, captchaToken) {
      if (!supabase) return { ok: false, msg: 'Registration is currently unavailable.' };
      var res = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { display_name: (displayName || '').substring(0, 120) },
          emailRedirectTo: 'https://universalnetworkdevelopment.github.io/und-industries-website/verified.html',
          captchaToken: captchaToken || undefined
        }
      });
      if (res.error) return { ok: false, msg: res.error.message };
      return { ok: true, needsVerification: !res.data.session };
    },

    login: async function (email, password, captchaToken) {
      if (!supabase) return { ok: false, msg: 'Login is currently unavailable.' };
      var res = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
        options: { captchaToken: captchaToken || undefined }
      });
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

    requestPasswordReset: async function (email, captchaToken) {
      if (!supabase) return { ok: false, msg: 'Password reset is currently unavailable.' };
      var redirectUrl = 'https://universalnetworkdevelopment.github.io/und-industries-website/reset-password.html';
      var res = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
        captchaToken: captchaToken || undefined
      });
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
    if (loggedIn && localStorage.getItem('und_recovery_pending') === '1') {
      var onResetPage = !!document.getElementById('reset-request-wrap');
      if (!onResetPage) {
        localStorage.removeItem('und_recovery_pending');
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

    // dashboard-alt keeps auth-loading until the owner check inside initPage() passes
    if (body.dataset.page !== 'dashboard-alt') {
      body.classList.remove('auth-loading');
    }
    updateNavAuth(loggedIn);
    initPage();
  }

  // ── Nav auth state ────────────────────────────────────────
  function updateNavAuth(loggedIn) {
    // Desktop CTA buttons
    var navCta = document.querySelector('.nav-cta');
    if (navCta) {
      navCta.innerHTML = loggedIn
        ? '<a href="dashboard.html" class="btn btn-outline btn-sm">Dashboard</a>'
        : '<a href="login.html" class="btn btn-outline btn-sm">Login</a>' +
          '<a href="register.html" class="btn btn-primary btn-sm">Sign Up</a>';
    }
    // Mobile hamburger menu auth items — keep them in sync with login state
    var mob = document.querySelectorAll('.nav-mobile-auth');
    if (mob.length >= 2) {
      if (loggedIn) {
        mob[0].innerHTML = '<a href="dashboard.html">Dashboard</a>';
        mob[1].innerHTML = '<a href="#" data-action="logout">Sign Out</a>';
      } else {
        mob[0].innerHTML = '<a href="login.html">Login</a>';
        mob[1].innerHTML = '<a href="register.html">Sign Up</a>';
      }
    }
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
  // Render a chat message body: animate GIF/image URLs inline, escape the rest.
  // Only https image/GIF URLs (or known GIF hosts) become <img>; everything
  // else is escaped text — no arbitrary HTML can be injected.
  function renderChatBody(text) {
    var t = String(text || '').trim();
    var isImg =
      /^https:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(t) ||
      /^https:\/\/(media\d*\.giphy\.com|i\.giphy\.com|media\d*\.tenor\.com|c\.tenor\.com|tenor\.com)\/\S+$/i.test(t);
    if (isImg) {
      return '<img class="chat-gif" src="' + escapeHtml(t) + '" alt="GIF" loading="lazy">';
    }
    return '<span class="chat-bubble-text">' + escapeHtml(text) + '</span>';
  }

  function chatAvatar(name) {
    var ch = (String(name || 'A').trim().charAt(0) || 'A').toUpperCase();
    // deterministic hue from the name so each user keeps a consistent color
    var hue = 0, s = String(name || 'A');
    for (var i = 0; i < s.length; i++) hue = (hue * 31 + s.charCodeAt(i)) % 360;
    return '<span class="chat-avatar" style="background:hsl(' + hue + ',55%,45%)">' + escapeHtml(ch) + '</span>';
  }

  var Chat = {
    currentUserId: null,

    render: function (messages) {
      var container = document.getElementById('chat-messages');
      if (!container) return;
      if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="chat-empty"><span class="chat-empty-icon">💬</span><p>No messages yet.<br>Be the first to say something.</p></div>';
        return;
      }
      var lastDay = '';
      container.innerHTML = messages.map(function (msg) {
        var d    = new Date(msg.created_at);
        var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        var day  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        var own  = msg.user_id && msg.user_id === Chat.currentUserId;
        var sep  = '';
        if (day !== lastDay) { lastDay = day; sep = '<div class="chat-day-sep"><span>' + escapeHtml(day) + '</span></div>'; }
        return sep +
          '<div class="chat-row' + (own ? ' chat-row-own' : '') + '">' +
            (own ? '' : chatAvatar(msg.display_name)) +
            '<div class="chat-bubble-wrap">' +
              (own ? '' : '<span class="chat-bubble-name">' + escapeHtml(msg.display_name || 'Anonymous') + '</span>') +
              '<div class="chat-bubble">' + renderChatBody(msg.content) + '</div>' +
              '<span class="chat-bubble-time">' + escapeHtml(time) + '</span>' +
            '</div>' +
          '</div>';
      }).join('');
      container.scrollTop = container.scrollHeight;
    },

    load: function () {
      if (!supabase) return;
      supabase
        .from('chat_messages')
        .select('id, user_id, display_name, content, created_at')
        .eq('room', 'general')
        .order('created_at', { ascending: true })
        .limit(80)
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
          _trackError('Inbox load: ' + res.error.message);
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

  function _trackError(msg) {
    _lastError = msg;
    var errEl = document.getElementById('op-stat-error');
    if (errEl) errEl.textContent = msg || 'None';
  }

  // ── Owner chat moderation ─────────────────────────────────
  function loadOwnerChatMod() {
    var listEl = document.getElementById('owner-chat-mod');
    if (!listEl || !supabase) return;
    listEl.innerHTML = '<p class="inbox-empty">Loading…</p>';

    supabase
      .from('chat_messages')
      .select('id, display_name, content, created_at, user_id')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(function (res) {
        if (res.error) {
          _trackError('Chat load: ' + res.error.message);
          listEl.innerHTML = '<p class="inbox-empty">Could not load messages.</p>';
          return;
        }
        if (!res.data || res.data.length === 0) {
          listEl.innerHTML = '<p class="inbox-empty">No messages.</p>';
          return;
        }
        listEl.innerHTML = '';
        res.data.forEach(function (msg) {
          var time = new Date(msg.created_at).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          var row = document.createElement('div');
          row.className = 'owner-chat-row';
          row.dataset.id = msg.id;
          row.innerHTML =
            '<div class="owner-chat-meta">' +
              '<span class="owner-chat-name">' + escapeHtml(msg.display_name || 'Anonymous') + '</span>' +
              '<span class="owner-chat-time">' + time + '</span>' +
            '</div>' +
            '<div class="owner-chat-body">' + escapeHtml(msg.content) + '</div>' +
            '<button type="button" class="btn-danger-sm op-delete-chat">Delete</button>';
          row.querySelector('.op-delete-chat').addEventListener('click', function () {
            deleteOwnerChat(msg.id, row);
          });
          listEl.appendChild(row);
        });
      });
  }

  function deleteOwnerChat(msgId, rowEl) {
    if (!supabase) return;
    if (!confirm('Delete this message permanently?')) return;
    supabase
      .from('chat_messages')
      .delete()
      .eq('id', msgId)
      .then(function (res) {
        if (res.error) {
          _trackError('Delete: ' + res.error.message);
          if (rowEl && rowEl.parentNode) {
            var errMsg = document.createElement('p');
            errMsg.className = 'owner-row-error';
            errMsg.textContent = 'Delete failed.';
            rowEl.parentNode.insertBefore(errMsg, rowEl.nextSibling);
            setTimeout(function () { if (errMsg.parentNode) errMsg.remove(); }, 4000);
          }
          return;
        }
        if (rowEl && rowEl.parentNode) rowEl.remove();
      });
  }

  // ── Owner system status ───────────────────────────────────
  function loadSystemStatus() {
    var backendEl = document.getElementById('op-stat-backend');
    var dbEl      = document.getElementById('op-stat-db');
    var errEl     = document.getElementById('op-stat-error');
    if (errEl) errEl.textContent = _lastError || 'None';
    if (!supabase) {
      if (backendEl) { backendEl.textContent = 'Unavailable'; backendEl.className = 'owner-status-val status-err'; }
      if (dbEl)      { dbEl.textContent = 'Unavailable';      dbEl.className = 'owner-status-val status-err'; }
      return;
    }
    if (backendEl) { backendEl.textContent = 'Connected'; backendEl.className = 'owner-status-val status-ok'; }
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .then(function (res) {
        if (res.error) {
          if (dbEl) { dbEl.textContent = 'Error'; dbEl.className = 'owner-status-val status-err'; }
          _trackError('DB check: ' + res.error.message);
        } else {
          if (dbEl) { dbEl.textContent = 'OK'; dbEl.className = 'owner-status-val status-ok'; }
        }
      });
  }

  // ── Promo Links — public page loader ──────────────────────
  // Called on home / music / contact pages to display active promos.
  function loadPromoLinks(pageLocation, containerId, sectionId) {
    if (!supabase) return;
    supabase
      .from('promo_links')
      .select('id, title, url')
      .eq('location', pageLocation)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(6)
      .then(function (res) {
        if (res.error) {
          console.error('[UND promo] query error for "' + pageLocation + '":', res.error.message, res.error);
          return;
        }
        if (!res.data || res.data.length === 0) {
          console.log('[UND promo] no active promos found for "' + pageLocation + '"');
          return;
        }
        var container = document.getElementById(containerId);
        var section   = document.getElementById(sectionId);
        if (!container) {
          console.error('[UND promo] container #' + containerId + ' not found in DOM');
          return;
        }
        container.innerHTML = res.data.map(function (p) {
          if (!/^https?:\/\//i.test(p.url)) return ''; // block javascript: and other non-http URIs
          return '<a href="' + escapeHtml(p.url) + '" class="promo-card" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(p.title) + '</a>';
        }).join('');
        if (section) section.removeAttribute('hidden');
      });
  }

  // ── Owner: Promo & Links panel ────────────────────────────
  function loadOwnerPromo() {
    var listEl = document.getElementById('op-promo-list');
    if (!listEl || !supabase) return;
    listEl.innerHTML = '<p class="inbox-empty">Loading…</p>';
    supabase
      .from('promo_links')
      .select('id, title, url, location, is_active, sort_order')
      .order('location', { ascending: true })
      .order('sort_order', { ascending: true })
      .then(function (res) {
        if (res.error) {
          _trackError('Promo load: ' + res.error.message);
          listEl.innerHTML = '<p class="inbox-empty">Could not load promo links.</p>';
          return;
        }
        if (!res.data || res.data.length === 0) {
          listEl.innerHTML = '<p class="inbox-empty">No promo links yet.</p>';
          return;
        }
        listEl.innerHTML = '';
        res.data.forEach(function (p) {
          var row = document.createElement('div');
          row.className = 'owner-promo-row';
          row.innerHTML =
            '<div class="owner-promo-meta">' +
              '<span class="owner-promo-loc">' + escapeHtml(p.location) + '</span>' +
              '<span class="owner-promo-title">' + escapeHtml(p.title) + '</span>' +
              '<span class="owner-promo-url">' + escapeHtml(p.url) + '</span>' +
              '<span class="owner-promo-order">order: ' + p.sort_order + '</span>' +
            '</div>' +
            '<div class="owner-promo-actions">' +
              '<button type="button" class="owner-promo-toggle op-promo-toggle" data-active="' + p.is_active + '">' +
                (p.is_active ? 'Active' : 'Inactive') +
              '</button>' +
              '<button type="button" class="btn-danger-sm op-promo-delete">Delete</button>' +
            '</div>';
          row.querySelector('.op-promo-toggle').addEventListener('click', function () {
            togglePromoActive(p.id, p.is_active, row);
          });
          row.querySelector('.op-promo-delete').addEventListener('click', function () {
            deletePromoLink(p.id, row);
          });
          listEl.appendChild(row);
        });
      });
  }

  function togglePromoActive(id, currentState, rowEl) {
    if (!supabase) return;
    supabase
      .from('promo_links')
      .update({ is_active: !currentState })
      .eq('id', id)
      .then(function (res) {
        if (res.error) { _trackError('Promo toggle: ' + res.error.message); return; }
        loadOwnerPromo();
      });
  }

  function deletePromoLink(id, rowEl) {
    if (!supabase) return;
    if (!confirm('Delete this promo link permanently?')) return;
    supabase
      .from('promo_links')
      .delete()
      .eq('id', id)
      .then(function (res) {
        if (res.error) {
          _trackError('Promo delete: ' + res.error.message);
          if (rowEl && rowEl.parentNode) {
            var errMsg = document.createElement('p');
            errMsg.className = 'owner-row-error';
            errMsg.textContent = 'Delete failed.';
            rowEl.parentNode.insertBefore(errMsg, rowEl.nextSibling);
            setTimeout(function () { if (errMsg.parentNode) errMsg.remove(); }, 4000);
          }
          return;
        }
        if (rowEl && rowEl.parentNode) rowEl.remove();
      });
  }

  // ── Owner: Feature Flags panel ────────────────────────────
  function loadOwnerFeatureFlags() {
    if (!supabase) return;
    supabase
      .from('feature_flags')
      .select('key, enabled')
      .then(function (res) {
        if (res.error) { _trackError('Flags load: ' + res.error.message); return; }
        if (!res.data) return;
        res.data.forEach(function (flag) {
          var btn = document.querySelector('[data-key="' + flag.key + '"]');
          if (!btn) return;
          btn.dataset.state = flag.enabled ? 'on' : 'off';
          btn.textContent   = flag.enabled ? 'On' : 'Off';
          btn.className     = 'owner-flag-toggle ' + (flag.enabled ? 'flag-on' : 'flag-off');
        });
      });
  }

  function updateFeatureFlag(key, enabled) {
    if (!supabase) return;
    var alertEl = document.getElementById('op-flags-alert');
    supabase
      .from('feature_flags')
      .upsert({ key: key, enabled: enabled })
      .then(function (res) {
        if (res.error) {
          _trackError('Flag update: ' + res.error.message);
          if (alertEl) { alertEl.textContent = 'Could not update flag.'; alertEl.className = 'auth-alert error visible'; setTimeout(function () { alertEl.className = 'auth-alert'; }, 3000); }
          return;
        }
        loadOwnerFeatureFlags();
        if (alertEl) { alertEl.textContent = 'Feature flag updated.'; alertEl.className = 'auth-alert success visible'; setTimeout(function () { alertEl.className = 'auth-alert'; }, 2000); }
      });
  }

  // ── Announcements — member view (dashboard overview) ─────
  function loadAnnouncements() {
    var card   = document.getElementById('announcements-card');
    var listEl = document.getElementById('announcements-list');
    if (!card || !listEl || !supabase) return;
    supabase
      .from('announcements')
      .select('id, title, body, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(function (res) {
        if (res.error || !res.data || res.data.length === 0) return;
        listEl.innerHTML = res.data.map(function (a) {
          var date = new Date(a.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          });
          return '<div class="ann-item">' +
            '<div class="ann-item-header">' +
              '<span class="ann-item-title">' + escapeHtml(a.title) + '</span>' +
              '<span class="ann-item-date">' + date + '</span>' +
            '</div>' +
            '<div class="ann-item-body">' + escapeHtml(a.body) + '</div>' +
          '</div>';
        }).join('');
        card.removeAttribute('hidden');
      });
  }

  // ── Owner: Announcements panel ────────────────────────────
  function loadOwnerAnnouncements() {
    var listEl = document.getElementById('op-ann-list');
    if (!listEl || !supabase) return;
    listEl.innerHTML = '<p class="inbox-empty">Loading…</p>';
    supabase
      .from('announcements')
      .select('id, title, body, created_at, is_active')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(function (res) {
        if (res.error) {
          _trackError('Ann load: ' + res.error.message);
          listEl.innerHTML = '<p class="inbox-empty">Could not load announcements.</p>';
          return;
        }
        if (!res.data || res.data.length === 0) {
          listEl.innerHTML = '<p class="inbox-empty">No announcements yet.</p>';
          return;
        }
        listEl.innerHTML = '';
        res.data.forEach(function (a) {
          var date = new Date(a.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          });
          var row = document.createElement('div');
          row.className = 'owner-ann-row' + (a.is_active ? '' : ' ann-inactive');
          row.innerHTML =
            '<div class="owner-ann-meta">' +
              '<span class="owner-ann-title">' + escapeHtml(a.title) + '</span>' +
              '<span class="owner-ann-date">' + date + '</span>' +
              (a.is_active ? '' : '<span class="owner-ann-badge">Inactive</span>') +
            '</div>' +
            '<div class="owner-ann-body">' + escapeHtml(a.body) + '</div>' +
            '<div class="owner-ann-actions">' +
              (a.is_active ? '<button type="button" class="btn btn-outline btn-sm op-ann-deactivate">Deactivate</button>' : '') +
              '<button type="button" class="btn-danger-sm op-ann-delete">Delete</button>' +
            '</div>';
          if (a.is_active) {
            row.querySelector('.op-ann-deactivate').addEventListener('click', function () {
              deactivateAnnouncement(a.id, row);
            });
          }
          row.querySelector('.op-ann-delete').addEventListener('click', function () {
            deleteAnnouncement(a.id, row);
          });
          listEl.appendChild(row);
        });
      });
  }

  function deactivateAnnouncement(id, rowEl) {
    if (!supabase) return;
    supabase
      .from('announcements')
      .update({ is_active: false })
      .eq('id', id)
      .then(function (res) {
        if (res.error) { _trackError('Ann deactivate: ' + res.error.message); return; }
        loadOwnerAnnouncements();
      });
  }

  function deleteAnnouncement(id, rowEl) {
    if (!supabase) return;
    if (!confirm('Delete this announcement permanently?')) return;
    supabase
      .from('announcements')
      .delete()
      .eq('id', id)
      .then(function (res) {
        if (res.error) {
          _trackError('Ann delete: ' + res.error.message);
          if (rowEl && rowEl.parentNode) {
            var errMsg = document.createElement('p');
            errMsg.className = 'owner-row-error';
            errMsg.textContent = 'Delete failed.';
            rowEl.parentNode.insertBefore(errMsg, rowEl.nextSibling);
            setTimeout(function () { if (errMsg.parentNode) errMsg.remove(); }, 4000);
          }
          return;
        }
        if (rowEl && rowEl.parentNode) rowEl.remove();
      });
  }

  // ── Store — shared state ──────────────────────────────────
  var storeAllProducts = [];
  var storeCategories  = [];
  var storeTags        = [];
  var storeFilter      = { type: 'all', subcats: [], tags: [], search: '' };
  var _storeEditingId  = null; // null = new product, string uuid = editing

  // ── Store — price formatter ───────────────────────────────
  function formatPrice(cents, currency) {
    if (cents === 0) return 'Free';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: currency || 'USD'
      }).format(cents / 100);
    } catch (_) {
      return '$' + (cents / 100).toFixed(2);
    }
  }

  // ── Store — type icon ─────────────────────────────────────
  function storeTypeIcon(type) {
    return { music: '🎵', game: '🎮', software: '💾', story: '📖' }[type] || '📦';
  }

  // ── Store — slug helper ───────────────────────────────────
  function slugify(str) {
    return String(str).toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // ── Store — render grid ───────────────────────────────────
  function renderStoreGrid(products) {
    var grid = document.getElementById('store-grid');
    if (!grid) return;

    if (!products || !products.length) {
      grid.innerHTML = '<p class="store-empty">No products match your filters.</p>';
      return;
    }

    grid.innerHTML = products.map(function (p) {
      var price = formatPrice(p.price_cents, p.currency);
      var cats  = (p.cats || []).map(function (c) {
        return '<span class="store-cat-pill">' + escapeHtml(c.label) + '</span>';
      }).join('');
      var img = p.cover_image_url
        ? '<img src="' + escapeHtml(p.cover_image_url) + '" alt="' + escapeHtml(p.title) + '" class="store-card-cover" loading="lazy">'
        : '<div class="store-card-cover store-card-placeholder" aria-hidden="true">' + storeTypeIcon(p.type) + '</div>';
      return '<div class="store-card">' +
        img +
        '<div class="store-card-body">' +
          '<div class="store-card-meta">' +
            '<span class="store-type-badge store-type-' + escapeHtml(p.type) + '">' + escapeHtml(p.type) + '</span>' +
            cats +
          '</div>' +
          '<h3 class="store-card-title">' + escapeHtml(p.title) + '</h3>' +
          '<p class="store-card-desc">' + escapeHtml(p.short_description) + '</p>' +
        '</div>' +
        '<div class="store-card-footer">' +
          '<span class="store-card-price">' + escapeHtml(price) + '</span>' +
          '<button type="button" class="btn btn-outline btn-sm store-view-btn" ' +
            'data-slug="' + escapeHtml(p.slug) + '" aria-label="View ' + escapeHtml(p.title) + '">View</button>' +
        '</div>' +
      '</div>';
    }).join('');

    // Wire view buttons
    grid.querySelectorAll('.store-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var slug = btn.dataset.slug;
        var product = storeAllProducts.filter(function (p) { return p.slug === slug; })[0];
        if (product) openStoreModal(product);
      });
    });
  }

  // ── Store — tag filter ────────────────────────────────────
  function renderStoreTagFilter() {
    var container = document.getElementById('store-tag-filter');
    if (!container) return;

    if (!storeTags.length) {
      container.innerHTML = '<span class="store-empty-filter">No tags yet.</span>';
      return;
    }

    container.innerHTML = storeTags.map(function (t) {
      return '<button type="button" class="store-tag-pill" data-tag-key="' + escapeHtml(t.key) + '">' +
        escapeHtml(t.label) + '</button>';
    }).join('');

    container.querySelectorAll('.store-tag-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.tagKey;
        var idx = storeFilter.tags.indexOf(key);
        if (idx === -1) { storeFilter.tags.push(key); btn.classList.add('active'); }
        else            { storeFilter.tags.splice(idx, 1); btn.classList.remove('active'); }
        applyStoreFilters();
      });
    });
  }

  // ── Store — subcat filter ─────────────────────────────────
  function renderStoreSubcatFilter() {
    var container = document.getElementById('store-subcat-filter');
    var wrap      = document.getElementById('store-subcat-wrap');
    if (!container) return;

    var filtered = storeFilter.type === 'all' ? [] :
      storeCategories.filter(function (c) { return c.type === storeFilter.type; });

    if (!filtered.length) {
      container.innerHTML = '';
      if (wrap) wrap.hidden = true;
      return;
    }

    if (wrap) wrap.hidden = false;
    container.innerHTML = filtered.map(function (c) {
      return '<button type="button" class="store-subcat-btn" data-cat-key="' + escapeHtml(c.key) + '">' +
        escapeHtml(c.label) + '</button>';
    }).join('');

    container.querySelectorAll('.store-subcat-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.catKey;
        var idx = storeFilter.subcats.indexOf(key);
        if (idx === -1) { storeFilter.subcats.push(key); btn.classList.add('active'); }
        else            { storeFilter.subcats.splice(idx, 1); btn.classList.remove('active'); }
        applyStoreFilters();
      });
    });
  }

  // ── Store — apply filters ─────────────────────────────────
  function applyStoreFilters() {
    var filtered = storeAllProducts.filter(function (p) {
      if (storeFilter.type !== 'all' && p.type !== storeFilter.type) return false;
      if (storeFilter.subcats.length) {
        var catKeys = (p.cats || []).map(function (c) { return c.key; });
        if (!storeFilter.subcats.some(function (k) { return catKeys.indexOf(k) !== -1; })) return false;
      }
      if (storeFilter.tags.length) {
        var tagKeys = (p.ptags || []).map(function (t) { return t.key; });
        if (!storeFilter.tags.some(function (k) { return tagKeys.indexOf(k) !== -1; })) return false;
      }
      if (storeFilter.search) {
        var hay = (p.title + ' ' + p.short_description).toLowerCase();
        if (hay.indexOf(storeFilter.search) === -1) return false;
      }
      return true;
    });

    renderStoreGrid(filtered);

    var countEl = document.getElementById('store-count');
    if (countEl) {
      countEl.textContent = filtered.length + ' product' + (filtered.length !== 1 ? 's' : '');
    }
  }

  // ── Store — product modal ─────────────────────────────────
  function openStoreModal(product) {
    var modal   = document.getElementById('store-modal');
    var bodyEl  = document.getElementById('store-modal-body');
    var closeEl = document.getElementById('store-modal-close');
    if (!modal || !bodyEl) return;

    var price = formatPrice(product.price_cents, product.currency);
    var externalLabel = { music: 'Listen Now', game: 'Play Now', software: 'Get It', story: 'Read Now' }[product.type] || 'Open';

    var catsHtml = (product.cats || []).map(function (c) {
      return '<span class="store-cat-pill">' + escapeHtml(c.label) + '</span>';
    }).join('');

    var tagsHtml = (product.ptags || []).map(function (t) {
      return '<span class="store-tag-pill store-tag-display">' + escapeHtml(t.label) + '</span>';
    }).join('');

    bodyEl.innerHTML =
      (product.cover_image_url
        ? '<img src="' + escapeHtml(product.cover_image_url) + '" alt="' + escapeHtml(product.title) + '" class="store-modal-img">'
        : '') +
      '<div class="store-modal-meta">' +
        '<span class="store-type-badge store-type-' + escapeHtml(product.type) + '">' + escapeHtml(product.type) + '</span>' +
        catsHtml +
      '</div>' +
      '<h2 id="store-modal-title" class="store-modal-title">' + escapeHtml(product.title) + '</h2>' +
      (tagsHtml ? '<div class="store-modal-tags">' + tagsHtml + '</div>' : '') +
      '<div class="store-modal-desc">' + escapeHtml(product.long_description || product.short_description) + '</div>' +
      '<div class="store-modal-footer">' +
        '<span class="store-modal-price">' + escapeHtml(price) + '</span>' +
        (product.external_url && /^https?:\/\//i.test(product.external_url)
          ? '<a href="' + escapeHtml(product.external_url) + '" class="btn btn-primary" target="_blank" rel="noopener noreferrer">' + escapeHtml(externalLabel) + '</a>'
          : '<button type="button" class="btn btn-outline" disabled>Not available</button>') +
      '</div>';

    modal.removeAttribute('hidden');
    if (closeEl) closeEl.focus();
    document.body.style.overflow = 'hidden';
  }

  function closeStoreModal() {
    var modal = document.getElementById('store-modal');
    if (modal) modal.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }

  // ── Store — init public page ──────────────────────────────
  function initStorePage() {
    var searchInput = document.getElementById('store-search');
    var typeFilters = document.querySelectorAll('[data-store-type]');
    var modalClose  = document.getElementById('store-modal-close');
    var modalBdrop  = document.getElementById('store-modal-backdrop');
    var subcatWrap  = document.getElementById('store-subcat-wrap');

    if (subcatWrap) subcatWrap.hidden = true;

    if (modalClose) modalClose.addEventListener('click', closeStoreModal);
    if (modalBdrop) modalBdrop.addEventListener('click', closeStoreModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeStoreModal();
    });

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        storeFilter.search = searchInput.value.trim().toLowerCase();
        applyStoreFilters();
      });
    }

    typeFilters.forEach(function (btn) {
      btn.addEventListener('click', function () {
        storeFilter.type    = btn.dataset.storeType;
        storeFilter.subcats = [];
        typeFilters.forEach(function (b) {
          b.classList.toggle('active', b.dataset.storeType === storeFilter.type);
        });
        renderStoreSubcatFilter();
        applyStoreFilters();
      });
    });

    if (!supabase) {
      var grid = document.getElementById('store-grid');
      if (grid) grid.innerHTML = '<p class="store-empty">Store is currently unavailable.</p>';
      return;
    }

    var grid = document.getElementById('store-grid');
    if (grid) grid.innerHTML = '<p class="store-empty">Loading products&hellip;</p>';

    Promise.all([
      supabase.from('store_categories').select('id, key, label, type').order('type').order('label'),
      supabase.from('store_tags').select('id, key, label').order('label'),
      supabase.from('store_products')
        .select('*, store_product_categories(store_categories(id,key,label,type)), store_product_tags(store_tags(id,key,label))')
        .eq('is_published', true)
        .order('created_at', { ascending: false })
    ]).then(function (results) {
      storeCategories = (results[0].data || []);
      storeTags       = (results[1].data || []);

      storeAllProducts = (results[2].data || []).map(function (p) {
        return Object.assign({}, p, {
          cats:  (p.store_product_categories || []).map(function (c) { return c.store_categories; }).filter(Boolean),
          ptags: (p.store_product_tags || []).map(function (t) { return t.store_tags; }).filter(Boolean)
        });
      });

      renderStoreTagFilter();
      renderStoreSubcatFilter();
      applyStoreFilters();
    }).catch(function () {
      if (grid) grid.innerHTML = '<p class="store-empty">Could not load products. Please try again later.</p>';
    });
  }

  // ── Owner: store products ─────────────────────────────────
  function loadOwnerProducts() {
    var listEl = document.getElementById('op-product-list');
    if (!listEl || !supabase) return;
    listEl.innerHTML = '<p class="inbox-empty">Loading&hellip;</p>';

    supabase
      .from('store_products')
      .select('id, title, type, slug, is_published, price_cents, currency')
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) {
          _trackError('Products load: ' + res.error.message);
          listEl.innerHTML = '<p class="inbox-empty">Could not load products.</p>';
          return;
        }
        if (!res.data || !res.data.length) {
          listEl.innerHTML = '<p class="inbox-empty">No products yet. Click &ldquo;+ New Product&rdquo; to create one.</p>';
          return;
        }

        listEl.innerHTML = '';
        res.data.forEach(function (p) {
          var price = formatPrice(p.price_cents, p.currency);
          var row   = document.createElement('div');
          row.className = 'owner-product-row';
          row.innerHTML =
            '<div class="owner-product-meta">' +
              '<span class="store-type-badge store-type-' + escapeHtml(p.type) + '">' + escapeHtml(p.type) + '</span>' +
              '<span class="owner-product-title">' + escapeHtml(p.title) + '</span>' +
              '<span class="owner-product-price">' + escapeHtml(price) + '</span>' +
            '</div>' +
            '<div class="owner-product-actions">' +
              '<button type="button" class="owner-pub-toggle op-pub-toggle ' + (p.is_published ? 'pub-published' : 'pub-draft') + '">' +
                (p.is_published ? 'Published' : 'Draft') + '</button>' +
              '<button type="button" class="btn btn-outline btn-sm op-product-edit">Edit</button>' +
              '<button type="button" class="btn-danger-sm op-product-delete">Delete</button>' +
            '</div>';

          var pubBtn = row.querySelector('.op-pub-toggle');
          pubBtn.addEventListener('click', function () { toggleProductPublished(p.id, pubBtn.classList.contains('pub-published'), pubBtn); });
          row.querySelector('.op-product-edit').addEventListener('click', function () { openProductEditor(p.id); });
          row.querySelector('.op-product-delete').addEventListener('click', function () { deleteOwnerProduct(p.id, row); });
          listEl.appendChild(row);
        });
      });
  }

  function openProductEditor(productId) {
    _storeEditingId = productId || null;
    var editorEl = document.getElementById('op-product-editor');
    var titleEl  = document.getElementById('op-editor-title');
    var alertEl  = document.getElementById('op-product-alert');
    var form     = document.getElementById('op-product-form');
    if (!editorEl) return;

    if (form)    form.reset();
    if (alertEl) alertEl.className = 'auth-alert';
    var idInput = document.getElementById('op-product-id');
    if (idInput) idInput.value = '';

    if (productId) {
      if (titleEl) titleEl.textContent = 'Edit Product';
      var _expectedEditId = productId; // stale-response guard
      supabase
        .from('store_products')
        .select('*, store_product_categories(category_id), store_product_tags(tag_id)')
        .eq('id', productId)
        .single()
        .then(function (res) {
          // If the user navigated away (clicked New or Cancel) before this resolved, discard
          if (_storeEditingId !== _expectedEditId) return;
          if (res.error || !res.data) { _trackError('Load product: ' + (res.error && res.error.message)); return; }
          var p = res.data;
          document.getElementById('op-product-id').value      = p.id;
          document.getElementById('op-prod-title').value      = p.title || '';
          document.getElementById('op-prod-slug').value       = p.slug || '';
          document.getElementById('op-prod-type').value       = p.type || 'music';
          document.getElementById('op-prod-short').value      = p.short_description || '';
          document.getElementById('op-prod-long').value       = p.long_description || '';
          document.getElementById('op-prod-price').value      = p.price_cents ? (p.price_cents / 100).toFixed(2) : '0.00';
          document.getElementById('op-prod-currency').value   = p.currency || 'USD';
          document.getElementById('op-prod-cover').value      = p.cover_image_url || '';
          document.getElementById('op-prod-external').value   = p.external_url || '';

          var catIds = (p.store_product_categories || []).map(function (c) { return c.category_id; });
          document.querySelectorAll('#op-prod-cats input[type="checkbox"]').forEach(function (cb) {
            cb.checked = catIds.indexOf(cb.value) !== -1;
          });

          var tagIds = (p.store_product_tags || []).map(function (t) { return t.tag_id; });
          document.querySelectorAll('#op-prod-tags input[type="checkbox"]').forEach(function (cb) {
            cb.checked = tagIds.indexOf(cb.value) !== -1;
          });

          updateEditorCatFilter();
        });
    } else {
      if (titleEl) titleEl.textContent = 'New Product';
      updateEditorCatFilter();
    }

    editorEl.removeAttribute('hidden');
    editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeProductEditor() {
    var editorEl = document.getElementById('op-product-editor');
    if (editorEl) editorEl.setAttribute('hidden', '');
    _storeEditingId = null;
  }

  function updateEditorCatFilter() {
    var typeEl = document.getElementById('op-prod-type');
    if (!typeEl) return;
    var sel = typeEl.value;
    document.querySelectorAll('#op-prod-cats .op-cat-option').forEach(function (wrap) {
      wrap.style.display = (wrap.dataset.catType === sel) ? '' : 'none';
    });
  }

  function saveOwnerProduct() {
    if (!supabase) return;
    var alertEl = document.getElementById('op-product-alert');
    var btn     = document.getElementById('op-product-save');

    var id        = (document.getElementById('op-product-id').value   || '').trim();
    var title     = (document.getElementById('op-prod-title').value    || '').trim();
    var slug      = (document.getElementById('op-prod-slug').value     || '').trim();
    var type      =  document.getElementById('op-prod-type').value;
    var shortDesc = (document.getElementById('op-prod-short').value    || '').trim();
    var longDesc  = (document.getElementById('op-prod-long').value     || '').trim();
    var priceStr  =  document.getElementById('op-prod-price').value;
    var currency  =  document.getElementById('op-prod-currency').value || 'USD';
    var cover     = (document.getElementById('op-prod-cover').value    || '').trim();
    var external  = (document.getElementById('op-prod-external').value || '').trim();

    var priceCents = Math.round(parseFloat(priceStr || '0') * 100);
    if (isNaN(priceCents) || priceCents < 0) priceCents = 0;

    if (!title || !slug || !type || !shortDesc) {
      if (alertEl) { alertEl.textContent = 'Title, slug, type, and short description are required.'; alertEl.className = 'auth-alert error visible'; }
      return;
    }

    var catIds = [];
    document.querySelectorAll('#op-prod-cats input[type="checkbox"]:checked').forEach(function (cb) { catIds.push(cb.value); });
    var tagIds = [];
    document.querySelectorAll('#op-prod-tags input[type="checkbox"]:checked').forEach(function (cb) { tagIds.push(cb.value); });

    // Validate external URL scheme before saving (mirrors the modal render check)
    var safeExternal = (external && /^https?:\/\//i.test(external)) ? external : null;
    if (external && !safeExternal) {
      if (alertEl) { alertEl.textContent = 'External link must start with https:// or http://'; alertEl.className = 'auth-alert error visible'; }
      return;
    }

    var data = {
      title:             title,
      slug:              slug,
      type:              type,
      short_description: shortDesc,
      long_description:  longDesc     || null,
      price_cents:       priceCents,
      currency:          currency,
      cover_image_url:   cover        || null,
      external_url:      safeExternal || null
    };

    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    // Single atomic RPC call — product + categories + tags in one transaction
    supabase.rpc('save_product_with_relations', {
      p_id:          id   || null,
      p_data:        data,
      p_category_ids: catIds.length ? catIds : null,
      p_tag_ids:      tagIds.length ? tagIds : null
    }).then(function (res) {
      if (res.error) {
        _trackError('Product save: ' + res.error.message);
        var errMsg = res.error.message || 'Could not save product.';
        if (/duplicate key.*slug/i.test(errMsg))   errMsg = 'A product with this slug already exists. Change the slug and try again.';
        if (/not authorized/i.test(errMsg))         errMsg = 'Permission denied. Make sure you are signed in as owner.';
        if (alertEl) { alertEl.textContent = errMsg; alertEl.className = 'auth-alert error visible'; }
        if (btn) { btn.disabled = false; btn.textContent = 'Save Product'; }
        return;
      }
      if (alertEl) { alertEl.textContent = 'Product saved.'; alertEl.className = 'auth-alert success visible'; setTimeout(function () { alertEl.className = 'auth-alert'; }, 3000); }
      if (btn) { btn.disabled = false; btn.textContent = 'Save Product'; }
      closeProductEditor();
      loadOwnerProducts();
    });
  }

  function deleteOwnerProduct(id, rowEl) {
    if (!supabase) return;
    if (!confirm('Delete this product permanently? This cannot be undone.')) return;
    supabase.from('store_products').delete().eq('id', id).then(function (res) {
      if (res.error) { _trackError('Product delete: ' + res.error.message); return; }
      if (rowEl && rowEl.parentNode) rowEl.remove();
    });
  }

  function toggleProductPublished(id, isCurrentlyPublished, btnEl) {
    if (!supabase) return;
    var newState = !isCurrentlyPublished;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }
    supabase.from('store_products').update({ is_published: newState }).eq('id', id)
      .then(function (res) {
        if (res.error) {
          _trackError('Product publish: ' + res.error.message);
          if (btnEl) {
            btnEl.disabled    = false;
            btnEl.textContent = (isCurrentlyPublished ? 'Published' : 'Draft') + ' ✗';
            btnEl.className   = 'owner-pub-toggle op-pub-toggle ' + (isCurrentlyPublished ? 'pub-published' : 'pub-draft');
            setTimeout(function () {
              btnEl.textContent = isCurrentlyPublished ? 'Published' : 'Draft';
            }, 3000);
          }
          return;
        }
        if (btnEl) {
          btnEl.disabled    = false;
          btnEl.textContent = newState ? 'Published' : 'Draft';
          btnEl.className   = 'owner-pub-toggle op-pub-toggle ' + (newState ? 'pub-published' : 'pub-draft');
        }
      });
  }

  // ── Owner: categories ─────────────────────────────────────
  function loadStoreCategories() {
    var listEl = document.getElementById('op-cat-list');
    if (!listEl || !supabase) return;
    listEl.innerHTML = '<p class="inbox-empty">Loading…</p>';

    supabase.from('store_categories').select('id, key, label, type').order('type').order('label')
      .then(function (res) {
        if (res.error) { listEl.innerHTML = '<p class="inbox-empty">Could not load.</p>'; return; }
        if (!res.data || !res.data.length) {
          listEl.innerHTML = '<p class="inbox-empty">No categories yet.</p>';
          rebuildCatCheckboxes([]);
          return;
        }
        listEl.innerHTML = '';
        res.data.forEach(function (c) {
          var row = document.createElement('div');
          row.className = 'owner-tax-row';
          row.innerHTML =
            '<span class="store-type-badge store-type-' + escapeHtml(c.type) + '">' + escapeHtml(c.type) + '</span> ' +
            '<span class="owner-tax-label">' + escapeHtml(c.label) + '</span>' +
            '<span class="owner-tax-key">' + escapeHtml(c.key) + '</span>' +
            '<button type="button" class="btn-danger-sm op-cat-delete" aria-label="Delete ' + escapeHtml(c.label) + '">Delete</button>';
          row.querySelector('.op-cat-delete').addEventListener('click', function () { deleteStoreCategory(c.id, row); });
          listEl.appendChild(row);
        });
        rebuildCatCheckboxes(res.data);
      });
  }

  function rebuildCatCheckboxes(cats) {
    var container = document.getElementById('op-prod-cats');
    if (!container) return;
    container.innerHTML = cats.map(function (c) {
      return '<label class="op-cat-option" data-cat-type="' + escapeHtml(c.type) + '">' +
        '<input type="checkbox" value="' + escapeHtml(c.id) + '"> ' + escapeHtml(c.label) +
      '</label>';
    }).join('') || '<span class="store-empty-filter">No categories yet.</span>';
    updateEditorCatFilter();
  }

  function saveStoreCategory() {
    if (!supabase) return;
    var alertEl = document.getElementById('op-cat-alert');
    var key     = (document.getElementById('op-cat-key').value   || '').trim().toLowerCase().replace(/\s+/g, '_');
    var label   = (document.getElementById('op-cat-label').value || '').trim();
    var type    =  document.getElementById('op-cat-type').value;

    if (!key || !label || !type) {
      if (alertEl) { alertEl.textContent = 'Key, label, and type are required.'; alertEl.className = 'auth-alert error visible'; }
      return;
    }

    supabase.from('store_categories').insert({ key: key, label: label, type: type }).then(function (res) {
      if (res.error) {
        _trackError('Cat insert: ' + res.error.message);
        if (alertEl) { alertEl.textContent = res.error.message || 'Could not add category.'; alertEl.className = 'auth-alert error visible'; }
        return;
      }
      if (alertEl) { alertEl.textContent = 'Category added.'; alertEl.className = 'auth-alert success visible'; setTimeout(function () { alertEl.className = 'auth-alert'; }, 2500); }
      var form = document.getElementById('op-cat-form');
      if (form) form.reset();
      loadStoreCategories();
    });
  }

  function deleteStoreCategory(id, rowEl) {
    if (!supabase) return;
    if (!confirm('Delete this category? Products using it will lose this subcategory.')) return;
    supabase.from('store_categories').delete().eq('id', id).then(function (res) {
      if (res.error) { _trackError('Cat delete: ' + res.error.message); return; }
      if (rowEl && rowEl.parentNode) rowEl.remove();
      loadStoreCategories();
    });
  }

  // ── Owner: tags ───────────────────────────────────────────
  function loadStoreTags() {
    var listEl = document.getElementById('op-tag-list');
    if (!listEl || !supabase) return;
    listEl.innerHTML = '<p class="inbox-empty">Loading…</p>';

    supabase.from('store_tags').select('id, key, label').order('label').then(function (res) {
      if (res.error) { listEl.innerHTML = '<p class="inbox-empty">Could not load.</p>'; return; }
      if (!res.data || !res.data.length) {
        listEl.innerHTML = '<p class="inbox-empty">No tags yet.</p>';
        rebuildTagCheckboxes([]);
        return;
      }
      listEl.innerHTML = '';
      res.data.forEach(function (t) {
        var row = document.createElement('div');
        row.className = 'owner-tax-row';
        row.innerHTML =
          '<span class="owner-tax-label">' + escapeHtml(t.label) + '</span>' +
          '<span class="owner-tax-key">' + escapeHtml(t.key) + '</span>' +
          '<button type="button" class="btn-danger-sm op-tag-delete" aria-label="Delete ' + escapeHtml(t.label) + '">Delete</button>';
        row.querySelector('.op-tag-delete').addEventListener('click', function () { deleteStoreTag(t.id, row); });
        listEl.appendChild(row);
      });
      rebuildTagCheckboxes(res.data);
    });
  }

  function rebuildTagCheckboxes(tags) {
    var container = document.getElementById('op-prod-tags');
    if (!container) return;
    container.innerHTML = tags.map(function (t) {
      return '<label class="op-tag-option">' +
        '<input type="checkbox" value="' + escapeHtml(t.id) + '"> ' + escapeHtml(t.label) +
      '</label>';
    }).join('') || '<span class="store-empty-filter">No tags yet.</span>';
  }

  function saveStoreTag() {
    if (!supabase) return;
    var alertEl = document.getElementById('op-tag-alert');
    var key     = (document.getElementById('op-tag-key').value   || '').trim().toLowerCase().replace(/\s+/g, '_');
    var label   = (document.getElementById('op-tag-label').value || '').trim();

    if (!key || !label) {
      if (alertEl) { alertEl.textContent = 'Key and label are required.'; alertEl.className = 'auth-alert error visible'; }
      return;
    }

    supabase.from('store_tags').insert({ key: key, label: label }).then(function (res) {
      if (res.error) {
        _trackError('Tag insert: ' + res.error.message);
        if (alertEl) { alertEl.textContent = res.error.message || 'Could not add tag.'; alertEl.className = 'auth-alert error visible'; }
        return;
      }
      if (alertEl) { alertEl.textContent = 'Tag added.'; alertEl.className = 'auth-alert success visible'; setTimeout(function () { alertEl.className = 'auth-alert'; }, 2500); }
      var form = document.getElementById('op-tag-form');
      if (form) form.reset();
      loadStoreTags();
    });
  }

  function deleteStoreTag(id, rowEl) {
    if (!supabase) return;
    if (!confirm('Delete this tag?')) return;
    supabase.from('store_tags').delete().eq('id', id).then(function (res) {
      if (res.error) { _trackError('Tag delete: ' + res.error.message); return; }
      if (rowEl && rowEl.parentNode) rowEl.remove();
      loadStoreTags();
    });
  }

  function initPage() {

    // ── Store page ────────────────────────────────────────────
    if (body.dataset.page === 'store') {
      initStorePage();
      return;
    }

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
          localStorage.removeItem('und_recovery_pending');
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

        // CAPTCHA gate (only enforced if the widget is present on the page)
        var loginCaptcha = getCaptchaToken();
        if (document.querySelector('.cf-turnstile') && !loginCaptcha) {
          alertEl.textContent = 'Please complete the CAPTCHA.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        btn.disabled    = true;
        btn.textContent = 'Signing in…';

        var result = await Auth.login(
          document.getElementById('login-email').value.trim(),
          document.getElementById('login-password').value,
          loginCaptcha
        );

        btn.disabled    = false;
        btn.textContent = 'Sign In';

        if (result.ok) {
          window.location.href = 'dashboard.html';
        } else {
          resetCaptcha();
          var loginMsg = result.msg;
          // Collapse both branches to the same message — prevents email enumeration
          // (distinguishing "wrong password" from "unverified account" reveals account existence)
          if (/invalid login credentials/i.test(loginMsg) || /email not confirmed/i.test(loginMsg)) {
            loginMsg = 'Incorrect email or password. If you just registered, please verify your email before signing in.';
          } else if (/captcha/i.test(loginMsg)) {
            loginMsg = 'CAPTCHA verification failed. Please try again.';
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

        // CAPTCHA gate (only enforced if the widget is present on the page)
        var regCaptcha = getCaptchaToken();
        if (document.querySelector('.cf-turnstile') && !regCaptcha) {
          alertEl.textContent = 'Please complete the CAPTCHA.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        btn.disabled    = true;
        btn.textContent = 'Creating account…';

        var result = await Auth.register(
          document.getElementById('reg-email').value.trim(),
          password,
          document.getElementById('reg-name').value.trim(),
          regCaptcha
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
          resetCaptcha();
          alertEl.textContent = /captcha/i.test(result.msg) ? 'CAPTCHA verification failed. Please try again.' : result.msg;
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

    // ── Studio Panel page — owner-only gate ──────────────────
    // Any authenticated user reaches this point on dashboard-alt.html.
    // Re-apply auth-loading to hide content, then redirect non-owners.
    if (body.dataset.page === 'dashboard-alt') {
      body.classList.add('auth-loading');
      Auth.getProfile().then(function (profile) {
        if (!profile || profile.role !== 'owner') {
          window.location.replace('dashboard.html');
        } else {
          body.classList.remove('auth-loading');
        }
      });
    }

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

        // Non-owner: remove owner-only DOM nodes entirely.
        // hidden attribute alone is not enough — devtools can unhide elements.
        // Removing them means no amount of DOM editing reveals owner UI or loads owner data.
        if (!isOwner) {
          ['owner-stats-row', 'tab-admin', 'sidebar-tab-admin', 'mobile-tab-admin',
           'sidebar-studio-link', 'studio-panel-card'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
          });
          // Feature flag: community chat may be disabled by owner
          if (supabase) {
            supabase.from('feature_flags').select('key, enabled').then(function (flagRes) {
              if (flagRes.error || !flagRes.data) return;
              var chatEnabled = true;
              flagRes.data.forEach(function (f) {
                if (f.key === 'community_chat_enabled') chatEnabled = f.enabled;
              });
              if (!chatEnabled) {
                var fChatSidebar = document.querySelector('.sidebar-tab-btn[data-tab="chat"]');
                var fChatMobile  = document.querySelector('.dash-tab-btn[data-tab="chat"]');
                var fChatPanel   = document.getElementById('tab-chat');
                if (fChatSidebar) fChatSidebar.remove();
                if (fChatMobile)  fChatMobile.remove();
                if (fChatPanel)   fChatPanel.remove();
              }
            });
          }
        }

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

        // Admin tab + studio links — owner only
        if (isOwner) {
          if (sidebarAdminBtn) sidebarAdminBtn.removeAttribute('hidden');
          if (mobileAdminBtn)  mobileAdminBtn.removeAttribute('hidden');
          var sidebarStudioLink = document.getElementById('sidebar-studio-link');
          var studioPanelCard   = document.getElementById('studio-panel-card');
          if (sidebarStudioLink) sidebarStudioLink.removeAttribute('hidden');
          if (studioPanelCard)   studioPanelCard.removeAttribute('hidden');
          loadOwnerStats();
          loadInbox();
          loadOwnerChatMod();
          loadSystemStatus();
          loadOwnerPromo();
          loadOwnerFeatureFlags();
          loadOwnerAnnouncements();

          var inboxRefreshBtn  = document.getElementById('op-inbox-refresh');
          var chatRefreshBtn   = document.getElementById('op-chat-refresh');
          var promoRefreshBtn  = document.getElementById('op-promo-refresh');
          var flagsRefreshBtn  = document.getElementById('op-flags-refresh');
          var annRefreshBtn    = document.getElementById('op-ann-refresh');
          if (inboxRefreshBtn) inboxRefreshBtn.addEventListener('click', loadInbox);
          if (chatRefreshBtn)  chatRefreshBtn.addEventListener('click', loadOwnerChatMod);
          if (promoRefreshBtn) promoRefreshBtn.addEventListener('click', loadOwnerPromo);
          if (flagsRefreshBtn) flagsRefreshBtn.addEventListener('click', loadOwnerFeatureFlags);
          if (annRefreshBtn)   annRefreshBtn.addEventListener('click', loadOwnerAnnouncements);

          // Feature flag toggle buttons
          document.querySelectorAll('.owner-flag-toggle[data-key]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              updateFeatureFlag(btn.dataset.key, btn.dataset.state !== 'on');
            });
          });

          // Promo link form
          var promoForm  = document.getElementById('op-promo-form');
          var promoAlert = document.getElementById('op-promo-alert');
          if (promoForm) {
            promoForm.addEventListener('submit', function (e) {
              e.preventDefault();
              if (!supabase) return;
              var title    = document.getElementById('op-promo-title').value.trim();
              var url      = document.getElementById('op-promo-url').value.trim();
              var location = document.getElementById('op-promo-location').value;
              var order    = parseInt(document.getElementById('op-promo-order').value, 10) || 0;
              if (!title || !url) {
                if (promoAlert) { promoAlert.textContent = 'Title and URL are required.'; promoAlert.className = 'auth-alert error visible'; }
                return;
              }
              if (!/^https?:\/\//i.test(url)) {
                if (promoAlert) { promoAlert.textContent = 'URL must start with https:// or http://'; promoAlert.className = 'auth-alert error visible'; }
                return;
              }
              supabase.from('promo_links').insert({ title: title, url: url, location: location, sort_order: order, is_active: true })
                .then(function (res) {
                  if (res.error) {
                    _trackError('Promo insert: ' + res.error.message);
                    if (promoAlert) { promoAlert.textContent = 'Could not add promo.'; promoAlert.className = 'auth-alert error visible'; }
                    return;
                  }
                  if (promoAlert) { promoAlert.textContent = 'Promo link added.'; promoAlert.className = 'auth-alert success visible'; setTimeout(function () { promoAlert.className = 'auth-alert'; }, 2500); }
                  promoForm.reset();
                  loadOwnerPromo();
                });
            });
          }

          // Announcements form
          var annForm  = document.getElementById('op-ann-form');
          var annAlert = document.getElementById('op-ann-alert');
          if (annForm) {
            annForm.addEventListener('submit', function (e) {
              e.preventDefault();
              if (!supabase) return;
              var annTitle = document.getElementById('op-ann-title').value.trim();
              var annBody  = document.getElementById('op-ann-body').value.trim();
              if (!annTitle || !annBody) {
                if (annAlert) { annAlert.textContent = 'Title and body are required.'; annAlert.className = 'auth-alert error visible'; }
                return;
              }
              supabase.from('announcements').insert({ title: annTitle, body: annBody, is_active: true })
                .then(function (res) {
                  if (res.error) {
                    _trackError('Ann insert: ' + res.error.message);
                    if (annAlert) { annAlert.textContent = 'Could not post announcement.'; annAlert.className = 'auth-alert error visible'; }
                    return;
                  }
                  if (annAlert) { annAlert.textContent = 'Announcement posted.'; annAlert.className = 'auth-alert success visible'; setTimeout(function () { annAlert.className = 'auth-alert'; }, 2500); }
                  annForm.reset();
                  loadOwnerAnnouncements();
                });
            });
          }

          // ── Owner: storefront ────────────────────────────────
          loadOwnerProducts();
          loadStoreCategories();
          loadStoreTags();

          var storeRefreshBtn  = document.getElementById('op-store-refresh');
          var productNewBtn    = document.getElementById('op-product-new');
          var editorCancelBtn  = document.getElementById('op-editor-cancel');
          var productSaveBtn   = document.getElementById('op-product-save');
          var taxonomyRefresh  = document.getElementById('op-taxonomy-refresh');
          var prodTypeSelect   = document.getElementById('op-prod-type');
          var prodTitleInput   = document.getElementById('op-prod-title');
          var prodSlugInput    = document.getElementById('op-prod-slug');
          var opCatForm        = document.getElementById('op-cat-form');
          var opTagForm        = document.getElementById('op-tag-form');

          if (storeRefreshBtn) {
            storeRefreshBtn.addEventListener('click', function () {
              loadOwnerProducts();
              loadStoreCategories();
              loadStoreTags();
            });
          }
          if (productNewBtn)   productNewBtn.addEventListener('click',   function () { openProductEditor(null); });
          if (editorCancelBtn) editorCancelBtn.addEventListener('click', closeProductEditor);
          if (productSaveBtn)  productSaveBtn.addEventListener('click',  saveOwnerProduct);
          if (taxonomyRefresh) {
            taxonomyRefresh.addEventListener('click', function () { loadStoreCategories(); loadStoreTags(); });
          }
          if (prodTypeSelect)  prodTypeSelect.addEventListener('change', updateEditorCatFilter);

          // Auto-slug from title (new products only)
          if (prodTitleInput && prodSlugInput) {
            prodTitleInput.addEventListener('input', function () {
              if (!_storeEditingId) prodSlugInput.value = slugify(prodTitleInput.value);
            });
          }

          if (opCatForm) {
            opCatForm.addEventListener('submit', function (e) { e.preventDefault(); saveStoreCategory(); });
          }
          if (opTagForm) {
            opTagForm.addEventListener('submit', function (e) { e.preventDefault(); saveStoreTag(); });
          }
        }

        // Announcements — all authenticated users see active ones on overview
        loadAnnouncements();

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
          Chat.currentUserId = user ? user.id : null;
          Chat.load();
          var chatForm    = document.getElementById('chat-form');
          var chatInput   = document.getElementById('chat-input');
          var chatAlert   = document.getElementById('chat-alert');
          var chatRefresh = document.getElementById('chat-refresh');

          if (chatRefresh) {
            chatRefresh.addEventListener('click', function () { Chat.load(); });
          }

          // ── Emoji picker ─────────────────────────────────────
          var emojiBtn   = document.getElementById('chat-emoji-btn');
          var emojiPanel = document.getElementById('chat-emoji-panel');
          if (emojiBtn && emojiPanel && chatInput) {
            var EMOJIS = ['😀','😁','😂','🤣','😊','😍','😎','😜','🤔','😴','😢','😭','😡','👍','👎','👏','🙌','🙏','💪','🔥','✨','⭐','💯','🎉','🎮','🎵','💜','❤️','💔','👀','💀','🤖','🚀','⚡','✅','❌','💡','📌','🕹️','🎧'];
            emojiPanel.innerHTML = EMOJIS.map(function (e) {
              return '<button type="button" class="chat-emoji" tabindex="-1">' + e + '</button>';
            }).join('');
            emojiBtn.addEventListener('click', function (ev) {
              ev.stopPropagation();
              emojiPanel.classList.toggle('open');
            });
            emojiPanel.addEventListener('click', function (ev) {
              if (ev.target.classList.contains('chat-emoji')) {
                chatInput.value += ev.target.textContent;
                chatInput.focus();
              }
            });
            document.addEventListener('click', function (ev) {
              if (!emojiPanel.contains(ev.target) && ev.target !== emojiBtn) emojiPanel.classList.remove('open');
            });
          }

          // ── GIF button ───────────────────────────────────────
          // Inline GIFs already render when a GIF/image URL is sent. This
          // button lets users paste a GIF link quickly (e.g. from Giphy/Tenor).
          // Full in-app GIF search activates once a Tenor API key is added.
          var gifBtn = document.getElementById('chat-gif-btn');
          if (gifBtn && chatInput) {
            gifBtn.addEventListener('click', function () {
              var url = prompt('Paste a GIF link (Giphy or Tenor, ending in .gif):');
              if (url && /^https:\/\/\S+/i.test(url.trim())) {
                chatInput.value = url.trim();
                chatInput.focus();
              }
            });
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
        var alertEl    = document.getElementById('change-password-alert');
        var btn        = document.getElementById('change-password-submit');
        var currentPwd = (document.getElementById('change-current-password').value || '');
        var newPwd     = document.getElementById('change-new-password').value;
        var confirm    = document.getElementById('change-confirm-password').value;

        if (!supabase) {
          alertEl.textContent = 'Authentication service is unavailable.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }
        if (!currentPwd) {
          alertEl.textContent = 'Current password is required.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }
        if (newPwd.length < 8) {
          alertEl.textContent = 'New password must be at least 8 characters.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }
        if (newPwd !== confirm) {
          alertEl.textContent = 'New passwords do not match.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }
        if (!applyRateLimit('change-password', 30000)) {
          alertEl.textContent = 'Please wait before trying again.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        btn.disabled    = true;
        btn.textContent = 'Verifying…';

        // Re-authenticate to confirm the user knows their current password
        var currentUser = await Auth.getUser();
        if (!currentUser || !currentUser.email) {
          alertEl.textContent = 'Session expired. Please sign in again.';
          alertEl.className   = 'auth-alert error visible';
          btn.disabled = false; btn.textContent = 'Update Password';
          return;
        }
        var reAuth = await supabase.auth.signInWithPassword({ email: currentUser.email, password: currentPwd });
        if (reAuth.error) {
          alertEl.textContent = 'Current password is incorrect.';
          alertEl.className   = 'auth-alert error visible';
          btn.disabled = false; btn.textContent = 'Update Password';
          return;
        }

        btn.textContent = 'Updating…';
        var result = await supabase.auth.updateUser({ password: newPwd });

        btn.disabled    = false;
        btn.textContent = 'Update Password';

        if (result.error) {
          alertEl.textContent = result.error.message || 'Could not update password.';
          alertEl.className   = 'auth-alert error visible';
        } else {
          alertEl.textContent = 'Password updated. All other sessions have been signed out.';
          alertEl.className   = 'auth-alert success visible';
          changePasswordForm.reset();
          // Revoke all other sessions for this account
          await supabase.auth.signOut({ scope: 'global' });
          setTimeout(function () { window.location.href = 'login.html'; }, 2500);
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

        var resetCap = getCaptchaToken();
        if (document.querySelector('.cf-turnstile') && !resetCap) {
          alertEl.textContent = 'Please complete the CAPTCHA.';
          alertEl.className   = 'auth-alert error visible';
          return;
        }

        btn.disabled    = true;
        btn.textContent = 'Sending…';

        var result = await Auth.requestPasswordReset(email, resetCap);

        btn.disabled    = false;
        btn.textContent = 'Send Reset Link';

        if (!result.ok) resetCaptcha();
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

      // Feature flag: contact form may be disabled by owner
      if (supabase) {
        supabase.from('feature_flags').select('enabled').eq('key', 'contact_form_enabled').single()
          .then(function (res) {
            if (!res.error && res.data && res.data.enabled === false) {
              var cSubmitBtn = contactForm.querySelector('[type="submit"]');
              var cAlertEl   = document.getElementById('contact-alert');
              if (cSubmitBtn) { cSubmitBtn.disabled = true; cSubmitBtn.textContent = 'Contact form unavailable'; }
              if (cAlertEl)   { cAlertEl.textContent = 'Contact form is temporarily unavailable.'; cAlertEl.className = 'auth-alert error visible'; }
            }
          });
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

    // Promo links — public pages only (home, music, contact)
    var promoPage = body.dataset.page;
    if (supabase && (promoPage === 'home' || promoPage === 'music' || promoPage === 'contact')) {
      loadPromoLinks(promoPage, promoPage + '-promo-area', promoPage + '-promo-section');
    }
  }

  runRouteGuard();

})();
