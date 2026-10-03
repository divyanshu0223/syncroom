# SyncRoom — Database Architecture & Administration Guide (PostgreSQL & Prisma)

This document provides a comprehensive operational guide for the PostgreSQL database persistence layer in SyncRoom, built using Prisma ORM.

---

## 1. PostgreSQL Requirement

SyncRoom relies on a real PostgreSQL database (v14+ recommended, v15/v16 fully supported) for all authoritative persistent storage:
- **Zero Mock / In-Memory Fallback in Production:** The application does not generate fake users, fake rooms, or ephemeral mock rooms when the database is unavailable. If the database is missing or unreachable, the server returns an explicit `DATABASE_NOT_CONFIGURED` status code and a clear error notification.
- **Connection Health Checks:** The `/ready` probe evaluates live PostgreSQL reachability (`SELECT 1`). If the database cannot be queried, the server responds with HTTP `503 Service Unavailable`.
- **Authoritative Source of Truth:** Room states, user device sessions, track metadata, queues, room memberships, and playback versions are strictly persisted to PostgreSQL tables.

---

## 2. Environment Variables & Connection Configuration

SyncRoom supports standard decoupled database connections for connection-pooled cloud environments (e.g., Supabase, Neon, AWS RDS with PgBouncer, Crunchy Bridge):

| Variable | Scope | Purpose | Example Format |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Server Runtime | Pooled PostgreSQL connection string for application runtime queries. | `postgresql://<user>:<password>@<pooler-host>:6543/<db>?pgbouncer=true&sslmode=require` |
| `DIRECT_URL` | Migrations / Admin | Direct PostgreSQL connection string for Prisma schema migrations and administrative operations. | `postgresql://<user>:<password>@<direct-host>:5432/<db>?sslmode=require` |

### Security & Isolation Rules
- **Server-Side Only:** `DATABASE_URL` and `DIRECT_URL` must **never** be prefixed with `VITE_` or exposed to frontend client code.
- **No Credentials in Logs:** Database error handlers sanitize connection strings and prevent credential leakage in application log streams.
- **Hashed Session Tokens:** Device session tokens are hashed with SHA-256 before being persisted to PostgreSQL (`tokenHash` column). Raw session tokens are never stored in plaintext.

---

## 3. Prisma Schema & Models

