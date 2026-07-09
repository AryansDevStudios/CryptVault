# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in CryptVault, please report it responsibly.

### How to Report

1. **DO NOT** open a public GitHub issue for security vulnerabilities
2. Email your findings to the maintainer with the subject line: `[CryptVault Security] <brief description>`
3. Include:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix timeline** communicated after assessment
- **Credit** in the release notes (unless you prefer anonymity)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.1.x   | ✅ Yes    |
| < 1.1   | ❌ No     |

## Security Best Practices for Deployment

1. **Always enable TLS** — Use the built-in TLS support or deploy behind a reverse proxy with HTTPS
2. **Use a strong master password** — Minimum 12 characters with mixed case, numbers, and special characters
3. **Restrict network access** — Use `127.0.0.1` binding for local-only access, or firewall rules for server deployments
4. **Keep dependencies updated** — Run `npm audit` and `npm update` regularly
5. **Back up securely** — Encrypt your backups of `uploads/` and `config.json`
6. **Monitor audit logs** — Review `logs/audit.log` for suspicious activity
