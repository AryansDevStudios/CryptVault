const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const crypto = require('crypto');
const multer = require('multer');
const archiver = require('archiver');
const bcrypt = require('bcryptjs');
const { PassThrough } = require('stream');
const { encryptStream, decryptStream, encryptMetadata, decryptMetadata, encryptBuffer, decryptBuffer } = require('./cryptoUtils');
const { logAudit } = require('./logger');

const app = express();

// --- Config Manager ---
const CONFIG_PATH = path.join(__dirname, 'config.json');

let globalConfig = {
    network: {
        port: 3000,
        host: "0.0.0.0",
        trustProxy: false,
        tls: { enabled: false, certPath: "", keyPath: "" }
    },
    security: {} // empty on fresh setup
};

function loadConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            globalConfig = JSON.parse(data);
        } catch (err) {
            console.error("Failed to parse config.json:", err);
        }
    }
    
    // Apply network config immediately
    if (globalConfig.network && globalConfig.network.trustProxy) {
        const tp = globalConfig.network.trustProxy;
        app.set('trust proxy', tp === true ? 1 : tp);
    }
}
loadConfig();

function saveConfig(updates) {
    if (updates.security) {
        globalConfig.security = { ...globalConfig.security, ...updates.security };
    }
    if (updates.network) {
        globalConfig.network = { ...globalConfig.network, ...updates.network };
    }
    const tempConfigPath = CONFIG_PATH + '.tmp';
    fs.writeFileSync(tempConfigPath, JSON.stringify(globalConfig, null, 2), 'utf8');
    fs.renameSync(tempConfigPath, CONFIG_PATH);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const helmet = require('helmet');

// Add security headers using Helmet
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "blob:"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "blob:"],
            workerSrc: ["'self'", "blob:"],
            upgradeInsecureRequests: null
        }
    },
    frameguard: {
        action: 'deny'
    },
    hsts: (globalConfig.network && globalConfig.network.tls && globalConfig.network.tls.enabled) ? { maxAge: 31536000, includeSubDomains: true } : false
}));

app.use(express.static(path.join(__dirname, 'public')));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

const MANIFEST_FILE = path.join(UPLOADS_DIR, 'manifest.enc');

// In-Memory State
const sessions = new Map(); // token -> { derivedKey, expiresAt }
const downloadTickets = new Map(); // ticketId -> { derivedKey, expiresAt }
let activeTransfers = 0; // tracking for safe restarts
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Manifest Manager to prevent race conditions during concurrent requests
class ManifestManager {
    constructor() {
        this.cache = null;
        this.isFlushing = false;
        this.needsFlush = false;
        this.flushPromise = Promise.resolve();
    }

    _seedManifest() {
        const nodes = Object.create(null);
        nodes["root"] = { type: "folder", name: "Vault Root", parentId: null, children: [] };
        return {
            settings: {
                maxUploadSize: 5 * 1024 * 1024 * 1024, // 5 GB
                parallelUploads: 3,
                networkTimeout: 0
            },
            nodes: nodes
        };
    }

    async load(encryptionKey) {
        if (this.cache) return this.cache;

        try {
            const exists = await fsPromises.stat(MANIFEST_FILE).then(() => true).catch(() => false);
            if (!exists) {
                this.cache = this._seedManifest();
                await this.save(encryptionKey);
                return this.cache;
            }

            const encrypted = await fsPromises.readFile(MANIFEST_FILE, 'utf8');
            if (!encrypted) {
                this.cache = this._seedManifest();
                return this.cache;
            }

            const decrypted = decryptMetadata(encrypted, encryptionKey);
            const parsed = JSON.parse(decrypted);
            
            if (!parsed.nodes || !parsed.nodes.root) {
                this.cache = this._seedManifest();
                return this.cache;
            }
            
            parsed.nodes = Object.assign(Object.create(null), parsed.nodes);
            
            if (!parsed.settings) {
                parsed.settings = { maxUploadSize: 5 * 1024 * 1024 * 1024, parallelUploads: 3, networkTimeout: 0 };
            } else {
                if (typeof parsed.settings.parallelUploads === 'undefined') parsed.settings.parallelUploads = 3;
                if (typeof parsed.settings.networkTimeout === 'undefined') parsed.settings.networkTimeout = 0;
            }

            this.cache = parsed;
            return this.cache;
        } catch (e) {
            console.error("Error reading manifest:", e.message);
            this.cache = this._seedManifest();
            return this.cache;
        }
    }