The schema is defined in [`prisma/schema.prisma`](file:///prisma/schema.prisma) and maps 9 core models:

1. **`User`**: Authoritative identity record (ID, display name, created/updated timestamps).
2. **`DeviceSession`**: Persistent device session for multi-device support, browser refreshes, and network reconnection. Stores SHA-256 `tokenHash`, `tokenPrefix`, `device` metadata, `lastActivity`, `expiresAt`, and revocation status (`isRevoked`).
3. **`Room`**: Core room entity (unique 6-character room code, room name, admin relation, `isActive` status, created/updated timestamps).
4. **`RoomMember`**: Membership registry linking users to rooms with roles (`admin`, `listener`), membership status (`active`, `left`, `removed`), joined timestamp, and presence metadata (`device`, `driftMs`, `lastSeen`).
5. **`Track`**: Normalized track metadata catalog (provider, provider track ID, title, artist, album, artwork URL, duration). **Zero unauthorized audio files or downloaded streams are stored.**
6. **`ImportedPlaylist`**: External playlist metadata tracking provider playlist ID, name, owner, and track relationships.
7. **`QueueItem`**: Ordered playback queue per room with deterministic 0-indexed integer `position`, track relation, added-by user, and timestamp.
8. **`PlaybackState`**: Authoritative synchronization state (current track, `isPlaying` boolean, playback position in seconds, server timestamp, monotonic integer `version` for optimistic concurrency, and queue relationship).
9. **`AuditLog`**: Append-only activity log tracking room creation, participant joins/removals, playback changes, queue updates, and settings changes.

---

## 4. Prisma Setup & Client Generation

Prisma is configured with the standard Node-API engine.

To generate the Prisma Client after cloning or changing the schema:
```bash
npm run prisma:generate
```
This writes the strongly typed client to `node_modules/@prisma/client`.

---

## 5. Migration Workflow

SyncRoom uses declarative SQL migrations tracked under `prisma/migrations/`.

### Development Migration Workflow
When developing locally and updating `prisma/schema.prisma`:
```bash
# Creates a new migration with an explicit name and applies it to the local database
npm run prisma:migrate:dev -- --name <migration_name>
```

### Production Migration Workflow
In production (CI/CD pipelines, container startup, or deployment hooks):
```bash
# Applies all pending migrations safely without schema drifting or table resets
npm run prisma:migrate
# (Runs: npx prisma migrate deploy)
```

> [!CAUTION]
> **Production Safety Warnings:**
> - **NEVER** run `prisma migrate reset` in a production or staging environment. This drops all tables and erases persistent data.
> - **NEVER** run destructive schema pushes (`prisma db push --force-reset`) against live production databases.
> - Migrations should be executed prior to or during zero-downtime rolling container releases.

---

## 6. Local Development Setup

To run a local PostgreSQL instance for development using Docker:

```bash
docker run --name syncroom-postgres \
  -e POSTGRES_USER=syncroom \
  -e POSTGRES_PASSWORD=syncroom_local_password \
  -e POSTGRES_DB=syncroom \
  -p 5432:5432 \
  -d postgres:16-alpine
```

Then create a `.env` file in the project root:
```env
DATABASE_URL="postgresql://syncroom:syncroom_local_password@localhost:5432/syncroom?schema=public"
DIRECT_URL="postgresql://syncroom:syncroom_local_password@localhost:5432/syncroom?schema=public"
```

Apply migrations and generate the client:
```bash
npm run prisma:migrate:dev -- --name init_local
npm run prisma:generate
```

---

## 7. Room Restart & Session Recovery Architecture

When the SyncRoom Node.js process boots:
1. `RoomManager.initializeFromDatabase()` queries all active rooms from PostgreSQL (`Room.isActive = true`).
2. Active rooms, current tracks, queue items, and authoritative playback states are reconstituted in-memory.
3. Returning clients reconnecting via WebSocket present their stored `sessionToken`.
4. The server validates the token against the PostgreSQL `DeviceSession` table (`tokenHash`, `isRevoked = false`, `expiresAt > NOW()`).
5. Member role, room status, and authoritative room state are restored without forcing the user through the initial join flow.
6. The client is immediately synchronized to the authoritative server clock and playback position.

---

## 8. Backup Considerations & Disaster Recovery

For production deployments:
1. **Automated Point-in-Time Recovery (PITR):** Enable WAL archiving and automated daily snapshots on your managed database provider (e.g., AWS RDS, Supabase, Neon, Crunchy Bridge).
2. **Logical Backups:** Execute regular `pg_dump` jobs for portable, cross-version archives:
   ```bash
   pg_dump -Fc --no-acl --no-owner "$DIRECT_URL" > syncroom_backup_$(date +%Y%m%d_%H%M%S).dump
   ```
3. **Zero Audio Data Storage:** Because SyncRoom only stores metadata (provider track IDs, titles, timestamps), database backups remain lightweight (megabytes rather than gigabytes).

---

## 9. Common Connection Errors & Troubleshooting

### `DATABASE_NOT_CONFIGURED`
- **Symptom:** WebSocket requests fail with `DATABASE_NOT_CONFIGURED`, and `/ready` returns HTTP 503.
- **Cause:** Neither `DATABASE_URL` nor `DIRECT_URL` is defined in the server environment.
- **Resolution:** Configure `DATABASE_URL` in your hosting platform (Railway, Render, Fly.io, ECS, Kubernetes secret) or `.env`.

### `P1001: Can't reach database server at <host>:<port>`
- **Cause:** The database host is unreachable due to network firewalls, incorrect hostname/port, or the database container is stopped.
- **Resolution:** Verify security groups, network routing, and ensure the PostgreSQL service is running and listening on port 5432/6543.

### `P1000: Authentication failed against database server`
- **Cause:** Incorrect username or password in `DATABASE_URL`.
- **Resolution:** Verify credentials. Ensure special characters in passwords (e.g., `#`, `@`, `%`) are properly URL-encoded.

### `P1017: Server has closed the connection` (PgBouncer connection pool exhaustion)
- **Cause:** High connection count with transaction pooling enabled.
- **Resolution:** Ensure `DATABASE_URL` includes `?pgbouncer=true` if using PgBouncer, and use `DIRECT_URL` for migration scripts.

---

## 10. Verification Commands

| Command | Description |
| :--- | :--- |
| `npm run lint` | Verifies TypeScript types across Prisma models and services. |
| `npm run build` | Compiles Vite frontend and bundles Node.js backend. |
| `npm run prisma:generate` | Regenerates Prisma Client types. |
| `npm run prisma:migrate` | Deploys pending SQL migrations in production. |
