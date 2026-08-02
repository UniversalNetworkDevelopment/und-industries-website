// functions/api/create-paypal-order.js
// POST /api/create-paypal-order
//   Body: { items: [{ slug, quantity }], ticket: 'UND-...' }
//     OR: { slug, ticket: 'UND-...' }   (single-item shorthand)
//   Auth: Authorization: Bearer <supabase access token>
//
// Mirrors create-checkout-session.js exactly but for PayPal Orders v2.
// The amount is ALWAYS resolved server-side from Supabase by slug.
// A tampered client request cannot change the price or the buyer.
//
// Returns: { approveUrl: 'https://www.paypal.com/checkoutnow?...' }
// The browser redirects the user to that URL to complete payment.

import { json, preflight } from '../util/cors.js';
import { getUserFromToken, getProductBySlug, logEvent } from '../util/supabase.js';
import { createOrder } from '../util/paypal.js';

export async function onRequestOptions({ request, env }) {
  return preflight(request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // PayPal removed 2026-07-10 — see PAYMENTS-DECISION-remove-paypal.md for the reason.
  // Backend safety net: even if a stale page calls this, NO PayPal order is created.
  // Reversible: delete this one block to restore PayPal Orders v2.
  return json({ error: 'PayPal checkout has been removed. Please use card checkout.' }, 410, request, env);

  // 0. Fail clearly if not configured.
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
                    'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'];
  for (let i = 0; i < required.length; i++) {
    if (!env[required[i]]) {
      return json({ error: 'Payments not configured yet — missing ' + required[i] + '.' }, 503, request, env);
    }
  }

  let user = null;

  try {
    // 1. Authenticate from the Supabase JWT — never trust a client-sent user id.
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
    user = await getUserFromToken(env, token);
    if (!user || !user.id) {
      return json({ error: 'You must be signed in to check out.' }, 401, request, env);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: 'Invalid request body.' }, 400, request, env);
    }

    // 2. Resolve items. Accept { slug } (single) or { items: [{slug, quantity}] }.
    const requested = (payload.items && payload.items.length)
      ? payload.items
      : (payload.slug ? [{ slug: payload.slug, quantity: 1 }] : []);

    if (!requested.length) {
      return json({ error: 'Provide a product slug or items array.' }, 400, request, env);
    }

    // PayPal orders for these services are one item per order.
    // (The client-side already enforces single-item PayPal cart, but guard here too.)
    if (requested.length > 1) {
      return json({ error: 'PayPal checkout supports one item at a time.' }, 400, request, env);
    }

    const reqSlug = requested[0] && requested[0].slug;
    if (!reqSlug) {
      return json({ error: 'Product slug is required.' }, 400, request, env);
    }

    // 3. Resolve price server-side — the client NEVER sets the amount.
    const product = await getProductBySlug(env, reqSlug);
    if (!product) {
      return json({ error: 'Product not found: ' + reqSlug }, 404, request, env);
    }
    if (!product.price_cents || product.price_cents <= 0) {
      return json({ error: 'Not for sale: ' + product.title }, 400, request, env);
    }

    // Same availability gate as create-checkout-session.js — and it has to be repeated HERE, in
    // full, because this is a second door to the same money. Found 2026-08-02 only by asking
    // "who else calls getProductBySlug?" after fixing the Stripe path; fixing one payment
    // endpoint and assuming the other was fine is how a closed hole stays open.
    // FAIL CLOSED: only an explicit 'live' may be charged.
    if (product.availability !== 'live') {
      return json({
        error: 'Not currently available for direct purchase: ' + product.title,
        slug: product.slug,
        availability: product.availability || null,
      }, 409, request, env);
    }

    const currency = (product.currency || 'USD').toUpperCase();
    const ticketNumber = payload.ticket || '';

    // 4. Build custom_id — compact JSON (≤ 127 chars) that the webhook reads back
    //    to fulfil the purchase. Mirrors Stripe's session.metadata pattern exactly.
    //    Fields:  u = user_id, t = ticket_number, i = items array
    const metaItem = { i: product.id, s: product.slug, t: product.type || '', q: 1 };
    const customId = JSON.stringify({ u: user.id, t: ticketNumber, i: [metaItem] });

    if (customId.length > 127) {
      // Edge case: UUID + ticket + slug might exceed 127 chars. Truncate slug to fit.
      // The webhook uses product.id (UUID) as the authoritative reference anyway.
      const safeItem = { i: product.id, s: product.slug.slice(0, 20), t: product.type || '', q: 1 };
      const safeCustomId = JSON.stringify({ u: user.id, t: ticketNumber, i: [safeItem] });
      // If still over (extreme edge), we can always look up by product.id in the webhook.
      // This is a safety valve — in practice slugs are short.
      if (safeCustomId.length > 127) {
        return json({ error: 'Order metadata too long — contact support.' }, 400, request, env);
      }
    }

    const origin = new URL(request.url).origin;
    const returnUrl = origin + '/purchase-complete.html?paypal=1&ticket=' + encodeURIComponent(ticketNumber);
    const cancelUrl = origin + '/store.html?checkout=cancelled';

    // 5. Create the PayPal order.
    const order = await createOrder(env, {
      amount: product.price_cents,
      currency: currency,
      customId: customId,
      returnUrl: returnUrl,
      cancelUrl: cancelUrl,
    });

    return json({ approveUrl: order.approveUrl, orderId: order.orderId }, 200, request, env);

  } catch (err) {
    console.error('PayPal order creation error:', err);
    await logEvent(env, {
      user_id: user ? user.id : null,
      action: 'paypal_order_creation_failed',
      severity: 'critical',
      ip: request.headers.get('cf-connecting-ip') || 'unknown',
      device_fingerprint: request.headers.get('user-agent') || 'unknown',
      detail: err.message,
    });
    return json({ error: 'Could not create PayPal order. Please contact support.' }, 500, request, env);
  }
}