    async save(encryptionKey) {
        if (!this.cache) return;
        
        this.needsFlush = true;
        
        // Debounce/queue flushes so we don't overwrite concurrently
        if (this.isFlushing) {
            return this.flushPromise;
        }

        this.isFlushing = true;
        
        this.flushPromise = (async () => {
            while (this.needsFlush) {
                this.needsFlush = false;
                try {
                    const json = JSON.stringify(this.cache);
                    const encrypted = encryptMetadata(json, encryptionKey);
                    
                    // Write to temp file then rename for atomic write
                    const tempFile = `${MANIFEST_FILE}.tmp`;
                    await fsPromises.writeFile(tempFile, encrypted, 'utf8');
                    await fsPromises.rename(tempFile, MANIFEST_FILE);
                } catch (e) {
                    console.error("Failed to save manifest:", e);
                    this.needsFlush = true; // Retry on next cycle if needed, but realistically we should just log
                }
            }
            this.isFlushing = false;
        })();

        return this.flushPromise;
    }

    async ensurePath(encryptionKey, baseParentId, relativePath) {
        await this.load(encryptionKey);
        
        if (!relativePath) return baseParentId;
        
        const parts = relativePath.split('/');
        const folders = parts.slice(0, -1);
        
        let currentParentId = baseParentId;
        let changed = false;
        
        for (const folderName of folders) {
            const validationError = validateNodeName(folderName);
            if (validationError) throw new Error(`Invalid folder name in path: ${validationError}`);
            
            const parentNode = this.cache.nodes[currentParentId];
            let foundFolderId = null;
            
            for (const childId of parentNode.children) {
                const childNode = this.cache.nodes[childId];
                if (childNode.type === 'folder' && childNode.name === folderName) {
                    foundFolderId = childId;
                    break;
                }
            }
            
            if (foundFolderId) {
                currentParentId = foundFolderId;
            } else {
                const newFolderId = crypto.randomUUID();
                this.cache.nodes[newFolderId] = {
                    type: 'folder',
                    name: folderName,
                    parentId: currentParentId,
                    children: [],
                    createdAt: new Date().toISOString()
                };
                this.cache.nodes[currentParentId].children.push(newFolderId);
                currentParentId = newFolderId;
                changed = true;
            }
        }
        
        if (changed) {
            await this.save(encryptionKey);
        }
        
        return currentParentId;
    }
}

const manifestManager = new ManifestManager();

// Multer Custom Storage Engine for on-the-fly encryption
function CustomEncryptStorage(opts) {
    this.destination = opts.destination;
}

CustomEncryptStorage.prototype._handleFile = function _handleFile(req, file, cb) {
    this.destination(req, file, function (err, destPath, fileUuid) {
        if (err) return cb(err);
        
        if (!req.encryptionKey) return cb(new Error("Unauthorized: Missing encryption key in request"));
        
        const writeStream = fs.createWriteStream(destPath);
        
        encryptStream(file.stream, writeStream, req.encryptionKey)
            .then(() => {
                cb(null, {
                    path: destPath,
                    filename: fileUuid,
                    originalname: file.originalname
                });
            })
            .catch((encryptErr) => {
                fsPromises.unlink(destPath).catch(() => {}).finally(() => cb(encryptErr));
            });
    });
};

CustomEncryptStorage.prototype._removeFile = function _removeFile(req, file, cb) {
    fs.unlink(file.path, cb);
};

const storage = new CustomEncryptStorage({
    destination: function (req, file, cb) {
        const fileUuid = crypto.randomUUID();
        const destPath = path.join(UPLOADS_DIR, fileUuid);
        cb(null, destPath, fileUuid);
    }
});

const upload = multer({ storage: storage });

// Authentication Middleware
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }
    
    const token = authHeader.split(' ')[1];
    const session = sessions.get(token);
    
    if (!session || session.expiresAt < Date.now()) {
        if (session) sessions.delete(token); // cleanup
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
    
    // Extend session life on activity (max 7 days total)
    const MAX_LIFETIME = 7 * 24 * 60 * 60 * 1000; // 7 days
    if (session.createdAt && Date.now() - session.createdAt > MAX_LIFETIME) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Unauthorized: Session absolute lifetime expired' });
    }
    
    session.expiresAt = Math.min(
        Date.now() + 24 * 60 * 60 * 1000, 
        session.createdAt ? session.createdAt + MAX_LIFETIME : Date.now() + 24 * 60 * 60 * 1000
    );
    
    req.encryptionKey = session.derivedKey;
    req.sessionToken = token;
    next();
};


function checkPasswordStrength(password) {
    if (password.length < 12) return 'Password must be at least 12 characters long.';
    if (password.length > 256) return 'Password too long (max 256 characters).';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
    if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
    if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character.';
    return null;
}

