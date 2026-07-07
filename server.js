const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const crypto = require('crypto');
const multer = require('multer');
const archiver = require('archiver');
const bcrypt = require('bcryptjs');
const { PassThrough } = require('stream');
const { encryptStream, decryptStream, encryptMetadata, decryptMetadata } = require('./cryptoUtils');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

const MANIFEST_FILE = path.join(UPLOADS_DIR, 'manifest.enc');

// In-Memory State
const sessions = new Map(); // token -> { derivedKey, expiresAt }
const downloadTickets = new Map(); // ticketId -> { derivedKey, expiresAt }

// Manifest Manager to prevent race conditions during concurrent requests
class ManifestManager {
    constructor() {
        this.cache = null;
        this.isFlushing = false;
        this.needsFlush = false;
        this.flushPromise = Promise.resolve();
    }

    _seedManifest() {
        return {
            nodes: {
                "root": { type: "folder", name: "Vault Root", parentId: null, children: [] }
            }
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
    
    // Extend session life on activity
    session.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    
    req.encryptionKey = session.derivedKey;
    req.sessionToken = token;
    next();
};

// --- Routes ---

app.post('/api/login', async (req, res) => {
    try {
        const { password } = req.body;
        
        // Use async bcrypt
        const isValid = await bcrypt.compare(password, process.env.MASTER_PASSWORD_HASH);
        
        if (isValid) {
            // Dynamically derive the 256-bit AES key and hold it in RAM
            const derivedKeyBuffer = crypto.scryptSync(password, process.env.KEY_DERIVATION_SALT, 32);
            const derivedKeyHex = derivedKeyBuffer.toString('hex');
            
            const token = crypto.randomUUID();
            sessions.set(token, {
                derivedKey: derivedKeyHex,
                expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
            });
            
            // Warm up cache
            await manifestManager.load(derivedKeyHex);
            
            return res.json({ success: true, token });
        }
        
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

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { filename: uuid, originalname } = req.file;
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
        res.json({ success: true, uuid, node: manifest.nodes[uuid] });
    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ error: 'Failed to complete upload' });
    }
});

app.get('/api/download/:uuid', ticketAuth, async (req, res) => {
    try {
        const { uuid } = req.params;
        const manifest = await manifestManager.load(req.encryptionKey);
        const node = manifest.nodes[uuid];

        if (!node || node.type !== 'file') return res.status(404).json({ error: 'File not found' });

        const filePath = path.join(UPLOADS_DIR, uuid);
        
        try {
            await fsPromises.access(filePath);
        } catch (e) {
            return res.status(404).json({ error: 'File missing on disk' });
        }

        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(node.name)}`);
        res.setHeader('Content-Type', 'application/octet-stream');

        await decryptStream(filePath, res, req.encryptionKey);
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: 'Decryption failed' });
    }
});

app.get('/api/download-folder/:uuid', ticketAuth, async (req, res) => {
    try {
        const { uuid } = req.params;
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
                    const filePath = path.join(UPLOADS_DIR, childId);
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
                    const filePath = path.join(UPLOADS_DIR, childId);
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
                const filePath = path.join(UPLOADS_DIR, uuid);
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
                filesToDelete.push(path.join(UPLOADS_DIR, nodeId));
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
    for (const [token, session] of sessions.entries()) {
        if (session.expiresAt < now) {
            sessions.delete(token);
            manifestManager.cache = null; // Purge cache when session dies
        }
    }
    for (const [ticket, data] of downloadTickets.entries()) {
        if (data.expiresAt < now) downloadTickets.delete(ticket);
    }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
