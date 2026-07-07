const crypto = require('crypto');
const fs = require('fs');
const { promises: fsPromises } = fs;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Parses the key string (hex) into a Buffer.
 * @param {string} keyString 
 * @returns {Buffer}
 */
const getKeyBuffer = (keyString) => {
    if (!keyString) throw new Error("Encryption key is missing!");
    const key = Buffer.from(keyString, 'hex');
    if (key.length !== 32) throw new Error("Encryption key must be 32 bytes (64 hex characters)!");
    return key;
};

/**
 * Encrypts a stream on the fly. Prepends IV, appends Auth Tag.
 * @param {import('stream').Readable} readStream 
 * @param {import('stream').Writable} writeStream 
 * @param {string} keyString 
 * @returns {Promise<void>}
 */
const encryptStream = (readStream, writeStream, keyString) => {
    return new Promise((resolve, reject) => {
        try {
            const key = getKeyBuffer(keyString);
            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

            // Clean up resources on error
            const cleanup = (error) => {
                readStream.destroy();
                writeStream.destroy();
                reject(error);
            };

            // Prepend the IV to the file
            writeStream.write(iv);

            // Pipe data through cipher to the write stream
            readStream.pipe(cipher).pipe(writeStream, { end: false });

            cipher.on('end', () => {
                try {
                    const authTag = cipher.getAuthTag();
                    // Append the Auth Tag at the end
                    writeStream.write(authTag);
                    writeStream.end();
                } catch (err) {
                    cleanup(err);
                }
            });

            writeStream.on('finish', resolve);
            
            readStream.on('error', cleanup);
            cipher.on('error', cleanup);
            writeStream.on('error', cleanup);
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * Decrypts an encrypted file stream asynchronously.
 * @param {string} inputFilePath 
 * @param {import('stream').Writable} writeStream 
 * @param {string} keyString 
 * @returns {Promise<void>}
 */
const decryptStream = async (inputFilePath, writeStream, keyString) => {
    let fileHandle;
    try {
        const key = getKeyBuffer(keyString);
        
        fileHandle = await fsPromises.open(inputFilePath, 'r');
        const stat = await fileHandle.stat();
        const fileSize = stat.size;

        if (fileSize < IV_LENGTH + AUTH_TAG_LENGTH) {
            throw new Error("File is too small to be a valid encrypted file");
        }

        // Read IV from the beginning (12 bytes)
        const iv = Buffer.alloc(IV_LENGTH);
        await fileHandle.read(iv, 0, IV_LENGTH, 0);

        // Read Auth Tag from the end (16 bytes)
        const authTag = Buffer.alloc(AUTH_TAG_LENGTH);
        await fileHandle.read(authTag, 0, AUTH_TAG_LENGTH, fileSize - AUTH_TAG_LENGTH);

        // We can close the handle now, as we'll use fs.createReadStream for the payload
        await fileHandle.close();
        fileHandle = null;

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        return new Promise((resolve, reject) => {
            const cleanup = (err) => {
                readStream.destroy();
                writeStream.destroy();
                reject(err);
            };

            const readStream = fs.createReadStream(inputFilePath, {
                start: IV_LENGTH,
                end: fileSize - AUTH_TAG_LENGTH - 1
            });

            readStream.pipe(decipher).pipe(writeStream);

            writeStream.on('finish', resolve);

            readStream.on('error', cleanup);
            decipher.on('error', cleanup);
            writeStream.on('error', cleanup);
        });
    } catch (error) {
        if (fileHandle) {
            await fileHandle.close().catch(() => {});
        }
        throw error;
    }
};

/**
 * Encrypts a small piece of data (like the manifest JSON string).
 * Format: IV (hex) : AuthTag (hex) : EncryptedData (hex)
 * @param {string} text 
 * @param {string} keyString 
 * @returns {string}
 */
const encryptMetadata = (text, keyString) => {
    const key = getKeyBuffer(keyString);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

/**
 * Decrypts a piece of metadata.
 * @param {string} encryptedString 
 * @param {string} keyString 
 * @returns {string}
 */
const decryptMetadata = (encryptedString, keyString) => {
    const key = getKeyBuffer(keyString);
    const parts = encryptedString.split(':');
    if (parts.length !== 3) throw new Error("Invalid encrypted metadata format");
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedData = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
};

module.exports = {
    encryptStream,
    decryptStream,
    encryptMetadata,
    decryptMetadata
};
