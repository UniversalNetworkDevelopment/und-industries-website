// functions/api/review.js
// GET /api/review?ticket=UND-...&rating=1..5
//
// The star links in the job-complete email point here. Email cannot run JavaScript, so the
// rating travels in the URL and is captured on click, then the customer is redirected to a
// thank-you page.
//
// REVIEW ETHICS — deliberate, do not "optimise" this away:
// Every rating is recorded and EVERY customer sees the same public-review link on the
// thank-you page. We do NOT send 4-5 stars to a public review site and quietly divert 1-3
// into a private inbox. That practice is "review gating"; the FTC has taken action over it,
// and it makes the public rating a lie. Low raters get an ADDITIONAL "tell us what went
// wrong" prompt — an extra path, never a substitute.
//
// SECURITY: this is an unauthenticated GET, because it is clicked from an email client
// that carries no session. So it is written to be safe when abused:
//   * rating is clamped to 1-5 and must be an integer
//   * ticket must match the UND-xxxx-xxxxx shape (no injection surface)
//   * one rating per ticket — later clicks do not overwrite the first
//   * no PII is echoed back into the page
//   * it can only ever write a rating; it cannot read or alter an order

import { json } from '../util/cors.js';

const TICKET_RE = /^UND-\d{4}-\d{4,6}$/;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ticket = String(url.searchParams.get('ticket') || '').trim();
  const ratingRaw = String(url.searchParams.get('rating') || '').trim();
  const rating = parseInt(ratingRaw, 10);

  const origin = url.origin;
  const fail = (why) => Response.redirect(origin + '/review-thanks.html?status=' + why, 302);

  if (!TICKET_RE.test(ticket)) return fail('badref');
  if (!(rating >= 1 && rating <= 5)) return fail('badrating');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail('unconfigured');

  try {
    // One rating per ticket. A second click must not silently change the score — if the
    // customer wants to revise it, that is a conversation, not a URL parameter.
    const existing = await fetch(
      env.SUPABASE_URL + '/rest/v1/service_reviews?select=id&ticket_number=eq.' +
      encodeURIComponent(ticket) + '&limit=1',
      { headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      } }
    ).then(r => r.ok ? r.json() : null).catch(() => null);

    if (existing && existing.length) {
      return Response.redirect(origin + '/review-thanks.html?status=already&r=' + rating, 302);
    }

    const res = await fetch(env.SUPABASE_URL + '/rest/v1/service_reviews', {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        ticket_number: ticket,
        rating,
        source: 'email',
        ip: request.headers.get('cf-connecting-ip') || null,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[review] insert failed:', res.status, detail);
      return fail('savefailed');
    }

    // Tell the owner immediately. A 5 is worth asking for a public review while they are
    // still warm; a 1 or 2 is a problem with a clock on it, and finding out days later via
    // a dashboard nobody opens is how a fixable complaint becomes a chargeback.
    try {
      const { sendEmail, ownerEmail } = await import('../util/email.js');
      const low = rating <= 3;
      await sendEmail(env, {
        to: ownerEmail(env),
        subject: (low ? 'LOW RATING ' : 'Rated ') + rating + '/5 — ' + ticket,
        html:
          '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;">' +
          '<p style="font-size:26px;margin:0 0 8px;">' + '&#9733;'.repeat(rating) +
          '<span style="color:#c9c9d4;">' + '&#9733;'.repeat(5 - rating) + '</span></p>' +
          '<p style="margin:0 0 6px;"><b>' + rating + ' out of 5</b> for ' + ticket + '</p>' +
          (low
            ? '<p style="margin:12px 0 0;padding:12px;background:#fdecec;border-left:3px solid #d95757;">' +
              '<b>Reach out today.</b> A low rating you answer quickly is usually recoverable. ' +
              'One you ignore turns into a public review or a chargeback.</p>'
            : '<p style="margin:12px 0 0;padding:12px;background:#eefaf1;border-left:3px solid #3d9a5f;">' +
              '<b>Ask for the public review now</b>, while they are still happy.</p>') +
          '</div>',
        text: rating + '/5 for ' + ticket + (low ? ' — LOW. Reach out today.' : ' — ask for a public review.'),
      });
    } catch (_) { /* the rating is already saved; a failed alert must not lose it */ }

    return Response.redirect(origin + '/review-thanks.html?status=ok&r=' + rating, 302);
  } catch (err) {
    console.error('[review] error:', err.message);
    return fail('error');
  }
}

export async function onRequestPost(context) {
  return json({ error: 'Use GET.' }, 405, context.request, context.env);
}
