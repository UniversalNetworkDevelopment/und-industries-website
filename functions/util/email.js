// functions/util/email.js
// Transactional email via Resend, from Cloudflare Pages Functions.
//
// WHY THIS EXISTS
// Before 2026-07-19 there was NO email anywhere in this codebase. A sweep for
// sendmail|nodemailer|resend|sendgrid|mailgun|smtp returned zero hits. Consequences:
//   * Alex was never told a sale happened.
//   * The customer never received their service-intake link, so if they closed the
//     success tab the link was gone.
//   * contact.js inserted to `contact_messages` and notified nobody — a contact form
//     that emails no one.
// The only "notification" was db_schema/02_triggers.sql posting to 127.0.0.1:3133 — which
// is SUPABASE'S loopback, not Alex's PC. Unreachable by design, forever.
//
// This runs SERVER-SIDE in the Worker, so notification never depends on Alex's machine
// being awake. That was the whole reason the buy buttons stayed disabled for 32 days.
//
// No SDK — Workers have fetch, and the Resend REST API is one POST.
// Verified against https://resend.com/docs/api-reference/emails/send-email on 2026-07-19.

import { reviewSig } from './sign.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// ── MOJIBAKE DETECTION + REPAIR ─────────────────────────────────────────────
// Mojibake is what you get when UTF-8 bytes are read as Windows-1252: an em dash (U+2014,
// bytes E2 80 94) becomes "â€”". It is silent, it survives every syntax check, and it only
// becomes visible in the customer's inbox — which is the worst possible place to find it.
//
// THIS HAPPENED HERE. On 2026-07-19 a PowerShell edit read this file with Get-Content -Raw
// (system codepage), replaced a string, and wrote it back as UTF-8. That round-trip mangled
// all 26 em dashes. `node --check` passed. Nothing caught it until a human looked at a
// rendered preview.
//
// The lesson is not "be careful with encodings" — carefulness is not a control. The lesson
// is that anything customer-facing must be VALIDATED at the boundary, in code, every time.
const MOJIBAKE_RE = /â€|Ã‚|Ãƒ|Â[^\w\s]|â€™|â€œ|â€/;

// The exact sequences produced when common UTF-8 punctuation is misread as CP-1252.
// Ordered longest-first so multi-byte sequences are consumed before their prefixes.
const MOJIBAKE_MAP = [
  ['â€”', '—'],  // em dash
  ['â€“', '–'],  // en dash
  ['â€™', '’'],  // right single quote
  ['â€˜', '‘'],  // left single quote
  ['â€œ', '“'],  // left double quote
  ['â€', '”'],  // right double quote
  ['â€¦', '…'],  // ellipsis
  ['â€¢', '•'],  // bullet
  ['Â ', ' '],   // nbsp
  ['Ã©', 'é'], ['Ã¨', 'è'], ['Ã¡', 'á'],
  ['Ã³', 'ó'], ['Ãº', 'ú'], ['Ã±', 'ñ'],
];

/**
 * Repair mojibake in a string. Returns the input unchanged when it is already clean,
 * so this is safe to run on every send.
 */
export function repairMojibake(s) {
  if (!s || !MOJIBAKE_RE.test(s)) return s;
  let out = String(s);
  for (const [bad, good] of MOJIBAKE_MAP) out = out.split(bad).join(good);
  // A stray "Â" left before punctuation is the residue of a doubled encoding pass.
  out = out.replace(/Â(?=[^\w\s])/g, '');
  return out;
}

/**
 * Send one email. NEVER throws — returns {ok, id?, error?}.
 *
 * Callers are fulfilment paths (Stripe webhook). Fulfilment must NOT fail because an
 * email failed: the customer's entitlement is the thing that matters, and a bounced
 * notification is recoverable while a lost grant is not. But a silent email failure is
 * its own defect, so every failure is returned AND logged by the caller.
 *
 * @param {object} env      Worker env (needs RESEND_API_KEY, MAIL_FROM, OWNER_EMAIL)
 * @param {object} msg      { to, subject, html, text?, replyTo?, idempotencyKey? }
 */
