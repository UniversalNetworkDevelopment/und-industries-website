// functions/api/paypal-webhook.js
// POST /api/paypal-webhook   (register this exact URL in the PayPal Developer
//                             Dashboard under your app's Webhooks)
//
// Mirrors stripe-webhook.js structure precisely:
//   1. Verify PayPal webhook signature (reject unsigned — no false-capability).
//   2. Idempotency via webhook_events (PayPal retries; fulfil exactly once).
//   3. Fulfil FIRST: recordPurchase + grantEntitlement(source:'paypal') + markTicketPaid.
//   4. Mark event processed AFTER fulfilment succeeds.
//   5. Return non-2xx on fulfilment failure so PayPal retries.
//
// Correlation: the PayPal order's custom_id carries a compact JSON payload
// set by create-paypal-order.js: { u: userId, t: ticketNumber, i: [{i,s,t,q}] }
// This mirrors Stripe's session.client_reference_id + metadata exactly.

import {
  hasEventBeenProcessed,
  markEventProcessed,
  recordPurchase,
  grantEntitlement,
  logEvent,
  markTicketPaid,
} from '../util/supabase.js';
import { verifyWebhookSignature } from '../util/paypal.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const rawBody = await request.text(); // raw body required for signature verification

  // 1. Signature verification — hard gate. No unsigned event is ever processed.
  //    Missing env vars are caught inside verifyWebhookSignature and surface as
  //    a thrown error, which we convert to 500 below (PayPal will retry).
  let valid = false;
  try {
    valid = await verifyWebhookSignature(env, request.headers, rawBody);
  } catch (err) {
    console.error('PayPal signature verification error:', err);
    // If our verifier threw due to a config problem (missing env) we return 500
    // so PayPal retries — not 400, which would stop retries permanently.
    return new Response('Signature verification error: ' + err.message, { status: 500 });
  }

  if (!valid) {
    // Definitively invalid signature — PayPal won't retry 400s, which is what
    // we want for a truly bad/spoofed request.
    return new Response('Invalid webhook signature', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return new Response('Bad payload', { status: 400 });
  }

  const eventId = event.id || '';
  if (!eventId) {
    return new Response('Missing event id', { status: 400 });
  }

  // 2. Idempotency (fast path) — same pattern as stripe-webhook.js.
  //    A webhook_events row means this event was already fully fulfilled.
  //    Swallow storage errors and fall through to idempotent fulfilment.
  try {
    if (await hasEventBeenProcessed(env, eventId)) {
      return new Response(JSON.stringify({ duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    // fall through — idempotent fulfilment is the real safety net
  }

  // 3. Fulfil FIRST. Non-2xx on any failure so PayPal retries.
  try {
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      await handleCaptureCompleted(env, event);
    }
    // Other event types acknowledged but not acted on (safe to extend later).
  } catch (err) {
    console.error('PayPal webhook provisioning failed:', err);
    await logEvent(env, {
      user_id: null,
      action: 'paypal_webhook_failed',
      severity: 'error',
      ip: 'paypal-webhook',
      device_fingerprint: event.event_type || 'unknown',
      detail: err.message,
    });
    return new Response('Provisioning failed', { status: 500 }); // PayPal retries
  }

  // 4. Mark processed AFTER successful fulfilment.
  try {
    await markEventProcessed(env, eventId, event.event_type || 'paypal');
  } catch (err) {
    // Already fulfilled; dedupe bookkeeping failed. Ack 200 — the grant is durable.
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── PAYMENT.CAPTURE.COMPLETED ─────────────────────────────────────────────────
// PayPal fires this when money actually clears (buyer's card charged and
// captured). The resource is a Capture object; the parent Order id is in
// resource.supplementary_data.related_ids.order_id or we get it from the
// custom_id set on the purchase_unit of the order.
async function handleCaptureCompleted(env, event) {
  const resource = event.resource || {};

  // The capture's custom_id is inherited from the order's purchase_unit.
  // PayPal propagates it onto the Capture resource automatically.
  const rawCustomId = resource.custom_id || '';
  if (!rawCustomId) throw new Error('PAYMENT.CAPTURE.COMPLETED missing custom_id');

  let meta;
  try {
    meta = JSON.parse(rawCustomId);
  } catch (e) {
    throw new Error('custom_id is not valid JSON: ' + rawCustomId);
  }

  const userId       = meta.u || '';
  const ticketNumber = meta.t || '';
  const items        = Array.isArray(meta.i) ? meta.i : [];

  if (!userId)   throw new Error('custom_id missing user id (u)');
  if (!items.length) throw new Error('custom_id missing items (i)');

  // Amount from PayPal capture — amount.value is a decimal string like "99.00"
  const amountValue    = resource.amount && resource.amount.value ? resource.amount.value : '0';
  const currencyCode   = (resource.amount && resource.amount.currency_code) || 'USD';
  const amountCents    = Math.round(parseFloat(amountValue) * 100);

  // Use the PayPal capture ID as the idempotency key for the purchases row.
  // The purchases table has stripe_session_id as the unique column — we reuse
  // this field as a generic "payment_session_id" (it holds a PayPal capture id
  // prefixed with "pp_" to distinguish from Stripe session ids).
  const captureId      = resource.id || '';
  const paymentSession = 'pp_' + captureId;

  // 3a. Record the purchase (one row per capture, idempotent on paymentSession).
  await recordPurchase(env, {
    user_id:               userId,
    product_id:            items.length === 1 ? (items[0].i || null) : null,
    product_slug:          items.length === 1 ? (items[0].s || null) : null,
    title:                 items.length > 1
                             ? (items.length + ' items')
                             : (items[0] && items[0].s ? items[0].s : null),
    amount_cents:          amountCents,
    currency:              currencyCode.toLowerCase(),
    stripe_session_id:     paymentSession, // reused column; "pp_<captureId>"
    stripe_payment_intent: null,
    status:                'paid',
  });

  // 3b. Mark the service ticket paid (if a ticket was created pre-payment).
  if (ticketNumber) {
    await markTicketPaid(env, ticketNumber, paymentSession);
  }

  // 3c. Grant one entitlement per item in the order.
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    await grantEntitlement(env, {
      user_id:           userId,
      product_id:        it.i || null,
      product_slug:      it.s || null,
      kind:              'purchase',
      license_key:       null,        // PayPal services are not software products
      status:            'active',
      source:            'paypal',
      stripe_session_id: paymentSession,
    });
  }
}
