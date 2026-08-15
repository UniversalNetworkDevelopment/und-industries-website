import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '../docs');
const CSS_PATH = path.join(DOCS_DIR, 'assets/css/styles.css');

const cssContent = fs.readFileSync(CSS_PATH, 'utf8');

// Find url(...) in CSS
const urlMatches = [...cssContent.matchAll(/url\(["']?([^"')]+)["']?\)/gi)];
console.log(`Checking ${urlMatches.length} asset URLs referenced in styles.css...`);

let missingCount = 0;
for (const match of urlMatches) {
  const url = match[1];
  if (!url.startsWith('data:') && !url.startsWith('http')) {
    const targetPath = path.resolve(path.dirname(CSS_PATH), url);
    if (!fs.existsSync(targetPath)) {
      console.log(`  [MISSING ASSET] ${url} -> ${targetPath}`);
      missingCount++;
    }
  }
}

console.log(`Asset URL check complete: ${missingCount} missing assets found.`);
