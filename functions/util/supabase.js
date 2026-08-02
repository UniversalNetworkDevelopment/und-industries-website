// functions/util/supabase.js
// Server-side Supabase access for Cloudflare Pages Functions.
// Uses the REST (PostgREST) + Auth APIs directly via fetch — no client SDK.
//
// SUPABASE_SERVICE_ROLE_KEY bypasses Row-Level Security and must ONLY ever
// live in Cloudflare env (Settings -> Variables and Secrets -> Encrypted).
// It is never sent to, or reachable by, the browser.

function adminHeaders(env, extra) {
  return Object.assign(
    {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    extra || {}
  );
}

// EVERY Supabase call is bounded. Added 2026-07-26 after an audit found 25 fetch() calls across
// the site and ZERO with a timeout. A fetch with no deadline does not fail - it HANGS, and a
// request that hangs is worse than one that errors: the customer sees a spinner that never
// resolves and never learns anything went wrong, and no alarm fires because nothing "failed".
// A request stuck forever is the un-catchable version of a silent failure.
//
// 10s is deliberately generous for a database call and still far below the point where a human
// gives up. On timeout we throw a NAMED error so callers (and the audit trail) can tell
// "the database was too slow" apart from "the database said no" - two different problems that
// used to look identical.
const REST_TIMEOUT_MS = 10_000;

async function rest(env, path, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { ...init, signal: ctrl.signal });
  } catch (e) {
    // AbortError is the timeout; anything else is a genuine network failure. Name both.
    const timedOut = e && (e.name === 'AbortError' || String(e).includes('aborted'));
    throw new Error(
      'Supabase REST ' + ((init && init.method) || 'GET') + ' ' + path + ' -> ' +
      (timedOut ? 'TIMEOUT after ' + REST_TIMEOUT_MS + 'ms' : 'NETWORK ERROR: ' + String((e && e.message) || e))
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Supabase REST ' + ((init && init.method) || 'GET') + ' ' + path + ' -> ' + res.status + ': ' + detail);
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// Authenticate the caller from their Supabase access token (the JWT the browser
// already holds after login). We ask Supabase who the token belongs to rather
// than trusting any user id sent by the client.
export async function getUserFromToken(env, accessToken) {
  if (!accessToken) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + accessToken,
      },
    });
    if (!res.ok) return null;
    return res.json(); // { id, email, ... }
  } catch (e) {
    return null; // never crash the request on a transient/verify error
  }
}

// `availability` added to the select 2026-08-02. Callers must be able to refuse a sale for a
// product that is not actually for sale, and they cannot check a column that was never fetched.
// is_published alone is NOT sufficient: a product can be published (visible in the catalogue) and
// still be 'soon', 'paused' or 'inquiry' — on 2026-08-02, 11 of the 15 published, priced products
// were 'soon' and every one of them was purchasable.
export async function getProductBySlug(env, slug) {
  const rows = await rest(
    env,
    'store_products?slug=eq.' + encodeURIComponent(slug) +
      '&is_published=eq.true&select=id,slug,title,price_cents,currency,type,availability&limit=1',
    { headers: adminHeaders(env) }
  );
  return rows && rows[0] ? rows[0] : null;
}

// --- Stripe customer mapping (one Stripe customer per Supabase user) -------
export async function getCustomerMapping(env, userId) {
  const rows = await rest(
    env,
    'customers?user_id=eq.' + userId + '&select=stripe_customer_id&limit=1',
    { headers: adminHeaders(env) }
  );
  return rows && rows[0] ? rows[0].stripe_customer_id : null;
}

export async function saveCustomerMapping(env, userId, stripeCustomerId, email) {
  await rest(env, 'customers', {
    method: 'POST',
    headers: adminHeaders(env, { Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
      email: email || null,
    }),
  });
}

// THE ONE PLACE THAT ANSWERS "what is this customer's email address?".
//
// It existed nowhere, and that absence had a cost: admin-job.js read the address out of the
// ticket's own JSON blob (`contact_email`), a key NOTHING has ever written. So `to` was always
// null and the "your work is complete" email was never sent to anybody, while the endpoint
// returned HTTP 200 with a warning nobody reads.
//
// `customers.email` is the right source because it is already populated for every paying user:
// create-checkout-session.js:61 calls saveCustomerMapping(env, user.id, customerId, user.email)
// before Stripe is ever reached, and a service ticket cannot exist without a checkout. So this
// works for EXISTING tickets too — no backfill, no new column, no schema change.
//
// Returns null when genuinely unknown. Callers must treat null as "cannot contact this customer"
// and say so loudly, never as "no email needed".
export async function getCustomerEmail(env, userId) {
  if (!userId) return null;
  const rows = await rest(
    env,
    'customers?user_id=eq.' + encodeURIComponent(userId) + '&select=email&limit=1',
    { headers: adminHeaders(env) }
  );
  return (rows && rows[0] && rows[0].email) || null;
}

export async function getUserIdByCustomer(env, stripeCustomerId) {
  const rows = await rest(
    env,
    'customers?stripe_customer_id=eq.' + encodeURIComponent(stripeCustomerId) +
      '&select=user_id&limit=1',
    { headers: adminHeaders(env) }
  );
  return rows && rows[0] ? rows[0].user_id : null;
}

