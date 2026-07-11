# CryptVault

> A zero-trust, end-to-end encrypted file vault built with Node.js — your files, your keys, your rules.

CryptVault is a self-hosted encrypted file storage system designed with security as its core principle. All files are encrypted at rest using **AES-256-GCM**, with keys derived via **scrypt** and protected by a **DEK/KEK architecture** — meaning even a database breach cannot expose your data without the master password.

## Features

- **AES-256-GCM Encryption** — Military-grade authenticated encryption for all stored files
- **Zero-Knowledge Architecture** — Server never sees plaintext data; all encryption/decryption happens with keys derived from your master password
- **DEK/KEK Key Management** — Data Encryption Key (DEK) is wrapped by a Key Encryption Key (KEK), enabling password rotation without re-encrypting all files
- **scrypt Key Derivation** — Memory-hard KDF with N=131072, r=8, p=1 to resist brute-force attacks
- **Streaming Encryption** — Files are encrypted/decrypted on-the-fly without ever touching disk in plaintext
- **Encrypted Manifest** — File metadata (names, structure) is encrypted alongside file data
- **Rate-Limited Authentication** — Per-IP and global rate limiting to prevent brute-force login attacks
- **Security Headers** — Helmet.js with CSP, X-Frame-Options, and more
- **TLS Support** — Built-in HTTPS with certificate management
- **Folder Organization** — Full hierarchical folder structure with drag-and-drop upload
- **Bulk Operations** — Multi-select download (as ZIP), delete, and folder download
- **Dark/Light Theme** — System-aware theme with manual override
- **Audit Logging** — All security events logged for review

## Security Architecture

```
Master Password
       │
       ▼
   [SHA-256]  ──▶  bcrypt (cost 12)  ──▶  Stored Hash (authentication)
       │
       ▼
   [scrypt]   ──▶  KEK (Key Encryption Key)
                         │
                         ▼
                   [AES-256-GCM]
                         │
                         ▼
                   Encrypted DEK ◄── DEK (Data Encryption Key, random 256-bit)
                                          │
                                          ▼
                                    [AES-256-GCM]
                                          │
                                    ┌─────┴─────┐
                                    ▼           ▼
                              Encrypted    Encrypted
                               Files       Manifest
```

- **Password changes** only re-wrap the DEK with a new KEK — no need to re-encrypt all files
- **Session tokens** are 256-bit cryptographically random values with sliding expiration (24h) and absolute lifetime (7 days)
- **Download tickets** are single-use, 60-second expiry tokens to prevent replay attacks

## Prerequisites

- **Node.js** >= 18.0.0
- **npm** (comes with Node.js)

## Installation

```bash
# Clone the repository
git clone https://github.com/AryansDevStudios/CryptVault.git
cd CryptVault

# Install dependencies (automatically copies client-side libraries)
npm install

# Start the server
npm start
```

On first launch, navigate to the URL shown in the terminal. You'll be prompted to create a master password (minimum 12 characters with uppercase, lowercase, number, and special character).

## Configuration

### Deployment Modes

- **Personal/Local** — Binds to `127.0.0.1` (most secure, local access only)
- **Deployed Server** — Binds to `0.0.0.0` (required for Docker, Render, Heroku, etc.)

### Network Settings

Configure via the Settings panel in the web UI:

| Setting | Default | Description |
|---------|---------|-------------|
| Port | 3000 | Server listening port |
| Host | 127.0.0.1 | Bind address |
| TLS | Disabled | Enable HTTPS with your own certificate |
| Trust Proxy | false | Enable if behind a reverse proxy |

### Upload Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Max Upload Size | 5 GB | Per-file upload size limit |
| Parallel Uploads | 3 | Concurrent upload streams |
| Network Timeout | 0 (none) | Upload timeout in seconds |

## Project Structure

```
CryptVault/
├── server.js          # Express server, API routes, auth, session management
├── cryptoUtils.js     # AES-256-GCM encryption/decryption, key handling
├── logger.js          # Audit logging
├── setup-libs.js      # Postinstall script to copy client-side libraries
├── package.json       # Dependencies and scripts
├── public/            # Frontend (served as static files)
│   ├── index.html     # Main HTML
│   ├── app.js         # Frontend application logic
│   ├── style.css      # Styles (dark/light theme)
│   └── lib/           # Auto-copied client-side libraries (gitignored)
├── uploads/           # Encrypted file storage (gitignored)
├── config.json        # Runtime configuration (gitignored)
└── logs/              # Audit logs (gitignored)
```

## Security Considerations

- **Always use TLS in production** — Without HTTPS, data is encrypted at rest but transmitted in plaintext over the network
- **Use a strong master password** — The entire vault's security depends on your password strength
- **Back up your data** — The `uploads/` directory and `config.json` are required to restore your vault
- **Keep dependencies updated** — Run `npm audit` periodically

## License

ISC License — See [LICENSE](LICENSE) for details.

## Author

**Aryan Gupta** — [AryansDevStudios](https://github.com/AryansDevStudios)
