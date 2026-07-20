// tools/make-email-preview.mjs
// Renders the transactional email templates to a standalone HTML file for visual review.
//
// Two things this does that a naive preview does not:
//   1. Each email is placed in an <iframe srcdoc>, so the host page's (or browser's)
//      dark mode cannot repaint it. What you see is what a mail client renders.
//      The first preview looked wrong for exactly this reason: Chrome's forced dark
//      mode inverted the dark header band, and the white logo vanished into it.
//   2. It renders the SAME template with TWO different orders, proving the content
//      really is substituted per purchase rather than hard-coded.
//
// The logo is inlined as a data: URI here ONLY. The real email points at the absolute
// https URL, which requires the site to be deployed.
//
// Usage:  node tools/make-email-preview.mjs [outputPath]

import { customerConfirmEmail, ownerSaleEmail } from '../functions/util/email.js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const logoPath = join(here, '..', 'docs', 'assets', 'img', 'email-logo.png');
const dataUri = 'data:image/png;base64,' + readFileSync(logoPath).toString('base64');
const LIVE_LOGO = 'https://universalnetworkdevelopment.com/assets/img/email-logo.png';
const swap = (h) => h.split(LIVE_LOGO).join(dataUri);

const ORIGIN = 'https://universalnetworkdevelopment.com';

const orderA = {
  amount: 34900,
  email: 'sarah.mitchell@brightpathdental.com',
  ticket: 'UND-2607-01031',
  sessionId: 'cs_live_a1B2c3D4e5F6',
  summary: 'Website Full Cleanup',
  items: [{ name: 'Website Full Cleanup', slug: 'website-fix-cleanup', qty: 1 }],
};

// Different customer, different items, different total — same template.
const orderB = {
  amount: 29800,
  email: 'mike@orlandogaragedoors.com',
  ticket: 'UND-2607-01032',
  sessionId: 'cs_live_z9Y8x7W6v5U4',
  summary: '2 items',
  items: [
    { name: 'Website Quick Fix', slug: 'website-fix-quick', qty: 1 },
    { name: 'Website Fix Bundle', slug: 'website-fix-bundle', qty: 1 },
  ],
};

const cA = customerConfirmEmail(orderA, ORIGIN);
const cB = customerConfirmEmail(orderB, ORIGIN);
const oA = ownerSaleEmail(orderA);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function block(title, meta, html) {
  return (
    '<h2>' + title + '</h2><div class="meta">' + meta + '</div>' +
    '<div class="frame"><iframe title="' + title + '" srcdoc="' +
    html.replace(/"/g, '&quot;') +
    '" style="width:100%;height:960px;border:0;display:block;background:#fff"></iframe></div>'
  );
}

const page =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="color-scheme" content="light only">' +
  '<title>UND Industries — Email Preview</title><style>' +
  ':root{color-scheme:light only}' +
  'body{margin:0;background:#e9e9ee;color:#22222a;font-family:Segoe UI,Helvetica,Arial,sans-serif;padding:26px 16px 70px}' +
  '.note{max-width:680px;margin:0 auto 24px;background:#fff8e1;border-left:4px solid #d9a441;padding:15px 18px;font-size:13px;line-height:1.65;color:#4a3d22}' +
  'h2{max-width:680px;margin:36px auto 8px;font-size:13px;color:#3a3a44;letter-spacing:.08em;text-transform:uppercase}' +
  '.meta{max-width:680px;margin:0 auto 8px;font-size:12.5px;color:#70707e;background:#fff;border:1px solid #dcdce4;padding:11px 15px;line-height:1.75}' +
  '.meta b{color:#2a2a34}' +
  '.frame{max-width:680px;margin:0 auto 10px;border:1px solid #d5d5de}' +
  '</style></head><body>' +

  '<div class="note"><b>PREVIEW ONLY — sample data, nothing was sent.</b><br>' +
  'Each email sits in an iframe so your browser’s dark mode cannot repaint it — this is how ' +
  'a mail client actually shows it. Sections 1 and 2 are the SAME template with different ' +
  'purchases, to show the content is substituted per order.</div>' +

  block('1 — Customer receipt · single item',
    '<b>From:</b> UND Industries &lt;orders@universalnetworkdevelopment.com&gt;<br>' +
    '<b>To:</b> ' + esc(orderA.email) + '<br>' +
    '<b>Reply-To:</b> contact.undindustries@gmail.com<br>' +
    '<b>Subject:</b> ' + esc(cA.subject),
    swap(cA.html)) +

  block('2 — Same template · two items, different total',
    '<b>To:</b> ' + esc(orderB.email) + '<br>' +
    '<b>Subject:</b> ' + esc(cB.subject),
    swap(cB.html)) +

  block('3 — What YOU receive',
    '<b>To:</b> contact.undindustries@gmail.com<br>' +
    '<b>Reply-To:</b> ' + esc(orderA.email) + ' <i>(reply goes straight to the customer)</i><br>' +
    '<b>Subject:</b> ' + esc(oA.subject),
    swap(oA.html)) +

  '<h2>4 — Plain-text fallback (what spam filters read)</h2>' +
  '<div class="frame" style="background:#fff"><pre style="margin:0;padding:20px;font-size:12.5px;' +
  'line-height:1.65;white-space:pre-wrap;font-family:Consolas,monospace">' +
  esc(cA.text) + '</pre></div>' +

  '</body></html>';

const out = process.argv[2] || join(process.env.USERPROFILE || '.', 'Desktop', 'UND-email-preview.html');
writeFileSync(out, page, 'utf8');

const mojibake = (page.match(/â€|Ã‚/g) || []).length;
console.log('  written : ' + out);
console.log('  size    : ' + (page.length / 1024).toFixed(1) + ' KB');
console.log('  mojibake: ' + mojibake);
console.log('  emails  : 3 rendered + 1 plain-text');