export async function sendEmail(env, msg) {
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!msg || !msg.to || !msg.subject) {
    return { ok: false, error: 'to and subject are required' };
  }

  // MAIL_FROM must be on a domain verified in Resend, or every send 403s.
  const from = env.MAIL_FROM || 'UND Industries <orders@universalnetworkdevelopment.com>';

  const headers = {
    Authorization: 'Bearer ' + env.RESEND_API_KEY,
    'Content-Type': 'application/json',
  };

  // Stripe retries webhooks on any non-2xx, and our fulfilment is deliberately idempotent —
  // so without this a single order could email the customer several times. Resend honours
  // Idempotency-Key for 24h, which comfortably covers Stripe's retry window.
  if (msg.idempotencyKey) {
    headers['Idempotency-Key'] = String(msg.idempotencyKey).slice(0, 256);
  }

  // ── MOJIBAKE GUARD ────────────────────────────────────────────────────────
  // A receipt that reaches a paying customer full of "â€"" looks amateur and invites a
  // dispute. On 2026-07-19 this file itself shipped 26 mangled em dashes because a
  // PowerShell edit round-tripped it through the system codepage. Being careful is not a
  // control; this is. Every outbound message is repaired before it leaves.
  const subject = repairMojibake(msg.subject);
  const html = msg.html ? repairMojibake(msg.html) : null;
  const text = msg.text ? repairMojibake(msg.text) : null;
  const damaged = [msg.subject, msg.html, msg.text]
    .filter(Boolean).some(s => MOJIBAKE_RE.test(s));

  const body = {
    from,
    to: Array.isArray(msg.to) ? msg.to : [msg.to],
    subject,
  };
  if (html) body.html = html;
  if (text) body.text = text;
  if (msg.replyTo) body.reply_to = msg.replyTo;   // snake_case in the API

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: 'resend ' + res.status + ': ' + JSON.stringify(data) };
    }
    // The customer is protected either way, but a repair means a SOURCE file is damaged
    // and every other consumer of that text is still broken. Surface it so it gets fixed
    // at the root instead of being quietly patched on every send forever.
    return { ok: true, id: data && data.id, repairedEncoding: damaged };
  } catch (err) {
    return { ok: false, error: 'resend request failed: ' + err.message };
  }
}

/** Owner address, with a fallback so a missing env var never silences the alert entirely. */
export function ownerEmail(env) {
  return env.OWNER_EMAIL || 'contact.undindustries@gmail.com';
}

// ── EMAIL CHROME ────────────────────────────────────────────────────────────
// Written as TABLES with INLINE styles on purpose. Email is not the web:
//   * Outlook (desktop) renders with the WORD engine — no border-radius, no flexbox,
//     no grid, unreliable background-color on divs. Tables are the only safe layout.
//   * Gmail strips <style> blocks and anything in <head>, so every rule must be inline.
//   * A fully dark email is a deliverability and legibility risk: several clients
//     force-invert it and light-mode users get a black slab.
// So: a DARK BRANDED HEADER BAND (his palette, always renders — bgcolor on a <td> is
// the one background clients agree on) over a LIGHT, high-contrast body. Premium and
// bulletproof at the same time.
const WRAP_OPEN =
  // A FULL document, not a fragment — <head> is the only place to declare colour-scheme.
  //
  // WHY THAT MATTERS: Gmail and Outlook dark modes INVERT backgrounds. Our header band is
  // dark and the logo is white line art (measured: 88% near-white), so an inverted band
  // would make the logo disappear. Two defences, belt and braces:
  //   1. 'light only' asks clients not to invert at all.
  //   2. The logo PNG carries its own dark rounded plate BAKED IN, so it still reads in
  //      clients that ignore the declaration — the Gmail app frequently does.
  // charset is declared explicitly as well: without it some clients guess Latin-1 and
  // every em dash renders as mojibake.
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="color-scheme" content="light only">' +
  '<meta name="supported-color-schemes" content="light only">' +
  '</head><body style="margin:0;padding:0;background-color:#f2f2f5;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
  'style="background-color:#f2f2f5;margin:0;padding:24px 12px;">' +
  '<tr><td align="center">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ' +
  'style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e3e3e8;">' +
  // header band — logo centred over the dark plate.
  //
  // The logo is a PURPLE mark that was only ever available on a solid BLACK background
  // (docs/assets/img/und-logo-transparent.png is misnamed — it is Format24bppRgb, no
  // alpha at all). It was keyed to real transparency on 2026-07-19 -> und-logo-alpha.png,
  // and email-logo.png is the 440px/53KB version used here.
  //
  // Rules this obeys, because email is not the web:
  //   * ABSOLUTE https URL — a relative path resolves against the mail client, not the site
  //   * width/height as ATTRIBUTES, not just CSS — Outlook ignores CSS sizing on <img>
  //   * displayed at 220 from a 440 source, so it stays sharp on retina
  //   * ALT text carries the brand name, because most clients block images by default
  //     and a blocked logo must still read as "UND Industries", never as a broken box
  //   * the wordmark stays as TEXT under the image, so the email is complete with images off
  '<tr><td bgcolor="#0d0d16" style="background-color:#0d0d16;padding:30px 32px 26px;" align="center">' +
  '<img src="https://universalnetworkdevelopment.com/assets/img/email-logo.png" ' +
  'width="72" height="72" alt="UND Industries" ' +
  'style="display:block;margin:0 auto 12px;border:0;outline:none;text-decoration:none;' +
  'width:72px;height:72px;">' +
  '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;' +
  'color:#ffffff;letter-spacing:.02em;">UND <span style="color:#8b6cff;">Industries</span></div>' +
  '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:10px;' +
  'letter-spacing:.18em;text-transform:uppercase;color:#8f8fa3;margin-top:5px;">' +
  'Universal Network Development LLC</div>' +
  '</td></tr>' +
  // accent rule
  '<tr><td bgcolor="#7c5cff" style="background-color:#7c5cff;font-size:0;line-height:0;height:3px;">&nbsp;</td></tr>' +
  '<tr><td style="padding:34px 32px 30px;font-family:Segoe UI,Helvetica,Arial,sans-serif;' +
  'color:#1c1c22;font-size:15px;line-height:1.62;">';