function validateNodeName(name) {
    if (!name || typeof name !== 'string') return 'Name is required';
    const trimmed = name.trim();
    if (trimmed.length === 0) return 'Name cannot be empty';
    if (trimmed.length > 255) return 'Name too long (max 255 characters)';
    if (/[\x00-\x1f\/\\<>:"|?*]/.test(trimmed)) return 'Name contains invalid characters';
    if (trimmed === '.' || trimmed === '..') return 'Invalid name';
    return null;
}

function safeFilePath(uuid) {
    if (!UUID_REGEX.test(uuid)) return null;
    const resolved = path.resolve(UPLOADS_DIR, uuid);
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) return null;
    return resolved;
}

// --- Routes ---

app.get('/api/status', (req, res) => {
    res.json({ isSetup: !!globalConfig.security.masterPasswordHash });
});

app.post('/api/setup', async (req, res) => {
    if (globalConfig.security.masterPasswordHash) {
        return res.status(400).json({ error: 'Vault is already setup' });
    }
    
    try {
        const { password, deployEnv } = req.body;
        if (!password || typeof password !== 'string') {
            return res.status(400).json({ error: 'Password is required' });
        }
        const strengthError = checkPasswordStrength(password);
        if (strengthError) return res.status(400).json({ error: strengthError });
        
        const preHashed = crypto.createHash('sha256').update(password).digest('hex');
        const hash = await bcrypt.hash(preHashed, 14);
        const currentDEK = crypto.randomBytes(32);
        
        const salt = crypto.randomBytes(32).toString('hex');
        const scryptN = 131072;
        const newKEK = crypto.scryptSync(password, salt, 32, { N: scryptN, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
        
        const { encrypted: encryptedDEK, iv, authTag } = encryptBuffer(currentDEK, newKEK);
        
        saveConfig({
            security: {
                masterPasswordHash: hash,
                keyDerivationSalt: salt,
                scryptN: scryptN,
                encryptedDek: encryptedDEK.toString('hex'),
                dekIv: iv.toString('hex'),
                dekAuthTag: authTag.toString('hex')
            },
            network: {
                host: deployEnv === 'local' ? '127.0.0.1' : '0.0.0.0'
            }
        });
        
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, {
            derivedKey: currentDEK.toString('hex'),
            createdAt: Date.now(),
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            userAgent: req.headers['user-agent'] || 'Unknown Device',
            ip: req.ip
        });
        
        await manifestManager.load(currentDEK.toString('hex'));
        
        logAudit('VAULT_SETUP', req.ip);
        
        res.json({ success: true, token });
        
        // Asynchronously restart server if the host changed to bind correctly.
        setTimeout(() => {
            restartServer().catch(err => console.error("Auto-restart failed:", err));
        }, 1000);
    } catch (err) {
        console.error("Setup error:", err);
        res.status(500).json({ error: 'Failed to complete setup' });
    }
});

const globalLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 failed attempts total across all IPs
    keyGenerator: () => 'global',
    message: { error: 'Vault is under attack. Global lockout active for 15 minutes.' },
    skipSuccessfulRequests: true
});

const ipLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 failed requests per windowMs
    message: { error: 'Too many failed login attempts from this IP, please try again after 15 minutes.' },
    skipSuccessfulRequests: true
});

app.post('/api/login', globalLoginLimiter, ipLoginLimiter, async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || typeof password !== 'string') {
            return res.status(400).json({ error: 'Password is required' });
        }
        
        if (!globalConfig.security || !globalConfig.security.masterPasswordHash) {
            return res.status(400).json({ error: 'Vault not set up yet' });
        }
        
        // Use async bcrypt
        const preHashed = crypto.createHash('sha256').update(password).digest('hex');
        const isValid = await bcrypt.compare(preHashed, globalConfig.security.masterPasswordHash);
        
        if (isValid) {
            // Derive KEK
            const scryptN = parseInt(globalConfig.security.scryptN || 16384, 10);
            const kek = crypto.scryptSync(password, globalConfig.security.keyDerivationSalt, 32, { N: scryptN, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
            
            let finalDEKHex;
            if (globalConfig.security.encryptedDek && globalConfig.security.dekIv) {
                try {
                    const dek = decryptBuffer(
                        Buffer.from(globalConfig.security.encryptedDek, 'hex'),
                        kek,
                        Buffer.from(globalConfig.security.dekIv, 'hex'),
                        globalConfig.security.dekAuthTag ? Buffer.from(globalConfig.security.dekAuthTag, 'hex') : Buffer.alloc(16)
                    );
                    finalDEKHex = dek.toString('hex');
                } catch (e) {
                    console.error("DEK Decryption Error:", e);
                    return res.status(500).json({ error: 'Failed to decrypt Data Encryption Key' });
                }
            } else {
                // Legacy fallback
                finalDEKHex = kek.toString('hex');
            }
            
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, {
                derivedKey: finalDEKHex,
                createdAt: Date.now(),
                expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
                userAgent: req.headers['user-agent'] || 'Unknown Device',
                ip: req.ip
            });
            
            // Warm up cache
            await manifestManager.load(finalDEKHex);
            
            logAudit('LOGIN_SUCCESS', req.ip);
            
            return res.json({ success: true, token });
        }
        
        logAudit('LOGIN_FAILED', req.ip);
        res.status(401).json({ error: 'Invalid password' });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/logout', authMiddleware, (req, res) => {
    sessions.delete(req.sessionToken);
    manifestManager.cache = null; // Clear cache on logout for security (single user assumption)
    res.json({ success: true });
});

