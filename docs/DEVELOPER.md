# TrichoApp Developer Guide

> ⚠️ **Migration notice** — this document predates the current v3 architecture. **For what's current, read [`ARCHITECTURE_CHANGES.md`](./ARCHITECTURE_CHANGES.md).** The text below describes earlier iterations and is kept for historical reference only. Sections that refer to `server/`, `src/auth/passkey.ts`, `src/auth/prf.ts`, `src/crypto/keys.ts`, `src/photos/pipeline.ts`, `CustomerList/Form/Detail.tsx`, RxDB collections, Supabase, or the CouchDB replication via `replicateRxCollection` have all been replaced — the current stack is PouchDB (browser) + CouchDB (server) with a tiny Node provisioning proxy.

Comprehensive technical documentation for developers building and maintaining TrichoApp.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Development Setup](#development-setup)
3. [Project Structure](#project-structure)
4. [Cryptographic Architecture](#cryptographic-architecture)
5. [Authentication System](#authentication-system)
6. [Database Layer (RxDB)](#database-layer-rxdb)
7. [Sync System](#sync-system)
8. [Photo Pipeline](#photo-pipeline)
9. [React Components](#react-components)
10. [API Reference](#api-reference)
11. [Testing](#testing)
12. [Security Considerations](#security-considerations)
13. [Deployment](#deployment)
14. [Troubleshooting](#troubleshooting)
15. [Contributing](#contributing)

---

## Architecture Overview

TrichoApp follows an **offline-first, end-to-end encrypted** architecture designed for privacy-conscious applications.

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT (Browser/PWA)                              │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                           REACT LAYER                                   │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │ │
│  │  │   TrichoApp  │  │  LoginScreen │  │  Customer    │                 │ │
│  │  │   (Root)     │──│  Setup/Auth  │──│  List/Detail │                 │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │ │
│  │         │                                    │                          │ │
│  │         ▼                                    ▼                          │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │  │                        AuthContext                                │  │ │
│  │  │   (auth state, DEK access, passkey management)                   │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                         DATA LAYER                                     │  │
│  │                                                                         │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │                         RxDB                                      │  │  │
│  │  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │  │  │
│  │  │   │  Customers   │  │    Visits    │  │  PhotoMeta   │          │  │  │
│  │  │   │  Collection  │  │  Collection  │  │  Collection  │          │  │  │
│  │  │   └──────────────┘  └──────────────┘  └──────────────┘          │  │  │
│  │  │                          │                                        │  │  │
│  │  │   ┌──────────────────────▼────────────────────────────────────┐  │  │  │
│  │  │   │  wrappedKeyEncryptionCryptoJsStorage                      │  │  │  │
│  │  │   │  (encrypts/decrypts using DEK password)                   │  │  │  │
│  │  │   └──────────────────────┬────────────────────────────────────┘  │  │  │
│  │  │                          │                                        │  │  │
│  │  │   ┌──────────────────────▼────────────────────────────────────┐  │  │  │
│  │  │   │  Dexie (IndexedDB adapter)                                │  │  │  │
│  │  │   └───────────────────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  │                                    │                                    │  │
│  │  ┌─────────────────────────────────▼────────────────────────────────┐  │  │
│  │  │                       SYNC ORCHESTRATOR                           │  │  │
│  │  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │  │  │
│  │  │   │   CouchDB    │  │    Photo     │  │   Conflict   │          │  │  │
│  │  │   │  Replication │  │    Queue     │  │   Handler    │          │  │  │
│  │  │   └──────────────┘  └──────────────┘  └──────────────┘          │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                         CRYPTO LAYER                                   │  │
│  │                                                                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │  │
│  │  │    Keys      │  │   Envelope   │  │    Utils     │                 │  │
│  │  │ (RS,DEK,KEK) │  │  (encrypt/   │  │  (base64url, │                 │  │
│  │  │              │  │   decrypt)   │  │   helpers)   │                 │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                          AUTH LAYER                                    │  │
│  │                                                                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │  │
│  │  │   Passkey    │  │     PRF      │  │   Recovery   │                 │  │
│  │  │ (WebAuthn)   │  │  Extension   │  │    Import/   │                 │  │
│  │  │              │  │  & Fallback  │  │    Export    │                 │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ HTTPS (all data encrypted)
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 CLOUD                                         │
│                                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐           │
│  │   Auth Service   │  │     CouchDB      │  │   Object Store   │           │
│  │   (Hono/Node)    │  │  (per-user DB)   │  │  (S3-compatible) │           │
│  │                  │  │                  │  │                  │           │
│  │  ┌────────────┐  │  │  ┌────────────┐  │  │  ┌────────────┐  │           │
│  │  │  WebAuthn  │  │  │  │ Encrypted  │  │  │  │ Encrypted  │  │           │
│  │  │ Challenges │  │  │  │   Docs     │  │  │  │   Photos   │  │           │
│  │  └────────────┘  │  │  └────────────┘  │  │  └────────────┘  │           │
│  │  ┌────────────┐  │  │                  │  │                  │           │
│  │  │  JWT Token │  │  │  Server CANNOT   │  │  Server CANNOT   │           │
│  │  │   Issuer   │  │  │  read content    │  │  read content    │           │
│  │  └────────────┘  │  │                  │  │                  │           │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

| Principle | Implementation | Rationale |
|-----------|----------------|-----------|
| **Offline-First** | RxDB with IndexedDB, local operations | Works without network, syncs opportunistically |
| **E2E Encryption** | AES-256-GCM, client-side only | Server never sees plaintext |
| **Passkey Auth** | WebAuthn with PRF extension | Phishing-resistant, no passwords |
| **Recovery by Design** | QR-encoded Recovery Secret | Users never lose data access |
| **Multi-Device** | CouchDB replication | Sync across phone, tablet, desktop |

### Data Flow

```
1. USER INPUT
   └──▶ React Component
         └──▶ RxDB Collection.insert/update
               └──▶ CryptoJS Encryption (DEK)
                     └──▶ IndexedDB (encrypted)
                           └──▶ CouchDB Replication (encrypted)
                                 └──▶ Other devices

2. DATA ACCESS
   └──▶ React Hook (useCustomers, etc.)
         └──▶ RxDB Query (reactive)
               └──▶ CryptoJS Decryption (DEK)
                     └──▶ Plaintext to Component
```

---

## Development Setup

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 18.0.0 | LTS recommended |
| npm | >= 9.0.0 | Comes with Node |
| Docker | >= 20.0.0 | For CouchDB |
| Git | >= 2.30.0 | Version control |

### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/beranku/tricho-app.git
cd tricho-app

# 2. Install frontend dependencies
npm install

# 3. Install server dependencies
cd server && npm install && cd ..

# 4. Start CouchDB (Docker)
docker run -d \
  --name tricho-couchdb \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=password \
  couchdb:3

# 5. Verify CouchDB is running
curl http://admin:password@localhost:5984/_up
# Should return: {"status":"ok",...}

# 6. Create environment file
cp .env.example .env

# 7. Start development servers (2 terminals)
# Terminal 1: Frontend
npm run dev

# Terminal 2: Auth server
cd server && npm run dev
```

### Environment Variables

Create a `.env` file in the project root:

```env
# ============================================
# FRONTEND CONFIGURATION (VITE)
# ============================================

# CouchDB URL for document sync
VITE_COUCHDB_URL=http://localhost:5984

# Auth service URL for WebAuthn
VITE_AUTH_URL=http://localhost:3000

# Object storage URL for photo uploads
VITE_OBJECT_STORAGE_URL=http://localhost:9000

# ============================================
# SERVER CONFIGURATION
# ============================================

# CouchDB connection
COUCHDB_URL=http://localhost:5984
COUCHDB_USER=admin
COUCHDB_PASSWORD=password

# JWT configuration (generate a strong secret!)
JWT_SECRET=your-secret-key-minimum-32-characters-long
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# WebAuthn Relying Party configuration
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME=TrichoApp
WEBAUTHN_ORIGIN=http://localhost:4321

# Server port
PORT=3000
```

### NPM Scripts

#### Frontend (root `package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `astro dev` | Start development server (port 4321) |
| `build` | `astro build` | Build production bundle |
| `preview` | `astro preview` | Preview production build locally |
| `test` | unit + component vitest | Fast loop (< 15 s, no Docker) — pyramid tiers 1-2 |
| `test:watch` | `vitest` | Watch mode for the unit tier |
| `test:unit` | unit config | Pure logic (src/auth, src/crypto, src/db, src/sync) |
| `test:component` | component config | React Testing Library jsdom tests under src/components/ |
| `test:backend` | backend config | Node-side unit tests for infrastructure/**/test/ |
| `test:backend:integration` | integration config | testcontainers-backed real CouchDB suites |
| `test:e2e` | `playwright test` | Browser E2E against the ci compose stack |
| `test:smoke` | `scripts/smoke/run-all.sh` | Infra sanity: compose config, secrets lint, healthcheck declared |
| `test:coverage` | all tiers with `--coverage` | Regenerates `coverage/*/coverage-summary.json` for baseline diff |
| `test:all` | every tier | Full sweep (minutes) |
| `typecheck` | `astro check && tsc --noEmit` | Check TypeScript types |

See [`docs/TESTING.md`](./TESTING.md) for the pyramid contract, per-tier runtime budgets, the decision tree, and the coverage baseline procedure.

#### Server (`server/package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `tsx watch src/index.ts` | Start server with hot reload |
| `build` | `tsc` | Compile TypeScript |
| `start` | `node dist/index.js` | Start production server |
| `test` | `vitest run` | Run server tests |

### IDE Setup

#### VS Code (Recommended)

Install these extensions:
- **ESLint** - Linting
- **Prettier** - Code formatting
- **TypeScript + JavaScript** - Built-in
- **Astro** - Astro file support

Settings (`.vscode/settings.json`):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

---

## Project Structure

```
tricho-app/
├── src/                          # Frontend source
│   ├── components/               # React UI components
│   │   ├── App.tsx              # Main app shell, auth routing
│   │   ├── TrichoApp.tsx        # Root component (Astro entry)
│   │   ├── MainContent.tsx      # Authenticated user content
│   │   ├── LoginScreen.tsx      # Login/setup/recovery screens
│   │   ├── CustomerList.tsx     # Customer list view
│   │   ├── CustomerDetail.tsx   # Customer detail view
│   │   ├── CustomerForm.tsx     # Create/edit customer form
│   │   ├── PhotoCapture.tsx     # Camera capture component
│   │   ├── RecoveryQRDisplay.tsx # Show recovery QR code
│   │   ├── RecoveryQRScanner.tsx # Scan recovery QR code
│   │   ├── SettingsScreen.tsx   # App settings
│   │   └── SyncStatus.tsx       # Sync status indicator
│   │
│   ├── context/                  # React context providers
│   │   └── AuthContext.tsx      # Authentication state, DEK access
│   │
│   ├── crypto/                   # Cryptographic operations
│   │   ├── keys.ts              # Key generation, KEK derivation, wrapping
│   │   ├── keys.test.ts         # Key tests
│   │   ├── envelope.ts          # Document/photo encryption
│   │   ├── envelope.test.ts     # Envelope tests
│   │   └── utils.ts             # Base64url, QR formatting
│   │
│   ├── auth/                     # Authentication modules
│   │   ├── passkey.ts           # WebAuthn registration/authentication
│   │   ├── prf.ts               # PRF extension, graceful degradation
│   │   ├── prf.test.ts          # PRF tests
│   │   └── recovery.ts          # Recovery QR import/export
│   │
│   ├── db/                       # Database layer
│   │   ├── index.ts             # RxDB initialization, singleton
│   │   ├── hooks.ts             # React hooks (useCustomers, etc.)
│   │   └── schemas/             # RxDB collection schemas
│   │       ├── index.ts         # Schema registry
│   │       ├── customer.ts      # Customer document schema
│   │       ├── visit.ts         # Visit document schema
│   │       └── photo-meta.ts    # Photo metadata schema
│   │
│   ├── sync/                     # Synchronization
│   │   ├── orchestrator.ts      # CouchDB replication manager
│   │   ├── photos.ts            # Photo upload queue
│   │   └── hooks.ts             # Sync React hooks
│   │
│   ├── photos/                   # Photo processing
│   │   ├── capture.ts           # Camera capture, file import
│   │   ├── encrypt.ts           # Photo encryption/decryption
│   │   ├── thumbnail.ts         # Thumbnail generation
│   │   ├── pipeline.ts          # Full photo pipeline
│   │   └── hooks.ts             # Photo React hooks
│   │
│   ├── config/                   # Configuration
│   │   └── env.ts               # Environment variable access
│   │
│   └── pages/                    # Astro pages
│       └── index.astro          # Main entry point
│
├── server/                       # Auth service (Node.js)
│   ├── src/
│   │   ├── index.ts             # Server entry (Hono framework)
│   │   ├── routes/
│   │   │   └── auth.ts          # WebAuthn API routes
│   │   ├── services/
│   │   │   ├── webauthn.ts      # WebAuthn logic
│   │   │   ├── tokens.ts        # JWT token management
│   │   │   └── tenant.ts        # User/database provisioning
│   │   └── middleware/
│   │       └── auth.ts          # Authentication middleware
│   ├── package.json
│   └── tsconfig.json
│
├── public/                       # Static assets
│   ├── manifest.webmanifest     # PWA manifest
│   ├── sw.js                    # Service worker
│   └── icons/                   # App icons
│
├── docs/                         # Documentation
│   ├── USER_GUIDE.md            # End-user documentation
│   └── DEVELOPER.md             # This file
│
├── package.json                  # Frontend dependencies
├── tsconfig.json                 # TypeScript config
├── astro.config.mjs             # Astro configuration
├── vitest.config.ts             # Test configuration
├── .env.example                 # Environment template
└── README.md                    # Project overview
```

---

## Cryptographic Architecture

### Key Hierarchy

TrichoApp uses a hierarchical key structure for security and flexibility:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          KEY HIERARCHY                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    RECOVERY SECRET (RS)                               │  │
│  │                                                                        │  │
│  │  • 32 bytes (256 bits) of cryptographic randomness                    │  │
│  │  • Generated once during first-time setup                             │  │
│  │  • Displayed as QR code for user to save                              │  │
│  │  • NEVER stored on device after initial display                       │  │
│  │  • Ultimate recovery mechanism - if lost, data is unrecoverable       │  │
│  │                                                                        │  │
│  │  Generation: crypto.getRandomValues(new Uint8Array(32))               │  │
│  │  Storage: None (shown once, user saves externally)                    │  │
│  │  Format: tricho://recover/<base64url-encoded-RS>                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│              ┌───────────────┴───────────────┐                              │
│              │                               │                              │
│              ▼                               ▼                              │
│  ┌────────────────────────┐    ┌────────────────────────┐                  │
│  │   KEK (from PRF)       │    │   KEK (from RS)        │                  │
│  │                        │    │                        │                  │
│  │ • Preferred method     │    │ • Fallback method      │                  │
│  │ • Uses passkey PRF     │    │ • Uses RS directly     │                  │
│  │ • Stateless unlock     │    │ • Requires RS scan     │                  │
│  │                        │    │                        │                  │
│  │ Derivation:            │    │ Derivation:            │                  │
│  │ HKDF(SHA-256,          │    │ HKDF(SHA-256,          │                  │
│  │   prfOutput,           │    │   recoverySecret,      │                  │
│  │   deviceSalt,          │    │   deviceSalt,          │                  │
│  │   "tricho:kek:prf:v1") │    │   "tricho:kek:rs:v1")  │                  │
│  └────────────────────────┘    └────────────────────────┘                  │
│              │                               │                              │
│              └───────────────┬───────────────┘                              │
│                              │                                               │
│                              ▼                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    KEY ENCRYPTION KEY (KEK)                           │  │
│  │                                                                        │  │
│  │  • AES-256 CryptoKey (non-extractable)                                │  │
│  │  • Used to wrap/unwrap the DEK                                        │  │
│  │  • Per-device (allows device revocation)                              │  │
│  │  • Derived differently per device                                     │  │
│  │                                                                        │  │
│  │  Type: CryptoKey { algorithm: AES-GCM, usages: [wrapKey, unwrapKey] } │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│                              │ wrapKey/unwrapKey                            │
│                              ▼                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    DATA ENCRYPTION KEY (DEK)                          │  │
│  │                                                                        │  │
│  │  • 32 bytes (256 bits) of cryptographic randomness                    │  │
│  │  • The actual key that encrypts user data                             │  │
│  │  • Stored WRAPPED (encrypted with KEK) in localStorage                │  │
│  │  • Same DEK across all user's devices                                 │  │
│  │                                                                        │  │
│  │  Generation: crypto.getRandomValues(new Uint8Array(32))               │  │
│  │  Storage: localStorage['dek_wrapped'] = { iv, ciphertext }            │  │
│  │  Usage: RxDB password, per-document key derivation                    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│                              │ HKDF                                         │
│                              ▼                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    PER-DOCUMENT KEYS                                  │  │
│  │                                                                        │  │
│  │  Document Key: HKDF(DEK, salt, "tricho:envelope:doc:v1:<docId>")      │  │
│  │  Photo Key:    HKDF(DEK, salt, "tricho:envelope:photo:v1:<id>:<var>") │  │
│  │                                                                        │  │
│  │  Each document/photo encrypted with unique key                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Operations Code Examples

#### Key Generation (`src/crypto/keys.ts`)

```typescript
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

// Constants
export const KEY_LENGTH = 32;    // 256 bits
export const IV_LENGTH = 12;     // 96 bits (NIST GCM recommendation)
export const SALT_LENGTH = 32;   // 256 bits

// Generate Recovery Secret
export function generateRecoverySecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
}

// Generate Data Encryption Key
export function generateDataEncryptionKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
}

// Generate per-device salt
export function generateDeviceSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

// Derive KEK from PRF output (preferred)
export async function deriveKekFromPRF(
  prfOutput: Uint8Array,
  deviceSalt: Uint8Array
): Promise<CryptoKey> {
  const keyBytes = hkdf(sha256, prfOutput, deviceSalt, 'tricho:kek:prf:v1', KEY_LENGTH);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false, // non-extractable
    ['wrapKey', 'unwrapKey']
  );
}

// Derive KEK from Recovery Secret (fallback)
export async function deriveKekFromRS(
  recoverySecret: Uint8Array,
  deviceSalt: Uint8Array
): Promise<CryptoKey> {
  const keyBytes = hkdf(sha256, recoverySecret, deviceSalt, 'tricho:kek:rs:v1', KEY_LENGTH);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['wrapKey', 'unwrapKey']
  );
}
```

#### DEK Wrapping (`src/crypto/keys.ts`)

```typescript
export interface WrappedDek {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

// Wrap DEK with KEK for storage
export async function wrapDek(dek: Uint8Array, kek: CryptoKey): Promise<WrappedDek> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Import DEK as CryptoKey for wrapping
  const dekKey = await crypto.subtle.importKey(
    'raw',
    dek,
    { name: 'AES-GCM' },
    true, // extractable (to unwrap later)
    ['encrypt', 'decrypt']
  );

  // Wrap with AES-GCM
  const ciphertext = await crypto.subtle.wrapKey(
    'raw',
    dekKey,
    kek,
    { name: 'AES-GCM', iv }
  );

  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

// Unwrap DEK with KEK
export async function unwrapDek(wrapped: WrappedDek, kek: CryptoKey): Promise<Uint8Array> {
  const dekKey = await crypto.subtle.unwrapKey(
    'raw',
    wrapped.ciphertext,
    kek,
    { name: 'AES-GCM', iv: wrapped.iv },
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );

  const rawKey = await crypto.subtle.exportKey('raw', dekKey);
  return new Uint8Array(rawKey);
}

// Serialize for localStorage
export function serializeWrappedDek(wrapped: WrappedDek): string {
  return JSON.stringify({
    iv: base64urlEncode(wrapped.iv),
    ciphertext: base64urlEncode(wrapped.ciphertext)
  });
}

// Deserialize from localStorage
export function deserializeWrappedDek(serialized: string): WrappedDek {
  const { iv, ciphertext } = JSON.parse(serialized);
  return {
    iv: base64urlDecode(iv),
    ciphertext: base64urlDecode(ciphertext)
  };
}
```

#### Envelope Encryption (`src/crypto/envelope.ts`)

```typescript
// Derive per-document key using HKDF
export function deriveDocumentKey(
  dek: Uint8Array,
  salt: Uint8Array,
  documentId: string
): Uint8Array {
  const info = `tricho:envelope:doc:v1:${documentId}`;
  return hkdf(sha256, dek, salt, info, KEY_LENGTH);
}

// Encrypt document
export async function encryptDocument(
  plaintext: object,
  dek: Uint8Array,
  documentId: string
): Promise<EncryptedDocument> {
  const salt = generateEnvelopeSalt();
  const docKey = deriveDocumentKey(dek, salt, documentId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const key = await crypto.subtle.importKey(
    'raw', docKey, { name: 'AES-GCM' }, false, ['encrypt']
  );

  const data = new TextEncoder().encode(JSON.stringify(plaintext));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    data
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    iv,
    salt
  };
}

// Decrypt document
export async function decryptDocument(
  encrypted: EncryptedDocument,
  dek: Uint8Array,
  documentId: string
): Promise<object> {
  const docKey = deriveDocumentKey(dek, encrypted.salt, documentId);

  const key = await crypto.subtle.importKey(
    'raw', docKey, { name: 'AES-GCM' }, false, ['decrypt']
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.iv, tagLength: 128 },
    key,
    encrypted.ciphertext
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}
```

### Cryptographic Parameters

| Parameter | Value | Standard | Rationale |
|-----------|-------|----------|-----------|
| Key size | 256 bits (32 bytes) | NIST SP 800-57 | AES-256 security level |
| IV size | 96 bits (12 bytes) | NIST SP 800-38D | GCM recommended size |
| Auth tag | 128 bits (16 bytes) | NIST SP 800-38D | Maximum integrity |
| Salt size | 256 bits (32 bytes) | RFC 5869 | HKDF best practice |
| HKDF hash | SHA-256 | RFC 5869 | Widely supported |

---

## Authentication System

### WebAuthn Flow Diagrams

#### Registration Flow

```
┌──────────────┐                  ┌──────────────┐                  ┌──────────────┐
│    Client    │                  │   Server     │                  │ Authenticator│
│   (Browser)  │                  │  (Auth API)  │                  │ (Face ID)    │
└──────────────┘                  └──────────────┘                  └──────────────┘
       │                                 │                                 │
       │  1. User enters email           │                                 │
       │  ─────────────────────────►     │                                 │
       │                                 │                                 │
       │  POST /auth/register/begin      │                                 │
       │  { username: "user@email.com" } │                                 │
       │  ───────────────────────────────►                                 │
       │                                 │                                 │
       │                                 │  Generate challenge             │
       │                                 │  Create user record             │
       │                                 │                                 │
       │  ◄───────────────────────────────                                 │
       │  PublicKeyCredentialCreationOptions                               │
       │  { challenge, rp, user, pubKeyCredParams,                         │
       │    authenticatorSelection: {                                      │
       │      residentKey: "required",                                     │
       │      userVerification: "required" }}                              │
       │                                 │                                 │
       │  2. startRegistration(options)  │                                 │
       │  ───────────────────────────────────────────────────────────────► │
       │                                 │                                 │
       │                                 │         User verifies           │
       │                                 │         (Face ID scan)          │
       │                                 │                                 │
       │  ◄─────────────────────────────────────────────────────────────── │
       │  { id, response: { attestation... } }                             │
       │                                 │                                 │
       │  POST /auth/register/finish     │                                 │
       │  { credential }                 │                                 │
       │  ───────────────────────────────►                                 │
       │                                 │                                 │
       │                                 │  Verify attestation             │
       │                                 │  Store credential               │
       │                                 │                                 │
       │  ◄───────────────────────────────                                 │
       │  { success: true, userId }      │                                 │
       │                                 │                                 │
```

#### Authentication Flow (with PRF)

```
┌──────────────┐                  ┌──────────────┐                  ┌──────────────┐
│    Client    │                  │   Server     │                  │ Authenticator│
└──────────────┘                  └──────────────┘                  └──────────────┘
       │                                 │                                 │
       │  GET device salt from storage   │                                 │
       │                                 │                                 │
       │  POST /auth/authenticate/begin  │                                 │
       │  { username? }                  │  (username optional for         │
       │  ───────────────────────────────►   discoverable credentials)     │
       │                                 │                                 │
       │  ◄───────────────────────────────                                 │
       │  PublicKeyCredentialRequestOptions                                │
       │  { challenge, rpId, allowCredentials }                            │
       │                                 │                                 │
       │  navigator.credentials.get({    │                                 │
       │    publicKey: { ...options,     │                                 │
       │      extensions: {              │                                 │
       │        prf: { eval: {           │                                 │
       │          first: deviceSalt      │                                 │
       │        }}                       │                                 │
       │      }                          │                                 │
       │    }                            │                                 │
       │  })                             │                                 │
       │  ───────────────────────────────────────────────────────────────► │
       │                                 │                                 │
       │                                 │         User verifies           │
       │                                 │         (Face ID scan)          │
       │                                 │                                 │
       │  ◄─────────────────────────────────────────────────────────────── │
       │  credential + extensions: { prf: { results: { first: prfOutput }}}│
       │                                 │                                 │
       │  POST /auth/authenticate/finish │                                 │
       │  { credential }                 │                                 │
       │  ───────────────────────────────►                                 │
       │                                 │                                 │
       │                                 │  Verify assertion               │
       │                                 │  Update counter                 │
       │                                 │                                 │
       │  ◄───────────────────────────────                                 │
       │  { accessToken, refreshToken }  │                                 │
       │                                 │                                 │
       │  3. Derive KEK from PRF output  │                                 │
       │     or fall back to RS          │                                 │
       │                                 │                                 │
       │  4. Unwrap DEK using KEK        │                                 │
       │                                 │                                 │
       │  5. Initialize RxDB with DEK    │                                 │
       │                                 │                                 │
```

### PRF Extension Implementation

```typescript
// src/auth/prf.ts

export interface PrfCapabilities {
  supported: boolean;
  platform: string;
  warnings: string[];
}

// Detect PRF support and platform quirks
export async function getPrfCapabilities(): Promise<PrfCapabilities> {
  const platform = detectPlatform();
  const warnings: string[] = [];

  // Check WebAuthn support
  if (!window.PublicKeyCredential) {
    return { supported: false, platform, warnings: ['WebAuthn not supported'] };
  }

  // Platform-specific warnings
  if (platform === 'safari' || platform === 'ios') {
    warnings.push('PRF only works with iCloud Keychain, not hardware keys');
    if (isIOS18()) {
      warnings.push('iOS 18.0-18.1 have PRF bugs; update to iOS 18.2+');
    }
  }

  if (platform === 'firefox') {
    warnings.push('Firefox has limited PRF support; RS fallback recommended');
  }

  // Check for prf extension support
  const supported = await checkPrfSupport();

  return { supported, platform, warnings };
}

// Authenticate with PRF extension
export async function authenticateWithPRF(
  authOptions: PublicKeyCredentialRequestOptions,
  prfSalt: Uint8Array
): Promise<{ credential: PublicKeyCredential; prfOutput?: Uint8Array }> {

  const credential = await navigator.credentials.get({
    publicKey: {
      ...authOptions,
      extensions: {
        prf: {
          eval: { first: prfSalt.buffer }
        }
      }
    }
  }) as PublicKeyCredential;

  const extResults = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } }
  };

  const prfOutput = extResults.prf?.results?.first
    ? new Uint8Array(extResults.prf.results.first)
    : undefined;

  return { credential, prfOutput };
}

// Unified unlock with automatic fallback
export async function unlockWithPasskey(options: {
  authOptions: PublicKeyCredentialRequestOptions;
  deviceSalt: Uint8Array;
  wrappedDek: WrappedDek;
  recoverySecret?: Uint8Array; // Only needed for fallback
}): Promise<UnlockResult> {

  // Try PRF first
  const { credential, prfOutput } = await authenticateWithPRF(
    options.authOptions,
    options.deviceSalt
  );

  let kek: CryptoKey;
  let kekSource: 'prf' | 'rs';

  if (prfOutput) {
    // PRF succeeded - derive KEK from PRF output
    kek = await deriveKekFromPRF(prfOutput, options.deviceSalt);
    kekSource = 'prf';
  } else if (options.recoverySecret) {
    // PRF failed, fall back to RS
    kek = await deriveKekFromRS(options.recoverySecret, options.deviceSalt);
    kekSource = 'rs';
  } else {
    throw new UnlockFailedError('PRF not supported and no recovery secret provided');
  }

  // Unwrap DEK
  const dek = await unwrapDek(options.wrappedDek, kek);

  return { credential, kek, dek, kekSource };
}
```

### Platform-Specific PRF Notes

| Platform | PRF Support | Notes |
|----------|-------------|-------|
| Chrome (Desktop/Android) | ✅ Full | Works with platform and roaming authenticators |
| Safari (macOS) | ⚠️ Limited | Only iCloud Keychain passkeys, not hardware keys |
| Safari (iOS) | ⚠️ Limited | Only iCloud Keychain; iOS 18.2+ recommended |
| Firefox | ⚠️ Limited | Partial support; RS fallback recommended |
| Edge | ✅ Full | Same as Chrome (Chromium-based) |
| Cross-device QR | ❌ Unreliable | PRF may fail or return different values |

---

## Database Layer (RxDB)

### Initialization

```typescript
// src/db/index.ts
import { createRxDatabase, RxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedKeyEncryptionCryptoJsStorage } from 'rxdb/plugins/encryption-crypto-js';
import { addRxPlugin } from 'rxdb';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { keyToPassword } from '../crypto/utils';

// Add dev mode plugin in development
if (import.meta.env.DEV) {
  addRxPlugin(RxDBDevModePlugin);
}

// Singleton instance
let dbPromise: Promise<RxDatabase> | null = null;

export async function initDatabase(dek: Uint8Array): Promise<RxDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = (async () => {
    // Validate DEK
    if (!(dek instanceof Uint8Array) || dek.length !== 32) {
      throw new DatabaseError('Invalid DEK: must be 32-byte Uint8Array');
    }

    // Create encrypted storage wrapper
    const encryptedStorage = wrappedKeyEncryptionCryptoJsStorage({
      storage: getRxStorageDexie()
    });

    // Create database with DEK as password
    const db = await createRxDatabase({
      name: 'trichoapp',
      storage: encryptedStorage,
      password: keyToPassword(dek), // base64url encode for RxDB
    });

    // Add collections
    await setupCollections(db);

    return db;
  })();

  return dbPromise;
}

export function getDatabase(): RxDatabase | null {
  return dbPromise ? await dbPromise : null;
}

export async function closeDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    await db.destroy();
    dbPromise = null;
  }
}
```

### Schema Pattern

All documents follow the **encrypted payload pattern**:

```typescript
// src/db/schemas/customer.ts

export const CUSTOMER_DOC_TYPE = 'customer';

export interface CustomerEncryptedPayload {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  allergies?: string;
  preferredProducts?: string;
  dateOfBirth?: string;
}

export interface CustomerDocType {
  // Unencrypted metadata (queryable, indexable)
  id: string;
  type: typeof CUSTOMER_DOC_TYPE;
  updatedAt: number;
  createdAt: number;
  deleted: boolean;

  // Encrypted payload (NOT queryable)
  enc: CustomerEncryptedPayload;
}

export const customerSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    type: { type: 'string' },
    updatedAt: { type: 'number' },
    createdAt: { type: 'number' },
    deleted: { type: 'boolean' },
    enc: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        notes: { type: 'string' },
        allergies: { type: 'string' },
        preferredProducts: { type: 'string' },
        dateOfBirth: { type: 'string' }
      }
    }
  },
  required: ['id', 'type', 'updatedAt', 'createdAt'],
  encrypted: ['enc'], // This field is encrypted
  indexes: [
    'updatedAt',
    ['type', 'updatedAt']
    // NOTE: Cannot index encrypted fields!
  ]
};
```

### React Hooks

```typescript
// src/db/hooks.ts

import { useState, useEffect } from 'react';
import { getDatabase } from './index';

// Generic hook for reactive RxDB queries
export function useRxQuery<T>(
  collectionName: string,
  queryFn: (collection: RxCollection) => RxQuery<T>
): { data: T[]; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const db = getDatabase();
    if (!db) return;

    const collection = db[collectionName];
    if (!collection) return;

    const query = queryFn(collection);
    const subscription = query.$.subscribe({
      next: (results) => {
        setData(results);
        setLoading(false);
      },
      error: (err) => {
        setError(err);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [collectionName]);

  return { data, loading, error };
}

// Customers hook
export function useCustomers() {
  return useRxQuery<CustomerDocType>('customers', (collection) =>
    collection.find({ selector: { deleted: false } })
  );
}

// Single customer hook
export function useCustomer(customerId: string) {
  const [customer, setCustomer] = useState<CustomerDocType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = getDatabase();
    if (!db) return;

    const subscription = db.customers
      .findOne(customerId)
      .$.subscribe((doc) => {
        setCustomer(doc?.toJSON() ?? null);
        setLoading(false);
      });

    return () => subscription.unsubscribe();
  }, [customerId]);

  return { data: customer, loading };
}

// Customer search (client-side, works with encrypted data)
export function useCustomerSearch() {
  const { data: allCustomers, loading } = useCustomers();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    if (!query.trim()) return allCustomers;

    const lowerQuery = query.toLowerCase();
    return allCustomers.filter((c) =>
      c.enc.name.toLowerCase().includes(lowerQuery) ||
      c.enc.phone?.includes(query) ||
      c.enc.email?.toLowerCase().includes(lowerQuery)
    );
  }, [allCustomers, query]);

  return { results, loading, query, setQuery };
}
```

---

## Sync System

### Orchestrator Configuration

```typescript
// src/sync/orchestrator.ts

import { replicateCouchDB } from 'rxdb/plugins/replication-couchdb';

export interface SyncConfig {
  database: RxDatabase;
  couchDbUrl: string;
  authToken: string;
  userId: string;
  enableNetworkSync?: boolean;  // Auto-sync on network change
  enableForegroundSync?: boolean; // Sync when app becomes visible (iOS)
}

export async function initSync(config: SyncConfig): Promise<void> {
  const {
    database,
    couchDbUrl,
    authToken,
    userId,
    enableNetworkSync = true,
    enableForegroundSync = true
  } = config;

  // User-specific database URL
  const userDbUrl = `${couchDbUrl}/user_${userId}`;

  // Set up replication for each collection
  for (const collectionName of ['customers', 'visits', 'photos']) {
    const collection = database[collectionName];
    if (!collection) continue;

    const replication = replicateCouchDB({
      collection,
      url: `${userDbUrl}`,
      headers: {
        Authorization: `Bearer ${authToken}`
      },
      pull: {
        batchSize: 100,
        heartbeat: 30000
      },
      push: {
        batchSize: 100
      },
      live: true,
      retryTime: 5000, // Retry failed sync after 5s
      autoStart: true
    });

    // Set up conflict handler
    replication.setConflictHandler(lastWriteWinsConflictHandler);

    // Store replication for later control
    replications.set(collectionName, replication);
  }

  // Set up network change listener
  if (enableNetworkSync) {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  // Set up foreground sync (iOS PWA)
  if (enableForegroundSync) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
}

// Last-write-wins conflict resolution
function lastWriteWinsConflictHandler(
  documentData: WithDeleted<any>,
  conflictData: WithDeleted<any>
): WithDeleted<any> {
  // Compare timestamps
  if (documentData.updatedAt > conflictData.updatedAt) {
    return documentData;
  }
  return conflictData;
}

// iOS foreground sync
function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible' && navigator.onLine) {
    triggerSync();
  }
}

// Manual sync trigger
export async function triggerSync(): Promise<void> {
  for (const replication of replications.values()) {
    await replication.reSync();
  }
}
```

### Photo Upload Queue

```typescript
// src/sync/photos.ts

interface QueuedUpload {
  id: string;
  photoId: string;
  variant: PhotoVariant;
  encryptedData: Uint8Array;
  storageKey: string;
  status: 'pending' | 'uploading' | 'failed';
  retryCount: number;
  lastError?: string;
  createdAt: number;
}

// IndexedDB-based upload queue
const DB_NAME = 'tricho-upload-queue';

export async function queuePhotoUpload(item: Omit<QueuedUpload, 'id' | 'status' | 'retryCount' | 'createdAt'>): Promise<string> {
  const db = await openQueueDatabase();
  const id = crypto.randomUUID();

  await db.put('uploads', {
    ...item,
    id,
    status: 'pending',
    retryCount: 0,
    createdAt: Date.now()
  });

  // Trigger processing if online
  if (navigator.onLine) {
    processQueue();
  }

  return id;
}

// Process queue with exponential backoff
async function processQueue(): Promise<void> {
  const db = await openQueueDatabase();
  const pending = await db.getAllFromIndex('uploads', 'by-status', 'pending');

  for (const item of pending) {
    try {
      // Update status
      await db.put('uploads', { ...item, status: 'uploading' });

      // Get presigned URL
      const uploadUrl = await getPresignedUploadUrl(item.storageKey);

      // Upload encrypted data
      await uploadPhoto(uploadUrl, item.encryptedData);

      // Remove from queue on success
      await db.delete('uploads', item.id);

      // Emit success event
      emitSyncEvent({ type: 'photo-uploaded', photoId: item.photoId });

    } catch (error) {
      // Calculate backoff delay
      const delay = Math.min(
        BASE_DELAY * Math.pow(2, item.retryCount),
        MAX_DELAY
      );

      await db.put('uploads', {
        ...item,
        status: 'failed',
        retryCount: item.retryCount + 1,
        lastError: error.message
      });

      // Retry after delay
      setTimeout(() => retryQueueItem(item.id), delay);
    }
  }
}
```

---

## Photo Pipeline

### Complete Photo Flow

```typescript
// src/photos/pipeline.ts

export interface PhotoPipelineResult {
  photoId: string;
  variants: Map<PhotoVariant, EncryptedPhotoData>;
  metaDoc: PhotoMetaDocType;
  uploadIds: string[];
}

export async function processPhoto(options: {
  source: Blob | File;
  customerId: string;
  visitId?: string;
  dek: Uint8Array;
  metadata?: { caption?: string; bodyRegion?: string; notes?: string };
}): Promise<PhotoPipelineResult> {
  const { source, customerId, visitId, dek, metadata } = options;

  const photoId = crypto.randomUUID();
  const capturedAt = Date.now();

  // Step 1: Generate variants (original, preview, thumbnail)
  const captured = await importFromBlob(source);
  const variantBlobs = await generateVariants(captured.blob);

  // Step 2: Encrypt each variant
  const variants = new Map<PhotoVariant, EncryptedPhotoData>();
  const uploadIds: string[] = [];

  for (const [variant, blob] of variantBlobs) {
    const arrayBuffer = await blob.arrayBuffer();
    const encrypted = await encryptPhotoBlob(
      new Uint8Array(arrayBuffer),
      dek,
      photoId,
      variant
    );

    variants.set(variant, encrypted);

    // Queue for upload
    const storageKey = generateStorageKey(customerId, photoId, variant);
    const uploadId = await queuePhotoUpload({
      photoId,
      variant,
      encryptedData: encrypted.ciphertext,
      storageKey
    });
    uploadIds.push(uploadId);
  }

  // Step 3: Create metadata document
  const metaDoc: PhotoMetaDocType = {
    id: photoId,
    type: PHOTO_META_DOC_TYPE,
    customerId,
    visitId: visitId ?? null,
    variant: 'original',
    uploadStatus: 'pending',
    capturedAt,
    storageKey: generateStorageKey(customerId, photoId, 'original'),
    mimeType: source.type,
    width: captured.width,
    height: captured.height,
    sizeBytes: source.size,
    updatedAt: capturedAt,
    createdAt: capturedAt,
    deleted: false,
    enc: {
      caption: metadata?.caption,
      bodyRegion: metadata?.bodyRegion,
      notes: metadata?.notes
    }
  };

  // Save metadata to RxDB
  const db = await getDatabase();
  await db.photos.insert(metaDoc);

  return { photoId, variants, metaDoc, uploadIds };
}
```

---

## API Reference

### Auth Service Endpoints

#### `POST /api/auth/register/begin`

Start WebAuthn registration.

**Request:**
```json
{ "username": "user@example.com" }
```

**Response:**
```json
{
  "challenge": "base64url-encoded-challenge",
  "rp": { "name": "TrichoApp", "id": "localhost" },
  "user": { "id": "base64url-user-id", "name": "user@example.com", "displayName": "user@example.com" },
  "pubKeyCredParams": [
    { "type": "public-key", "alg": -7 },
    { "type": "public-key", "alg": -257 }
  ],
  "authenticatorSelection": {
    "residentKey": "required",
    "userVerification": "required"
  },
  "timeout": 60000
}
```

#### `POST /api/auth/register/finish`

Complete WebAuthn registration.

**Request:**
```json
{
  "id": "credential-id",
  "rawId": "base64url-raw-id",
  "type": "public-key",
  "response": {
    "clientDataJSON": "base64url-client-data",
    "attestationObject": "base64url-attestation"
  }
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid"
}
```

#### `POST /api/auth/authenticate/begin`

Start WebAuthn authentication.

**Request:**
```json
{ "username": "user@example.com" }
```

**Response:**
```json
{
  "challenge": "base64url-challenge",
  "rpId": "localhost",
  "allowCredentials": [
    { "type": "public-key", "id": "credential-id" }
  ],
  "timeout": 60000,
  "userVerification": "required"
}
```

#### `POST /api/auth/authenticate/finish`

Complete WebAuthn authentication.

**Request:**
```json
{
  "id": "credential-id",
  "rawId": "base64url-raw-id",
  "type": "public-key",
  "response": {
    "clientDataJSON": "base64url-client-data",
    "authenticatorData": "base64url-auth-data",
    "signature": "base64url-signature"
  }
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "refresh-token-string",
  "user": {
    "id": "user-uuid",
    "username": "user@example.com"
  }
}
```

#### `POST /api/auth/token/refresh`

Refresh access token.

**Headers:**
```
Authorization: Bearer <refreshToken>
```

**Response:**
```json
{
  "accessToken": "new-access-token",
  "refreshToken": "new-refresh-token"
}
```

---

## Testing

### Test Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**']
    }
  }
});
```

### Example Tests

```typescript
// src/crypto/keys.test.ts
import { describe, it, expect } from 'vitest';
import {
  generateRecoverySecret,
  generateDataEncryptionKey,
  generateDeviceSalt,
  deriveKekFromRS,
  wrapDek,
  unwrapDek,
  KEY_LENGTH,
  constantTimeEqual
} from './keys';

describe('Key Generation', () => {
  it('generates 32-byte recovery secret', () => {
    const rs = generateRecoverySecret();
    expect(rs).toBeInstanceOf(Uint8Array);
    expect(rs.length).toBe(KEY_LENGTH);
  });

  it('generates unique keys each call', () => {
    const rs1 = generateRecoverySecret();
    const rs2 = generateRecoverySecret();
    expect(constantTimeEqual(rs1, rs2)).toBe(false);
  });
});

describe('Key Wrapping', () => {
  it('wraps and unwraps DEK correctly', async () => {
    const dek = generateDataEncryptionKey();
    const rs = generateRecoverySecret();
    const salt = generateDeviceSalt();

    const kek = await deriveKekFromRS(rs, salt);
    const wrapped = await wrapDek(dek, kek);
    const unwrapped = await unwrapDek(wrapped, kek);

    expect(constantTimeEqual(dek, unwrapped)).toBe(true);
  });

  it('fails with wrong KEK', async () => {
    const dek = generateDataEncryptionKey();
    const rs1 = generateRecoverySecret();
    const rs2 = generateRecoverySecret();
    const salt = generateDeviceSalt();

    const kek1 = await deriveKekFromRS(rs1, salt);
    const kek2 = await deriveKekFromRS(rs2, salt);

    const wrapped = await wrapDek(dek, kek1);

    await expect(unwrapDek(wrapped, kek2)).rejects.toThrow();
  });
});

describe('Constant Time Comparison', () => {
  it('returns true for equal arrays', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it('returns false for different arrays', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 4]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run with watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific file
npm test -- src/crypto/keys.test.ts

# Run tests matching pattern
npm test -- --grep "Key Wrapping"
```

---

## Security Considerations

### MUST DO

| Rule | Rationale |
|------|-----------|
| Use Web Crypto API for all crypto | Hardware-accelerated, audited implementation |
| Generate fresh IV for every encryption | IV reuse with same key breaks GCM security |
| Use 12-byte (96-bit) IV for AES-GCM | NIST recommendation for GCM mode |
| Clear sensitive data from memory | Reduce exposure window |
| Use constant-time comparison for secrets | Prevent timing attacks |
| Use HKDF domain separation | Prevent cross-context key misuse |
| Validate all cryptographic inputs | Prevent malformed data attacks |
| Use non-extractable CryptoKeys | Prevent key extraction via JavaScript |

### MUST NOT DO

| Rule | Rationale |
|------|-----------|
| Store DEK/RS on server | Violates E2EE principle |
| Log cryptographic material | Security exposure |
| Reuse IVs with same key | Breaks GCM confidentiality |
| Use 16-byte IV for GCM | Non-standard, less secure |
| Trust client-supplied key material | Potential for attack |
| Skip authentication on APIs | Unauthorized access |
| Use `eval()` or dynamic code | Code injection risk |
| Store secrets in source code | Exposure in version control |

### Security Checklist

Before release:

- [ ] All PII encrypted before leaving device
- [ ] Recovery secret shown only once
- [ ] DEK wrapped per-device for revocation
- [ ] Server only stores ciphertext
- [ ] No secrets in code or logs
- [ ] HTTPS required in production
- [ ] WebAuthn user verification required
- [ ] Input validation on all API endpoints
- [ ] Rate limiting on auth endpoints
- [ ] CORS properly configured

---

## Deployment

### Production Build

```bash
# Build frontend
npm run build

# Build server
cd server && npm run build
```

### Docker Compose

```yaml
version: '3.8'

services:
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "443:443"
    environment:
      - NODE_ENV=production
    depends_on:
      - auth

  auth:
    build:
      context: ./server
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - COUCHDB_URL=http://couchdb:5984
      - COUCHDB_USER=${COUCHDB_USER}
      - COUCHDB_PASSWORD=${COUCHDB_PASSWORD}
      - JWT_SECRET=${JWT_SECRET}
      - WEBAUTHN_RP_ID=${WEBAUTHN_RP_ID}
      - WEBAUTHN_RP_NAME=${WEBAUTHN_RP_NAME}
      - WEBAUTHN_ORIGIN=${WEBAUTHN_ORIGIN}
    depends_on:
      - couchdb

  couchdb:
    image: couchdb:3
    ports:
      - "5984:5984"
    volumes:
      - couchdb_data:/opt/couchdb/data
    environment:
      - COUCHDB_USER=${COUCHDB_USER}
      - COUCHDB_PASSWORD=${COUCHDB_PASSWORD}

volumes:
  couchdb_data:
```

### Health Checks

```bash
# Frontend
curl -f https://tricho.app/ || exit 1

# Auth service
curl -f https://auth.tricho.app/health || exit 1

# CouchDB
curl -f https://couch.tricho.app/_up || exit 1
```

---

## Production releases (promote dev → main)

Production releases are a single click in the GitHub Actions UI. The
`.github/workflows/promote-dev-to-main.yml` workflow fast-forwards `main`
to whatever SHA `dev` currently points at — `main` and `dev` end up on the
exact same commit object, so production deploys the artifact that was
already tested on staging (`dev.tricho.app`).

### How to release

1. Go to **Actions** → **Promote dev → main** → **Run workflow**.
2. Type `RELEASE` into the `confirm` input.
3. Click **Run workflow**.

That's it. The workflow validates four preflight gates, fast-forwards
`main`, tags the released SHA `prod-YYYY-MM-DD-<shortsha>`, and posts a
summary. The push to `main` then triggers `ci.yml`, which builds and
deploys to `tricho.app` as today.

### What the workflow checks before pushing

If any of these gates fails, the workflow aborts before touching `main`
and prints a remediation message in the run summary.

| Gate | What it checks | Remediation if it fails |
| --- | --- | --- |
| 0. Confirmation | `confirm` input equals `RELEASE` | Re-run, type `RELEASE` exactly |
| 1. Ahead of main | `dev` has ≥ 1 commit not on `main` | Land work on `dev` first |
| 2. Linear ancestor | `main` is an ancestor of `dev` (no divergence) | `git fetch origin && git checkout dev && git rebase origin/main && git push --force-with-lease origin dev` |
| 3. No merge commits | `main..dev` contains no merge commits | Rebase `dev` to a linear history |
| 4. Staging CI green | Latest `ci.yml` run on dev's tip SHA is `success` | Wait for staging CI, or fix the failure on `dev` and push again |

The push uses `git push origin <dev-sha>:refs/heads/main` with no force
flag, so the GitHub server itself rejects any non-fast-forward update.
The workflow never force-pushes.

### Recommended GitHub repo settings

Apply these once in **Settings → Branches** to enforce the same
invariants at the server side, regardless of the workflow:

- **`main` branch protection rule:**
  - ✅ Require linear history.
  - ❌ Disable "Allow squash merging" and "Allow merge commits" for PRs
    targeting `main`. (Squash- or merge-merging a PR breaks the
    dev↔main parity invariant; the recovery commit `e8ff12d "Merge main
    into dev to resolve squash-merge divergence"` records the last time
    that happened.)
  - ⚠️ Do **not** enable "Require pull request before merging" — the
    workflow's `GITHUB_TOKEN` push would be denied. The `confirm:
    RELEASE` gate replaces PR review for the single-developer flow.

### Rollback

Rollback is one click in the Cloudflare Pages dashboard:
**Workers & Pages → tricho → Deployments → "Rollback to this deployment"**
on the previous green deployment. There is no automated rollback
workflow today.

### Production tag timeline

`git tag --list 'prod-*' --sort=-v:refname` shows the production
release timeline (most recent first). These tags are independent of
the PWA semver `app-v*` tags created by `release-app.yml` — different
axes, different namespaces, no collision.

---

## Troubleshooting

### Common Issues

#### WebAuthn Not Working

**Symptoms:** Registration/authentication fails immediately

**Solutions:**
1. Ensure HTTPS (or localhost)
2. Check RP ID matches hostname
3. Verify browser supports WebAuthn
4. Check device has enrolled authenticator

#### PRF Returns Undefined

**Symptoms:** `prfOutput` is undefined after authentication

**Solutions:**
1. Check browser/platform PRF support with `getPrfCapabilities()`
2. Fall back to RS-based KEK derivation
3. On Safari, verify using iCloud Keychain (not hardware key)

#### Sync Stuck

**Symptoms:** Data not syncing between devices

**Solutions:**
1. Check network connectivity
2. Verify CouchDB is running and accessible
3. Check auth token is valid (not expired)
4. Look for CORS errors in console
5. Verify per-user database exists in CouchDB

#### RxDB Encryption Errors

**Symptoms:** Database operations fail with encryption errors

**Solutions:**
1. Verify DEK is 32-byte Uint8Array
2. Check `keyToPassword()` encoding is consistent
3. Clear database and re-initialize (dev only)
4. Verify CryptoJS plugin is loaded

---

## Contributing

### Development Workflow

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes following code style
4. Write/update tests
5. Run tests: `npm test`
6. Run linter: `npm run lint`
7. Commit with conventional commits
8. Push and create pull request

### Code Style

- Use TypeScript strict mode
- Follow ESLint configuration
- Use Prettier for formatting
- Write JSDoc comments for public APIs
- Add unit tests for new functionality

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add photo thumbnail generation
fix: correct PRF detection on Safari
docs: update API reference
test: add key wrapping tests
refactor: simplify sync orchestrator
```

---

## License

MIT License - see LICENSE file for details.

---

*TrichoApp - Secure, encrypted CRM for hairdressers.*
