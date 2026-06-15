// functions/api/create-checkout-session.js
// POST /api/create-checkout-session
//   Body: { slug }     -> one-time purchase of a store product
//         { priceId }  -> subscription (used once you populate the plans table)
//   Auth: Authorization: Bearer <supabase access token>
//
// The amount charged is ALWAYS resolved server-side from Supabase by slug.
// A tampered client request cannot change the price or the buyer.

import { json, preflight } from '../util/cors.js';
import {
  getUserFromToken,
  getProductBySlug,
  getCustomerMapping,
  saveCustomerMapping,
  logEvent,
} from '../util/supabase.js';
import { stripeRequest } from '../util/stripe.js';

export async function onRequestOptions({ request, env }) {
  return preflight(request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 0. Fail clearly if the server isn't configured yet, naming the missing var,
  //    instead of throwing an opaque runtime error.
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY'];
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

    // 2. Reuse (or lazily create) one Stripe customer per Supabase user.
    let customerId = await getCustomerMapping(env, user.id);
    if (!customerId) {
      const customer = await stripeRequest(env, 'POST', '/v1/customers', {
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await saveCustomerMapping(env, user.id, customerId, user.email);
    }

    const origin = new URL(request.url).origin;
    const taxEnabled = env.STRIPE_TAX_ENABLED === 'true';
    let sessionParams;

    if (payload.priceId) {
      // --- Subscription path -------------------------------------------------
      sessionParams = {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: payload.priceId, quantity: 1 }],
        success_url: origin + '/purchase-complete.html?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: origin + '/store.html?checkout=cancelled',
        client_reference_id: user.id,
        metadata: { supabase_user_id: user.id, kind: 'subscription' },
        subscription_data: { metadata: { supabase_user_id: user.id } },
        automatic_tax: { enabled: taxEnabled },
        allow_promotion_codes: true,
      };
    } else if (payload.slug || (payload.items && payload.items.length)) {
      // --- One-time digital goods: single "Buy Now" OR a multi-item cart ----
      // Accept either { slug } (one item) or { items: [{ slug, quantity }] }.
      const requested = (payload.items && payload.items.length)
        ? payload.items
        : [{ slug: payload.slug, quantity: 1 }];

      const lineItems = [];
      const metaItems = [];
      for (let n = 0; n < requested.length; n++) {
        const reqSlug = requested[n] && requested[n].slug;
        if (!reqSlug) continue;
        let qty = parseInt(requested[n].quantity, 10);
        if (!(qty > 0)) qty = 1;
        if (qty > 20) qty = 20;

        // Price is resolved server-side — the client never sets it.
        const product = await getProductBySlug(env, reqSlug);
        if (!product) {
          return json({ error: 'Product not found: ' + reqSlug }, 404, request, env);
        }
        if (!product.price_cents || product.price_cents <= 0) {
          return json({ error: 'Not for sale: ' + product.title }, 400, request, env);
        }

        lineItems.push({
          quantity: qty,
          price_data: {
            currency: (product.currency || 'usd').toLowerCase(),
            unit_amount: product.price_cents,
            product_data: { name: product.title, metadata: { product_id: product.id } },
          },
        });
        metaItems.push({ i: product.id, s: product.slug, t: product.type || '', q: qty });
      }

      if (!lineItems.length) {
        return json({ error: 'No valid items to check out.' }, 400, request, env);
      }

      sessionParams = {
        mode: 'payment',
        customer: customerId,
        line_items: lineItems,
        success_url: origin + '/purchase-complete.html?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: origin + '/store.html?checkout=cancelled',
        client_reference_id: user.id,
        metadata: {
          supabase_user_id: user.id,
          kind: 'one_time',
          ticket_number: payload.ticket || '',
          // Compact item list for the webhook to fulfil each line.
          items: JSON.stringify(metaItems),
        },
        payment_intent_data: {
          metadata: { supabase_user_id: user.id },
          setup_future_usage: 'off_session',
        },
        automatic_tax: { enabled: taxEnabled },
        allow_promotion_codes: true,
      };
    } else {
      return json({ error: 'Provide a product slug, items, or a priceId.' }, 400, request, env);
    }

    const session = await stripeRequest(env, 'POST', '/v1/checkout/sessions', sessionParams);
    return json({ id: session.id, url: session.url }, 200, request, env);
  } catch (err) {
    // SECURITY: Never leak internal stack traces or Stripe error messages to the client.
    // Log the actual error to the Cloudflare Worker console and Nexus Telemetry (Supabase).
    console.error('Checkout error:', err);
    await logEvent(env, {
      user_id: user ? user.id : null,
      action: 'checkout_session_failed',
      severity: 'critical',
      ip: request.headers.get('cf-connecting-ip') || 'unknown',
      device_fingerprint: request.headers.get('user-agent') || 'unknown',
      detail: err.message,
    });
    return json({ error: 'Could not process checkout request. Please contact support.' }, 502, request, env);
  }
}
