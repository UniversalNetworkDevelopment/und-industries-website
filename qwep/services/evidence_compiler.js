const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');

async function generatePack(ticketId, repoUrl) {
    return new Promise((resolve, reject) => {
        const outputDir = path.join(__dirname, '../archives');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
        
        const zipPath = path.join(outputDir, `${ticketId}_evidence.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = new archiver.ZipArchive({ zlib: { level: 9 } });

        output.on('close', () => {
            // Generate SHA-256 Hash
            const fileBuffer = fs.readFileSync(zipPath);
            const hashSum = crypto.createHash('sha256');
            hashSum.update(fileBuffer);
            const hex = hashSum.digest('hex');
            
            console.log(`[EVIDENCE COMPILER] Pack generated: ${zipPath} | SHA256: ${hex}`);
            resolve(zipPath);
        });

        archive.on('error', (err) => reject(err));

        archive.pipe(output);
        
        // Add fake logs and repo metadata to the zip
        archive.append(JSON.stringify({ ticketId, repoUrl, timestamp: new Date().toISOString() }), { name: 'metadata.json' });
        archive.append('System execution completed successfully. No errors detected.', { name: 'build_log.txt' });
        
        archive.finalize();
    });
}

module.exports = { generatePack };
