// functions/util/stripe.js
// Minimal Stripe REST client + webhook signature verification for the
// Cloudflare Workers runtime. No Stripe SDK (it depends on Node's crypto,
// which isn't available here) — we talk to the REST API with fetch and verify
// signatures with Web Crypto.

const STRIPE_BASE = 'https://api.stripe.com';

// Flatten a nested object/array into Stripe's bracketed form encoding, e.g.
//   { line_items: [{ price: 'x' }] }  ->  line_items[0][price]=x
function encodeForm(obj, prefix, out) {
  out = out || [];
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const value = obj[key];
    if (value === undefined || value === null) continue;
    const name = prefix ? prefix + '[' + key + ']' : key;
    if (typeof value === 'object') {
      encodeForm(value, name, out);
    } else {
      out.push(encodeURIComponent(name) + '=' + encodeURIComponent(value));
    }
  }
  return out;
}

export async function stripeRequest(env, method, path, params, idempotencyKey) {
  const headers = {
    Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': env.STRIPE_API_VERSION || '2026-05-27.dahlia',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const init = { method: method, headers: headers };
  let url = STRIPE_BASE + path;
  if (params && method === 'GET') {
    url += '?' + encodeForm(params).join('&');
  } else if (params) {
    init.body = encodeForm(params).join('&');
  }

  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || ('Stripe ' + res.status));
    err.stripe = data && data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Verify a Stripe-Signature header ("t=...,v1=...") with HMAC-SHA256.
// Returns true only for an authentic, in-tolerance signature.
export async function verifyStripeSignature(payload, sigHeader, secret, toleranceSeconds, nowSeconds) {
  if (!sigHeader || !secret) return false;
  const tolerance = toleranceSeconds || 300;

  const parts = {};
  sigHeader.split(',').forEach(function (kv) {
    const i = kv.indexOf('=');
    if (i > -1) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;

  const now = typeof nowSeconds === 'number' ? nowSeconds : Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false; // garbage timestamp -> reject (don't fail open)
  if (Math.abs(now - ts) > tolerance) return false; // replay defense

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(timestamp + '.' + payload));
  const computed = [].slice
    .call(new Uint8Array(sigBuf))
    .map(function (b) { return b.toString(16).padStart(2, '0'); })
    .join('');

  // Constant-time comparison. Do not early-return on length mismatch — that
  // would leak the expected signature's length via timing. (Cloudflare pattern.)
  const a = enc.encode(computed);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) {
    crypto.subtle.timingSafeEqual(a, a);
    return false;
  }
  return crypto.subtle.timingSafeEqual(a, b);
}
