const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, 'docs');
const htmlFiles = fs.readdirSync(docsDir).filter(f => f.endsWith('.html'));

let changedFiles = 0;
for (const file of htmlFiles) {
  const filePath = path.join(docsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace styles.css with styles.css?v=2 or v=3 etc to bust cache
  if (content.includes('href="assets/css/styles.css"')) {
    content = content.replace('href="assets/css/styles.css"', 'href="assets/css/styles.css?v=' + Date.now() + '"');
    fs.writeFileSync(filePath, content);
    changedFiles++;
  } else if (content.match(/href="assets\/css\/styles\.css\?v=\d+"/)) {
    content = content.replace(/href="assets\/css\/styles\.css\?v=\d+"/, 'href="assets/css/styles.css?v=' + Date.now() + '"');
    fs.writeFileSync(filePath, content);
    changedFiles++;
  }
}

console.log(`Cache busted in ${changedFiles} files.`);
