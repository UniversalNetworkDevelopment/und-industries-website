// functions/util/paypal.js
// PayPal Orders v2 helpers for Cloudflare Workers (no SDK — fetch only).
//
// Env vars required:
//   PAYPAL_CLIENT_ID     — from PayPal Developer Dashboard app credentials
//   PAYPAL_CLIENT_SECRET — from PayPal Developer Dashboard app credentials
//   PAYPAL_WEBHOOK_ID    — from PayPal Developer Dashboard > Webhooks (the ID of
//                          the registered webhook, NOT the endpoint URL)
//   PAYPAL_ENV           — 'live' | 'sandbox'  (default: 'live')
//
// Fail-safe: every exported function checks for missing env and throws a
// descriptive error that surfaces as a 503 at the calling layer.

function baseUrl(env) {
  return (env.PAYPAL_ENV || 'live') === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

function requireEnv(env, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (!env[keys[i]]) throw new Error('PayPal not configured — missing env var: ' + keys[i]);
  }
}

// ── OAuth2 client-credentials token (cached for the Worker lifetime only) ────
// Cloudflare Workers are short-lived; one token per invocation is fine.
export async function getAccessToken(env) {
  requireEnv(env, ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']);

  const credentials = btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET);
  const res = await fetch(baseUrl(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + credentials,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('PayPal OAuth2 failed: ' + (data.error_description || data.error || res.status));
  }
  return data.access_token;
}

// ── Create a PayPal Order (Orders v2 API) ─────────────────────────────────────
// customId: a compact JSON string carried round-trip to the webhook so we can
// fulfil without a database lookup ({u:userId, t:ticketNumber, i:[...items]}).
// returnUrl: where PayPal redirects the buyer after approval.
// cancelUrl: where PayPal redirects if the buyer cancels.
export async function createOrder(env, { amount, currency, customId, returnUrl, cancelUrl }) {
  requireEnv(env, ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']);

  const token = await getAccessToken(env);

  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: {
          currency_code: (currency || 'USD').toUpperCase(),
          value: (amount / 100).toFixed(2), // PayPal expects decimal dollars
        },
        custom_id: customId, // ≤ 127 chars; echoed back verbatim in the webhook
      },
    ],
    application_context: {
      return_url: returnUrl,
      cancel_url: cancelUrl,
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
    },
  };

  const res = await fetch(baseUrl(env) + '/v2/checkout/orders', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error('PayPal createOrder failed: ' + (data.message || res.status));
  }

  // Extract the buyer-approval link.
  const approveLink = (data.links || []).find(function (l) { return l.rel === 'approve'; });
  if (!approveLink || !approveLink.href) {
    throw new Error('PayPal createOrder: no approve link in response');
  }

  return { orderId: data.id, approveUrl: approveLink.href };
}

// ── Verify a PayPal webhook signature ─────────────────────────────────────────
// PayPal does NOT use HMAC over the raw body like Stripe; instead they expose a
// server-side verification API. We call it with the headers + raw body PayPal
// sent, and PayPal tells us valid/invalid. This is the only authorised approach
// for Cloudflare Workers (Web Crypto can't replicate the asymmetric cert-chain
// PayPal uses internally).
//
// Returns true (authentic) or false (reject). Throws only on network errors.
export async function verifyWebhookSignature(env, headers, rawBody) {
  requireEnv(env, ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID']);

  const token = await getAccessToken(env);

  const verifyPayload = {
    auth_algo: headers.get('paypal-auth-algo') || '',
    cert_url: headers.get('paypal-cert-url') || '',
    transmission_id: headers.get('paypal-transmission-id') || '',
    transmission_sig: headers.get('paypal-transmission-sig') || '',
    transmission_time: headers.get('paypal-transmission-time') || '',
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: JSON.parse(rawBody), // the parsed event object
  };

  const res = await fetch(baseUrl(env) + '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(verifyPayload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error('PayPal verify-webhook-signature API error ' + res.status + ': ' + detail);
  }

  const result = await res.json();
  // PayPal returns { "verification_status": "SUCCESS" } or "FAILURE"
  return result.verification_status === 'SUCCESS';
}