const WRAP_CLOSE =
  '</td></tr>' +
  '<tr><td style="padding:20px 32px 26px;border-top:1px solid #e8e8ee;' +
  'font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6c6c78;">' +
  'Universal Network Development LLC<br>' +
  'Questions? Just reply to this email &mdash; it reaches us directly.<br>' +
  '<a href="mailto:contact.undindustries@gmail.com" style="color:#5b3fd6;text-decoration:none;">' +
  'contact.undindustries@gmail.com</a>' +
  '</td></tr></table></td></tr></table></body></html>';

// Bulletproof button. Outlook ignores padding on <a>, so the padding lives on a <td>
// with a background colour — the pattern that works everywhere without VML.
function btn(href, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px;">' +
    '<tr><td bgcolor="#7c5cff" style="background-color:#7c5cff;padding:14px 30px;">' +
    '<a href="' + href + '" style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;' +
    'font-weight:600;color:#ffffff;text-decoration:none;display:inline-block;">' + label + '</a>' +
    '</td></tr></table>';
}

// Hidden preheader — the grey line clients show next to the subject in the inbox list.
// Without it they scrape whatever text comes first, which looks accidental.
function preheader(text) {
  return '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;' +
    'font-size:1px;line-height:1px;color:#ffffff;">' + text +
    '&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>';
}

const BRAND_HEAD = WRAP_OPEN;
const BRAND_FOOT = WRAP_CLOSE;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * OWNER alert — a sale landed. This is the message whose absence kept the store closed.
 * Deliberately blunt and action-first: what sold, for how much, who, and what to do next.
 */
export function ownerSaleEmail(order) {
  const items = (order.items || []).map(i =>
    '<li style="margin:4px 0;">' + esc(i.name || i.slug) +
    (i.qty > 1 ? ' &times;' + i.qty : '') + '</li>').join('');

  return {
    subject: 'PAID: ' + (order.summary || 'new order') + ' — $' + (order.amount / 100).toFixed(2),
    html: BRAND_HEAD +
      '<h1 style="margin:0 0 6px;font-size:21px;color:#fff;">You got paid</h1>' +
      '<div style="font-size:30px;font-weight:700;color:#7c5cff;margin:10px 0 20px;">$' +
      (order.amount / 100).toFixed(2) + '</div>' +
      '<table style="width:100%;font-size:14px;border-collapse:collapse;">' +
      '<tr><td style="padding:6px 0;color:#9a9aa6;">Customer</td><td style="padding:6px 0;">' + esc(order.email || 'unknown') + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#9a9aa6;">Ticket</td><td style="padding:6px 0;">' + esc(order.ticket || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#9a9aa6;">Session</td><td style="padding:6px 0;font-size:12px;">' + esc(order.sessionId) + '</td></tr>' +
      '</table>' +
      (items ? '<ul style="margin:16px 0 0;padding-left:18px;font-size:14px;">' + items + '</ul>' : '') +
      '<div style="margin-top:22px;padding:14px;background:rgba(124,92,255,.12);border-radius:9px;font-size:14px;">' +
      '<strong>Next:</strong> wait for their intake (site URL + admin access), then the clock starts. ' +
      'Timeline is measured from when you receive access, not from payment.</div>' +
      BRAND_FOOT,
    text: 'PAID $' + (order.amount / 100).toFixed(2) + ' — ' + (order.summary || 'order') +
      '\nCustomer: ' + (order.email || 'unknown') + '\nTicket: ' + (order.ticket || '-') +
      '\nSession: ' + order.sessionId,
  };
}

