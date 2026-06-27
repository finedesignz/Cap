# Codebase Concerns

**Analysis Date:** 2026-06-27

**Scope:** Risks/blockers for deploying the **web app** (`apps/web`, `@cap/web`) to Coolify via auto-detect / Nixpacks. Cap is a Tauri + Next.js pnpm/turbo monorepo (open-source Loom alternative). Verdict up front: **a clean Nixpacks auto-detect deploy is very unlikely to work.** The project is explicitly designed to ship as a prebuilt multi-service Docker Compose stack. Use `docker-compose.coolify.yml`, not Nixpacks.

---

## Tech Debt / Deployment Blockers

### 1. Standalone output AND migrations are gated behind `NEXT_PUBLIC_DOCKER_BUILD=true` — Nixpacks won't set it

This is the single biggest blocker. Two critical behaviors only activate when the build-time env `NEXT_PUBLIC_DOCKER_BUILD === "true"`:

- **Standalone output:** `apps/web/next.config.mjs:142-143`
  ```js
  output: process.env.NEXT_PUBLIC_DOCKER_BUILD === "true" ? "standalone" : undefined,
  ```
  The runtime image / `CMD` expects `apps/web/.next/standalone/.../server.js`. Without standalone, `node apps/web/server.js` does not exist. Nixpacks' default `next start` would also work, BUT then migrations never run (see below).

- **DB migrations on boot:** `apps/web/instrumentation.node.ts:84-99` (`runMigrations`) calls `migrateDb()` ONLY if `buildEnv.NEXT_PUBLIC_DOCKER_BUILD === "true"`. A Nixpacks build leaves this unset, so the app boots against an **empty/unmigrated MySQL schema** and breaks at runtime with no obvious error.

Nixpacks auto-detect will not know to inject `NEXT_PUBLIC_DOCKER_BUILD=true` at build time. Files: `apps/web/next.config.mjs`, `apps/web/instrumentation.node.ts`, `packages/env/build.ts:21`.

### 2. Migrations folder path assumes the Docker layout (`cwd()/migrations`)

`packages/database/migrate.ts:11` runs:
```js
migrate(db(), { migrationsFolder: path.join(process.cwd(), "/migrations") })
```
The Dockerfile explicitly copies `packages/database/migrations` to `apps/web/migrations` (`apps/web/Dockerfile:35`) so that, with `cwd=/app/apps/web`, the path resolves. A Nixpacks build does NOT perform this copy — `cwd/migrations` will not exist, so even if migrations were triggered they would find no SQL files (36 migration files live in `packages/database/migrations/`).

### 3. Monorepo build complexity — turbo + pnpm workspace + many internal packages

`apps/web` depends on 9+ `workspace:*` packages (`@cap/database`, `@cap/env`, `@cap/web-backend`, `@cap/web-domain`, `@cap/web-api-contract`, `@cap/web-api-contract-effect`, `@cap/recorder-core`, `@cap/ui`, `@cap/utils`) — see `apps/web/package.json`. These are consumed as TS source and `transpilePackages` in `next.config.mjs`. A correct build requires:
- `pnpm i --frozen-lockfile` at the **repo root** (lockfile is `pnpm-lock.yaml`; there is also a `bun.lock` — mixed signals that can confuse auto-detect).
- Building from the monorepo root with workspace context, not from `apps/web` alone.

Nixpacks' Node provider tends to detect a single app and run `npm/pnpm build` in a way that frequently mishandles pnpm workspaces + turbo. The official path is the root `Dockerfile` (`apps/web/Dockerfile`) which does `COPY . .` then `pnpm run build:web`.

### 4. Heavy/native build dependencies

- `ffmpeg-static` (`apps/web/package.json:98`) — downloads a platform binary; `next.config.mjs` lists it in `serverExternalPackages` and `outputFileTracingIncludes`. Must survive into the runtime image.
- Large dependency surface: AWS SDK (multiple clients), Effect platform/cluster/sql-mysql2/rpc, Remotion (`@remotion/webcodecs`, `@remotion/media-parser`), OpenTelemetry stack, Mux, Deepgram. Build is slow and memory-hungry; constrained Coolify build hosts may OOM.
- Build uses Next 15 + **Turbopack** (`next build --turbopack`) — newer/less battle-tested in containerized CI.

---

## Hard External-Service Dependencies (boot/runtime fails without them)

`packages/env/server.ts` validates server env via `@t3-oss/env-nextjs` (Zod). **Non-optional fields throw at runtime if missing**, killing boot:

| Env var | Required? | Source |
|---------|-----------|--------|
| `DATABASE_URL` | **required** (no `.optional()`) | `server.ts:17` |
| `WEB_URL` | **required** | `server.ts:18` |
| `NEXTAUTH_SECRET` | **required** | `server.ts:21` |
| `NEXTAUTH_URL` | **required** | `server.ts:22` |
| `CAP_AWS_BUCKET` | **required** | `server.ts:36` |
| `CAP_AWS_REGION` | **required** | `server.ts:37` |
| `NEXT_PUBLIC_WEB_URL` | **required at BUILD time** | `packages/env/build.ts` |
| `DATABASE_ENCRYPTION_KEY` | optional in schema, but required in practice for encrypting AWS keys | `server.ts:23` |

