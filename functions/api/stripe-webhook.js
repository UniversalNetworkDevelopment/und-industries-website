// functions/api/stripe-webhook.js
// POST /api/stripe-webhook   (register this exact URL in the Stripe Dashboard)
//
// 1. Verify the Stripe signature with Web Crypto (no SDK).
// 2. De-duplicate via webhook_events (Stripe retries; we fulfil exactly once).
// 3. Fulfil: record purchase, grant entitlement (+ license key for software),
//    and keep subscriptions / profile plan in sync.
//
// Returning a non-2xx makes Stripe retry with backoff. Every handler is
// idempotent, so retries are safe.

import {
  hasEventBeenProcessed,
  markEventProcessed,
  recordPurchase,
  grantEntitlement,
  upsertSubscription,
  setProfilePlan,
  getUserIdByCustomer,
  logEvent,
  markTicketPaid,
  getProductBySlug,
} from '../util/supabase.js';
import { verifyStripeSignature } from '../util/stripe.js';
import { generateLicenseKey } from '../util/license.js';
import { sendEmail, ownerEmail, ownerSaleEmail, customerConfirmEmail } from '../util/email.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const rawBody = await request.text(); // RAW body is required for the signature
  const sig = request.headers.get('stripe-signature') || '';

  const valid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response('Invalid signature', { status: 400 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return new Response('Bad payload', { status: 400 });
  }

  // Idempotency (fast path) — a webhook_events row is written ONLY after a
  // prior delivery fulfilled completely, so its presence proves the side
  // effects already happened. Short-circuit those without re-doing work.
  // NOTE: this is an optimisation, not the safety net. The real guarantee is
  // that fulfilment itself is idempotent (purchases upsert on stripe_session_id,
  // entitlements upsert on user_id,product_id) AND we only mark-processed AFTER
  // fulfilment succeeds. A storage error here must NOT block fulfilment, so we
  // swallow it and let the idempotent fulfilment run.
  try {
    if (await hasEventBeenProcessed(env, event.id)) {
      return new Response(JSON.stringify({ duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    // fall through — re-running idempotent fulfilment is safe.
  }

  // Fulfil FIRST. If any step throws, return non-2xx WITHOUT marking the event
  // processed, so Stripe retries and the retry actually completes the grant.
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(env, event.data.object, request, event.id);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionChange(env, event.data.object);
        break;
      case 'invoice.payment_failed':
        await handleInvoiceFailed(env, event.data.object);
        break;
      default:
        break; // unhandled types are acknowledged, not errors
    }
  } catch (err) {
    console.error('Webhook provisioning failed:', err);
    await logEvent(env, {
      user_id: null,
      action: 'stripe_webhook_failed',
      severity: 'error',
      ip: request.headers.get('cf-connecting-ip') || 'unknown',
      device_fingerprint: request.headers.get('user-agent') || 'unknown',
      detail: err.message,
    });
    return new Response('Provisioning failed', { status: 500 }); // let Stripe retry
  }

  // Fulfilment succeeded — NOW record the event so future retries short-circuit.
  // A failure to record is non-fatal: returning 500 here would make Stripe retry
  // an already-fulfilled event, and the idempotent upserts would no-op anyway.
  // But recording is what makes the fast-path work, so we still try and only
  // ack 200 regardless (the grant is already durably done).
  try {
    await markEventProcessed(env, event.id, event.type);
  } catch (err) {
    // Already fulfilled; dedupe bookkeeping failed. Safe to ack — a future
    // retry re-runs idempotent fulfilment without double-granting.
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleCheckoutCompleted(env, session, request, eventId) {
  const md = session.metadata || {};
  const userId = session.client_reference_id || md.supabase_user_id;
  if (!userId) return;

  if (md.kind === 'subscription' || session.mode === 'subscription') {
    // Subscription specifics arrive via customer.subscription.* events.
    return;
  }

  // One-time purchase — only fulfil paid sessions.
  if (session.payment_status && session.payment_status !== 'paid') return;

  // Cart items live in metadata.items ([{i:id, s:slug, t:type, q:qty}]).
  // Fall back to the original single-item shape for older sessions.
  let items = [];
  if (md.items) {
    try { items = JSON.parse(md.items); } catch (e) { items = []; }
  }
  if (!items.length && md.product_id) {
    items = [{ i: md.product_id, s: md.product_slug, t: md.product_type, q: 1 }];
  }
  if (!items.length) return;

  // One order row per session (purchases.stripe_session_id is unique).
  await recordPurchase(env, {
    user_id: userId,
    product_id: items.length === 1 ? (items[0].i || null) : null,
    product_slug: items.length === 1 ? (items[0].s || null) : null,
    title: items.length > 1 ? (items.length + ' items') : (md.title || (items[0] && items[0].s) || null),
    amount_cents: session.amount_total,
    currency: session.currency,
    stripe_session_id: session.id,
    stripe_payment_intent: session.payment_intent || null,
    status: 'paid',
  });

  if (md.ticket_number) {
    await markTicketPaid(env, md.ticket_number, session.id);
  }

  // One entitlement per item; software items also get a license key.
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    const licenseKey = it.t === 'software' ? generateLicenseKey('ECAM') : null;
    await grantEntitlement(env, {
      user_id: userId,
      product_id: it.i || null,
      product_slug: it.s || null,
      kind: 'purchase',
      license_key: licenseKey,
      status: 'active',
      source: 'stripe',
      stripe_session_id: session.id,
    });
  }

  // ── NOTIFY (added 2026-07-19) ─────────────────────────────────────────────
  // This is the piece whose absence kept the buy buttons disabled for 32 days. The
  // original design tried to reach Alex via a Postgres trigger POSTing to
  // 127.0.0.1:3133 — Supabase's own loopback, permanently unreachable. Sending from
  // HERE means notification runs server-side and never depends on his PC being awake.
  //
  // DELIBERATELY LAST, AND DELIBERATELY NON-FATAL. The purchase, ticket and entitlement
  // are already durably written above. If email fails we log it and still ack 2xx —
  // making Stripe retry a fulfilled order to re-attempt an email would risk double
  // grants to fix a strictly lesser problem. A failed email is recoverable; a lost
  // entitlement is not.
  await notifyOrder(env, session, items, md, request, eventId);
}

async function notifyOrder(env, session, items, md, request, eventId) {
  try {
    const origin = request ? new URL(request.url).origin : 'https://universalnetworkdevelopment.com';

    // ── RESOLVE REAL PRODUCT NAMES ────────────────────────────────────────────
    // BUG FOUND 2026-07-19 by tracing the data instead of assuming it:
    // create-checkout-session.js:133 writes metadata as { i, s, t, q } — there is NO name
    // field. The email fell back to the SLUG, so a paying customer would have received
    // "Order confirmed — one step to start your website-fix-cleanup".
    //
    // Fixed by looking the title up here rather than adding it to metadata: Stripe caps
    // each metadata VALUE at 500 characters, and names would silently truncate the items
    // JSON somewhere around the 6th line item — corrupting fulfilment to fix cosmetics.
    // A lookup has no such ceiling and cannot go stale.
    //
    // Falls back to a de-slugged title ("website-fix-cleanup" -> "Website Fix Cleanup") if
    // the lookup fails, so the worst case is still readable prose, never a raw slug.
    const named = await Promise.all(items.map(async (i) => {
      let name = null;
      try {
        if (i.s) {
          const p = await getProductBySlug(env, i.s);
          if (p && p.title) name = p.title;
        }
      } catch (_) { /* fall through to the de-slug */ }
      if (!name) {
        name = String(i.s || 'Service')
          .split('-')
          .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w)
          .join(' ');
      }
      return { name, slug: i.s, qty: i.q || 1 };
    }));

    const summary = named.length > 1 ? named.length + ' items' : (named[0] && named[0].name) || 'your order';

    const order = {
      amount: session.amount_total || 0,
      email: (session.customer_details && session.customer_details.email) || session.customer_email || null,
      ticket: md.ticket_number || null,
      sessionId: session.id,
      summary,
      items: named,
    };

    // Idempotency keys are derived from the Stripe EVENT id, so a retried webhook cannot
    // send a second copy of either email (Resend honours the key for 24h — well beyond
    // Stripe's retry window).
    const owner = ownerSaleEmail(order);
    const r1 = await sendEmail(env, {
      to: ownerEmail(env),
      subject: owner.subject,
      html: owner.html,
      text: owner.text,
      replyTo: order.email || undefined,   // reply goes straight to the customer
      idempotencyKey: 'owner-' + eventId,
    });
    if (!r1.ok) {
      await logEvent(env, {
        user_id: null, action: 'owner_sale_email_failed', severity: 'critical',
        ip: 'worker', device_fingerprint: 'resend',
        detail: 'session ' + session.id + ': ' + r1.error,
      });
    }

    if (order.email) {
      const cust = customerConfirmEmail(order, origin);
      const r2 = await sendEmail(env, {
        to: order.email,
        subject: cust.subject,
        html: cust.html,
        text: cust.text,
        replyTo: ownerEmail(env),
        idempotencyKey: 'cust-' + eventId,
      });
      if (!r2.ok) {
        await logEvent(env, {
          user_id: null, action: 'customer_confirm_email_failed', severity: 'error',
          ip: 'worker', device_fingerprint: 'resend',
          detail: 'session ' + session.id + ': ' + r2.error,
        });
      }
    }
  } catch (err) {
    // Never let a notification bug undo a completed fulfilment.
    try {
      await logEvent(env, {
        user_id: null, action: 'order_notify_threw', severity: 'error',
        ip: 'worker', device_fingerprint: 'resend', detail: err.message,
      });
    } catch (_) {}
  }
}

async function handleSubscriptionChange(env, sub) {
  const userId =
    (sub.metadata && sub.metadata.supabase_user_id) ||
    (await getUserIdByCustomer(env, sub.customer));
  if (!userId) return;

  const item = sub.items && sub.items.data && sub.items.data[0];
  const priceId = item && item.price ? item.price.id : null;
  const active = sub.status === 'active' || sub.status === 'trialing';
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  await upsertSubscription(env, {
    stripe_subscription_id: sub.id,
    user_id: userId,
    stripe_customer_id: sub.customer,
    stripe_price_id: priceId,
    status: sub.status,
    current_period_end: periodEnd,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  });

  // Surface plan state to the existing profiles-based authorization.
  await setProfilePlan(env, userId, {
    plan: active ? 'pro' : 'free',
    plan_status: sub.status,
    plan_renews_at: periodEnd,
  });
}

async function handleInvoiceFailed(env, invoice) {
  const userId = await getUserIdByCustomer(env, invoice.customer);
  if (!userId) return;
  await setProfilePlan(env, userId, { plan_status: 'past_due' });
}
