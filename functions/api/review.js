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
// SECURITY: this is an unauthenticated GET, because it is clicked from an email client that
// carries no session. It therefore has to be safe when called by anyone, in any order, forever.
//
// WHAT THE ORIGINAL GUARDS ACTUALLY BOUGHT (audited 2026-08-01):
// The list below used to read "rating clamped 1-5, ticket shape enforced, one rating per ticket,
// no PII echoed, cannot alter an order" — and every line was true and the endpoint was still
// forgeable by anybody. Shape validation is not authentication. Ticket numbers are SEQUENTIAL
// (the live table runs UND-2606-01001, 01002, 01003 ...), there is no foreign key on
// service_reviews.ticket_number, and this handler holds the SERVICE ROLE key so RLS never
// applied to it. Anyone could rate any ticket, including ones that did not exist yet.
//
// Worse, "one rating per ticket" turned from a protection into the payload: with a UNIQUE index
// and first-write-wins, an attacker could pre-stamp 1-star rows across the whole number range,
// and a real customer's genuine 5-star click would later come back 'already' and be discarded.
//
// SO THE GUARDS ARE NOW:
//   * sig  — HMAC over (ticket, rating). Only WE can mint a link, and only after delivery.
//            Bound to the rating too, so a 5-star link cannot be edited into a 1-star one.
//   * the ticket must EXIST, be paid, and be delivered — no rating a job that never happened.
//   * rating clamped 1-5, ticket shape enforced (kept: cheap, and they bound the input space)
//   * one rating per ticket — now safe, because only a real customer can hold a valid link
//   * no PII echoed back into the page; it can only ever write a rating

import { json } from '../util/cors.js';
import { reviewSigValid } from '../util/sign.js';

const TICKET_RE = /^UND-\d{4}-\d{4,6}$/;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ticket = String(url.searchParams.get('ticket') || '').trim();
  const ratingRaw = String(url.searchParams.get('rating') || '').trim();
  const rating = parseInt(ratingRaw, 10);
  const sig = String(url.searchParams.get('sig') || '').trim();

  const origin = url.origin;
  const fail = (why) => Response.redirect(origin + '/review-thanks.html?status=' + why, 302);

  if (!TICKET_RE.test(ticket)) return fail('badref');
  if (!(rating >= 1 && rating <= 5)) return fail('badrating');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail('unconfigured');

  // THE gate. Checked before any database work so an unsigned flood costs one HMAC and nothing
  // else — no query, no insert, no email to Alex. Fails CLOSED: if the signing key is missing,
  // reviewSigValid returns false and nothing is written. A review feature that is briefly
  // unavailable is a much smaller problem than a rating table anyone can author.
  if (!(await reviewSigValid(env, ticket, rating, sig))) return fail('badsig');

  try {
    // Defence in depth. The signature already proves we minted this link, so in normal operation
    // this check never fires. It exists because the signing key is shared with other server-side
    // uses, and because a rating attached to a job that was never delivered would corrupt the one
    // number a prospective customer actually looks at. 'complete' is accepted alongside
    // 'delivered' for the same reason admin-job.js:165 accepts it — it is the invalid value the
    // old code wrote, and those tickets are genuinely delivered.
    const job = await fetch(
      env.SUPABASE_URL + '/rest/v1/service_tickets?select=status,intake_status&ticket_number=eq.' +
      encodeURIComponent(ticket) + '&limit=1',
      { headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      } }
    ).then(r => r.ok ? r.json() : null).catch(() => null);

    const j = job && job[0];
    if (!j) return fail('badref');
    if (j.status !== 'paid') return fail('notdelivered');
    if (j.intake_status !== 'delivered' && j.intake_status !== 'complete') return fail('notdelivered');

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