// --- Idempotency -----------------------------------------------------------
// A row in webhook_events means this event id has ALREADY been fulfilled.
// We only insert it AFTER fulfilment succeeds, so its presence is proof of
// completed side effects (not merely "received"). Returns true if a row exists.
export async function hasEventBeenProcessed(env, eventId) {
  const rows = await rest(
    env,
    'webhook_events?id=eq.' + encodeURIComponent(eventId) + '&select=id&limit=1',
    { headers: adminHeaders(env) }
  );
  return !!(rows && rows[0]);
}

// Record an event id as fully processed. Call this ONLY after fulfilment has
// succeeded. A duplicate primary key (concurrent/raced retry) returns 409,
// which we treat as success — someone else already recorded it.
export async function markEventProcessed(env, eventId, type) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/webhook_events', {
    method: 'POST',
    headers: adminHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ id: eventId, type: type }),
  });
  if (res.status === 409) return false;
  if (!res.ok) {
    const detail = await res.text();
    throw new Error('webhook_events insert ' + res.status + ': ' + detail);
  }
  return true;
}

export async function recordPurchase(env, row) {
  // Upsert on the unique session id => one order row per checkout session,
  // safe under Stripe retries.
  await rest(env, 'purchases?on_conflict=stripe_session_id', {
    method: 'POST',
    headers: adminHeaders(env, { Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(row),
  });
}

export async function markTicketPaid(env, ticketNumber, stripeSessionId) {
  // ticketNumber might be a comma-separated list like "UND-123,UND-124"
  // PostgREST in. syntax expects values in parentheses: in.(UND-123,UND-124)
  const filter = ticketNumber.indexOf(',') > -1 
    ? 'in.(' + encodeURIComponent(ticketNumber) + ')'
    : 'eq.' + encodeURIComponent(ticketNumber);
    
  await rest(env, 'service_tickets?ticket_number=' + filter, {
    method: 'PATCH',
    headers: adminHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ status: 'paid', stripe_session_id: stripeSessionId }),
  });
}

export async function grantEntitlement(env, row) {
  // Upsert on (user_id, product_id) => re-granting the same product is a no-op
  // update rather than a duplicate-key error.
  await rest(env, 'entitlements?on_conflict=user_id,product_id', {
    method: 'POST',
    headers: adminHeaders(env, { Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(row),
  });
}

export async function upsertSubscription(env, row) {
  await rest(env, 'subscriptions', {
    method: 'POST',
    headers: adminHeaders(env, { Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(row),
  });
}

export async function setProfilePlan(env, userId, fields) {
  await rest(env, 'profiles?id=eq.' + userId, {
    method: 'PATCH',
    headers: adminHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify(fields),
  });
}

// The audit log must never lose an event, and must never take down the request it is
// recording. Rewritten 2026-07-26 after TWO failures proved both halves matter:
//
//   1. `system_logs` did not exist AT ALL for weeks. Every write 400'd, this function caught it,
//      console.error'd into an ephemeral Cloudflare log, and returned as if it had worked. The
//      audit trail reported success while recording nothing.
//   2. Once the table WAS created, three call sites still failed: they send severity:'critical',
//      which the table's CHECK constraint rejects. Among them `owner_sale_email_failed` - the
//      alarm for "a customer paid and Alex was never told", i.e. the single event most worth
//      keeping. A schema/vocabulary mismatch silently destroyed the loudest alarm in the system.
//
// So a swallowed failure is not acceptable here, but neither is throwing (that would fail a
// checkout because its LOGGING failed). The answer is a fallback write: if the real row is
// rejected, retry once with a minimal row that cannot violate the schema, tagged so the
// original rejection is itself in the record. An audit write that gets rejected must leave a
// trace that it was rejected - otherwise the log's silence is indistinguishable from health.
export async function logEvent(env, event) {
  try {
    await rest(env, 'system_logs', {
      method: 'POST',
      headers: adminHeaders(env),
      body: JSON.stringify(event),
    });
    return { ok: true };
  } catch (e) {
    const reason = String((e && e.message) || e).slice(0, 400);
    console.error('logEvent REJECTED, attempting fallback row:', reason);
    try {
      // Minimal shape only: action + severity 'error' (always legal) + everything we know about
      // the original event folded into detail as text. No optional columns, nothing that can
      // violate a constraint. If the schema drifts again, THIS still lands.
      await rest(env, 'system_logs', {
        method: 'POST',
        headers: adminHeaders(env),
        body: JSON.stringify({
          action: 'logevent_rejected',
          severity: 'error',
          detail:
            'Original action=' + String((event && event.action) || 'unknown') +
            ' severity=' + String((event && event.severity) || 'unknown') +
            ' user_id=' + String((event && event.user_id) || 'none') +
            ' | rejected because: ' + reason +
            ' | original detail: ' + String((event && event.detail) || '').slice(0, 600),
        }),
      });
      return { ok: false, fallback: true, reason };
    } catch (e2) {
      // Both writes failed - the log table is unreachable or gone. Nothing left but the
      // platform log; say so explicitly so it is greppable rather than a generic error.
      console.error('AUDIT TRAIL DOWN - system_logs unwritable. Event LOST:',
                    JSON.stringify(event), 'first=', reason, 'fallback=', String((e2 && e2.message) || e2));
      return { ok: false, lost: true, reason };
    }
  }
}
