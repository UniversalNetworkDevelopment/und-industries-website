// functions/util/sign.js
// HMAC-SHA256 signatures for links that are clicked from an email and therefore carry no session.
//
// WHY THIS EXISTS (2026-08-01):
// /api/review accepted ANY well-formed ticket number from ANYONE. Ticket numbers are strictly
// sequential — the live table runs UND-2606-01001, 01002, 01003 ... — so a single customer who
// buys once can derive every ticket that exists or ever will. There is no foreign key on
// service_reviews.ticket_number, so the ticket did not even have to exist. And because the
// endpoint runs on the SERVICE ROLE key, RLS never applied: the endpoint IS the privileged path.
//
// The attack that made this urgent was not "someone leaves a bad review". It was that
// service_reviews has a UNIQUE index on ticket_number and the worker honours first-write-wins.
// So an attacker could pre-emptively write 1-star rows across the whole number range, INCLUDING
// tickets not yet issued. When the real customer later clicked their genuine 5-star link they
// would get status=already and their real rating would be silently discarded. The "one rating
// per ticket" protection is what made the poisoning permanent — the defence was the weapon.
//
// A signature fixes this at the root: the rating link is only valid if WE minted it, which we
// only do after a paid job is actually delivered. No schema change, no new table, no state.
//
// KEY: prefers REVIEW_LINK_SECRET so the signing key can be rotated independently. Falls back to
// SUPABASE_SERVICE_ROLE_KEY so the feature is correct with ZERO configuration — a fix that needs
// a dashboard visit to take effect is a fix that stays unapplied. Every message is domain-
// separated by a label, so a signature minted for one purpose can never validate for another.

const enc = new TextEncoder();

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
}

function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function secretFor(env) {
  return env.REVIEW_LINK_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
}

/**
 * Sign a message under a domain label. Truncated to 128 bits — ample against forgery and short
 * enough to keep the emailed URL readable.
 */
export async function sign(env, label, message) {
  const secret = secretFor(env);
  if (!secret) return '';
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(label + ':' + message));
  return b64url(mac).slice(0, 22);
}

/**
 * Constant-time verify.
 *
 * Uses crypto.subtle.timingSafeEqual, matching util/stripe.js:88-96 — this codebase already had a
 * signature comparison and already documented the right way to do it. The first version of this
 * function hand-rolled a XOR loop AND early-returned on a length mismatch, which is precisely what
 * the comment over there says not to do because it leaks the expected length via timing. The
 * practical risk was negligible (the signature is a fixed 22 chars, and network jitter dwarfs the
 * signal) but reimplementing a solved problem slightly worse is how two files drift apart.
 *
 * timingSafeEqual is a Workers extension to crypto.subtle and is absent under Node, where the
 * tests run — hence the fallback, which stays constant-time with respect to the expected length
 * and folds the length difference into the same accumulator rather than branching on it.
 */
export async function verify(env, label, message, candidate) {
  const expected = await sign(env, label, message);
  if (!expected || typeof candidate !== 'string') return false;

  const a = enc.encode(expected);
  const b = enc.encode(candidate);

  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    if (a.byteLength !== b.byteLength) {
      crypto.subtle.timingSafeEqual(a, a);   // compare anyway, so timing does not reveal length
      return false;
    }
    return crypto.subtle.timingSafeEqual(a, b);
  }

  let diff = a.byteLength ^ b.byteLength;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ (b[i] === undefined ? 0 : b[i]);
  return diff === 0;
}

export const REVIEW_LABEL = 'und-review-v1';

/** The signature carried by a star link. Bound to BOTH ticket and rating, so a 5-star signature
 *  cannot be replayed as a 1-star one by editing the URL. */
export const reviewSig = (env, ticket, rating) =>
  sign(env, REVIEW_LABEL, ticket + ':' + rating);

export const reviewSigValid = (env, ticket, rating, sig) =>
  verify(env, REVIEW_LABEL, ticket + ':' + rating, sig);
