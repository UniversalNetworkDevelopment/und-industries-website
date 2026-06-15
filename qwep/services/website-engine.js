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

// 🔥 Home Brain: generate site from intake via local LLM
async function generateDynamicSite(intake, serviceType = "website") {
  const { qwepLLM, pickModel } = require("./llm-router.js");
  const model = pickModel(serviceType);

  const prompt = `
You are Qwep, the UND Industries Website Engine.

Given this intake JSON, generate:
- index.html
- styles.css
- main.js

Intake:
${JSON.stringify(intake, null, 2)}

Requirements:
- Premium UND dark cinematic style.
- Responsive layout.
- Smooth section reveal animations.
- Sections: home, about, services/music, contact.
- Contact form with basic front-end validation.

Return a JSON object with keys: html, css, js.
`;

  console.log(`[Qwep][HomeBrain] Using model: ${model}`);
  const raw = await qwepLLM(prompt, model);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("[Qwep][HomeBrain] Failed to parse LLM JSON, falling back.");
    throw e;
  }

  return parsed;
}

async function scaffoldSite(repoDir, intake) {
  console.log("[Qwep][Website] Generating site via Home Brain...");

  const { html, css, js } = await generateDynamicSite(intake, "website");

  fs.writeFileSync(path.join(repoDir, "index.html"), html, "utf8");
  fs.writeFileSync(path.join(repoDir, "styles.css"), css, "utf8");
  fs.writeFileSync(path.join(repoDir, "main.js"), js, "utf8");

  console.log("[Qwep][Website] Scaffolded HTML/CSS/JS from Home Brain");
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

  const deployedUrl = `https://${GITHUB_ORG}.github.io/${target_repo}/`;
  return deployedUrl;
}

module.exports = { runWebsiteJob };
