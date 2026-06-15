const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, 'docs');
const htmlFiles = fs.readdirSync(docsDir).filter(f => f.endsWith('.html'));

const cssToAdd = `
/* ── Nav Dropdown ── */
.nav-dropdown {
  position: relative;
}

.nav-dropdown-toggle {
  display: flex !important;
  align-items: center;
  gap: 4px;
}

.nav-dropdown-toggle svg {
  transition: transform 0.2s ease;
  margin-top: 1px;
}

.nav-dropdown:hover .nav-dropdown-toggle svg {
  transform: rotate(180deg);
}

.nav-dropdown-menu {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(10px);
  background: rgba(15, 15, 20, 0.98);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 0;
  min-width: 200px;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
  z-index: 200;
}

.nav-dropdown:hover .nav-dropdown-menu {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

.nav-dropdown-menu li {
  display: block;
}

.nav-dropdown-menu a {
  display: block;
  padding: 10px 20px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-soft) !important;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.nav-dropdown-menu a::after {
  display: none !important;
}

.nav-dropdown-menu a:hover {
  background: var(--bg-card-hover);
  color: #fff !important;
}
`;

const cssPath = path.join(docsDir, 'assets', 'css', 'styles.css');
let cssContent = fs.readFileSync(cssPath, 'utf8');
if (!cssContent.includes('.nav-dropdown-menu')) {
  fs.writeFileSync(cssPath, cssContent + "\n" + cssToAdd);
  console.log("Updated styles.css");
}

const targetActive = `<li><a href="services.html" class="active" aria-current="page">Services</a></li>`;
const targetInactive = `<li><a href="services.html">Services</a></li>`;

const replaceActive = `<li class="nav-dropdown">
          <a href="services.html" class="nav-dropdown-toggle active" aria-current="page">Services <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></a>
          <ul class="nav-dropdown-menu">
            <li><a href="services.html">Website Fixes</a></li>
            <li><a href="shopify.html">Shopify Services</a></li>
            <li><a href="automation.html">Automations &amp; AI</a></li>
          </ul>
        </li>`;

const replaceInactive = `<li class="nav-dropdown">
          <a href="services.html" class="nav-dropdown-toggle">Services <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></a>
          <ul class="nav-dropdown-menu">
            <li><a href="services.html">Website Fixes</a></li>
            <li><a href="shopify.html">Shopify Services</a></li>
            <li><a href="automation.html">Automations &amp; AI</a></li>
          </ul>
        </li>`;

for (const file of htmlFiles) {
  const filePath = path.join(docsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  
  if (content.includes(targetActive)) {
    content = content.replace(targetActive, replaceActive);
    changed = true;
  } else if (content.includes(targetInactive)) {
    content = content.replace(targetInactive, replaceInactive);
    changed = true;
  }
  
  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log("Updated " + file);
  }
}
