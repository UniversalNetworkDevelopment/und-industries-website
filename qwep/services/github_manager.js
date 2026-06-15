const { Octokit } = require('octokit');

// In production, instantiate with real PAT from process.env.GITHUB_PAT
const octokit = process.env.GITHUB_PAT ? new Octokit({ auth: process.env.GITHUB_PAT }) : null;
const ORG_NAME = 'UniversalNetworkDevelopment';

async function createRepoAndPush(job) {
    if (!octokit) {
        console.warn('[GITHUB MANAGER] No GITHUB_PAT found. Simulating repo creation.');
        return `https://github.com/${ORG_NAME}/${job.ticket_id}-simulated`;
    }

    try {
        const repoName = job.target_repo_name || `${job.ticket_id}-deployment`;
        
        // 1. Create Private Repo
        console.log(`[GITHUB] Creating private repo: ${repoName} for authenticated user`);
        const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
            name: repoName,
            private: true,
            auto_init: true
        });
        
        // Ensure we use the correct owner for branch protection
        const owner = repo.owner.login;

        // 2. Branch Protections skipped (Requires GitHub Pro for private repos)
        console.log(`[GITHUB] Skipping branch protections (Free tier limitation)`);

        // 3. Atomic Commit: Scaffold HTML
        console.log(`[GITHUB] Committing index.html`);
        await octokit.rest.repos.createOrUpdateFileContents({
            owner: owner,
            repo: repoName,
            path: 'index.html',
            message: 'feat: Scaffold initial index.html',
            content: Buffer.from('<!DOCTYPE html><html><head><title>Scaffold</title></head><body><h1>Welcome to Qwep Generated Site</h1></body></html>').toString('base64')
        });
        // For actual atomic commits, we would loop through staging directory.

        return repo.html_url;
    } catch (error) {
        console.error('[GITHUB MANAGER ERROR]', error.message);
        throw error;
    }
}

module.exports = { createRepoAndPush };
