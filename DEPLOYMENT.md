# SyncRoom — Production Deployment & Operations Guide

This document defines the deployment architecture, configuration specification, operational procedures, security controls, backup/recovery protocols, and smoke-testing standards for deploying the SyncRoom synchronized audio room platform to production environments.

---

## 1. System Architecture

SyncRoom implements a decoupled, server-authoritative real-time audio synchronization platform.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Production Client (Browser)                    │
│   React 19 + TypeScript + Vite SPA + Tailwind CSS + Lucide Icons       │
│   Progressive Web App (PWA) / Responsive Mobile & Desktop Layout       │
│   Dynamic Protocol Adaptation (Auto HTTPS / WSS Derivation)            │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 │ HTTPS (REST API)     WSS (WebSockets) │
                 ▼                                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        SyncRoom Production Engine                      │
│   Node.js 20+ / Express / ws (WebSocket Server on /ws)                 │
│   - Strict Security Headers (CSP, HSTS, X-Frame-Options, NoSniff)      │
│   - Multi-Tier Sliding-Window Rate Limiters (Auth, API, WS, Spotify)   │
│   - Structured JSON Logging with Sensitive Secret Redaction            │
│   - Authoritative Clock Sync (Cristian's Filtered Clock Model)         │
│   - Server-Authoritative Playback State Machine (Lock & Monotonic Ver) │
│   - Cryptographic 256-Bit SHA-256 Session Token Authentication         │
│   - Graceful Shutdown Controller (SIGTERM / SIGINT Draining)           │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
┌──────────────────────────────────────┐     ┌─────────────────────────────────┐
           │     Spotify Web API / OAuth 2.0      │     │    PostgreSQL Database (Prisma) │
           │   (Metadata, Search & Playlists)     │     │  (Persistent Sessions & Rooms)  │
           └──────────────────────────────────────┘     └─────────────────────────────────┘
```

### Components
1. **Frontend**: Vite Single-Page Application (SPA) compiled to static assets (`dist/`), with service worker caching for offline app shell resilience and manifest metadata for PWA installation.
2. **Backend**: Express REST API (`/api/*`), diagnostic probes (`/health`, `/ready`), and high-performance WebSocket server (`/ws`).
3. **Database**: PostgreSQL with connection pooling via Prisma ORM for relational persistence of users, rooms, sessions, queues, playback states, and audit logs.
4. **External Services**: Spotify Web API (OAuth 2.0 Authorization Code flow for metadata retrieval and playlist importing; audio is never scraped, converted, or redistributed).

---

## 2. Production URLs & Domain Configuration

| Service Component | Protocol | Production URL Pattern |
| :--- | :--- | :--- |
| **Frontend Web App** | `HTTPS` | `https://<real-production-domain>` |
| **Backend REST API** | `HTTPS` | `https://<real-api-domain>` |
| **WebSocket Engine** | `WSS` | `wss://<real-api-domain>/ws` |

*Note: If custom domains are not yet registered or DNS is pending, the application operates against the host-assigned cloud domain (e.g. AWS ALB, Cloud Run URL, Render URL). Never hardcode placeholder or example domains in production configuration.*

---

## 3. Environment Variables Specification

All configuration is provided via environment variables. **Never check real secret values or credentials into version control.**

### Backend Runtime Environment Variables (Server Only)

| Variable Name | Required | Default / Example | Purpose |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | **Yes** | `production` | Enforces production security optimizations, suppresses stack traces, and enables CSP. |
| `PORT` | **Yes** | `3000` | Port on which the HTTP server listens. |
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@pool-host:5432/syncroom?pgbouncer=true` | Pooled PostgreSQL connection string for Prisma application queries. |
| `DIRECT_URL` | **Yes** | `postgresql://user:pass@direct-host:5432/syncroom` | Direct PostgreSQL connection string for Prisma migrations. |
| `CLIENT_ORIGIN` | **Yes** | `https://syncroom.yourdomain.com` | Primary authorized client origin for CORS and WebSocket handshake origin validation. |
| `ALLOWED_ORIGINS` | Optional | `https://app.yourdomain.com` | Comma-separated list of secondary authorized origins. |
| `APP_URL` | **Yes** | `https://syncroom.yourdomain.com` | Base public URL of the application (used to resolve OAuth callbacks). |
| `SPOTIFY_CLIENT_ID` | Optional | `c481...` | Spotify Developer Application Client ID. Required for Spotify playlist/track search. |
| `SPOTIFY_CLIENT_SECRET` | Optional | `9f2a...` | Spotify Developer Application Client Secret. **Must never reach client bundle.** |
| `SPOTIFY_REDIRECT_URI` | Optional | `https://<api-domain>/api/spotify/callback` | Exact OAuth redirect URI registered in Spotify Developer Dashboard. |
| `SESSION_MAX_AGE_DAYS` | Optional | `7` | Sliding expiration lifetime for persistent device sessions (days). |
| `RATE_LIMIT_WINDOW_MS` | Optional | `60000` | Sliding rate limit window duration in milliseconds (default: 60s). |
| `RATE_LIMIT_MAX` | Optional | `100` | Max general API requests per IP per window. |
| `RATE_LIMIT_AUTH_MAX` | Optional | `30` | Max authentication requests per IP per window. |
| `RATE_LIMIT_SPOTIFY_MAX` | Optional | `40` | Max Spotify proxy requests per IP per window. |
| `WS_MAX_CONNECTIONS_PER_IP`| Optional | `20` | Max concurrent WebSocket connections per client IP address. |

### Frontend Runtime Environment Variables (Vite Bundle)

| Variable Name | Required | Default / Example | Purpose |
| :--- | :--- | :--- | :--- |
| `VITE_API_URL` | Optional | `https://api.yourdomain.com` | Base REST API URL. If empty, client uses `window.location.origin` (same-origin). |
| `VITE_WS_URL` | Optional | `wss://api.yourdomain.com/ws` | Base WebSocket URL. If empty, client derives `wss://<host>/ws` automatically. |

> **CRITICAL SECURITY RULE:** Never prefix server secrets (database credentials, Spotify secret, private signing keys) with `VITE_`. Any variable starting with `VITE_` is baked directly into public static JavaScript files.

---

## 4. Frontend Deployment Procedure

### Static Hosting (Cloudflare Pages / Vercel / Netlify / AWS S3 + CloudFront)

1. **Set Environment Variables**:
   In your build pipeline or hosting platform settings, configure:
   ```bash
   VITE_API_URL="https://api.yourdomain.com"
   VITE_WS_URL="wss://api.yourdomain.com/ws"
   ```
2. **Execute Clean Production Build**:
   ```bash
   npm run build:client
   ```
3. **Deploy Build Directory**:
   Deploy the generated `dist/` directory.
4. **Configure Single Page Application (SPA) Fallback**:
   Ensure all client routes (`/`, `/create`, `/join`, `/room/*`) route to `/index.html` with HTTP 200.
5. **Set HTTP Response Headers on Static Host**:
   - `index.html`: `Cache-Control: no-cache, no-store, must-revalidate`
   - `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`
   - `/sw.js`: `Cache-Control: no-cache, no-store, must-revalidate`

---

## 5. Backend Deployment Procedure

### Containerized Deployment (Docker / Kubernetes / Cloud Run / AWS ECS)

1. **Build Container Image**:
   The production Dockerfile uses a multi-stage Alpine build with a non-root `nodejs` execution user:
   ```bash
   docker build -t syncroom-backend:latest .
   ```
2. **Inject Production Secrets**:
   Provide environment variables via container orchestration secrets (Kubernetes Secrets, AWS SSM / Secrets Manager, Cloud Run Secret Manager).
3. **Execute Production Migration Before Starting New Replicas**:
   Run the migration step in an init container or pre-deployment hook:
   ```bash
   npx prisma migrate deploy
   ```
4. **Run Application**:
   ```bash
   docker run -d \
     -p 3000:3000 \
     --env-file .env.production \
     syncroom-backend:latest
   ```

### Bare Metal / Linux VM Deployment (Systemd / PM2)

1. **Install Production Dependencies**:
   ```bash
   npm ci --legacy-peer-deps
   npx prisma generate
   ```
2. **Compile Application**:
   ```bash
   npm run build
   ```
3. **Apply Database Migrations**:
   ```bash
   npx prisma migrate deploy
   ```
4. **Start Production Service via PM2**:
   ```bash
   pm2 start dist/server.js --name "syncroom" --instances max --exec-mode cluster
   ```

---

## 6. PostgreSQL Database Migration Workflow

SyncRoom utilizes Prisma ORM with PostgreSQL.

### Pre-Migration Verification Checklist
- [ ] Verify `DATABASE_URL` connects to pooled connection.
- [ ] Verify `DIRECT_URL` connects to direct instance (bypassing connection pooler transactions for DDL migrations).
- [ ] Confirm target database name and instance identity to prevent executing against wrong environment.
- [ ] Verify database user possesses DDL permissions (`CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`).

### Executing Migrations in Production
Execute ONLY the non-destructive deployment command:
```bash
npx prisma migrate deploy
```

> **STRICT PROHIBITION:**
> - **NEVER** run `prisma migrate reset` in production (this drops all tables and destroys user data).
> - **NEVER** run `prisma db push` in production (this bypasses migration tracking and can cause unmonitored schema divergence).
> - **NEVER** run development seed scripts against production databases.

### Post-Migration Verification
Execute the verification query via `psql` or database administrative console:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
```
Verify the presence of tables: `User`, `DeviceSession`, `Room`, `RoomMember`, `Track`, `ImportedPlaylist`, `QueueItem`, `PlaybackState`, `AuditLog`.

---

## 7. Spotify OAuth Production Setup

1. **Dashboard Configuration**:
   - Access [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
   - Under App Settings > **Redirect URIs**, add the exact production callback URL:
     ```
     https://api.yourdomain.com/api/spotify/callback
     ```
2. **Server Environment**:
   - Provide `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REDIRECT_URI`.
3. **Client Privacy Guarantee**:
   - `SPOTIFY_CLIENT_SECRET` remains strictly server-side.
   - Tokens are retained only in server memory/database sessions and never transmitted over public WebSocket messages or logged in plaintext.

---

## 8. Playback Provider & Licensing Policy

SyncRoom is an audio room synchronization metadata coordinator. To maintain strict compliance with content licensing and terms of service:

1. **Prohibited Activities**:
   - Downloading or caching Spotify or third-party proprietary audio.
   - Scraping Spotify web players or extracting unauthorized audio stream URLs.
   - Transcoding or re-broadcasting copyright-protected audio files.
2. **Allowed Playback Providers**:
   - **Spotify Web Playback SDK**: Authorized clients stream directly from Spotify servers using their individual user credentials (Premium accounts required per Spotify Developer Terms).
   - **Licensed Custom Audio CDN**: Pre-cleared, licensed audio files or creator-owned streams hosted on an authorized CDN.
   - **Synthesized Audio / Demonstration Source**: In unconfigured environments, the application uses Web Audio API oscillators for synchronization latency testing without asserting third-party content playback.

---

## 9. HTTPS / TLS & WSS Reverse Proxy Configuration

Production environments must enforce TLS 1.3/1.2 termination with HTTP/2 and WebSocket upgrade support.

### Nginx Reverse Proxy Configuration Example

```nginx
# HTTP to HTTPS redirect
server {
    listen 80;
    server_name syncroom.yourdomain.com api.yourdomain.com;
    return 301 https://$host$request_uri;
}

# Production API & WebSocket Server
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # REST API endpoints
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket Real-Time Endpoint
    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

## 10. CORS Policy Enforcement

SyncRoom enforces zero-trust CORS validation:
- Authenticated endpoints reject unapproved origins with HTTP 403 Forbidden.
- Permitted origins are populated strictly via `CLIENT_ORIGIN` and `ALLOWED_ORIGINS`.
- Preflight (`OPTIONS`) requests receive credentials-enabled headers only if origin matches.
- WebSocket handshakes inspect the HTTP `Origin` header during upgrade and reject unauthorized origins with HTTP 403 before socket creation.

---

## 11. Health & Readiness Monitoring

The platform provides two automated monitoring endpoints:

### Liveness Probe (`GET /health`)
- Verifies HTTP server is responding and event loop is non-blocking.
- Returns HTTP 200 OK:
  ```json
  {
    "status": "ok",
    "service": "syncroom",
    "timestamp": "2026-09-29T...",
    "uptimeSeconds": 8421,
    "activeConnections": 42
  }
  ```

### Readiness Probe (`GET /ready`)
- Evaluates real database connectivity before accepting load balancer traffic.
- If PostgreSQL is connected: returns HTTP 200 OK with `{"trafficReady": true}`.
- If PostgreSQL is unconfigured or disconnected: returns HTTP 503 Service Unavailable with `{"trafficReady": false, "reason": "DATABASE_NOT_CONFIGURED"}`.
- Use `/ready` for Kubernetes readiness probes and AWS Target Group health checks.

---

## 12. Logging, Auditing & Secret Redaction

- **JSON Structured Logging**: All server events output standard single-line JSON logs with timestamp, level, context, and message.
- **Automatic Secret Redaction**: The custom logger recursively scans all logged objects, scrubbing:
  - `token`, `sessionToken`, `sessionTokenHash`
  - `password`, `secret`, `client_secret`
  - `authorization`, `cookie`
  - Connection strings containing database passwords
- **Audit Trails**: Critical administrative actions (room creation, room ending, member removal, playlist imports) are recorded in the `AuditLog` table.

---

## 13. Backup & Disaster Recovery Strategy

### Automated PostgreSQL Backup Plan
1. **Daily Full Logical Backups (`pg_dump`)**:
   ```bash
   pg_dump -Fc --no-acl --no-owner -d "$DIRECT_URL" -f "syncroom_backup_$(date +%Y%m%d_%H%M%S).dump"
   ```
2. **Continuous Archiving & Point-In-Time Recovery (PITR)**:
   - Enable PostgreSQL Write-Ahead Logging (WAL) archiving to encrypted cloud object storage (e.g. AWS S3 with KMS or GCP Cloud Storage).
   - Retain WAL archives for at least 14 days to enable restoration to any second.
3. **Storage Encryption**: Backups must use AES-256 server-side encryption at rest.

### Database Recovery Procedure
1. Provision target clean PostgreSQL instance.
2. Verify connectivity:
   ```bash
   pg_isready -d "$RESTORE_TARGET_URL"
   ```
3. Restore database schema and data from custom-format dump:
   ```bash
   pg_restore --clean --if-exists --no-owner --no-privileges -d "$RESTORE_TARGET_URL" syncroom_backup_latest.dump
   ```
4. Verify table row counts and rerun Prisma migration check:
   ```bash
   npx prisma migrate status
   ```

---

## 14. Deployment Rollback Procedure

In the event of an unexpected release defect or service regression:

1. **Automated Rollback Trigger Criteria**:
   - Liveness probe `/health` failing for > 60 seconds.
   - Readiness probe `/ready` failing with HTTP 503.
   - Unhandled exception rate > 1% of total requests.
2. **Containerized / Kubernetes Rollback**:
   ```bash
   kubectl rollout undo deployment/syncroom-backend
   ```
3. **Static Frontend Rollback**:
   - Revert Cloudflare Pages / Vercel deployment to previous deployment ID.
   - Purge edge cache for `index.html`.
4. **Database Backward-Compatibility Invariant**:
   - All Prisma migrations must be additive (no breaking column removals in same release) to allow seamless backend rollback without immediate database restores.

---

## 15. Production Smoke-Test Protocol

Execute this smoke-test protocol on any freshly deployed production environment:

1. **Health Verification**:
   - Request `GET https://<api-domain>/health` -> expect HTTP 200 `status: "ok"`.
   - Request `GET https://<api-domain>/ready` -> expect HTTP 200 `trafficReady: true`.
2. **Room Creation (Admin Flow)**:
   - Load `https://<production-domain>/create`.
   - Create room with Name "Launch Audit" and Admin Name "Admin1".
   - Verify room code is generated and session token is stored securely in `sessionStorage`.
3. **Listener Join Flow**:
   - Open separate browser in Incognito or mobile device.
   - Navigate to `https://<production-domain>/join/<ROOM_CODE>`.
   - Enter display name "Listener1" and join.
   - Verify room member presence updates in real time on both devices.
4. **Playback & Queue Synchronization**:
   - Admin adds a track to queue.
   - Verify track appears on listener's queue within 50ms.
   - Admin triggers Play; verify `PLAYBACK_STATE` event broadcasts with synchronized start timestamp.
5. **Reconnection Resilience**:
   - Toggle airplane mode / disconnect network on Listener device for 5 seconds.
   - Reconnect network; verify WebSocket re-authenticates via `RECONNECT_SESSION` without requiring user re-entry.
6. **Room Termination**:
   - Admin clicks "End Room".
   - Verify Listener receives `ROOM_ENDED` event, playback halts, and input controls are disabled.
