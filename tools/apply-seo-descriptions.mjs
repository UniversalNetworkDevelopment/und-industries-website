import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '../docs');

const DESCRIPTIONS = {
  '404.html': '<meta name="description" content="Page not found. Return to U.N.D Industries homepage or browse our store and services.">',
  'dashboard.html': '<meta name="description" content="U.N.D Industries User Portal and Dashboard - manage your products, services, and account settings.">',
  'dashboard-alt.html': '<meta name="description" content="U.N.D Industries Alternative Dashboard View - account management and client portal access.">',
  'login.html': '<meta name="description" content="Log in to your U.N.D Industries account to access purchases, services, and client tools.">',
  'register.html': '<meta name="description" content="Create a U.N.D Industries account to get started with software, music, automations, and custom services.">',
  'reset-password.html': '<meta name="description" content="Reset your U.N.D Industries account password securely.">',
  'review-thanks.html': '<meta name="description" content="Thank you for submitting a review to U.N.D Industries.">',
  'verified.html': '<meta name="description" content="Account verification status for U.N.D Industries.">'
};

function countNonAscii(str) {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) count++;
  }
  return count;
}

let count = 0;
for (const [file, metaTag] of Object.entries(DESCRIPTIONS)) {
  const filePath = path.join(DOCS_DIR, file);
  if (!fs.existsSync(filePath)) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('name="description"')) {
    console.log(`  [SKIP] ${file} already has meta description`);
    continue;
  }

  const initialNonAscii = countNonAscii(content);
  const updated = content.replace(/(<meta\s+name="viewport"[^>]*>)/i, `$1\n  ${metaTag}`);
  const finalNonAscii = countNonAscii(updated);

  if (initialNonAscii !== finalNonAscii) {
    console.error(`ERROR: Non-ASCII mismatch in ${file}: ${initialNonAscii} vs ${finalNonAscii}`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, updated, 'utf8');
  console.log(`  [UPDATED] ${file} with SEO meta description`);
  count++;
}

console.log(`SEO meta description injection complete: ${count} files updated.`);
