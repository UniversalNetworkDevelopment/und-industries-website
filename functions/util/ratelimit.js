// functions/util/ratelimit.js
// Per-IP request limiting for endpoints that anyone on the internet can call.
//
// WHY THIS EXISTS (2026-08-01):
// contact.js had a rate limiter. The two unauthenticated endpoints added after it — review.js
// and intake-notify.js — did not, because the limiter lived as a private const inside contact.js
// where nothing else could reach it. The discipline existed and simply did not travel. Making it
// importable is the actual fix; a rule that has to be remembered per-file gets forgotten per-file.
//
// intake-notify is the one that mattered: ticket numbers are sequential, so anyone could walk the
// range and fire an owner notification for every ticket in 'submitted' state, unbounded. Not a
// data leak — an inbox flood that burns the Resend quota and can get the sending domain marked as
// a spam source, which would silently break every transactional email the business depends on.
//
// HONEST LIMITATION — read before trusting this:
// State is a module-level Map, which lives in ONE Worker isolate. Cloudflare runs many isolates
// across many colos and recycles them freely, so this is NOT a globally coordinated limit. It
// reliably stops a naive loop from one address; it does NOT stop a distributed or patient
// attacker. Doing that properly needs Durable Objects or KV, which is a real dependency and a
// cost. This is deliberately the cheap 90% — documented as such so nobody later reads "rate
// limited" and believes the endpoint is protected against someone who is actually trying.

const buckets = new Map();

/**
 * @param {string} name    bucket namespace, so two endpoints never share a budget
 * @param {string} ip      caller address ('' is treated as its own shared bucket, not exempt)
 * @param {number} max     requests allowed per window
 * @param {number} windowMs window length in ms
 * @returns {boolean} true if the request may proceed
 */
export function allow(name, ip, max, windowMs) {
  const key = name + '|' + (ip || 'unknown');
  const now = Date.now();
  const slot = buckets.get(key);

  if (!slot || now >= slot.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });

    // Opportunistic sweep. Without it the Map grows for the isolate's whole lifetime, one entry
    // per distinct IP — which is itself a way to hurt a Worker. Cheap because it only runs on a
    // fresh window and only when the Map is already large.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return true;
  }

  if (slot.count >= max) return false;
  slot.count++;
  return true;
}

/** The address Cloudflare vouches for. Never trust X-Forwarded-For here — the caller sets it. */
export const callerIp = (request) => request.headers.get('cf-connecting-ip') || '';

/** Test seam: reset all buckets. Not used in production paths. */
export const _reset = () => buckets.clear();
