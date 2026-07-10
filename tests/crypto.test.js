const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { encryptStream, decryptStream, encryptMetadata, decryptMetadata } = require('../cryptoUtils');

describe('Crypto Utils', () => {
    const testKey = crypto.randomBytes(32).toString('hex');
    const tempDir = path.join(__dirname, 'temp_crypto_test');
    
    beforeAll(() => {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('Metadata Encryption', () => {
        it('should encrypt and decrypt metadata properly', () => {
            const originalText = JSON.stringify({ filename: "secret.pdf", size: 1024 });
            const encrypted = encryptMetadata(originalText, testKey);
            
            expect(encrypted).not.toBe(originalText);
            
            const decrypted = decryptMetadata(encrypted, testKey);
            expect(decrypted).toBe(originalText);
        });

        it('should fail with an incorrect key length', () => {
            expect(() => encryptMetadata("test", "short")).toThrow("Encryption key must be 32 bytes (64 hex characters)!");
        });

        it('should fail to decrypt with wrong key', () => {
            const originalText = "secret";
            const encrypted = encryptMetadata(originalText, testKey);
            const wrongKey = crypto.randomBytes(32).toString('hex');
            
            expect(() => decryptMetadata(encrypted, wrongKey)).toThrow();
        });
    });

    describe('Stream Encryption', () => {
        it('should encrypt and decrypt a file stream correctly', async () => {
            const plainTextPath = path.join(tempDir, 'plain.txt');
            const encryptedPath = path.join(tempDir, 'encrypted.dat');
            const decryptedPath = path.join(tempDir, 'decrypted.txt');

            const testContent = "This is a long test content to ensure streams work smoothly. ".repeat(100);
            fs.writeFileSync(plainTextPath, testContent);

            // Encrypt
            const readStream = fs.createReadStream(plainTextPath);
            const writeStream = fs.createWriteStream(encryptedPath);
            await encryptStream(readStream, writeStream, testKey);

            expect(fs.existsSync(encryptedPath)).toBe(true);

            // Decrypt
            const decryptWriteStream = fs.createWriteStream(decryptedPath);
            await decryptStream(encryptedPath, decryptWriteStream, testKey);

            // Verify
            const decryptedContent = fs.readFileSync(decryptedPath, 'utf8');
            expect(decryptedContent).toBe(testContent);
        });

        it('should fail when decrypting with wrong key', async () => {
            const plainTextPath = path.join(tempDir, 'plain2.txt');
            const encryptedPath = path.join(tempDir, 'encrypted2.dat');
            const decryptedPath = path.join(tempDir, 'decrypted2.txt');

            const testContent = "Another test.";
            fs.writeFileSync(plainTextPath, testContent);

            const readStream = fs.createReadStream(plainTextPath);
            const writeStream = fs.createWriteStream(encryptedPath);
            await encryptStream(readStream, writeStream, testKey);

            const wrongKey = crypto.randomBytes(32).toString('hex');
            const decryptWriteStream = fs.createWriteStream(decryptedPath);
            
            await expect(decryptStream(encryptedPath, decryptWriteStream, wrongKey)).rejects.toThrow();
        });
    });
});
