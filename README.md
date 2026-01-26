# TrichoApp - Offline-First E2EE CRM for Hairdressers

A Progressive Web Application (PWA) that provides hairdressers with a secure, encrypted CRM system for managing customer data, appointments, and scalp/hair photos. All data is encrypted end-to-end - the cloud server never sees your plaintext data.

## Key Features

- **End-to-End Encryption (E2EE)** - All customer data is encrypted locally before sync
- **Offline-First** - Works without internet, syncs when online
- **Passkey Authentication** - Secure biometric login (Face ID, fingerprint)
- **Multi-Device Sync** - Your data on all your devices (phone, tablet, desktop)
- **Photo Management** - Capture, store, and sync encrypted photos
- **Recovery QR Code** - Never lose access to your data

## Quick Start

### For Users

1. **Create Account** - Open the app and tap "Create Account"
2. **Register Passkey** - Use Face ID or fingerprint to create your passkey
3. **Save Recovery QR** - **IMPORTANT**: Save the recovery QR code securely
4. **Start Using** - Add customers, appointments, and photos

For detailed instructions, see the [User Guide](docs/USER_GUIDE.md).

### For Developers

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start auth server (separate terminal)
cd server && npm run dev
```

For detailed setup and architecture, see the [Developer Guide](docs/DEVELOPER.md).

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React + TypeScript (Astro) |
| Local Database | RxDB with Dexie adapter |
| Encryption | Web Crypto API + @noble/hashes |
| Authentication | WebAuthn (passkeys) with PRF extension |
| Sync | CouchDB replication |
| Photo Storage | S3-compatible object storage |

## Security Architecture

```
                    ┌─────────────────────────────────────┐
                    │           USER DEVICE               │
                    │  ┌─────────────────────────────┐   │
                    │  │  Recovery Secret (RS)       │   │
                    │  │  32 bytes - shown once      │   │
                    │  └──────────────┬──────────────┘   │
                    │                 │                   │
                    │  ┌──────────────▼──────────────┐   │
                    │  │  Key Encryption Key (KEK)   │   │
                    │  │  Derived from PRF or RS     │   │
                    │  └──────────────┬──────────────┘   │
                    │                 │                   │
                    │  ┌──────────────▼──────────────┐   │
                    │  │  Data Encryption Key (DEK)  │   │
                    │  │  32 bytes - encrypts data   │   │
                    │  └──────────────┬──────────────┘   │
                    │                 │                   │
                    │  ┌──────────────▼──────────────┐   │
                    │  │  Encrypted Customer Data    │   │
                    │  │  Photos, Notes, Visits      │   │
                    │  └─────────────────────────────┘   │
                    └─────────────────────────────────────┘
                                      │
                                      │ Encrypted
                                      ▼
                    ┌─────────────────────────────────────┐
                    │           CLOUD (CouchDB)           │
                    │  Only sees encrypted blobs          │
                    │  Cannot read your data              │
                    └─────────────────────────────────────┘
```

## Documentation

- [User Guide](docs/USER_GUIDE.md) - How to use TrichoApp
- [Developer Guide](docs/DEVELOPER.md) - Technical architecture and setup
- [API Reference](docs/API.md) - Auth service endpoints (coming soon)

## Project Structure

```
tricho-app/
├── src/
│   ├── components/     # React UI components
│   ├── context/        # React context (AuthContext)
│   ├── crypto/         # Encryption (keys, envelope)
│   ├── auth/           # WebAuthn, PRF, recovery
│   ├── db/             # RxDB setup and schemas
│   ├── sync/           # CouchDB sync orchestrator
│   ├── photos/         # Photo capture and encryption
│   └── pages/          # Astro pages
├── server/             # Auth service (Node.js)
│   └── src/
│       ├── routes/     # API endpoints
│       └── services/   # WebAuthn, tokens, tenant
├── public/             # Static assets, PWA manifest
└── docs/               # Documentation
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

---

**TrichoApp** - Your customers' data, encrypted and secure.
