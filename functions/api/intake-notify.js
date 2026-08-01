// functions/api/intake-notify.js
// POST /api/intake-notify   Body: { ticket }
//
// THE GAP THIS CLOSES:
// Payment emails the owner. The moment work can ACTUALLY START — the customer handing over
// their site URL and admin access — did not. Alex had to notice it by opening a dashboard.
// The delivery clock in MSA section 7 starts at access, not payment, so this is the moment
// that matters most and it was the one nobody was told about.
//
// The intake form updates the ticket directly via Supabase (RLS lets a buyer update their
// OWN ticket while intake_status='awaiting_intake'). So this endpoint exists purely to
// notify. It is called by the client after a successful update.
//
// SECURITY: called from the browser, so it is written to be harmless when abused.
//   * It NEVER trusts the caller for content — it re-reads the ticket server-side.
//   * It only proceeds if the ticket really is `submitted`. A forged call about a ticket
//     that has not had intake does nothing.
//   * It returns no customer data to the caller.
//   * Rate limited per IP (added 2026-08-01).
//
// THE CLAIM THAT WAS WRONG (audited 2026-08-01):
// This header used to end "worst case abuse is a duplicate email to the OWNER" and claim the
// endpoint "cannot be used to probe tickets". Both were too generous. Ticket numbers are
// SEQUENTIAL — the live table runs UND-2606-01001, 01002, 01003 — so the range is walkable, and
// there was no limit on how fast. Worst case was therefore not one duplicate email but an
// unbounded flood to the owner's inbox, which burns the Resend quota and can get the sending
// domain flagged as a spam source — that would take out every transactional email the business
// runs on, including receipts. And {ok:true} vs {ok:false} IS a probe: it confirms which ticket
// numbers exist and are awaiting work. It reveals nothing about who or what, so the oracle is
// minor, but "cannot be used to probe" was simply not true.

import { json, preflight } from '../util/cors.js';
import { sendEmail, ownerEmail } from '../util/email.js';
import { getCustomerEmail } from '../util/supabase.js';
import { allow, callerIp } from '../util/ratelimit.js';

const TICKET_RE = /^UND-\d{4}-\d{4,6}$/;

export async function onRequestOptions({ request, env }) {
  return preflight(request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false }, 200, request, env);   // never block the customer's flow
  }

  // 5 per minute. A real customer submits intake once, so this is far above any honest use and
  // far below what makes flooding worthwhile. Returns the same {ok:false} shape as every other
  // rejection: a limiter that announces itself just tells the caller how to pace around it.
  if (!allow('intake-notify', callerIp(request), 5, 60_000)) {
    return json({ ok: false }, 200, request, env);
  }

  let ticket = '';
  try {
    const body = await request.json();
    ticket = String(body.ticket || '').trim();
  } catch (_) {
    return json({ ok: false }, 200, request, env);
  }
  if (!TICKET_RE.test(ticket)) return json({ ok: false }, 200, request, env);

  try {
    // Re-read server-side. The caller's claim about state is not evidence.
    //
    // `order_details`, NOT `intake_data` — there is no intake_data column and never has been, so
    // this select returned HTTP 400 (Postgres 42703) and the `r.ok ? r.json() : null` below turned
    // it into null. The handler then returned `{ok:false}` with HTTP 200: the customer's browser
    // saw success, the owner NEVER got the "access received" email, and nothing was logged
    // anywhere. MSA §7 starts the delivery clock at access — this was the exact moment nobody was
    // ever told about, and it failed behind a 200. See docs/assets/js/service-intake.js:357 for
    // the write side; the two were introduced in the same commit (5430fe9) and never matched.
    //
    // `user_id` is selected because the customer's email address is NOT in the ticket JSON.
    const rows = await fetch(
      env.SUPABASE_URL + '/rest/v1/service_tickets' +
      '?select=ticket_number,service_name,service_slug,intake_status,status,order_details,user_id' +
      '&ticket_number=eq.' + encodeURIComponent(ticket) + '&limit=1',
      { headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      } }
    ).then(r => (r.ok ? r.json() : null)).catch(() => null);

    const t = rows && rows[0];
    if (!t) return json({ ok: false }, 200, request, env);
    if (t.intake_status !== 'submitted') {
      // Not actually ready — do not cry wolf.
      return json({ ok: false }, 200, request, env);
    }

    const d = t.order_details || {};
    // THE KEYS HAVE TO MATCH THE WRITER, NOT WHAT SOUNDS RIGHT. This email asked for `site_url`,
    // `platform`, `contact_email` and `description`. The intake form
    // (docs/assets/js/service-intake.js:357-390) writes exactly: target_url, problem,
    // desired_outcome, notes, access_method_label, submitted_at, access_authorization. So even
    // once the column name was fixed, every row in this table would have rendered BLANK — a
    // delivered email that says nothing, which is worse than no email because it looks handled.
    // The two most valuable fields the customer actually gives us (problem, desired_outcome) were
    // not being shown at all.
    const contact = await getCustomerEmail(env, t.user_id).catch(() => null);
    const line = (k, v) => v
      ? '<tr><td style="padding:6px 12px 6px 0;color:#6c6c78;font-size:13px;white-space:nowrap;">' +
        k + '</td><td style="padding:6px 0;font-size:14px;color:#1c1c22;">' + esc(v) + '</td></tr>'
      : '';

    await sendEmail(env, {
      to: ownerEmail(env),
      subject: 'READY TO START: ' + (t.service_name || t.service_slug || 'job') + ' — ' + ticket,
      html:
        '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;">' +
        '<h2 style="margin:0 0 6px;font-size:19px;color:#0d0d16;">Access received — the clock starts now</h2>' +
        '<p style="margin:0 0 16px;color:#41414c;font-size:14px;">' +
        esc(t.service_name || t.service_slug || 'Service') + ' &middot; ' + esc(ticket) + '</p>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ' +
        'style="width:100%;background:#fafafc;border:1px solid #e8e8ee;padding:14px 16px;">' +
        line('Site', d.target_url) +
        line('Problem', d.problem) +
        line('Wanted', d.desired_outcome) +
        line('Access', d.access_method_label) +
        line('Contact', contact) +
        line('Notes', d.notes) +
        '</table>' +
        '<p style="margin:16px 0 0;padding:12px 14px;background:#f4f1fd;border-left:3px solid #7c5cff;' +
        'font-size:14px;color:#31314a;">Your stated delivery window is measured from <b>now</b>, ' +
        'not from when they paid. Credentials are in the ticket — treat them as sensitive and ' +
        'ask them to rotate after delivery.</p>' +
        '</div>',
      text: 'ACCESS RECEIVED — ' + ticket + '\n' +
        (t.service_name || t.service_slug || 'Service') + '\n\n' +
        'Site: ' + (d.target_url || '(see ticket)') + '\n' +
        'Problem: ' + (d.problem || '-') + '\n' +
        'Wanted: ' + (d.desired_outcome || '-') + '\n' +
        'Access: ' + (d.access_method_label || '-') + '\n' +
        'Contact: ' + (contact || '(unknown)') + '\n\n' +
        'Delivery window starts NOW, not at payment.',
    });

    return json({ ok: true }, 200, request, env);
  } catch (err) {
    console.error('[intake-notify]', err.message);
    return json({ ok: false }, 200, request, env);   // never surface a failure to the customer
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
