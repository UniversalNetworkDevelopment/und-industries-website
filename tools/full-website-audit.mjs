import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '../docs');

const findings = {
  brokenLinks: [],
  missingAlt: [],
  missingAria: [],
  missingMeta: [],
  scriptIssues: [],
  jsIssues: []
};

const htmlFiles = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.html') && !f.includes('.bak'));

// 1. Analyze each HTML file
for (const file of htmlFiles) {
  const filePath = path.join(DOCS_DIR, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  if (!content.includes('name="description"')) {
    findings.missingMeta.push({ file, issue: 'Missing <meta name="description"> tag for SEO' });
  }

  const headMatch = content.match(/<head>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    const headContent = headMatch[1];
    const scriptMatches = headContent.match(/<script[\s\S]*?>/gi) || [];
    for (const s of scriptMatches) {
      if (!s.includes('defer') && !s.includes('async') && s.includes('src=')) {
        findings.scriptIssues.push({ file, script: s, issue: 'Render-blocking <script> in <head>' });
      }
    }
  }
}

// 2. Check JS files in assets/js
const jsDir = path.join(DOCS_DIR, 'assets/js');
if (fs.existsSync(jsDir)) {
  const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
  for (const jsFile of jsFiles) {
    const jsPath = path.join(jsDir, jsFile);
    const content = fs.readFileSync(jsPath, 'utf8');
    if (content.includes('console.log') && !jsFile.includes('test')) {
      findings.jsIssues.push({ file: `assets/js/${jsFile}`, issue: 'Contains debug console.log calls' });
    }
  }
}

console.log('========================================================');
console.log('       U.N.D WEBSITE DETAILED AUDIT FINDINGS           ');
console.log('========================================================');

console.log('\n--- 1. FILES MISSING META DESCRIPTIONS (SEO TASK FOR CLAUDE) ---');
findings.missingMeta.forEach(m => console.log(`  - docs/${m.file}: ${m.issue}`));

console.log('\n--- 2. JS MAINTENANCE & CLEANUP ITEMS ---');
findings.jsIssues.forEach(j => console.log(`  - ${j.file}: ${j.issue}`));

console.log('\n--- 3. RENDER-BLOCKING HEAD SCRIPTS ---');
findings.scriptIssues.forEach(s => console.log(`  - docs/${s.file}: ${s.issue}`));

console.log('\nAudit scan complete.');
