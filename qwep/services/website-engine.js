const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const axios = require("axios");

const ROOT = process.env.WORK_ROOT || process.cwd();
const GITHUB_ORG = process.env.GITHUB_ORG;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Helper: run shell command
function run(cmd, cwd = ROOT) {
  return execSync(cmd, { cwd, stdio: "inherit" });
}

// Helper: safe path
function p(...segments) {
  return path.join(ROOT, ...segments);
}

// 1. Ensure repo exists (create via GitHub API if needed)
async function ensureRepoExists(repoName) {
  const url = `https://api.github.com/repos/${GITHUB_ORG}/${repoName}`;

  try {
    await axios.get(url, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });
    console.log(`[Qwep][Website] Repo exists: ${GITHUB_ORG}/${repoName}`);
    return;
  } catch (e) {
    console.log(`[Qwep][Website] Repo not found, creating: ${GITHUB_ORG}/${repoName}`);
  }

  const createUrl = `https://api.github.com/orgs/${GITHUB_ORG}/repos`;
  const res = await axios.post(
    createUrl,
    {
      name: repoName,
      private: false,
      auto_init: true
    },
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    }
  );

  console.log(`[Qwep][Website] Repo created: ${res.data.html_url}`);
}

// 2. Clone repo locally
function cloneRepo(repoName) {
  const targetDir = p("work", repoName);

  if (!fs.existsSync(p("work"))) {
    fs.mkdirSync(p("work"));
  }

  if (fs.existsSync(targetDir)) {
    console.log(`[Qwep][Website] Repo already cloned, pulling latest: ${targetDir}`);
    run("git pull origin main", targetDir);
    return targetDir;
  }

  const repoUrl = `https://github.com/${GITHUB_ORG}/${repoName}.git`;
  console.log(`[Qwep][Website] Cloning repo: ${repoUrl}`);
  run(`git clone ${repoUrl} ${targetDir}`);
  return targetDir;
}

// 3. Scaffold HTML/CSS/JS (basic UND-style site)
function scaffoldSite(repoDir, intake) {
  const srcDir = repoDir;

  // index.html
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${intake.site_name || "UND Site"}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="hero">
    <h1>${intake.site_name || "UND Industries"}</h1>
    <p>Premium digital experiences, built by Qwep.</p>
  </header>

  <main>
    <section id="home" class="section">
      <h2>Home</h2>
      <p>Welcome to your new site. This was built automatically by Qwep.</p>
    </section>

    <section id="about" class="section">
      <h2>About</h2>
      <p>Tell your story here. Artist, founder, brand—this section is yours.</p>
    </section>

    <section id="music" class="section">
      <h2>Music</h2>
      <p>Embed your tracks, playlists, and visuals here.</p>
    </section>

    <section id="contact" class="section">
      <h2>Contact</h2>
      <form id="contact-form">
        <input type="text" placeholder="Your name" />
        <input type="email" placeholder="Your email" />
        <textarea placeholder="Your message"></textarea>
        <button type="submit">Send</button>
      </form>
    </section>
  </main>

  <script src="main.js"></script>
</body>
</html>
`;

  // styles.css
  const css = `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #050509;
  color: #f5f5f5;
}

.hero {
  padding: 4rem 2rem;
  text-align: center;
  background: radial-gradient(circle at top, #7b5cff, #050509);
}

.hero h1 {
  font-size: 3rem;
  margin-bottom: 0.5rem;
}

.hero p {
  opacity: 0.8;
}

.section {
  padding: 3rem 2rem;
  max-width: 900px;
  margin: 0 auto;
}

.section h2 {
  font-size: 2rem;
  margin-bottom: 1rem;
}

.section p {
  line-height: 1.6;
  opacity: 0.9;
}

#contact-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
}

#contact-form input,
#contact-form textarea {
  padding: 0.75rem;
  border-radius: 6px;
  border: 1px solid #333;
  background: #0b0b10;
  color: #f5f5f5;
}

#contact-form button {
  padding: 0.75rem;
  border-radius: 6px;
  border: none;
  background: #7b5cff;
  color: #050509;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

#contact-form button:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(123, 92, 255, 0.4);
}
`;

  // main.js
  const js = `document.addEventListener("DOMContentLoaded", () => {
  const sections = document.querySelectorAll(".section");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
        }
      });
    },
    { threshold: 0.2 }
  );

  sections.forEach((section) => {
    section.classList.add("hidden");
    observer.observe(section);
  });

  const form = document.getElementById("contact-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      alert("Message captured. Backend wiring comes next.");
    });
  }
});
`;

  const animCss = `
.section.hidden {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.section.visible {
  opacity: 1;
  transform: translateY(0);
}
`;

  fs.writeFileSync(path.join(srcDir, "index.html"), html, "utf8");
  fs.writeFileSync(path.join(srcDir, "styles.css"), css + animCss, "utf8");
  fs.writeFileSync(path.join(srcDir, "main.js"), js, "utf8");

  console.log("[Qwep][Website] Scaffolded HTML/CSS/JS");
}

// 4. Atomic commits
function atomicCommits(repoDir) {
  const steps = [
    { msg: "feat(html): scaffold base layout", files: ["index.html"] },
    { msg: "feat(css): apply UND theme styles", files: ["styles.css"] },
    { msg: "feat(js): add interactivity and animations", files: ["main.js"] }
  ];

  steps.forEach((step) => {
    run(`git add ${step.files.join(" ")}`, repoDir);
    run(`git commit -m "${step.msg}"`, repoDir);
    console.log(`[Qwep][Website] Commit: ${step.msg}`);
  });
}

// 5. Configure deploy (GitHub Pages)
function configureDeploy(repoDir) {
  console.log("[Qwep][Website] Deploy config assumed via GitHub Pages workflow.");
}

// 6. Push and deploy
function pushRepo(repoDir) {
  // Try to push to remote if it's a real git repo
  try {
    run("git push origin main", repoDir);
    console.log("[Qwep][Website] Pushed to origin main");
  } catch (e) {
    console.log("[Qwep][Website] Failed to push (could be a local test or missing upstream)");
  }
}

// 7. Main entry: run website job
async function runWebsiteJob(jobPacket) {
  const { job_id, target_repo, intake } = jobPacket;

  console.log(`[Qwep][Website] Starting job ${job_id} for repo ${target_repo}`);

  await ensureRepoExists(target_repo);
  const repoDir = cloneRepo(target_repo);
  scaffoldSite(repoDir, intake || {});
  atomicCommits(repoDir);
  configureDeploy(repoDir);
  pushRepo(repoDir);

  console.log(`[Qwep][Website] Job ${job_id} completed for repo ${target_repo}`);
}

module.exports = { runWebsiteJob };
