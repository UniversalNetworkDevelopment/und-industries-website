// functions/util/cors.js
// Shared response helpers for the payment API.
// Same-origin by default; echoes an allowed Origin so a future custom domain
// works too. Set ALLOWED_ORIGINS (comma-separated) in the Pages env to lock
// this down once the real domain is live.

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allow = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : [])
    .map(function (s) { return s.trim(); })
    .filter(Boolean);

  // Only ever echo a concrete origin — never a blanket '*'. The legitimate
  // frontend calls these endpoints same-origin (relative /api/... paths), so a
  // request with no Origin needs no CORS header at all. When ALLOWED_ORIGINS is
  // set, a non-allowlisted origin is not reflected (defaults to the first
  // allowed origin, which the foreign site can't use).
  let allowOrigin = origin || '';
  if (allow.length) {
    allowOrigin = origin && allow.indexOf(origin) !== -1 ? origin : allow[0];
  }

  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  return headers;
}

export function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      corsHeaders(request, env)
    ),
  });
}

export function preflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
