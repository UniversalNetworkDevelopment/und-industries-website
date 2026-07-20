// review-thanks.js — the landing page after a customer taps a star in the job-complete email.
//
// WHY THIS EXISTS: /api/review redirected to /review-thanks.html?status=...&r=N and that page
// did not exist. Every star link in the completion email 404'd. Built 2026-07-19.
//
// External file because the page CSP is `script-src 'self'` (no unsafe-inline).
//
// REVIEW ETHICS — deliberate, do not "optimise":
// The public review link is offered on EVERY rating, 1 through 5. We do not show it only to
// happy customers and quietly divert unhappy ones to a private form. That is review gating;
// the FTC has acted on it and it makes a public rating dishonest. A low rating additionally
// gets a "tell us what went wrong" prompt — an EXTRA path, never a substitute.
(function () {
  'use strict';

  // Where the public review lives. Left null until Alex supplies a Google Business Profile
  // (or similar) URL — a button pointing nowhere is worse than no button.
  var PUBLIC_REVIEW_URL = null;

  var params = new URLSearchParams(window.location.search);
  var status = String(params.get('status') || '').toLowerCase();
  var ratingRaw = parseInt(params.get('r'), 10);
  var rating = (ratingRaw >= 1 && ratingRaw <= 5) ? ratingRaw : null;

  var titleEl = document.getElementById('rt-title');
  var bodyEl = document.getElementById('rt-body');
  var actionsEl = document.getElementById('rt-actions');
  var cardEl = document.getElementById('rt-card');
  if (!titleEl || !bodyEl || !actionsEl || !cardEl) return;

  // ── star row ──────────────────────────────────────────────────────────────
  function renderStars(n) {
    if (!n) return;
    var row = document.createElement('div');
    row.className = 'rt-stars';
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', n + ' out of 5 stars');
    for (var i = 1; i <= 5; i++) {
      var s = document.createElement('span');
      s.className = i <= n ? 'rt-on' : 'rt-off';
      s.textContent = '★';
      row.appendChild(s);
    }
    cardEl.insertBefore(row, titleEl);
  }

  function addBtn(label, href, primary) {
    var a = document.createElement('a');
    a.className = 'rt-btn ' + (primary ? 'rt-primary' : 'rt-ghost');
    a.textContent = label;
    a.href = href;
    if (/^https?:\/\//i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    actionsEl.insertBefore(a, actionsEl.firstChild);
    return a;
  }

  // ── copy per outcome ──────────────────────────────────────────────────────
  // Every branch produces a COMPLETE message. No state falls through to a blank page.
  var COPY = {
    ok: function () {
      renderStars(rating);
      // A missing/invalid rating must NOT fall through to the low-score branch. Found by
      // hostile-input testing 2026-07-19: ?status=ok&r=99 and r=abc set rating=null, and
      // `null >= 4` / `null === 3` are both false, so a customer whose link got mangled was
      // told "that is not the standard we aim for" — accusing them of a complaint they
      // never made. Handle unknown explicitly instead of letting it default to the worst case.
      if (rating === null) {
        titleEl.textContent = 'Thanks for the feedback';
        bodyEl.textContent = 'We recorded your response, but the star value did not come '
          + 'through clearly. If you want it counted exactly, reply to your confirmation '
          + 'email with a number from 1 to 5.';
        return;
      }
      if (rating >= 4) {
        titleEl.textContent = 'Thank you — that means a lot';
        bodyEl.textContent = 'Your ' + rating + '-star rating is recorded. For a small business, '
          + 'a good word genuinely changes things.';
      } else if (rating === 3) {
        titleEl.textContent = 'Thanks for the honesty';
        bodyEl.textContent = 'Three stars tells us there was room to do better. If you have a '
          + 'minute to say where, we would rather hear it than guess.';
      } else {
        titleEl.textContent = 'Thank you for telling us';
        bodyEl.textContent = 'That is not the standard we aim for, and we would like the chance '
          + 'to put it right. Tell us what went wrong and we will come back to you.';
      }
      if (PUBLIC_REVIEW_URL) addBtn('Leave a public review', PUBLIC_REVIEW_URL, rating >= 4);
      if (rating <= 3) {
        addBtn('Tell us what went wrong',
          'mailto:contact.undindustries@gmail.com?subject=' +
          encodeURIComponent('Feedback on my order') + '&body=' +
          encodeURIComponent('What could have gone better:\n\n'), true);
      }
    },

    already: function () {
      renderStars(rating);
      titleEl.textContent = 'Already recorded';
      bodyEl.textContent = 'We have your rating for this order' + (rating ? ' — ' + rating + ' stars' : '')
        + '. If you meant to change it, just reply to your confirmation email and we will update it.';
      if (PUBLIC_REVIEW_URL) addBtn('Leave a public review', PUBLIC_REVIEW_URL, false);
    },

    badref: function () {
      titleEl.textContent = 'That link looks incomplete';
      bodyEl.textContent = 'We could not tell which order this rating was for — the link may have '
        + 'been cut short by your email client. Reply to your confirmation email and we will '
        + 'sort it out.';
    },

    badrating: function () {
      titleEl.textContent = 'That rating did not come through';
      bodyEl.textContent = 'Something was lost between the email and here. Reply to your '
        + 'confirmation email with a number from 1 to 5 and we will record it.';
    },

    savefailed: function () {
      titleEl.textContent = 'We could not save that';
      bodyEl.textContent = 'Your rating did not record — that is our problem, not yours. Reply to '
        + 'your confirmation email and we will log it manually.';
    },

    unconfigured: function () {
      titleEl.textContent = 'Ratings are not live yet';
      bodyEl.textContent = 'This link is not connected on our side yet. Reply to your confirmation '
        + 'email and tell us how we did — it reaches us directly.';
    },

    error: function () {
      titleEl.textContent = 'Something went wrong on our end';
      bodyEl.textContent = 'Your rating may not have saved. Reply to your confirmation email and '
        + 'we will make sure it counts.';
    }
  };

  // Unknown/absent status must never leave the generic shell showing. Fall back to the
  // honest neutral case rather than implying a rating was recorded when it may not have been.
  (COPY[status] || function () {
    titleEl.textContent = 'Thanks for the feedback';
    bodyEl.textContent = 'If your rating did not go through, reply to your confirmation email '
      + 'and we will record it by hand.';
  })();
})();