/**
 * CUSTOMER confirmation — carries the intake link.
 * Without this, the link only ever existed on the success page: close the tab, lose it.
 */
export function customerConfirmEmail(order, origin) {
  const intake = order.ticket
    ? origin + '/service-intake.html?ticket=' + encodeURIComponent(order.ticket)
    : origin + '/dashboard.html';

  const rows = (order.items || []).map(i =>
    '<tr><td style="padding:9px 0;border-bottom:1px solid #eeeef2;font-size:14px;color:#1c1c22;">' +
    esc(i.name || i.slug) + (i.qty > 1 ? ' &times;' + i.qty : '') + '</td></tr>').join('');

  return {
    subject: 'Order confirmed — one step to start your ' + (order.summary || 'service'),
    html: preheader('We have your payment. Send your site details and we\'ll get started.') + BRAND_HEAD +

      '<h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;font-weight:700;color:#0d0d16;">' +
      'Thanks — we have your payment</h1>' +

      '<p style="margin:0 0 22px;color:#41414c;">Your order is confirmed. There\'s one quick step ' +
      'before we can start work.</p>' +

      // order summary card
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background-color:#fafafc;border:1px solid #e8e8ee;margin:0 0 26px;">' +
      '<tr><td style="padding:18px 20px;">' +
      '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7a7a88;' +
      'margin-bottom:10px;">Order summary</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      (rows || '<tr><td style="padding:9px 0;font-size:14px;">' + esc(order.summary || 'Service') + '</td></tr>') +
      '<tr><td style="padding:12px 0 0;font-size:16px;font-weight:700;color:#0d0d16;">Total paid: $' +
      (order.amount / 100).toFixed(2) + '</td></tr>' +
      (order.ticket ? '<tr><td style="padding:8px 0 0;font-size:13px;color:#6c6c78;">Reference: ' +
        esc(order.ticket) + '</td></tr>' : '') +
      '</table></td></tr></table>' +

      '<h2 style="margin:0 0 10px;font-size:17px;font-weight:700;color:#0d0d16;">Next step</h2>' +
      '<p style="margin:0 0 18px;color:#41414c;">Send us your site URL and working admin access ' +
      'so we can begin:</p>' +

      btn(esc(intake), 'Send my site details &rarr;') +

      '<p style="margin:18px 0 26px;font-size:13px;color:#6c6c78;">' +
      'Or paste this into your browser:<br>' +
      '<span style="color:#5b3fd6;word-break:break-all;">' + esc(intake) + '</span></p>' +

      // the important expectations, set once, plainly
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background-color:#fdf8ec;border-left:3px solid #d9a441;margin:0 0 22px;">' +
      '<tr><td style="padding:16px 18px;font-size:14px;line-height:1.6;color:#4a3d22;">' +
      '<strong style="color:#3d3218;">Please back up your site before we start.</strong><br>' +
      'We work carefully, but we can\'t be responsible for data that wasn\'t backed up. ' +
      'If you\'re not sure how, reply and we\'ll walk you through it.' +
      '</td></tr></table>' +

      '<p style="margin:0 0 8px;font-size:14px;color:#41414c;">' +
      '<strong style="color:#0d0d16;">Your delivery window starts when we receive your access</strong> ' +
      '— not at payment — so the sooner you send it, the sooner we start.</p>' +

      '<p style="margin:22px 0 0;color:#41414c;">Anything unclear, just reply to this email. ' +
      'It comes straight to us.</p>' +

      BRAND_FOOT,

    text: 'Thanks — we have your payment.\n\n' +
      'ORDER SUMMARY\n' +
      (order.items || []).map(i => '  - ' + (i.name || i.slug) + (i.qty > 1 ? ' x' + i.qty : '')).join('\n') +
      '\n  Total paid: $' + (order.amount / 100).toFixed(2) +
      (order.ticket ? '\n  Reference: ' + order.ticket : '') +
      '\n\nNEXT STEP — send your site URL and admin access:\n' + intake +
      '\n\nPlease back up your site before we start. We work carefully, but we cannot be ' +
      'responsible for data that was not backed up.\n\n' +
      'Your delivery window starts when we receive your access, not at payment.\n\n' +
      'Questions? Reply to this email — it comes straight to us.\n' +
      'UND Industries — contact.undindustries@gmail.com',
  };
}

