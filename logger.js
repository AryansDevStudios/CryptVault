const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const auditLogPath = path.join(logDir, 'audit.log');

let lastHash = 'genesis';
let logQueue = Promise.resolve();

// Initialize lastHash from the last line of the existing log
try {
    if (fs.existsSync(auditLogPath)) {
        const data = fs.readFileSync(auditLogPath, 'utf8');
        const lines = data.trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
            const lastLine = JSON.parse(lines[lines.length - 1]);
            if (lastLine && lastLine.hash) {
                lastHash = lastLine.hash;
            }
        }
    }
} catch (e) {
    console.error("Failed to initialize audit log hash chain:", e);
}

const logAudit = (action, ip, details = {}) => {
    // Serialize writes to prevent race conditions in hash chaining
    logQueue = logQueue.then(() => {
        return new Promise((resolve) => {
            const entry = {
                timestamp: new Date().toISOString(),
                action,
                ip: ip || 'unknown',
                ...details,
                prevHash: lastHash
            };
            
            // Generate hash for current entry
            const payloadString = JSON.stringify(entry);
            const hash = crypto.createHash('sha256').update(payloadString).digest('hex');
            entry.hash = hash;
            
            // Update the global lastHash for the next entry
            lastHash = hash;
            
            fs.appendFile(auditLogPath, JSON.stringify(entry) + '\n', (err) => {
                if (err) console.error("Failed to write to audit log:", err);
                resolve();
            });
        });
    });
};

module.exports = { logAudit };
