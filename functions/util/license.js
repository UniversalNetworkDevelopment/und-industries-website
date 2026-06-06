// functions/util/license.js
// License-key generation for software products (e.g. ECAM).
// Crockford base32 (omits ambiguous I/L/O/U), grouped for readability.
// Cryptographically random via Web Crypto. Uniqueness is enforced at delivery
// by the entitlements row, so a (vanishingly unlikely) collision can't double-grant.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateLicenseKey(prefix) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let chars = '';
  for (let i = 0; i < bytes.length; i++) chars += ALPHABET[bytes[i] % 32];
  const groups = chars.match(/.{1,4}/g).slice(0, 4); // 4 groups of 4
  return (prefix ? prefix + '-' : '') + groups.join('-');
}
