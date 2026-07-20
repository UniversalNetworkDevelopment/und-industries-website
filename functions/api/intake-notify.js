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
//   * It returns no customer data to the caller, so it cannot be used to probe tickets.
//   * Worst case abuse is a duplicate email to the OWNER about a genuine ticket.

import { json, preflight } from '../util/cors.js';
import { sendEmail, ownerEmail } from '../util/email.js';

const TICKET_RE = /^UND-\d{4}-\d{4,6}$/;

export async function onRequestOptions({ request, env }) {
  return preflight(request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false }, 200, request, env);   // never block the customer's flow
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
    const rows = await fetch(
      env.SUPABASE_URL + '/rest/v1/service_tickets' +
      '?select=ticket_number,service_name,service_slug,intake_status,status,intake_data' +
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

    const d = t.intake_data || {};
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
        line('Site', d.site_url || d.website || d.url) +
        line('Platform', d.platform) +
        line('Contact', d.contact_email || d.email) +
        line('Notes', d.notes || d.description) +
        '</table>' +
        '<p style="margin:16px 0 0;padding:12px 14px;background:#f4f1fd;border-left:3px solid #7c5cff;' +
        'font-size:14px;color:#31314a;">Your stated delivery window is measured from <b>now</b>, ' +
        'not from when they paid. Credentials are in the ticket — treat them as sensitive and ' +
        'ask them to rotate after delivery.</p>' +
        '</div>',
      text: 'ACCESS RECEIVED — ' + ticket + '\n' +
        (t.service_name || t.service_slug || 'Service') + '\n\n' +
        'Site: ' + (d.site_url || d.website || d.url || '(see ticket)') + '\n' +
        'Platform: ' + (d.platform || '-') + '\n\n' +
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
