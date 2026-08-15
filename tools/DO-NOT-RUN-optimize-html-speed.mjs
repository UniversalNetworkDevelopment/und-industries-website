import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '../docs');

const INLINED_AUTH_REDIRECT = `<script>(function(){var s=window.location.search,h=window.location.hash;if(s.indexOf('code=')!==-1){window.location.replace('verified.html'+s+h);return;}if(h.indexOf('type=recovery')!==-1){window.location.replace('reset-password.html'+h);return;}if(h.indexOf('type=signup')!==-1||h.indexOf('type=email_change')!==-1){window.location.replace('verified.html'+h);return;}}());</script>`;

const PRECONNECT_TAGS = `<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n  <link rel="dns-prefetch" href="https://cdn.jsdelivr.net">`;

function countNonAscii(str) {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) count++;
  }
  return count;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const initialNonAscii = countNonAscii(content);
  let updated = content;

  // 1. Preconnect to cdn.jsdelivr.net
  if (!updated.includes('preconnect') && !updated.includes('cdn.jsdelivr.net')) {
    updated = updated.replace(/<link\s+rel=["']stylesheet["']/i, `${PRECONNECT_TAGS}\n  <link rel="stylesheet"`);
  } else if (!updated.includes('rel="preconnect"') && updated.includes('cdn.jsdelivr.net')) {
    updated = updated.replace(/<link\s+rel=["']stylesheet["']/i, `${PRECONNECT_TAGS}\n  <link rel="stylesheet"`);
  }

  // 2. Inline auth-redirect.js
  updated = updated.replace(
    /<script\s+src=["']assets\/js\/auth-redirect\.js(?:\?v=[a-f0-9]+)?["']><\/script>/gi,
    INLINED_AUTH_REDIRECT
  );

  // 3. Ensure defer on site-state.js and main.js
  updated = updated.replace(
    /<script\s+(?!defer\b)(src=["']assets\/js\/(?:site-state|main)\.js(?:\?v=[a-f0-9]+)?["'])><\/script>/gi,
    '<script defer $1></script>'
  );

  const finalNonAscii = countNonAscii(updated);
  if (initialNonAscii !== finalNonAscii) {
    console.error(`ERROR: Non-ASCII count mismatch in ${path.basename(filePath)}: initial ${initialNonAscii} vs final ${finalNonAscii}`);
    process.exit(1);
  }

  if (content !== updated) {
    fs.writeFileSync(filePath, updated, 'utf8');
    return true;
  }
  return false;
}

function runSweep() {
  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.html') && !f.includes('.bak'));
  let modifiedCount = 0;

  console.log(`Starting 31-file HTML speed optimization sweep across ${files.length} HTML files...`);

  for (const f of files) {
    const fullPath = path.join(DOCS_DIR, f);
    if (processFile(fullPath)) {
      modifiedCount++;
      console.log(`  [OPTIMIZED] ${f}`);
    } else {
      console.log(`  [UNCHANGED] ${f}`);
    }
  }

  console.log(`Sweep complete: ${modifiedCount} of ${files.length} HTML files updated.`);
}

runSweep();
