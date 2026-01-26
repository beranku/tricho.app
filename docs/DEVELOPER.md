# TrichoApp Developer Guide

Technical documentation for developers building and maintaining TrichoApp.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Development Setup](#development-setup)
3. [Project Structure](#project-structure)
4. [Cryptographic Architecture](#cryptographic-architecture)
5. [Authentication System](#authentication-system)
6. [Database Layer (RxDB)](#database-layer-rxdb)
7. [Sync System](#sync-system)
8. [Photo Pipeline](#photo-pipeline)
9. [API Reference](#api-reference)
10. [Testing](#testing)
11. [Security Considerations](#security-considerations)
12. [Deployment](#deployment)

---

## Architecture Overview

TrichoApp follows an **offline-first, end-to-end encrypted** architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser/PWA)                         │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │    React     │    │   RxDB       │    │   Crypto     │          │
│  │  Components  │───▶│  (Dexie)     │───▶│   Engine     │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│         │                   │                   │                   │
│         │                   │                   │                   │
│  ┌──────▼──────────────────▼───────────────────▼──────┐            │
│  │                   Sync Orchestrator                 │            │
│  │              (RxDB CouchDB Replication)             │            │
│  └─────────────────────────┬───────────────────────────┘            │
└─────────────────────────────┼───────────────────────────────────────┘
                              │ HTTPS (encrypted at rest + in transit)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            CLOUD                                     │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ Auth Service │    │   CouchDB    │    │ Object Store │          │
│  │  (WebAuthn)  │    │ (encrypted)  │    │   (photos)   │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Offline-First**: All operations work without network; sync happens opportunistically
2. **E2E Encryption**: Server only sees ciphertext; decryption happens only on client
3. **Passkey Auth**: WebAuthn for passwordless, phishing-resistant authentication
4. **Recovery by Design**: Recovery QR ensures users never lose data access

---

## Development Setup

### Prerequisites

- Node.js >= 18
- npm >= 9
- Docker (for CouchDB)

### Quick Start

```bash
# Clone repository
git clone https://github.com/beranku/tricho-app.git
cd tricho-app

# Install dependencies
npm install

# Install server dependencies
cd server && npm install && cd ..

# Start CouchDB (Docker)
docker run -d \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=password \
  couchdb:3

# Create .env file
cp .env.example .env

# Start development servers (two terminals)
npm run dev              # Terminal 1: Frontend (port 4321)
cd server && npm run dev # Terminal 2: Auth server (port 3000)
```

### Environment Variables

Create a `.env` file:

```env
# Frontend
VITE_COUCHDB_URL=http://localhost:5984
VITE_AUTH_URL=http://localhost:3000
VITE_OBJECT_STORAGE_URL=http://localhost:9000

# Server
COUCHDB_URL=http://localhost:5984
COUCHDB_USER=admin
COUCHDB_PASSWORD=password
JWT_SECRET=your-secret-key-min-32-chars
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME=TrichoApp
WEBAUTHN_ORIGIN=http://localhost:4321
```

### Available Scripts

```bash
# Frontend
npm run dev        # Start Astro dev server
npm run build      # Build for production
npm run preview    # Preview production build
npm test           # Run Vitest tests
npm run test:watch # Run tests in watch mode

# Server
npm run dev        # Start server with hot reload
npm run build      # Compile TypeScript
npm test           # Run server tests
```

---

## Project Structure

```
tricho-app/
├── src/
│   ├── components/           # React UI components
│   │   ├── App.tsx          # Main app shell with auth routing
│   │   ├── LoginScreen.tsx  # Login/setup screen
│   │   ├── CustomerList.tsx # Customer list component
│   │   ├── CustomerDetail.tsx
│   │   ├── CustomerForm.tsx
│   │   ├── PhotoCapture.tsx
│   │   ├── RecoveryQRDisplay.tsx
│   │   ├── RecoveryQRScanner.tsx
│   │   ├── SettingsScreen.tsx
│   │   └── SyncStatus.tsx
│   │
│   ├── context/             # React context providers
│   │   └── AuthContext.tsx  # Authentication state management
│   │
│   ├── crypto/              # Encryption modules
│   │   ├── keys.ts          # Key generation, wrapping, HKDF
│   │   ├── keys.test.ts     # Key module tests
│   │   ├── envelope.ts      # Document/photo encryption
│   │   ├── envelope.test.ts # Envelope tests
│   │   └── utils.ts         # Base64url, helpers
│   │
│   ├── auth/                # Authentication modules
│   │   ├── passkey.ts       # WebAuthn registration/auth
│   │   ├── prf.ts           # PRF extension handling
│   │   ├── prf.test.ts      # PRF tests
│   │   └── recovery.ts      # Recovery QR import/export
│   │
│   ├── db/                  # Database layer
│   │   ├── index.ts         # RxDB initialization
│   │   ├── hooks.ts         # React hooks for RxDB
│   │   └── schemas/         # Document schemas
│   │       ├── index.ts     # Schema registry
│   │       ├── customer.ts  # Customer schema
│   │       ├── visit.ts     # Visit schema
│   │       └── photo-meta.ts # Photo metadata schema
│   │
│   ├── sync/                # Sync orchestration
│   │   ├── orchestrator.ts  # CouchDB replication manager
│   │   ├── photos.ts        # Photo upload/download
│   │   └── hooks.ts         # Sync React hooks
│   │
│   ├── photos/              # Photo processing
│   │   ├── capture.ts       # Camera capture, import
│   │   ├── encrypt.ts       # Photo encryption
│   │   ├── thumbnail.ts     # Thumbnail generation
│   │   ├── pipeline.ts      # Full photo pipeline
│   │   └── hooks.ts         # Photo React hooks
│   │
│   ├── pages/               # Astro pages
│   │   └── index.astro      # Main entry point
│   │
│   └── config/
│       └── env.ts           # Environment configuration
│
├── server/                  # Auth service
│   ├── src/
│   │   ├── index.ts         # Server entry point (Hono)
│   │   ├── routes/
│   │   │   └── auth.ts      # WebAuthn endpoints
│   │   ├── services/
│   │   │   ├── webauthn.ts  # WebAuthn logic
│   │   │   ├── tokens.ts    # JWT management
│   │   │   └── tenant.ts    # User provisioning
│   │   └── middleware/
│   │       └── auth.ts      # Auth middleware
│   ├── package.json
│   └── tsconfig.json
│
├── public/                  # Static assets
│   ├── manifest.webmanifest
│   ├── sw.js               # Service worker
│   └── icons/
│
├── docs/                   # Documentation
│   ├── USER_GUIDE.md
│   └── DEVELOPER.md
│
├── package.json
├── tsconfig.json
├── astro.config.mjs
├── vitest.config.ts
└── .env.example
```

---

## Cryptographic Architecture

### Key Hierarchy

```
Recovery Secret (RS)
    │  32 bytes, random
    │  Shown once as QR code
    │  Ultimate recovery mechanism
    │
    ├──────────────────────────────────────┐
    │                                      │
    ▼                                      ▼
KEK (from PRF)                    KEK (from RS fallback)
    │  Derived via HKDF                   │  Derived via HKDF
    │  Uses passkey's PRF output          │  Uses RS + device salt
    │                                      │
    └──────────────────┬───────────────────┘
                       │
                       ▼
           Data Encryption Key (DEK)
               │  32 bytes, random
               │  Wrapped with KEK
               │  Stored in localStorage
               │
               ├────────────────────────────┐
               │                            │
               ▼                            ▼
    RxDB Database Encryption       Per-Document Keys
        Password = base64url(DEK)      Derived via HKDF
                                       "tricho:envelope:doc:v1:${docId}"
```

### Key Generation (`src/crypto/keys.ts`)

```typescript
// Generate new keys on first setup
const rs = generateRecoverySecret();  // 32 bytes
const dek = generateDataEncryptionKey();  // 32 bytes
const deviceSalt = generateDeviceSalt();  // 32 bytes

// Derive KEK from PRF output (preferred)
const kek = await deriveKekFromPRF(prfOutput, deviceSalt);

// OR derive KEK from RS (fallback)
const kek = await deriveKekFromRS(rs, deviceSalt);

// Wrap DEK for storage
const wrappedDek = await wrapDek(dek, kek);
localStorage.setItem('dek_wrapped', serializeWrappedDek(wrappedDek));
```

### HKDF Domain Separation

All key derivation uses domain-separated HKDF:

| Key Purpose | HKDF Info String |
|-------------|------------------|
| KEK from PRF | `tricho:kek:prf:v1` |
| KEK from RS | `tricho:kek:rs:v1` |
| Document key | `tricho:envelope:doc:v1:${docId}` |
| Photo key | `tricho:envelope:photo:v1:${photoId}:${variant}` |

### Envelope Encryption (`src/crypto/envelope.ts`)

```typescript
// Encrypt a document
const encrypted = await encryptDocument(plaintext, dek, docId);
// Returns: { ciphertext, iv, salt, tag }

// Decrypt a document
const plaintext = await decryptDocument(encrypted, dek, docId);

// Encrypt a photo
const encryptedPhoto = await encryptPhoto(photoBlob, dek, photoId, 'original');

// Decrypt a photo
const photoBlob = await decryptPhoto(encryptedPhoto, dek, photoId, 'original');
```

### Cryptographic Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Key size | 256 bits (32 bytes) | AES-256 standard |
| IV size | 96 bits (12 bytes) | NIST GCM recommendation |
| Auth tag | 128 bits (16 bytes) | Maximum security |
| Salt size | 256 bits (32 bytes) | HKDF best practice |
| HKDF hash | SHA-256 | Widely supported |

---

## Authentication System

### WebAuthn Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REGISTRATION                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Client                         Server                               │
│    │                               │                                 │
│    │  POST /auth/register/begin    │                                 │
│    │  { username }                 │                                 │
│    │──────────────────────────────▶│                                 │
│    │                               │  Generate challenge             │
│    │◀──────────────────────────────│  Store for user                 │
│    │  { options }                  │                                 │
│    │                               │                                 │
│    │  navigator.credentials.create │                                 │
│    │  User verifies (biometric)    │                                 │
│    │                               │                                 │
│    │  POST /auth/register/finish   │                                 │
│    │  { credential }               │                                 │
│    │──────────────────────────────▶│                                 │
│    │                               │  Verify & store credential      │
│    │◀──────────────────────────────│                                 │
│    │  { success }                  │                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Client                         Server                               │
│    │                               │                                 │
│    │  POST /auth/authenticate/begin│                                 │
│    │  { username? }                │                                 │
│    │──────────────────────────────▶│                                 │
│    │                               │  Generate challenge             │
│    │◀──────────────────────────────│                                 │
│    │  { options }                  │                                 │
│    │                               │                                 │
│    │  navigator.credentials.get   │                                 │
│    │  + PRF extension             │                                 │
│    │  User verifies               │                                 │
│    │                               │                                 │
│    │  POST /auth/authenticate/finish                                │
│    │  { credential }               │                                 │
│    │──────────────────────────────▶│                                 │
│    │                               │  Verify signature               │
│    │◀──────────────────────────────│  Issue JWT tokens               │
│    │  { accessToken, refreshToken }│                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### PRF Extension (`src/auth/prf.ts`)

The PRF (Pseudo-Random Function) extension provides deterministic key material from passkeys:

```typescript
// Check PRF support
const capabilities = await getPrfCapabilities();
// { supported: boolean, platform: string, warnings: string[] }

// Authenticate with PRF
const result = await authenticateWithPRF({
  options: authOptions,
  prfSalt: deviceSalt,
});

if (result.prfOutput) {
  // PRF supported - derive KEK from PRF output
  const kek = await deriveKekFromPRF(result.prfOutput, deviceSalt);
} else {
  // PRF not supported - need recovery secret
}
```

### Platform-Specific PRF Gotchas

| Platform | PRF Support | Notes |
|----------|-------------|-------|
| Chrome (desktop/Android) | ✅ Full | Works with all authenticators |
| Safari (macOS/iOS) | ⚠️ Limited | Only iCloud Keychain, not hardware keys |
| Firefox | ⚠️ Limited | Partial support, fallback recommended |
| iOS 18 | ⚠️ Buggy | Early versions have data loss bugs |
| Cross-device QR | ❌ Unreliable | PRF may fail or return different values |

### Graceful Degradation

```typescript
// Unified unlock flow with automatic fallback
const unlockResult = await unlockWithPasskey({
  authOptions,
  deviceSalt,
  wrappedDek,
});

// Returns:
// - kekSource: 'prf' | 'rs' - which method was used
// - kek: CryptoKey - the derived KEK
// - dek: Uint8Array - the unwrapped DEK
```

---

## Database Layer (RxDB)

### Initialization (`src/db/index.ts`)

```typescript
import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedKeyEncryptionCryptoJsStorage } from 'rxdb/plugins/encryption-crypto-js';

// Create encrypted storage
const encryptedStorage = wrappedKeyEncryptionCryptoJsStorage({
  storage: getRxStorageDexie()
});

// Initialize database with DEK
const db = await createRxDatabase({
  name: 'trichoapp',
  storage: encryptedStorage,
  password: keyToPassword(dek), // base64url encoded
});

// Add collections
await setupCollections(db);
```

### Schema Pattern

Documents use an **encrypted payload pattern**:

```typescript
// src/db/schemas/customer.ts
export const customerSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    // Unencrypted metadata (can be queried/indexed)
    id: { type: 'string', maxLength: 100 },
    type: { type: 'string' },
    updatedAt: { type: 'number' },
    createdAt: { type: 'number' },
    deleted: { type: 'boolean' },

    // Encrypted payload (cannot be queried)
    enc: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        notes: { type: 'string' },
        allergies: { type: 'string' },
      }
    }
  },
  encrypted: ['enc'], // Mark for encryption
  indexes: ['updatedAt', ['type', 'updatedAt']] // Only unencrypted fields
};
```

### React Hooks (`src/db/hooks.ts`)

```typescript
// Get all customers
const { data: customers, loading, error } = useCustomers();

// Get single customer
const { data: customer } = useCustomer(customerId);

// Search customers (client-side, decrypted)
const { results, search } = useCustomerSearch();

// Get visits for customer
const { data: visits } = useVisits({ customerId });

// Get photos for visit
const { data: photos } = usePhotos({ visitId });
```

---

## Sync System

### Orchestrator (`src/sync/orchestrator.ts`)

```typescript
// Initialize sync
await initSync({
  database: db,
  couchDbUrl: 'http://localhost:5984',
  authToken: accessToken,
  userId: user.id,
  enableNetworkSync: true,    // Auto-sync on network change
  enableForegroundSync: true, // iOS PWA foreground sync
});

// Manual sync trigger
await triggerSync();

// Get sync state
const state = getSyncState();
// { status: 'synced', lastSyncAt: Date, pendingWrites: 0 }

// Subscribe to sync events
const unsubscribe = subscribeSyncEvents((event) => {
  console.log(event.type, event.data);
});
```

### Conflict Resolution

Uses **last-write-wins** based on `updatedAt` timestamp:

```typescript
const conflictHandler = (local, remote) => {
  // Compare timestamps
  if (local.updatedAt > remote.updatedAt) {
    return local; // Keep local version
  }
  return remote; // Keep remote version
};
```

### iOS Foreground Sync

iOS PWA doesn't support Background Sync API. TrichoApp handles this:

```typescript
// Sync on visibility change (app comes to foreground)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isOnline()) {
    triggerSync();
  }
});
```

---

## Photo Pipeline

### Full Pipeline (`src/photos/pipeline.ts`)

```
Capture → Compress → Generate Variants → Encrypt → Queue Upload → Sync Metadata
   │          │             │               │            │             │
   ▼          ▼             ▼               ▼            ▼             ▼
Camera/   Resize to     thumbnail        AES-GCM    IndexedDB    CouchDB doc
 File    max 2048px     preview        per-variant   queue        (encrypted)
                        original                                     │
                                                                     │
                            ┌────────────────────────────────────────┘
                            ▼
                    Object Storage (S3)
                    (encrypted blobs)
```

### Photo Encryption

```typescript
// Process and encrypt a captured photo
const result = await processPhoto({
  source: capturedBlob,
  customerId,
  visitId,
  dek,
  metadata: { caption, bodyRegion }
});

// Returns:
// - encryptedVariants: { thumbnail, preview, original }
// - photoMetaDoc: RxDB document to save
// - uploadQueue: items queued for upload
```

### Upload Queue

Photos upload asynchronously with retry logic:

```typescript
// Queue automatically processes when online
queuePhotoUpload({
  photoId,
  variant: 'original',
  encryptedData,
  storageKey,
});

// Check queue status
const queue = getUploadQueue();
// { pending: 3, uploading: 1, failed: 0 }

// Retry failed uploads
await retryAllFailed();
```

---

## API Reference

### Auth Service Endpoints

#### Registration

```http
POST /api/auth/register/begin
Content-Type: application/json

{ "username": "user@example.com" }

Response:
{
  "challenge": "...",
  "rp": { "name": "TrichoApp", "id": "localhost" },
  "user": { "id": "...", "name": "user@example.com" },
  "pubKeyCredParams": [...],
  "authenticatorSelection": {
    "residentKey": "required",
    "userVerification": "required"
  }
}
```

```http
POST /api/auth/register/finish
Content-Type: application/json

{ "id": "...", "response": {...}, "type": "public-key" }

Response:
{ "success": true, "userId": "..." }
```

#### Authentication

```http
POST /api/auth/authenticate/begin
Content-Type: application/json

{ "username": "user@example.com" }  // Optional for discoverable credentials

Response:
{
  "challenge": "...",
  "rpId": "localhost",
  "allowCredentials": [...]
}
```

```http
POST /api/auth/authenticate/finish
Content-Type: application/json

{ "id": "...", "response": {...}, "type": "public-key" }

Response:
{
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "user": { "id": "...", "username": "..." }
}
```

#### Token Management

```http
POST /api/auth/token/refresh
Authorization: Bearer {refreshToken}

Response:
{
  "accessToken": "eyJ...",
  "refreshToken": "..."  // Rotated
}
```

```http
POST /api/auth/logout
Authorization: Bearer {accessToken}

Response:
{ "success": true }
```

---

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run specific test file
npm test -- src/crypto/keys.test.ts
```

### Test Structure

```typescript
// src/crypto/keys.test.ts
import { describe, it, expect } from 'vitest';
import {
  generateRecoverySecret,
  generateDataEncryptionKey,
  wrapDek,
  unwrapDek,
} from './keys';

describe('Key Generation', () => {
  it('generates 32-byte recovery secret', () => {
    const rs = generateRecoverySecret();
    expect(rs).toBeInstanceOf(Uint8Array);
    expect(rs.length).toBe(32);
  });

  it('generates unique keys each time', () => {
    const rs1 = generateRecoverySecret();
    const rs2 = generateRecoverySecret();
    expect(rs1).not.toEqual(rs2);
  });
});

describe('Key Wrapping', () => {
  it('wraps and unwraps DEK correctly', async () => {
    const dek = generateDataEncryptionKey();
    const kek = await deriveKekFromRS(generateRecoverySecret(), salt);

    const wrapped = await wrapDek(dek, kek);
    const unwrapped = await unwrapDek(wrapped, kek);

    expect(unwrapped).toEqual(dek);
  });
});
```

### Test Files

| File | Tests |
|------|-------|
| `src/crypto/keys.test.ts` | Key generation, wrapping, constant-time comparison |
| `src/crypto/envelope.test.ts` | Document encryption/decryption, HKDF derivation |
| `src/auth/prf.test.ts` | Platform detection, PRF capabilities |

---

## Security Considerations

### DO

- Use Web Crypto API for all cryptographic operations
- Generate fresh IV for every encryption
- Use constant-time comparison for cryptographic values
- Clear sensitive data from memory when done
- Validate all inputs before cryptographic operations
- Use HKDF domain separation for different key purposes

### DON'T

- Store DEK or RS on the server
- Log sensitive cryptographic material
- Reuse IVs with the same key
- Use 16-byte IV (use 12 bytes for GCM)
- Trust client-supplied key material without validation
- Skip authentication checks on API endpoints

### Security Checklist

- [ ] All PII encrypted before leaving device
- [ ] Recovery secret shown only once
- [ ] DEK wrapped per-device for revocation
- [ ] Server only stores ciphertext
- [ ] No secrets in code or logs
- [ ] HTTPS required in production
- [ ] WebAuthn user verification required

---

## Deployment

### Production Build

```bash
# Build frontend
npm run build

# Build server
cd server && npm run build
```

### Environment Configuration

Production `.env`:

```env
# Frontend (build-time)
VITE_COUCHDB_URL=https://couch.tricho.app
VITE_AUTH_URL=https://auth.tricho.app
VITE_OBJECT_STORAGE_URL=https://storage.tricho.app

# Server (runtime)
NODE_ENV=production
COUCHDB_URL=http://couchdb:5984
COUCHDB_USER=${COUCHDB_USER}
COUCHDB_PASSWORD=${COUCHDB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
WEBAUTHN_RP_ID=tricho.app
WEBAUTHN_RP_NAME=TrichoApp
WEBAUTHN_ORIGIN=https://tricho.app
```

### Docker Compose

```yaml
version: '3.8'
services:
  frontend:
    build: .
    ports:
      - "443:443"
    environment:
      - VITE_AUTH_URL=https://auth.tricho.app

  auth:
    build: ./server
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production

  couchdb:
    image: couchdb:3
    volumes:
      - couchdb_data:/opt/couchdb/data
    environment:
      - COUCHDB_USER=${COUCHDB_USER}
      - COUCHDB_PASSWORD=${COUCHDB_PASSWORD}
```

### Health Checks

```bash
# Frontend
curl https://tricho.app/

# Auth service
curl https://auth.tricho.app/health

# CouchDB
curl https://couch.tricho.app/_up
```

---

## Troubleshooting

### Common Issues

**TypeScript errors with RxDB**
```
Solution: Ensure rxdb types are installed
npm install --save-dev @types/pouchdb-core
```

**WebAuthn not working on localhost**
```
Solution: Use HTTPS or localhost (not 127.0.0.1)
WebAuthn requires secure context
```

**PRF returning undefined**
```
Solution: Check browser/authenticator support
Use getPrfCapabilities() to detect support
Fall back to RS-based KEK derivation
```

**Sync not completing**
```
Solution:
1. Check network connectivity
2. Verify CouchDB is running
3. Check auth token is valid
4. Look for CORS issues in console
```

---

## Contributing

1. Read this guide thoroughly
2. Follow existing code patterns
3. Add tests for new functionality
4. Update documentation
5. Run `npm test` before submitting PR

---

## License

MIT License - see LICENSE file for details.
