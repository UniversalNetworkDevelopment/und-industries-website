// functions/api/admin-job.js
// POST /api/admin-job   Body: { ticket, action: 'start' | 'deliver' | 'note', workDone?, note? }
//
// (Cloudflare Pages maps functions/api/admin-job.js to /api/admin-job — NOT /api/admin/job.
//  A nested path would need functions/api/admin/job.js. Corrected after checking, because a
//  wrong route in a comment is how the next person wastes an hour.)
// Auth: Authorization: Bearer <supabase access token>   (must be the OWNER)
//
// THE GAPS THIS CLOSES (found by tracing on 2026-07-19):
//   1. `intake_status` values 'in_progress' and 'complete' were READ by the customer's
//      dashboard (service-intake.js:121) but **no code anywhere wrote them**. A job being
//      worked on and a job finished looked identical to the customer, forever.
//   2. Nothing ever marked a job DELIVERED, so the job-complete + review email had no
//      trigger and could never send.
//   3. Nothing wrote `product_usage_proof`. MSA section 10.5 promises to contest disputes
//      "with evidence of delivery and acceptance" — there was no evidence to submit.
//
// One endpoint, because these are the same act: move the job forward and leave a record.
//
// WHY OWNER-ONLY AND NOT A SHARED SECRET:
// A static admin token in a URL or header leaks into logs, browser history, and screenshots,
// and cannot be revoked per-person. This checks the caller's Supabase JWT against
// OWNER_USER_ID, so access follows the account and dies with the session.

import { json, preflight } from '../util/cors.js';
import { getUserFromToken, logEvent, getCustomerEmail } from '../util/supabase.js';
import { sendEmail, ownerEmail, serviceCompleteEmail } from '../util/email.js';

const TICKET_RE = /^UND-\d{4}-\d{4,6}$/;

