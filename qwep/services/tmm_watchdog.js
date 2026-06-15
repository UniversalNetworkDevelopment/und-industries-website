const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Basic TMM configuration
const TMM_INTERVAL_MS = 15000; // Check every 15 seconds
const CPU_KILL_THRESHOLD = 80; // Kill node processes > 80% CPU

function logEvent(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[TMM WATCHDOG] ${timestamp} - ${message}\n`;
    console.log(logLine.trim());
    
    // Optional: write to a local log file or Supabase audit_logs
    fs.appendFileSync(path.join(__dirname, '../tmm_events.log'), logLine);
}

function runProcessCheck() {
    // PowerShell command to get top CPU consumers
    const psCommand = `Get-Process | Where-Object { $_.CPU -gt 0 } | Sort-Object CPU -Descending | Select-Object -First 10 -Property Id, ProcessName, CPU, WorkingSet`;
    
    exec(`powershell -NoProfile -Command "${psCommand}"`, (error, stdout, stderr) => {
        if (error) {
            console.error('[TMM] Error querying processes:', error.message);
            return;
        }

        const lines = stdout.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length <= 2) return; // Skip headers

        let totalCpuAlert = false;
        const heavyProcesses = [];

        for (let i = 2; i < lines.length; i++) {
            const parts = lines[i].split(/\s+/);
            if (parts.length >= 4) {
                const id = parts[0];
                const name = parts[1];
                const cpu = parseFloat(parts[2]);
                const ramMb = Math.round(parseInt(parts[3]) / 1024 / 1024);

                if (cpu > CPU_KILL_THRESHOLD) {
                    heavyProcesses.push({ id, name, cpu, ramMb });
                }
            }
        }

        heavyProcesses.forEach(proc => {
            if (proc.name.toLowerCase() === 'node' || proc.name.toLowerCase() === 'node.exe') {
                // Ensure we don't kill the TMM itself! 
                // We'll just log and kill if it's exceptionally high.
                if (proc.id != process.pid) {
                    logEvent(`CRITICAL: Rogue Node process (${proc.id}) at ${proc.cpu}% CPU. KILLING process.`);
                    exec(`taskkill /PID ${proc.id} /F`, (kErr) => {
                        if (kErr) logEvent(`Failed to kill rogue node ${proc.id}: ${kErr.message}`);
                        else logEvent(`Successfully terminated rogue node ${proc.id}`);
                    });
                }
            } else if (proc.name.toLowerCase() === 'code' || proc.name.toLowerCase() === 'vmmemwsl' || proc.name.toLowerCase() === 'chrome') {
                logEvent(`WARNING: Heavy core process detected -> ${proc.name} (PID: ${proc.id}) using ${proc.cpu}% CPU, ${proc.ramMb} MB RAM.`);
            }
        });
    });
}

function startWatchdog() {
    logEvent('TMM Watchdog started. Enforcing Rules 122 & 123.');
    setInterval(runProcessCheck, TMM_INTERVAL_MS);
}

module.exports = { startWatchdog, logEvent };
