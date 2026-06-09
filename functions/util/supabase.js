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

async function rest(env, path, init) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, init);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Supabase REST ' + (init.method || 'GET') + ' ' + path + ' -> ' + res.status + ': ' + detail);
  }
  if (res.status === 204) return null;
  return res.json();
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

export async function getProductBySlug(env, slug) {
  const rows = await rest(
    env,
    'store_products?slug=eq.' + encodeURIComponent(slug) +
      '&is_published=eq.true&select=id,slug,title,price_cents,currency,type&limit=1',
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