/**
 * JOB COMPLETE — delivery notice + review request.
 *
 * Sent when Alex marks a service delivered. Two jobs in one email:
 *   1. Tell them the work is done and what was done (this is the delivery record that
 *      MSA section 8 hangs on — "deemed accepted 7 days after delivery" only means
 *      something if delivery was actually communicated and timestamped).
 *   2. Ask for a 1-5 star review while the work is fresh.
 *
 * REVIEW ETHICS — deliberate, do not "optimise" this away:
 * Every rating gets the SAME public review link. We do NOT route 4-5 stars to a public
 * page and 1-3 stars into a private inbox. That practice is "review gating" and the FTC
 * has acted against it; it is also just dishonest. Low raters additionally get an easy
 * "tell us what went wrong" path, but nobody is BLOCKED from reviewing publicly.
 */
export async function serviceCompleteEmail(env, job, origin, reviewUrl) {
  // '/review' — NOT '/api/review'. The handler is functions/api/review.js, which Cloudflare Pages
  // routes at /api/review; there is no docs/review.html and no _redirects file, so every star in
  // every completion email pointed at a 404. The two halves were written to different addresses
  // and nothing ever compared them, because the sending half had never actually run (the customer
  // email address was read from the wrong column, so `to` was null on every delivery — see
  // admin-job.js:365). Two silent faults hid each other: the link nobody could click was broken,
  // and the endpoint nobody could reach was wide open.
  //
  // `sig` makes the link unforgeable — see util/sign.js for the poisoning attack it closes.
  const ticket = job.ticket || '';
  const sigs = await Promise.all([1, 2, 3, 4, 5].map((n) => reviewSig(env, ticket, n)));
  const rate = (n) => origin + '/api/review?ticket=' + encodeURIComponent(ticket) +
    '&rating=' + n + '&sig=' + encodeURIComponent(sigs[n - 1]);

  // Stars as individual linked cells — an <a> per rating. Emails cannot run JS, so the
  // rating has to be carried in the URL and captured server-side on click.
  const stars = [1, 2, 3, 4, 5].map(n =>
    '<td style="padding:0 3px;">' +
    '<a href="' + rate(n) + '" style="display:inline-block;text-decoration:none;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td bgcolor="#fbf3e0" style="background-color:#fbf3e0;border:1px solid #e6d3a8;' +
    'width:46px;height:44px;text-align:center;vertical-align:middle;' +
    'font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:20px;color:#d9a441;' +
    'line-height:44px;">&#9733;</td></tr></table></a></td>').join('');

  const done = (job.workDone || []).map(w =>
    '<tr><td style="padding:7px 0;border-bottom:1px solid #eeeef2;font-size:14px;color:#1c1c22;">' +
    '<span style="color:#3d9a5f;font-weight:700;">&#10003;</span>&nbsp; ' + esc(w) + '</td></tr>').join('');

  return {
    subject: (job.summary || 'Your service') + ' is complete',
    html: preheader('Your work is done. Mind rating us out of 5?') + BRAND_HEAD +

      '<h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;font-weight:700;color:#0d0d16;">' +
      'All done &mdash; your ' + esc(job.summary || 'service') + ' is complete</h1>' +

      '<p style="margin:0 0 22px;color:#41414c;">Hi' + (job.name ? ' ' + esc(job.name) : '') +
      ', the work you ordered is finished and live. Here&rsquo;s exactly what we did:</p>' +

      (done
        ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
          'style="background-color:#fafafc;border:1px solid #e8e8ee;margin:0 0 24px;">' +
          '<tr><td style="padding:16px 20px;">' +
          '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7a7a88;' +
          'margin-bottom:8px;">Work completed</div>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
          done + '</table></td></tr></table>'
        : '') +

      // ── the ask ──
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background-color:#0d0d16;margin:0 0 24px;">' +
      '<tr><td align="center" style="padding:26px 20px;">' +
      '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;' +
      'color:#ffffff;margin-bottom:6px;">How did we do?</div>' +
      '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;color:#a9a9bb;' +
      'margin-bottom:16px;">One tap. It genuinely helps a small business.</div>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>' +
      stars + '</tr></table>' +
      '</td></tr></table>' +

      (reviewUrl
        ? '<p style="margin:0 0 6px;color:#41414c;font-size:14px;">' +
          'If you have 30 seconds, a public review helps more than anything else we could ask for:</p>' +
          btn(esc(reviewUrl), 'Leave a review &rarr;') +
          '<p style="margin:14px 0 24px;font-size:13px;color:#6c6c78;">' +
          'And if anything fell short, reply to this email first &mdash; we&rsquo;d rather fix it than ' +
          'have you stuck with it.</p>'
        : '<p style="margin:0 0 24px;font-size:14px;color:#41414c;">' +
          'If anything fell short, just reply &mdash; we&rsquo;d rather fix it than have you stuck with it.</p>') +

      // warranty, stated once, where it is useful rather than defensive
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background-color:#f4f1fd;border-left:3px solid #7c5cff;margin:0 0 20px;">' +
      '<tr><td style="padding:15px 18px;font-size:14px;line-height:1.6;color:#31314a;">' +
      '<strong style="color:#1c1c22;">You&rsquo;re covered for 14 days.</strong><br>' +
      'If something we fixed stops working because of how we did it, tell us within 14 days ' +
      'and we&rsquo;ll correct it at no charge.' +
      '</td></tr></table>' +

      '<p style="margin:0;color:#41414c;">Thanks for trusting us with it.' +
      (job.ticket ? '<br><span style="font-size:13px;color:#6c6c78;">Reference: ' +
        esc(job.ticket) + '</span>' : '') + '</p>' +

      BRAND_FOOT,

    text: 'All done - your ' + (job.summary || 'service') + ' is complete.\n\n' +
      (job.workDone && job.workDone.length
        ? 'WORK COMPLETED\n' + job.workDone.map(w => '  - ' + w).join('\n') + '\n\n' : '') +
      'HOW DID WE DO? Rate us 1-5:\n' +
      [1, 2, 3, 4, 5].map(n => '  ' + n + ' star' + (n > 1 ? 's' : '') + ': ' + rate(n)).join('\n') +
      (reviewUrl ? '\n\nLeave a public review: ' + reviewUrl : '') +
      '\n\nIf anything fell short, reply to this email first - we would rather fix it.\n\n' +
      'YOU ARE COVERED FOR 14 DAYS. If something we fixed stops working because of how we ' +
      'did it, tell us within 14 days and we will correct it at no charge.\n\n' +
      'Thanks for trusting us with it.\n' +
      (job.ticket ? 'Reference: ' + job.ticket + '\n' : '') +
      'UND Industries - contact.undindustries@gmail.com',
  };
}

/** OWNER alert for a contact-form message that would otherwise sit unseen in a table. */
export function ownerContactEmail(msg) {
  return {
    subject: 'Contact form: ' + (msg.subject || '(no subject)'),
    html: BRAND_HEAD +
      '<h1 style="margin:0 0 14px;font-size:19px;color:#fff;">New message</h1>' +
      '<table style="width:100%;font-size:14px;">' +
      '<tr><td style="padding:5px 0;color:#9a9aa6;">From</td><td>' + esc(msg.name) + ' &lt;' + esc(msg.email) + '&gt;</td></tr>' +
      '<tr><td style="padding:5px 0;color:#9a9aa6;">Subject</td><td>' + esc(msg.subject) + '</td></tr></table>' +
      '<div style="margin-top:16px;padding:14px;background:rgba(255,255,255,.05);border-radius:9px;' +
      'font-size:14px;line-height:1.6;white-space:pre-wrap;">' + esc(msg.message) + '</div>' +
      BRAND_FOOT,
    text: 'From: ' + msg.name + ' <' + msg.email + '>\nSubject: ' + msg.subject + '\n\n' + msg.message,
  };
}
