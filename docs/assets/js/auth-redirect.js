// If Supabase redirects an auth email link to the homepage (allowlist fallback),
// forward the code/hash to the correct handler before any page content renders.
// Must load synchronously in <head> — the redirect must fire before body paints.
(function () {
  var s = window.location.search, h = window.location.hash;
  if (s.indexOf('code=') !== -1) {
    window.location.replace('verified.html' + s + h); return;
  }
  if (h.indexOf('type=recovery') !== -1) {
    window.location.replace('reset-password.html' + h); return;
  }
  if (h.indexOf('type=signup') !== -1 || h.indexOf('type=email_change') !== -1) {
    window.location.replace('verified.html' + h); return;
  }
}());