app.get('/api/settings', authMiddleware, async (req, res) => {
    try {
        const manifest = await manifestManager.load(req.encryptionKey);
        res.json({ success: true, settings: manifest.settings, network: globalConfig.network });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

app.post('/api/settings', authMiddleware, async (req, res) => {
    try {
        const { maxUploadSize, parallelUploads, networkTimeout } = req.body;
        if (!maxUploadSize || typeof maxUploadSize !== 'number') {
            return res.status(400).json({ error: 'Invalid maxUploadSize' });
        }
        
        const manifest = await manifestManager.load(req.encryptionKey);
        manifest.settings.maxUploadSize = maxUploadSize;
        
        if (typeof parallelUploads === 'number' && parallelUploads > 0) {
            manifest.settings.parallelUploads = parallelUploads;
        }
        if (typeof networkTimeout === 'number' && networkTimeout >= 0) {
            manifest.settings.networkTimeout = networkTimeout;
        }
        
        await manifestManager.save(req.encryptionKey);
        
        res.json({ success: true, settings: manifest.settings });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

app.post('/api/settings/reset', authMiddleware, async (req, res) => {
    try {
        const manifest = await manifestManager.load(req.encryptionKey);
        manifest.settings = {
            maxUploadSize: 5 * 1024 * 1024 * 1024,
            parallelUploads: 3,
            networkTimeout: 0
        };
        await manifestManager.save(req.encryptionKey);
        res.json({ success: true, settings: manifest.settings });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset settings' });
    }
});

app.get('/api/settings/audit', authMiddleware, async (req, res) => {
    try {
        const fsPromises = require('fs').promises;
        const logPath = path.join(__dirname, 'logs', 'audit.log');
        if (!fs.existsSync(logPath)) return res.json({ logs: [] });
        
        const data = await fsPromises.readFile(logPath, 'utf8');
        const logs = data.trim().split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean);
        res.json({ logs });
    } catch (err) {
        console.error("Failed to read audit logs:", err);
        res.status(500).json({ error: 'Failed to read audit logs' });
    }
});

const tlsUpload = multer({ storage: multer.memoryStorage() }).fields([
    { name: 'tlsCertFile', maxCount: 1 },
    { name: 'tlsKeyFile', maxCount: 1 }
]);

app.post('/api/settings/network', authMiddleware, tlsUpload, (req, res) => {
    try {
        const port = parseInt(req.body.port, 10);
        const host = req.body.host;
        let trustProxy = req.body.trustProxy;
        if (trustProxy === 'true' || trustProxy === true) trustProxy = true;
        else if (trustProxy === 'false' || trustProxy === false) trustProxy = false;
        
        const tlsEnabled = req.body.tlsEnabled === 'true' || req.body.tlsEnabled === true;
        
        let tlsKeyPath = globalConfig.network.tls ? globalConfig.network.tls.keyPath : '';
        let tlsCertPath = globalConfig.network.tls ? globalConfig.network.tls.certPath : '';

        if (tlsEnabled) {
            const hasNewCert = req.files && req.files['tlsCertFile'] && req.files['tlsCertFile'][0];
            const hasNewKey = req.files && req.files['tlsKeyFile'] && req.files['tlsKeyFile'][0];
            
            if (hasNewCert && hasNewKey) {
                const certBuffer = req.files['tlsCertFile'][0].buffer;
                const keyBuffer = req.files['tlsKeyFile'][0].buffer;
                
                try {
                    const crypto = require('crypto');
                    crypto.createSecureContext({
                        cert: certBuffer,
                        key: keyBuffer
                    });
                } catch (e) {
                    return res.status(400).json({ error: 'Invalid TLS Certificate or Key' });
                }
                
                const tlsDir = path.join(__dirname, 'tls');
                if (!fs.existsSync(tlsDir)) {
                    fs.mkdirSync(tlsDir, { recursive: true });
                }
                tlsCertPath = path.join(tlsDir, 'server.crt');
                tlsKeyPath = path.join(tlsDir, 'server.key');
                
                fs.writeFileSync(tlsCertPath, certBuffer, { mode: 0o644 });
                fs.writeFileSync(tlsKeyPath, keyBuffer, { mode: 0o600 });
            } else if (!tlsCertPath || !tlsKeyPath || !fs.existsSync(tlsCertPath) || !fs.existsSync(tlsKeyPath)) {
                return res.status(400).json({ error: 'TLS enabled but certificates are missing or invalid' });
            }
        } else {
            const tlsDir = path.join(__dirname, 'tls');
            const certP = path.join(tlsDir, 'server.crt');
            const keyP = path.join(tlsDir, 'server.key');
            if (fs.existsSync(certP)) fs.unlinkSync(certP);
            if (fs.existsSync(keyP)) fs.unlinkSync(keyP);
            tlsKeyPath = '';
            tlsCertPath = '';
        }
        
        saveConfig({
            network: {
                port: port || 3000,
                host: host || '127.0.0.1',
                trustProxy: trustProxy,
                tls: {
                    enabled: !!tlsEnabled,
                    keyPath: tlsKeyPath,
                    certPath: tlsCertPath
                }
            }
        });
        
        res.json({ success: true, network: globalConfig.network });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to save network settings' });
    }
});

app.post('/api/system/restart', authMiddleware, (req, res) => {
    if (activeTransfers > 0) {
        return res.status(409).json({ error: 'Cannot restart: Active transfers in progress' });
    }
    
    const host = globalConfig.network.host || '127.0.0.1';
    const port = globalConfig.network.port;
    const protocol = (globalConfig.network.tls && globalConfig.network.tls.enabled) ? 'https' : 'http';
    const newUrl = `${protocol}://${host}:${port}`;
    
    // Respond immediately, then restart asynchronously
    res.json({ success: true, newUrl });
    
    setTimeout(() => {
        restartServer().catch(err => console.error("Restart failed:", err));
    }, 500);
});

app.post('/api/settings/password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || typeof currentPassword !== 'string' || !newPassword || typeof newPassword !== 'string') {
            return res.status(400).json({ error: 'currentPassword and newPassword are required strings' });
        }
        
        const currentPreHashed = crypto.createHash('sha256').update(currentPassword).digest('hex');
        const isValid = await bcrypt.compare(currentPreHashed, globalConfig.security.masterPasswordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'Incorrect current password' });
        }
        
        const strengthError = checkPasswordStrength(newPassword);
        if (strengthError) return res.status(400).json({ error: strengthError });
        
        // We already have the decrypted DEK in memory via req.encryptionKey
        const currentDEK = Buffer.from(req.encryptionKey, 'hex');
        
        const newPreHashed = crypto.createHash('sha256').update(newPassword).digest('hex');
        const hash = await bcrypt.hash(newPreHashed, 14);
        
        const salt = crypto.randomBytes(32).toString('hex');
        const scryptN = 131072;
        const newKEK = crypto.scryptSync(newPassword, salt, 32, { N: scryptN, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
        
        const { encrypted: encryptedDEK, iv, authTag } = encryptBuffer(currentDEK, newKEK);
        
        saveConfig({
            security: {
                masterPasswordHash: hash,
                keyDerivationSalt: salt,
                scryptN: scryptN,
                encryptedDek: encryptedDEK.toString('hex'),
                dekIv: iv.toString('hex'),
                dekAuthTag: authTag.toString('hex')
            }
        });
        
        // Revoke all OTHER sessions to force re-login on other devices
        for (const [token, session] of sessions.entries()) {
            if (token !== req.sessionToken) {
                sessions.delete(token);
            }
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error("Password rotation error:", err);
        res.status(500).json({ error: 'Failed to update password' });
    }
});

app.get('/api/check-auth', authMiddleware, (req, res) => {
    res.json({ authenticated: true });
});

// Protect all following /api routes
app.use('/api/nodes', authMiddleware);
app.use('/api/folders', authMiddleware);
app.use('/api/upload', authMiddleware);
app.use('/api/download-ticket', authMiddleware);

app.post('/api/download-ticket', (req, res) => {
    const { uuids } = req.body || {};
    const ticketId = crypto.randomBytes(16).toString('hex');
    downloadTickets.set(ticketId, {
        derivedKey: req.encryptionKey,
        expiresAt: Date.now() + 60000, // Ticket valid for 60 seconds
        uuids
    });
    res.json({ success: true, ticket: ticketId });
});

// Download routes do NOT use authMiddleware because they are triggered via window.location.href
const ticketAuth = (req, res, next) => {
    const ticketId = req.query.ticket;
    if (!ticketId) return res.status(401).json({ error: 'Missing ticket' });
    
    const ticket = downloadTickets.get(ticketId);
    if (!ticket || ticket.expiresAt < Date.now()) {
        if (ticket) downloadTickets.delete(ticketId);
        return res.status(401).json({ error: 'Invalid or expired ticket' });
    }
    
    req.encryptionKey = ticket.derivedKey;
    req.ticketData = ticket;
    // Consume ticket (single-use)
    downloadTickets.delete(ticketId);
    
    next();
};

app.get('/api/nodes/:parentId', async (req, res) => {
    try {
        const { parentId } = req.params;
        const manifest = await manifestManager.load(req.encryptionKey);
        
        if (!manifest.nodes[parentId]) {
            return res.status(404).json({ error: 'Folder not found' });
        }
        
        const childrenNodes = {};
        manifest.nodes[parentId].children.forEach(childId => {
            childrenNodes[childId] = manifest.nodes[childId];
        });
        
        const breadcrumbs = [];
        let currentId = parentId;
        while (currentId) {
            const node = manifest.nodes[currentId];
            if (!node) break;
            breadcrumbs.unshift({ id: currentId, name: node.name });
            currentId = node.parentId;
        }
        
        res.json({
            folder: manifest.nodes[parentId],
            children: childrenNodes,
            breadcrumbs
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch nodes' });
    }
});

app.post('/api/folders', async (req, res) => {
    try {
        const { name, parentId } = req.body;
        const nameError = validateNodeName(name);
        if (nameError) return res.status(400).json({ error: nameError });
        
        const manifest = await manifestManager.load(req.encryptionKey);
        
        if (!manifest.nodes[parentId] || manifest.nodes[parentId].type !== 'folder') {
            return res.status(404).json({ error: 'Parent folder not found' });
        }
        
        const folderId = crypto.randomUUID();
        manifest.nodes[folderId] = {
            type: 'folder',
            name,
            parentId,
            children: [],
            createdAt: new Date().toISOString()
        };
        manifest.nodes[parentId].children.push(folderId);
        
        await manifestManager.save(req.encryptionKey);
        res.json({ success: true, folderId, folder: manifest.nodes[folderId] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

app.post('/api/folders/path', async (req, res) => {
    try {
        const { baseParentId, relativePath } = req.body;
        const actualParentId = await manifestManager.ensurePath(req.encryptionKey, baseParentId, relativePath);
        res.json({ success: true, folderId: actualParentId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create path' });
    }
});

app.post('/api/upload', (req, res, next) => {
    activeTransfers++;
    let done = false;
    const dec = () => { if (!done) { activeTransfers--; done = true; } };
    res.on('finish', dec);
    res.on('close', dec);
    next();
}, async (req, res, next) => {
    try {
        const manifest = await manifestManager.load(req.encryptionKey);
        const limit = manifest.settings?.maxUploadSize || 5 * 1024 * 1024 * 1024;
        
        const dynamicUpload = multer({
            storage: storage,
            limits: { fileSize: limit }
        }).single('file');
        
        dynamicUpload(req, res, function (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large' });
            } else if (err) {
                return res.status(500).json({ error: 'Upload error' });
            }
            next();
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to initialize upload' });
    }
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { filename: uuid } = req.file;
        const originalname = req.body.originalname || req.file.originalname;
        const nameError = validateNodeName(originalname);
        if (nameError) {
            await fsPromises.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ error: 'Invalid filename: ' + nameError });
        }
        const stat = await fsPromises.stat(req.file.path);

        const baseParentId = req.body.parentId || 'root';
        const relativePath = req.body.relativePath || '';

        const actualParentId = await manifestManager.ensurePath(req.encryptionKey, baseParentId, relativePath);
        const manifest = await manifestManager.load(req.encryptionKey);

        manifest.nodes[uuid] = {
            type: 'file',
            name: originalname,
            parentId: actualParentId,
            uploadedAt: new Date().toISOString(),
            size: stat.size
        };
        manifest.nodes[actualParentId].children.push(uuid);

        await manifestManager.save(req.encryptionKey);
        
        logAudit('UPLOAD_FILE', req.ip, { uuid, filename: originalname, size: stat.size });
        
        res.json({ success: true, uuid, node: manifest.nodes[uuid] });
    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ error: 'Failed to complete upload' });
    }
});

app.get('/api/download/:uuid', ticketAuth, async (req, res) => {
    activeTransfers++;
    let done = false;
    const dec = () => { if (!done) { activeTransfers--; done = true; } };
    res.on('finish', dec);
    res.on('close', dec);
    
    try {
        const { uuid } = req.params;
        const filePath = safeFilePath(uuid);
        if (!filePath) return res.status(400).json({ error: 'Invalid file ID' });
        
        // Validate ticket scope if UUIDs were specified
        if (req.ticketData.uuids && req.ticketData.uuids.length > 0 && !req.ticketData.uuids.includes(uuid)) {
            return res.status(403).json({ error: 'Ticket not valid for this file' });
        }
        
        const manifest = await manifestManager.load(req.encryptionKey);
        const node = manifest.nodes[uuid];

        if (!node || node.type !== 'file') return res.status(404).json({ error: 'File not found' });
        
        try {
            await fsPromises.access(filePath);
        } catch (e) {
            return res.status(404).json({ error: 'File missing on disk' });
        }

        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(node.name)}`);
        res.setHeader('Content-Type', 'application/octet-stream');

        logAudit('DOWNLOAD_FILE', req.ip, { uuid });
        
        await decryptStream(filePath, res, req.encryptionKey);
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: 'Decryption failed' });
    }
});

app.get('/api/download-folder/:uuid', ticketAuth, async (req, res) => {
    try {
        const { uuid } = req.params;
        if (!UUID_REGEX.test(uuid)) return res.status(400).json({ error: 'Invalid folder ID' });
        
        const manifest = await manifestManager.load(req.encryptionKey);
        const folderNode = manifest.nodes[uuid];
        
        if (!folderNode || folderNode.type !== 'folder') return res.status(404).json({ error: 'Folder not found' });
        
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(folderNode.name + '.zip')}`);
        res.setHeader('Content-Type', 'application/zip');
        
        const archive = new archiver.ZipArchive({ zlib: { level: 1 } });
        
        archive.on('error', (err) => {
            console.error("Archiver error:", err);
            if (!res.headersSent) res.status(500).end();
        });

        archive.pipe(res);
        
        async function appendFolderToArchive(folderId, currentPath) {
            const node = manifest.nodes[folderId];
            if (!node || !node.children) return;
            for (const childId of node.children) {
                const childNode = manifest.nodes[childId];
                if (!childNode) continue;
                if (childNode.type === 'folder') {
                    await appendFolderToArchive(childId, `${currentPath}${childNode.name}/`);
                } else {
                    const filePath = safeFilePath(childId);
                    if (!filePath) continue;
                    try {
                        await fsPromises.access(filePath);
                        const pt = new PassThrough();
                        // Handle promise correctly without blocking the loop but catching errors
                        decryptStream(filePath, pt, req.encryptionKey).catch((e) => {
                            console.error(`Failed to decrypt ${filePath} for zip`, e);
                            pt.end(); // Ensure stream ends on error so archiver doesn't hang
                        });
                        archive.append(pt, { name: `${currentPath}${childNode.name}` });
                    } catch (e) {
                        // File missing, skip
                    }
                }
            }
        }
        
        await appendFolderToArchive(uuid, '');
        await archive.finalize();
    } catch (err) {
        console.error("Download folder error:", err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to download folder' });
    }
});

app.get('/api/download-multiple', ticketAuth, async (req, res) => {
    try {
        const uuids = req.ticketData.uuids;
        if (!uuids || !Array.isArray(uuids) || uuids.length === 0) {
            return res.status(400).json({ error: 'No files specified' });
        }
        
        const manifest = await manifestManager.load(req.encryptionKey);
        
        res.setHeader('Content-Disposition', `attachment; filename="bulk_download.zip"`);
        res.setHeader('Content-Type', 'application/zip');
        
        const archive = new archiver.ZipArchive({ zlib: { level: 1 } });
        
        archive.on('error', (err) => {
            console.error("Archiver error:", err);
            if (!res.headersSent) res.status(500).end();
        });

        archive.pipe(res);
        
        async function appendFolderToArchive(folderId, currentPath) {
            const node = manifest.nodes[folderId];
            if (!node) return;
            for (const childId of node.children) {
                const childNode = manifest.nodes[childId];
                if (childNode.type === 'folder') {
                    await appendFolderToArchive(childId, `${currentPath}${childNode.name}/`);
                } else {
                    const filePath = safeFilePath(childId);
                    if (!filePath) continue;
                    try {
                        await fsPromises.access(filePath);
                        const pt = new PassThrough();
                        decryptStream(filePath, pt, req.encryptionKey).catch((e) => {
                            console.error(`Failed to decrypt ${filePath} for zip`, e);
                            pt.end();
                        });
                        archive.append(pt, { name: `${currentPath}${childNode.name}` });
                    } catch (e) {
                        // File missing, skip
                    }
                }
            }
        }
        
        for (const uuid of uuids) {
            const node = manifest.nodes[uuid];
            if (!node) continue;
            
            if (node.type === 'folder') {
                await appendFolderToArchive(uuid, `${node.name}/`);
            } else {
                const filePath = safeFilePath(uuid);
                if (!filePath) continue;
                try {
                    await fsPromises.access(filePath);
                    const pt = new PassThrough();
                    decryptStream(filePath, pt, req.encryptionKey).catch((e) => {
                        console.error(`Failed to decrypt ${filePath} for zip`, e);
                        pt.end();
                    });
                    archive.append(pt, { name: node.name });
                } catch (e) {
                    // File missing, skip
                }
            }
        }
        
        await archive.finalize();
    } catch (err) {
        console.error("Bulk download error:", err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to download files' });
    }
});

app.delete('/api/nodes/:uuid', async (req, res) => {
    try {
        const { uuid } = req.params;
        if (!UUID_REGEX.test(uuid)) return res.status(400).json({ error: 'Invalid ID' });
        
        const manifest = await manifestManager.load(req.encryptionKey);
        
        if (!manifest.nodes[uuid] || uuid === 'root') {
            return res.status(400).json({ error: 'Invalid deletion request' });
        }
        
        const filesToDelete = [];

        function gatherDeletions(nodeId) {
            const node = manifest.nodes[nodeId];
            if (!node) return;
            
            if (node.type === 'folder') {
                [...node.children].forEach(childId => gatherDeletions(childId));
            } else {
                const safePath = safeFilePath(nodeId);
                if (safePath) filesToDelete.push(safePath);
            }
            delete manifest.nodes[nodeId];
        }
        
        const parentId = manifest.nodes[uuid].parentId;
        if (parentId && manifest.nodes[parentId]) {
            manifest.nodes[parentId].children = manifest.nodes[parentId].children.filter(id => id !== uuid);
        }
        
        gatherDeletions(uuid);
        await manifestManager.save(req.encryptionKey);
        
        // Asynchronously delete files from disk
        for (const filePath of filesToDelete) {
            fsPromises.unlink(filePath).catch(e => console.error(`Failed to delete ${filePath}`, e));
        }
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Periodic cleanup of expired sessions and tickets (every hour)
setInterval(() => {
    const now = Date.now();
    let expiredCount = 0;
    for (const [token, session] of sessions.entries()) {
        if (session.expiresAt < now) {
            sessions.delete(token);
            expiredCount++;
        }
    }
    if (expiredCount > 0) {
        manifestManager.cache = null; // Purge cache when sessions die
    }
    for (const [ticket, data] of downloadTickets.entries()) {
        if (data.expiresAt < now) downloadTickets.delete(ticket);
    }
}, 60 * 60 * 1000).unref();

let activeServer = null;

function startServer() {
    const PORT = globalConfig.network.port;
    const HOST = globalConfig.network.host;
    
    if (globalConfig.network.tls && globalConfig.network.tls.enabled && globalConfig.network.tls.keyPath && globalConfig.network.tls.certPath) {
        const https = require('https');
        const options = {
            key: fs.readFileSync(globalConfig.network.tls.keyPath),
            cert: fs.readFileSync(globalConfig.network.tls.certPath)
        };
        activeServer = https.createServer(options, app).listen(PORT, HOST, () => {
            console.log(`Server running securely on https://${HOST}:${PORT}`);
        });
    } else {
        const http = require('http');
        activeServer = http.createServer(app).listen(PORT, HOST, () => {
            console.log(`Server running on http://${HOST}:${PORT}\nWARNING: Running in plain HTTP.`);
        });
    }
}

function restartServer() {
    return new Promise((resolve, reject) => {
        if (activeServer) {
            console.log("Shutting down active server...");
            activeServer.close((err) => {
                if (err) return reject(err);
                console.log("Active server closed. Starting new server...");
                startServer();
                resolve();
            });
        } else {
            startServer();
            resolve();
        }
    });
}

if (require.main === module) {
    startServer();
}

module.exports = app;
