// tools/test-email-encoding.mjs
// Gate: no customer-facing email may leave with mojibake in it.
//
// Run before any deploy that touches email:
//   node tools/test-email-encoding.mjs
// Exits non-zero on failure so it can gate a build.

import { customerConfirmEmail, ownerSaleEmail, ownerContactEmail, repairMojibake }
  from '../functions/util/email.js';

const MOJIBAKE = /â€|Ã‚|Ãƒ|â€™|â€œ/;
let failures = 0;
const ok = (label, pass, detail) => {
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : ''));
  if (!pass) failures++;
};

console.log('EMAIL ENCODING GATE\n');

// 1. The templates themselves must render clean.
const order = {
  amount: 34900, email: 'test@example.com', ticket: 'UND-2607-01031',
  sessionId: 'cs_test_1', summary: 'Website Full Cleanup',
  items: [{ name: 'Website Full Cleanup', slug: 'website-fix-cleanup', qty: 1 }],
};
const rendered = [
  ['customer html', customerConfirmEmail(order, 'https://x.test').html],
  ['customer text', customerConfirmEmail(order, 'https://x.test').text],
  ['customer subject', customerConfirmEmail(order, 'https://x.test').subject],
  ['owner html', ownerSaleEmail(order).html],
  ['owner subject', ownerSaleEmail(order).subject],
  ['contact html', ownerContactEmail({ name: 'A', email: 'a@b.c', subject: 'S', message: 'M' }).html],
];
for (const [label, body] of rendered) {
  ok('clean: ' + label, !MOJIBAKE.test(body));
}

// 2. Structural requirements that keep it rendering correctly at the far end.
const h = customerConfirmEmail(order, 'https://x.test').html;
ok('declares charset utf-8', /<meta charset="utf-8">/i.test(h));
ok('declares color-scheme (blocks dark-mode inversion)', /color-scheme/.test(h));
ok('document is closed', /<\/body><\/html>$/.test(h));
ok('logo uses an ABSOLUTE url', /src="https:\/\//.test(h));
ok('logo has width/height ATTRIBUTES (Outlook)', /width="72" height="72"/.test(h));
ok('logo has alt text', /alt="UND Industries"/.test(h));
ok('no flexbox/grid (breaks Outlook)', !/display:\s*(flex|grid)/.test(h));
ok('no external stylesheet', !/<link[^>]+stylesheet/i.test(h));
ok('brand name has no periods', !/U\.N\.D/.test(h));
ok('contact address present', /contact\.undindustries@gmail\.com/.test(h));

// 3. The repair function actually repairs, and leaves clean text alone.
const damaged = 'Order confirmed â€” one step. Weâ€™ve got it.';
const fixed = repairMojibake(damaged);
ok('repairs a damaged string', !MOJIBAKE.test(fixed), JSON.stringify(fixed));
const clean = 'Order confirmed — one step. We’ve got it.';
ok('leaves clean text untouched', repairMojibake(clean) === clean);

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS') + '\n');
process.exit(failures ? 1 : 0);
