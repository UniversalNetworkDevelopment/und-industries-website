const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const githubManager = require('./services/github_manager');
const evidenceCompiler = require('./services/evidence_compiler');
const supabaseWriteback = require('./services/supabase_writeback');

const app = express();
app.use(express.json());

// TMM Protocol
const tmmWatchdog = require('./services/tmm_watchdog');
tmmWatchdog.startWatchdog();

let activeJobs = 0;
const MAX_CONCURRENT_JOBS = 2;

// Inject Book & Street Smarts (The Master Rules)
try {
    global.QWEP_RULES = require('fs').readFileSync(path.join(__dirname, '../../GEMINI.md'), 'utf-8');
    console.log(`[QWEP] Master rules injected into memory. Street smarts active.`);
} catch (e) {
    console.warn(`[QWEP] Could not load GEMINI.md master rules.`);
}

// Initialize SQLite Bookkeeping Ledger
const dbPath = path.join(__dirname, 'qwep_ledger.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        ticket_id TEXT UNIQUE,
        ticket_type TEXT,
        status TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.post('/api/jobs', async (req, res) => {
    const jobPacket = req.body;
    console.log(`[QWEP] Received new job packet:`, jobPacket.ticket_id);
    
    // TMM Concurrency Check
    if (activeJobs >= MAX_CONCURRENT_JOBS) {
        tmmWatchdog.logEvent(`REJECTED JOB ${jobPacket.ticket_id} - Concurrency cap reached (${activeJobs}/${MAX_CONCURRENT_JOBS}). Engine throttled.`);
        return res.status(429).json({ error: 'Too many jobs running. Engine throttled by Task Manager Manager.' });
    }
    
    db.run(`INSERT INTO jobs (id, ticket_id, ticket_type, status) VALUES (?, ?, ?, ?)`, 
        [Date.now().toString(), jobPacket.ticket_id, jobPacket.ticket_type, 'received'], 
        async (err) => {
            if (err) {
                console.error('[QWEP] SQLite Insert Error:', err);
                return res.status(500).json({ error: 'Bookkeeping error' });
            }
            res.status(200).json({ status: 'Job accepted into local queue' });
            
            // Execute the pipeline asynchronously
            await executePipeline(jobPacket);
        });
});

const { runWebsiteJob } = require('./services/website-engine');

async function executePipeline(job) {
    try {
        activeJobs++;
        tmmWatchdog.logEvent(`Started job ${job.ticket_id}. Active jobs: ${activeJobs}/${MAX_CONCURRENT_JOBS}`);
        
        console.log(`[QWEP] Starting execution for ${job.ticket_id}`);
        db.run(`UPDATE jobs SET status = 'in_progress' WHERE ticket_id = ?`, [job.ticket_id]);
        
        // Formulate the full job packet
        const jobPacket = {
            job_id: Date.now().toString(),
            ticket_id: job.ticket_id,
            service_type: job.service_type || 'website',
            target_repo: job.target_repo_name || 'web-builder-ai',
            intake: job.intake_data || {},
            mode: job.ticket_type || 'live'
        };

        let deployedUrl = null;
        if (jobPacket.service_type === 'website') {
            deployedUrl = await runWebsiteJob(jobPacket);
        } else {
            console.log(`[QWEP] Unsupported service_type for now: ${jobPacket.service_type}`);
        }
        
        // Generate Evidence Pack
        const evidencePath = await evidenceCompiler.generatePack(job.ticket_id, `https://github.com/${process.env.GITHUB_ORG}/${jobPacket.target_repo}`);
        
        // Sync back to Supabase
        await supabaseWriteback.markComplete(job.ticket_id, evidencePath, deployedUrl);
        
        db.run(`UPDATE jobs SET status = 'completed' WHERE ticket_id = ?`, [job.ticket_id]);
        console.log(`[QWEP] Job ${job.ticket_id} fully completed.`);
    } catch (error) {
        console.error(`[QWEP] PIPELINE FAILED for ${job.ticket_id}:`, error);
        tmmWatchdog.logEvent(`ERROR in job ${job.ticket_id}: ${error.message}`);
        db.run(`UPDATE jobs SET status = 'failed' WHERE ticket_id = ?`, [job.ticket_id]);
        // Trigger rollback/error logic
    } finally {
        activeJobs--;
        tmmWatchdog.logEvent(`Finished job. Active jobs: ${activeJobs}/${MAX_CONCURRENT_JOBS}`);
    }
}

const PORT = 3133;
app.listen(PORT, () => {
    console.log(`[QWEP CORE] Listening on http://127.0.0.1:${PORT}`);
});
