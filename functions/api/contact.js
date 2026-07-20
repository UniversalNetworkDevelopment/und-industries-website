// functions/api/contact.js
// POST /api/contact — server-side validated, rate-limited contact form submission.
//
// Accepts an optional Authorization: Bearer <supabase-access-token> to associate
// the message with a logged-in user. Anonymous submissions are allowed (user_id null).
//
// Rate limit: 3 submissions per IP per 60 seconds.
// Uses a module-level Map — per-worker-instance, not globally coordinated. Good
// enough to stop simple bots; Cloudflare WAF rules provide the distributed layer.

import { json, preflight } from '../util/cors.js';
import { sendEmail, ownerEmail, ownerContactEmail } from '../util/email.js';
import { getUserFromToken  } from '../util/supabase.js';

const _rl         = new Map(); // ip -> { count: number, resetAt: number }
const RL_MAX      = 3;
const RL_WINDOW   = 60_000; // ms

function checkRateLimit(ip) {
  const now  = Date.now();
  const slot = _rl.get(ip);
  if (!slot || now >= slot.resetAt) {
    _rl.set(ip, { count: 1, resetAt: now + RL_WINDOW });
    return true;
  }
  if (slot.count >= RL_MAX) return false;
  slot.count++;
  return true;
}

const NAME_MAX    = 200;
const EMAIL_MAX   = 500;
const SUBJECT_MAX = 300;
const MSG_MIN     = 2;
const MSG_MAX     = 5000;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestOptions({ request, env }) {
  return preflight(request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Contact form is not configured.' }, 503, request, env);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(ip)) {
    return json({ error: 'Too many submissions. Please wait a minute before trying again.' }, 429, request, env);
  }

  let body;
  try { body = await request.json(); }
  catch (_) { return json({ error: 'Invalid request body.' }, 400, request, env); }

  const name    = String(body.name    ?? '').trim();
  const email   = String(body.email   ?? '').trim();
  const subject = String(body.subject ?? '').trim();
  const message = String(body.message ?? '').trim();

  if (!name || name.length > NAME_MAX)
    return json({ error: 'Name is required (max ' + NAME_MAX + ' characters).' }, 400, request, env);
  if (!email || !EMAIL_RE.test(email) || email.length > EMAIL_MAX)
    return json({ error: 'A valid email address is required.' }, 400, request, env);
  if (!subject || subject.length > SUBJECT_MAX)
    return json({ error: 'Subject is required (max ' + SUBJECT_MAX + ' characters).' }, 400, request, env);
  if (message.length < MSG_MIN || message.length > MSG_MAX)
    return json({ error: 'Message must be ' + MSG_MIN + '–' + MSG_MAX + ' characters.' }, 400, request, env);

  // Resolve user id from bearer token if provided (anonymous submissions are fine).
  const authHeader = request.headers.get('Authorization') || '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  let   userId     = null;
  if (token && env.SUPABASE_ANON_KEY) {
    const user = await getUserFromToken(env, token);
    userId = user ? (user.id ?? null) : null;
  }

  // Insert via service role — we control all validation, RLS is bypassed intentionally.
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/contact_messages', {
    method:  'POST',
    headers: {
      apikey:         env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization:  'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify({ user_id: userId, name, email, subject, message }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[contact] Supabase insert failed:', res.status, detail);
    return json({ error: 'Message could not be saved. Please try again later.' }, 502, request, env);
  }

  // ── NOTIFY THE OWNER (added 2026-07-19) ───────────────────────────────────
  // Until now this endpoint inserted to `contact_messages` and told nobody. A contact
  // form that emails no one is worse than no contact form: the customer believes they
  // reached someone. And with the services buy buttons disabled, "Inquire Now" -> this
  // form was the ONLY conversion path on the site — every message landed in a table
  // nobody was watching.
  //
  // Non-fatal by design: the message is already saved, so a mail failure must never tell
  // the customer their message was lost. It IS logged, so the failure is not silent.
  try {
    const mail = ownerContactEmail({ name, email, subject, message });
    const sent = await sendEmail(env, {
      to: ownerEmail(env),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo: email,          // hitting reply answers the customer directly
    });
    if (!sent.ok) console.error('[contact] owner notification failed:', sent.error);
  } catch (err) {
    console.error('[contact] owner notification threw:', err.message);
  }

  return json({ ok: true }, 200, request, env);
}
