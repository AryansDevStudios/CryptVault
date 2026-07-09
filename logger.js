const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const auditLogPath = path.join(logDir, 'audit.log');

const logAudit = (action, ip, details = {}) => {
    const entry = {
        timestamp: new Date().toISOString(),
        action,
        ip: ip || 'unknown',
        ...details
    };
    
    // Append asynchronously
    fs.appendFile(auditLogPath, JSON.stringify(entry) + '\n', (err) => {
        if (err) console.error("Failed to write to audit log:", err);
    });
};

module.exports = { logAudit };