Generate secrets with `openssl rand -hex 32` (per `docker-compose.coolify.env.example`).

### Database — MySQL, NOT Postgres
- Cap is hard-wired to **MySQL 8** (`@effect/sql-mysql2`, `mysql2`, `@planetscale/database`, `@mattrax/mysql-planetscale` in `packages/database/package.json`; Drizzle dialect = mysql). `DATABASE_URL` format is `mysql://...` (`docker-compose.coolify.yml:15`).
- **Conflicts with the standard Coolify "Postgres per app" default** — you must provision a MySQL service (the compose file ships `mysql:8.0` with `utf8mb4` + `--default-authentication-plugin=mysql_native_password`). Postgres is not an option without a rewrite.

### Object storage — S3/MinIO required
- App requires an S3-compatible store (`CAP_AWS_BUCKET`/`REGION` required; `CAP_AWS_ACCESS_KEY`/`SECRET_KEY`, `S3_PUBLIC_ENDPOINT`, `S3_INTERNAL_ENDPOINT`, `S3_PATH_STYLE`). Compose ships `minio` + a `minio-setup` job that creates the bucket.
- **Bucket auto-creation only happens in the Docker-build path:** `instrumentation.node.ts:43-86` (`createS3Bucket`) runs via the same `register()` hook. The public-read bucket policy is set there too. A Nixpacks deploy without the companion MinIO + setup container has no bucket and no public read policy → video playback broken.
- `S3_PUBLIC_ENDPOINT` must be **internet-reachable** for video playback (per env example comment).

### Media server — separate service, hard dependency for processing
- `cap-media-server` (`ghcr.io/capsoftware/cap-media-server:latest`) is a distinct container doing FFmpeg processing, wired via `MEDIA_SERVER_URL`, `MEDIA_SERVER_WEBHOOK_SECRET`, `MEDIA_SERVER_WEBHOOK_URL` (`docker-compose.coolify.yml:30-46`). Nixpacks deploys only the web app — media features will be dead.

### Email — degraded-but-functional without it
- `RESEND_API_KEY` / `RESEND_FROM_DOMAIN` are optional. Without them, **login magic links are printed to container logs** instead of emailed (env example comment). Usable for testing, unacceptable for real users.

### Auth providers — optional
- `GOOGLE_CLIENT_ID/SECRET`, `WORKOS_*` optional. Email-link auth (NextAuth) works without OAuth, but depends on email (above).

---

## Architectural Footguns

### Serverless-hostile boot hook
`apps/web/instrumentation.node.ts:1-3` carries an explicit warning: running migrations here is *"DEADLY for serverless environments where the server will be restarted on each request."* Coolify long-running container = fine; any serverless/scale-to-zero target = data-corruption risk. Migrations also `process.exit(1)` after 3 failed attempts (`instrumentation.node.ts:30`), so a transient DB-not-ready will crash the container (compose mitigates with `depends_on ... service_healthy`).

### Build-time domain baking
`NEXT_PUBLIC_WEB_URL` (from `WEB_URL`) is inlined at build time (`packages/env/build.ts`). Changing the public domain requires a **full rebuild**, not just an env change. Plan the final domain before building.

### Mixed lockfiles
Both `pnpm-lock.yaml` and `bun.lock` exist at root. Auto-detect tools may pick the wrong package manager. Force pnpm.

### TypeScript errors ignored at build
`next.config.mjs`: `typescript.ignoreBuildErrors: true`. Build won't fail on type errors — masks real breakage; don't rely on a green build meaning a healthy app.

---

## Licensing

- **AGPLv3** for everything except the `cap-camera*` / `scap-*` crates (MIT). See `LICENSE` (root) and `licenses/LICENSE-MIT`. AGPL is a **network copyleft** license: if you host a modified version of the web app for users over a network, you must offer the corresponding source. Self-hosting unmodified is fine; forking/modifying for a public service triggers source-disclosure obligations. Relevant if this is deployed as a customer-facing product.

---

## Recommended Path (not a concern, but the mitigation)

Do **not** use Nixpacks auto-detect. Use the maintained, prebuilt multi-service stack:
- `docker-compose.coolify.yml` (web + media-server + mysql + minio + minio-setup), images pulled from `ghcr.io/capsoftware/*:latest` — no in-Coolify build needed.
- `docker-compose.coolify.env.example` enumerates the required secrets.
- If you must build from source, build the **root `Dockerfile`** (`apps/web/Dockerfile`) with build arg `NEXT_PUBLIC_DOCKER_BUILD=true` and context = repo root; it handles standalone output, the migrations-folder copy, and boot-time migration.

---

*Concerns audit: 2026-06-27*
