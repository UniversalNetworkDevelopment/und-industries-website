// functions/api/create-portal-session.js
// POST /api/create-portal-session
//   Auth: Authorization: Bearer <supabase access token>
//
// Returns a Stripe Billing Portal URL so a subscriber can update their card,
// view invoices, or cancel. Used once subscriptions are live.

import { json, preflight } from '../util/cors.js';
import { getUserFromToken, getCustomerMapping } from '../util/supabase.js';
import { stripeRequest } from '../util/stripe.js';

export async function onRequestOptions({ request, env }) {
  return preflight(request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
  const user = await getUserFromToken(env, token);
  if (!user || !user.id) {
    return json({ error: 'You must be signed in.' }, 401, request, env);
  }

  const customerId = await getCustomerMapping(env, user.id);
  if (!customerId) {
    return json({ error: 'No billing account yet.' }, 404, request, env);
  }

  const origin = new URL(request.url).origin;
  try {
    const portal = await stripeRequest(env, 'POST', '/v1/billing_portal/sessions', {
      customer: customerId,
      return_url: origin + '/dashboard.html',
    });
    return json({ url: portal.url }, 200, request, env);
  } catch (err) {
    return json({ error: err.message || 'Could not open billing portal.' }, 502, request, env);
  }
}