// Constant-time compare. A plain === leaks key material through response timing: an attacker
// can discover the secret one character at a time by measuring how long the rejection takes.
// Always compares the full length so it cannot exit early on the first mismatch.
function timingSafeEqual(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function onRequestOptions({ request, env }) {
  return preflight(request, env);
}

async function sb(env, path, init) {
  return fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      ...(init && init.headers),
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OWNER_USER_ID']) {
    if (!env[k]) return json({ error: 'Not configured — missing ' + k }, 503, request, env);
  }

  // ── auth path A: an internal AGENT (Qwep / Nexus) via shared service key ───
  // WHY THIS EXISTS: delivery was implemented THREE times — here, in
  // UND-Nexus/routes/orders.js, and in E:\Qwep\ticket-relay.js. Only this one emails the
  // customer, so a job delivered by Qwep or Nexus left the customer never told the work was
  // done and never asked for the review. Duplicating the email into each agent would just
  // move the bug (two templates drift). Instead the agents call THIS endpoint, so there is
  // exactly one delivery implementation and one place a customer notification can break.
  //
  // A shared secret, not a user JWT: these are headless daemons with no interactive login.
  // It is compared in constant time, never logged, and is a DIFFERENT secret from the
  // Supabase service key, so leaking one does not grant the other. If AGENT_SERVICE_KEY is
  // unset the header path is simply unavailable — it never degrades to "allow".
  const agentKey = request.headers.get('x-und-agent-key') || '';
  let isAgent = false;
  if (agentKey) {
    if (!env.AGENT_SERVICE_KEY) {
      return json({ error: 'Agent auth not configured on this deployment.' }, 503, request, env);
    }
    if (!timingSafeEqual(agentKey, env.AGENT_SERVICE_KEY)) {
      await logEvent(env, {
        user_id: null, action: 'admin_job_bad_agent_key', severity: 'warning',
        ip: request.headers.get('cf-connecting-ip') || 'unknown',
        device_fingerprint: request.headers.get('user-agent') || 'unknown',
        detail: 'bad X-UND-Agent-Key on /api/admin-job',
      });
      return json({ error: 'Not permitted.' }, 403, request, env);
    }
    isAgent = true;
  }

  // ── auth path B: the owner, signed in ─────────────────────────────────────
  const auth = request.headers.get('Authorization') || '';
  const token = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  const user = isAgent ? null : await getUserFromToken(env, token);
  if (!isAgent && (!user || !user.id)) return json({ error: 'Sign in required.' }, 401, request, env);
  if (!isAgent && user.id !== env.OWNER_USER_ID) {
    // Log it — someone authenticated probing an admin route is worth knowing about.
    await logEvent(env, {
      user_id: user.id, action: 'admin_job_forbidden', severity: 'warning',
      ip: request.headers.get('cf-connecting-ip') || 'unknown',
      device_fingerprint: request.headers.get('user-agent') || 'unknown',
      detail: 'non-owner called /api/admin/job',
    });
    return json({ error: 'Not permitted.' }, 403, request, env);
  }

  let body;
  try { body = await request.json(); }
  catch (_) { return json({ error: 'Invalid body.' }, 400, request, env); }

  const ticket = String(body.ticket || '').trim();
  const action = String(body.action || '').trim();

  // Who is doing this, for the delivery record. An agent may name itself ('qwep', 'nexus');
  // the value is whitelisted rather than trusted, so a compromised key cannot write arbitrary
  // text into the evidence trail. A signed-in caller is always 'owner' regardless of body.
  const AGENTS = ['qwep', 'nexus', 'axiom'];
  const actor = isAgent
    ? (AGENTS.indexOf(String(body.agent || '').toLowerCase()) !== -1
        ? String(body.agent).toLowerCase() : 'agent')
    : 'owner';

  if (!TICKET_RE.test(ticket)) return json({ error: 'Bad ticket reference.' }, 400, request, env);
  if (['start', 'deliver', 'note'].indexOf(action) === -1) {
    return json({ error: 'action must be start, deliver or note.' }, 400, request, env);
  }

  // ── load the ticket ───────────────────────────────────────────────────────
  // `id` is selected because product_usage_proof.resource_id is a UUID pointing at
  // service_tickets.id — not at the human-readable ticket_number.
  //
  // `order_details` — NOT `intake_data`. There has never been an intake_data column on
  // service_tickets. Commit 5430fe9 (2026-07-20) introduced the WRITE to order_details in
  // docs/assets/js/service-intake.js and the READS of intake_data here, in one changeset, and the
  // two halves never met. PostgREST answers an unknown column in a select list with HTTP 400
  // (Postgres 42703), the `r.ok ? r.json() : null` below collapsed that to null, and the handler
  // returned "Ticket not found." — a 404 for a ticket that plainly exists.
  //
  // The consequence was total and silent: every one of start / deliver / note was dead for every
  // paid order. The owner could not mark a job in progress (so the customer's dashboard showed
  // every paid job as never-started, forever), could not deliver, so serviceCompleteEmail never
  // fired and no paying customer was ever told their work was done or asked for a review, and
  // product_usage_proof was never written, so the MSA §10.5 dispute evidence does not exist for
  // any order taken to date. A schema typo wearing a 404's clothing.
  const rows = await sb(env,
    'service_tickets?select=id,ticket_number,service_name,service_slug,status,intake_status,' +
    'order_details,user_id,created_at&ticket_number=eq.' + encodeURIComponent(ticket) + '&limit=1'
  ).then(r => (r.ok ? r.json() : null)).catch(() => null);

  const t = rows && rows[0];
  if (!t) return json({ error: 'Ticket not found.' }, 404, request, env);

  // ── guard rails: refuse nonsensical transitions rather than corrupting state ──
  if (action === 'start' && t.status !== 'paid') {
    return json({ error: 'Not paid yet (status: ' + t.status + '). Refusing to start.' }, 409, request, env);
  }
  // 'delivered' is the canonical terminal state (supabase/fulfillment_chain.sql:12).
  // 'complete' is checked too: it is the invalid value this file used to WRITE, so
  // tickets closed by the old code must still be recognised as already delivered —
  // otherwise fixing the bug would make every old ticket re-deliverable.
  if (action === 'deliver' && (t.intake_status === 'delivered' || t.intake_status === 'complete')) {
    return json({ error: 'Already delivered. Refusing to re-send the review email.' }, 409, request, env);
  }
  if (action === 'deliver' && t.status !== 'paid') {
    return json({ error: 'Not paid yet. Refusing to deliver.' }, 409, request, env);
  }

  const now = new Date().toISOString();

  // ── note only ─────────────────────────────────────────────────────────────
  if (action === 'note') {
    const notes = Array.isArray(t.order_details && t.order_details.owner_notes)
      ? t.order_details.owner_notes : [];
    notes.push({ at: now, note: String(body.note || '').slice(0, 2000) });
    await sb(env, 'service_tickets?ticket_number=eq.' + encodeURIComponent(ticket), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ order_details: { ...(t.order_details || {}), owner_notes: notes } }),
    });
    return json({ ok: true, ticket, action, notes: notes.length }, 200, request, env);
  }

  // ── start ─────────────────────────────────────────────────────────────────
  if (action === 'start') {
    const patch = await sb(env, 'service_tickets?ticket_number=eq.' + encodeURIComponent(ticket), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        intake_status: 'in_progress',
        order_details: { ...(t.order_details || {}), started_at: now },
      }),
    });
    if (!patch.ok) return json({ error: 'Could not update ticket.' }, 502, request, env);
    return json({ ok: true, ticket, intake_status: 'in_progress', started_at: now }, 200, request, env);
  }

  // ── deliver ───────────────────────────────────────────────────────────────
  //
  // ACCEPTANCE GATE (added 2026-07-25). Before this, `deliver` would write intake_status=
  // 'delivered' AND send the customer "your work is complete" in the SAME request, with the
  // only guards being that the ticket existed, was paid, and was not already delivered.
  // Nothing compared what was DELIVERED against what was ORDERED, and an agent key could fire
  // it head-less as 'qwep'/'nexus'/'axiom' with no person involved. Since the completion email
  // carries a fixed idempotencyKey, a wrong one can never be corrected by re-sending.
  // Three rules now hold, in increasing order of importance:
  //   1. An AGENT may not deliver. Only a signed-in human may tell a customer their work is done.
  //   2. The work must be DESCRIBED (workDone non-empty) - an undescribed delivery is unverifiable.
  //   3. The deliverer must explicitly assert the work matches the order (matches_order === true),
  //      and that assertion is recorded WITH the actor and timestamp, so acceptance is attributable.
  //
  // NOTE ON ALERTING: this function runs on Cloudflare, so it CANNOT reach the local AI Hub
  // (127.0.0.1:3134). A refusal here is returned to the caller AND written to the audit log; the
  // local agent that was refused is responsible for raising it on the hub, which is what actually
  // toasts the owner. A gate that stops a thing without telling a human is the same silent
  // failure it was built to prevent.
  if (isAgent) {
    await logEvent(env, {
      user_id: t.user_id || null,
      action: 'delivery_refused_agent',
      severity: 'warning',
      detail: `Agent '${actor}' attempted to deliver ${ticket} and was refused. ` +
              `Only a signed-in human may send a customer completion email. AWAITING OWNER APPROVAL.`,
    }).catch(() => {});
    return json({
      error: 'Agents may not deliver. A human must confirm the work matches the order.',
      awaiting_owner_approval: true,
      ticket,
      hint: 'Raise this on the AI Hub so the owner is alerted, then have the owner deliver from the admin.',
    }, 403, request, env);
  }

  const workDone = Array.isArray(body.workDone)
    ? body.workDone.map(w => String(w).slice(0, 300)).filter(Boolean).slice(0, 20)
    : [];

  if (!workDone.length) {
    return json({ error: 'workDone is required: describe what was actually done before delivering.' },
                400, request, env);
  }
  if (body.matches_order !== true) {
    const want = (t.order_details && (t.order_details.desired_outcome || t.order_details.problem)) || null;
    return json({
      error: 'Confirm the work matches what was ordered: send matches_order: true.',
      ordered: want,
      hint: 'This is the acceptance record. It is stored with your name and the timestamp.',
    }, 400, request, env);
  }
  // The deliverable itself (a URL, a file reference, or a description). Recorded because the
  // artifact was previously stored NOWHERE - the proof said work happened but not what was handed over.
  const deliverable = String(body.deliverable || '').slice(0, 1000) || null;

  const patch = await sb(env, 'service_tickets?ticket_number=eq.' + encodeURIComponent(ticket), {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    // Must write the SAME terminal state as the Qwep path (UND-Nexus/routes/orders.js
    // PATCH /:orderId), or the two fulfilment routes leave the database in two different
    // shapes for the same real-world event: Nexus's cockpit counter only counts
    // intake_status='delivered', and its re-queue guard only blocks 'delivered', so an
    // owner-delivered job was both uncounted and re-queueable.
    body: JSON.stringify({
      intake_status: 'delivered',
      status:        'delivered',
      completed_at:  now,
      order_details: {
        ...(t.order_details || {}),
        delivered_at: now,
        work_done: workDone,
        // THE ACCEPTANCE RECORD. Who asserted the work matches the order, and when. Stored on
        // the ticket so account -> order -> acceptance is retrievable without a separate lookup.
        deliverable,
        acceptance: {
          matches_order: true,
          asserted_by: actor,
          asserted_at: now,
          // Snapshot what was ORDERED at the moment of acceptance, so a later edit to the intake
          // cannot silently change what the delivery was accepted against.
          ordered_snapshot: (t.order_details && (t.order_details.desired_outcome || t.order_details.problem)) || null,
        },
      },
    }),
  });
  if (!patch.ok) return json({ error: 'Could not update ticket.' }, 502, request, env);

  // PROOF OF DELIVERY — written BEFORE the email, because this is the record that
  // matters in a dispute. MSA section 8 ("deemed accepted 7 days after delivery") and
  // section 10.5 ("evidence of delivery and acceptance") both depend on this row existing.
  // Best-effort: a failure here must not undo a completed job, but it IS logged loudly.
  // COLUMNS VERIFIED against E:\UND-Nexus\compliance_schema.sql:68 on 2026-07-19.
  // My first version invented ticket_number/product_slug/kind/detail — none of which exist.
  // It would have 400'd, been swallowed by this try/catch, and proof would NEVER have been
  // written while the code looked healthy. Real shape:
  //   user_id (NOT NULL, FK auth.users) · service_rendered (NOT NULL text) ·
  //   resource_id (uuid -> service_tickets.id) · tokens_consumed · execution_time_ms ·
  //   ip · session_token · log_of_thought (jsonb) · created_at
  try {
    if (!t.user_id) {
      // user_id is NOT NULL. Without it the insert can never succeed, so say so plainly
      // rather than letting it fail silently on every delivery forever.
      await logEvent(env, {
        user_id: null, action: 'delivery_proof_skipped_no_user', severity: 'error',
        ip: 'worker', device_fingerprint: 'admin-job',
        detail: ticket + ': ticket has no user_id; product_usage_proof requires one',
      });
      throw new Error('ticket has no user_id');
    }

    const startedAt = t.order_details && t.order_details.started_at;
    const elapsedMs = startedAt
      ? Math.max(0, Date.parse(now) - Date.parse(startedAt))
      : null;

    const proof = await sb(env, 'product_usage_proof', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: t.user_id,
        // normalised so it matches the documented examples ('website_fix_quick', ...)
        service_rendered: String(t.service_slug || 'service').replace(/-/g, '_'),
        resource_id: t.id || null,
        execution_time_ms: elapsedMs,
        ip: request.headers.get('cf-connecting-ip') || null,
        // The delivery record itself. This is what MSA section 8 and 10.5 rest on:
        // WHAT was delivered, WHEN, and by whose decision.
        log_of_thought: {
          intent: 'deliver_service',
          decision: 'proceed',
          service: t.service_name || t.service_slug || null,
          ticket_number: ticket,
          work_done: workDone,
          started_at: startedAt || null,
          delivered_at: now,
          // Must name the REAL actor. This row is the evidence submitted in a chargeback
          // dispute (MSA §10.5), so recording an agent's delivery as the owner's own act
          // would put a false statement into the record we rely on to be believed.
          delivered_by: actor,
          timestamp: now,
        },
      }),
    });
    if (!proof.ok) {
      const d = await proof.text().catch(() => '');
      await logEvent(env, {
        user_id: t.user_id || null, action: 'delivery_proof_write_failed', severity: 'error',
        ip: 'worker', device_fingerprint: 'admin-job',
        detail: ticket + ': ' + proof.status + ' ' + d,
      });
    }
  } catch (err) {
    await logEvent(env, {
      user_id: null, action: 'delivery_proof_threw', severity: 'error',
      ip: 'worker', device_fingerprint: 'admin-job', detail: err.message,
    });
  }

  // ── job-complete + review request to the customer ─────────────────────────
  let emailed = false;
  let emailError = null;
  // THE ADDRESS DOES NOT LIVE ON THE TICKET, AND RENAMING THE COLUMN WOULD NOT HAVE FIXED THIS.
  // This previously read `contact_email` / `email` out of the ticket's JSON blob. The intake form
  // (docs/assets/js/service-intake.js:357-390) writes exactly seven keys — target_url, problem,
  // desired_outcome, notes, access_method_label, submitted_at, access_authorization — and NONE of
  // them is an email address. So `to` was null on every single delivery, and the completion email
  // has never been sent to anyone. Swapping intake_data->order_details alone would have left that
  // untouched: the endpoint would have stopped 404ing, looked healthy, and still told no customer
  // their work was done.
  // The authoritative source is customers.email, populated at checkout before Stripe is reached.
  const to = await getCustomerEmail(env, t.user_id).catch(() => null);
  if (to) {
    const origin = new URL(request.url).origin;
    // `await` + `env`: the star links are now HMAC-signed (util/sign.js), which makes minting them
    // async and needs the signing key. Without the await this passes a Promise to sendEmail and
    // the customer receives an email body of "[object Promise]".
    const mail = await serviceCompleteEmail(
      env,
      {
        ticket,
        // The intake form never collects a name. Left null deliberately rather than inventing a
        // fallback — the template greets generically, which is better than greeting them wrongly.
        name: null,
        summary: t.service_name || t.service_slug || 'service',
        workDone,
      },
      origin,
      env.PUBLIC_REVIEW_URL || null
    );
    const sent = await sendEmail(env, {
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo: ownerEmail(env),
      idempotencyKey: 'complete-' + ticket,   // re-delivering cannot double-send
    });
    emailed = sent.ok;
    if (!sent.ok) {
      emailError = sent.error;
      await logEvent(env, {
        user_id: t.user_id || null, action: 'job_complete_email_failed', severity: 'error',
        ip: 'worker', device_fingerprint: 'resend', detail: ticket + ': ' + sent.error,
      });
    }
  }

  // Report honestly: the job IS delivered even if the email failed. Saying "sent" when it
  // was not is the exact defect class this codebase keeps producing.
  return json({
    ok: true,
    ticket,
    intake_status: 'delivered',   // must match what was actually written above
    delivered_at: now,
    work_items: workDone.length,
    customer_emailed: emailed,
    customer_email_error: emailError,
    warning: to ? null : 'No contact email on the ticket — the customer was NOT notified.',
  }, 200, request, env);
}
