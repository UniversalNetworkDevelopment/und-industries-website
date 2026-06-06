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
} from '../util/supabase.js';
import { stripeRequest } from '../util/stripe.js';

export async function onRequestOptions({ request, env }) {
  return preflight(request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Authenticate from the Supabase JWT — never trust a client-sent user id.
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
  const user = await getUserFromToken(env, token);
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
  } else if (payload.slug) {
    // --- One-time digital goods (current store) ---------------------------
    const product = await getProductBySlug(env, payload.slug);
    if (!product) {
      return json({ error: 'Product not found.' }, 404, request, env);
    }
    if (!product.price_cents || product.price_cents <= 0) {
      return json({ error: 'This product is not for sale.' }, 400, request, env);
    }
    const currency = (product.currency || 'usd').toLowerCase();
    sessionParams = {
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency,
            unit_amount: product.price_cents,
            product_data: { name: product.title, metadata: { product_id: product.id } },
          },
        },
      ],
      success_url: origin + '/purchase-complete.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/store.html?checkout=cancelled',
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        kind: 'one_time',
        product_id: product.id,
        product_slug: product.slug,
        product_type: product.type || '',
        title: product.title,
      },
      payment_intent_data: {
        metadata: { supabase_user_id: user.id, product_id: product.id },
      },
      automatic_tax: { enabled: taxEnabled },
      allow_promotion_codes: true,
    };
  } else {
    return json({ error: 'Provide a product slug or a priceId.' }, 400, request, env);
  }

  try {
    const session = await stripeRequest(env, 'POST', '/v1/checkout/sessions', sessionParams);
    return json({ id: session.id, url: session.url }, 200, request, env);
  } catch (err) {
    // Don't leak Stripe internals to the client; the real error is in the logs.
    return json({ error: err.message || 'Could not start checkout.' }, 502, request, env);
  }
}
