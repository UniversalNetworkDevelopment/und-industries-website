# QWEP CAPABILITY AUDIT: MISSING COMPONENTS

## 1. Missing Core Engine (Severity: CRITICAL)
- **Missing:** The actual Qwep local Node.js server.
- **Explanation:** `QWEP_REALTIME_LISTENER.js` attempts to `POST` to `http://127.0.0.1:3133/api/jobs`. This server does not exist.
- **Required Fix:** Build an Express/Fastify API server on port 3133.
- **Dependencies:** Node.js, Express, SQLite3.

## 2. Missing GitHub Integration (Severity: CRITICAL)
- **Missing:** GitHub API orchestration script.
- **Explanation:** Qwep has no ability to clone, commit, or create repos. `gh` CLI is not even installed on the host.
- **Required Fix:** Install `gh` CLI, inject Personal Access Token, and write `github_manager.js`.

## 3. Missing Evidence Generator (Severity: HIGH)
- **Missing:** Automated screenshot logic.
- **Explanation:** Qwep cannot take "before and after" snapshots because it lacks a headless browser.
- **Required Fix:** Integrate Puppeteer or Playwright to navigate to URLs and capture PNGs.

## 4. Missing Rollback Engine (Severity: HIGH)
- **Missing:** Rollback handler for mid-job failures.
- **Explanation:** If Qwep crashes mid-build, there is no script to revert the database status from `in_progress` to `pending_retry`.
- **Required Fix:** Implement a global exception handler in the Qwep core that catches errors and cleans up staging directories.
