<!-- refreshed: 2026-06-27 -->
# Architecture

**Analysis Date:** 2026-06-27

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                               │
├──────────────────┬──────────────────┬───────────────────────┤
│  Desktop app     │  Web (browser)   │   Chrome extension    │
│  Tauri + SolidJS │  Next.js SPA/SSR │   `apps/chrome-       │
│  `apps/desktop`  │  `apps/web`      │    extension`         │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │  records video   │  uploads / views    │
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│              WEB APP (deployable)  `apps/web`                │
│  Next.js 16 (App Router) — pages + route handlers           │
│  app/api/*  (Hono + Effect RPC)   actions/*  (server actions)│
│  Business logic delegated to `@cap/web-backend` (Effect)     │
└──────┬──────────────────┬───────────────────┬───────────────┘
       │ Drizzle/mysql2   │ AWS S3 SDK        │ webhook
       ▼                  ▼                   ▼
┌───────────────┐  ┌──────────────┐  ┌─────────────────────────┐
│  MySQL 8      │  │  S3 / MinIO  │  │  media-server           │
│ (Drizzle ORM) │  │  video blobs │  │  `apps/media-server`    │
│ `@cap/database`│ │  `packages/s3`│  │  Bun, transcode/webhook │
└───────────────┘  └──────────────┘  └─────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Web app | Public site, dashboard, share pages, API, auth | `apps/web` |
| Web backend | Effect-based domain services (Auth, S3, Videos, Storage, Workflows) | `packages/web-backend/src` |
| Web domain | Shared domain models, schemas, error types | `packages/web-domain/src` |
| Database | Drizzle schema + MySQL client + migrations | `packages/database` |
| S3 helpers | Bucket/presign helpers | `packages/s3` |
| Media server | Standalone video transcode/webhook service | `apps/media-server` |
| Desktop app | Tauri recorder client (SolidJS UI) | `apps/desktop` |
| Web cluster | Effect cluster runner (background workflow workers) | `apps/web-cluster` |
| API contract | Shared ts-rest / Effect RPC contracts | `packages/web-api-contract*` |

## Pattern Overview

**Overall:** pnpm/Turborepo monorepo; Next.js App Router web app backed by an Effect-TS service layer.

**Key Characteristics:**
- Frontend and backend co-located in `apps/web` (App Router route handlers + server actions).
- Heavy domain logic extracted to `@cap/web-backend` (Effect services) and `@cap/web-domain` (models/errors).
- Drizzle ORM over MySQL; S3-compatible object storage for media.
- Effect RPC + Hono for the API surface (`app/api/[[...route]]`, `app/api/erpc`).

## Layers

**Presentation (`apps/web/app`):**
- Route groups: `(site)` marketing/SEO, `(org)` dashboard/auth, `(docs)`, `s/` share pages, `embed/`, `admin/`.
- Server actions in `apps/web/actions/*` mutate data directly.

**API (`apps/web/app/api`):**
- `[[...route]]` and `erpc` mount Hono + Effect RPC routers.
- Namespaced handlers: `auth`, `upload`, `storage`, `video(s)`, `webhooks`, `cron`, `desktop`, `developer`.

**Domain/service (`packages/web-backend/src`):**
- Effect services: `Auth`, `Aws`, `Database`, `Storage`, `S3Buckets`, `Videos`, `Users`, `Organisations`, `Workflows`, `Tinybird`.

**Data (`packages/database`):**
- `schema.ts` Drizzle schema, `index.ts` lazy MySQL client, `migrations/` SQL, `migrate.ts` runner + backfills.

## Data Flow

### Record → Upload → View

1. Desktop/extension records, requests presigned upload (`apps/web/app/api/upload`, `storage`).
2. Blob uploaded directly to S3/MinIO (`packages/s3`, `@cap/web-backend` S3Buckets).
3. Metadata persisted to MySQL via Drizzle (`packages/database`).
4. media-server transcodes, calls back webhook (`MEDIA_SERVER_WEBHOOK_URL` → `apps/web/app/api/webhooks`).
5. Share page `apps/web/app/s/[videoId]` streams via HLS from S3/CloudFront.

**State Management:**
- Server: MySQL is source of truth; client: TanStack Query/Store.

## Key Abstractions

**Effect services:**
- Purpose: dependency-injected backend logic.
- Examples: `packages/web-backend/src/Videos`, `S3Buckets`, `Storage`.

**Drizzle DB accessor:**
- Purpose: single lazy MySQL connection (`db()`).
- Pattern: `packages/database/index.ts` — requires `DATABASE_URL` (`mysql://`).

## Entry Points

**Web server (deploy target):**
- Build: `next build --turbopack` with `output: "standalone"` when `NEXT_PUBLIC_DOCKER_BUILD=true`.
- Runtime entry: `node apps/web/server.js` (standalone), `HOSTNAME=0.0.0.0`, port `3000`.
- Instrumentation: `apps/web/instrumentation.ts` (OTel registration).

**Media server:**
- `apps/media-server` (Bun), port `3456`, `/health`.

## Architectural Constraints

- **Database:** MySQL only — `index.ts` throws if `DATABASE_URL` is not `mysql://`. NOTE: conflicts with org Postgres default; Cap upstream is MySQL/Drizzle.
- **Object storage:** S3-compatible required (AWS S3 or MinIO); path-style supported via `S3_PATH_STYLE`.
- **Encryption:** `DATABASE_ENCRYPTION_KEY` (32-byte hex) required for encrypting sensitive columns.
- **Auth:** NextAuth (`NEXTAUTH_SECRET`, `NEXTAUTH_URL`); WorkOS/Google OAuth optional.
- **Standalone build:** migrations copied to `apps/web/migrations`; run via `@cap/database` `migrate.ts`.

## Anti-Patterns

### Direct Stripe / external auth in app
**What happens:** upstream Cap embeds Stripe, WorkOS, NextAuth directly.
**Why it's wrong:** diverges from org Titanium Licensing + Postgres defaults.
**Do this instead:** keep upstream as-is for OSS parity; isolate any org integration behind a phase.

## Error Handling

**Strategy:** Effect typed errors in backend (`packages/web-domain/src/Errors.ts`); thrown/caught in route handlers and actions.

## Cross-Cutting Concerns

**Logging/Tracing:** OpenTelemetry via `@vercel/otel` (`instrumentation.ts`), optional Axiom export.
**Validation:** Zod + Effect Schema (`web-api-contract*`).
**Authentication:** NextAuth + `packages/web-backend/src/Auth.ts`.

---

*Architecture analysis: 2026-06-27*
