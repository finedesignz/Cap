# External Integrations

**Analysis Date:** 2026-06-27

Scope: the **deployable web app** `apps/web` (`@cap/web`). Authoritative env schema: `packages/env/server.ts` (`@t3-oss/env-nextjs` + Zod). Self-host reference: `docker-compose.coolify.yml`, `docker-compose.coolify.env.example`.

> **Deployable unit:** `apps/web` builds to Docker image `ghcr.io/capsoftware/cap-web:latest`, listens on **port 3000**. Build: `next build --turbopack` (`build:web`); start: `next start`. Companion services: `media-server` (FFmpeg, port 3456), MySQL 8, S3/MinIO. Other `apps/` (`desktop`, `cli`, `chrome-extension`, `discord-bot`, `media-server`, `web-cluster`) are NOT the web deployable.

## Data Storage

**Database — MySQL (NOT Postgres):**
- Engine: **MySQL 8.0** (`docker-compose.coolify.yml` `mysql:8.0`)
- ORM: Drizzle (`drizzle-orm/mysql2`), dialect `mysql`, snake_case casing (`packages/database/drizzle.config.ts`, `index.ts`)
- Connection: `DATABASE_URL` — **must** be a `mysql://` URI (hard-asserted in `index.ts` and `drizzle.config.ts`; the fetch/PlanetScale-HTTP adapter is rejected for migrations)
- Coolify form: `mysql://cap:${MYSQL_PASSWORD}@mysql:3306/cap`
- Migrations: `packages/database/migrations`; apply via `pnpm db:push` / `db:generate` / `migrate.ts`
- Optional PlanetScale serverless support present (`@planetscale/database`, `@mattrax/mysql-planetscale`) but self-host uses a plain MySQL container

**Object storage — S3-compatible (MinIO for self-host):**
- Client: AWS SDK v3 (`@aws-sdk/client-s3`, presigned-post, request-presigner)
- Bucket env: `CAP_AWS_BUCKET` (required), `CAP_AWS_REGION` (required)
- Credentials: `CAP_AWS_ACCESS_KEY`, `CAP_AWS_SECRET_KEY` (optional — fall back to instance role)
- Endpoints: `S3_PUBLIC_ENDPOINT` (browser-facing, used for playback), `S3_INTERNAL_ENDPOINT` (in-cluster, e.g. `http://minio:9000`)
- `S3_PATH_STYLE` (default true) — needed for MinIO/non-AWS
- Self-host: MinIO container + `minio-setup` job that creates the bucket (`S3_BUCKET`, default `cap`)

**CDN (optional, Cap Cloud):**
- CloudFront: `CAP_AWS_BUCKET_URL`, `CAP_CLOUDFRONT_DISTRIBUTION_ID`, `CLOUDFRONT_KEYPAIR_ID`, `CLOUDFRONT_KEYPAIR_PRIVATE_KEY`

**Caching:** None dedicated (Effect cluster handles workflow state).

## Authentication & Identity

- **next-auth ^4.24.5** — sessions; `NEXTAUTH_SECRET` (32-byte) + `NEXTAUTH_URL` (= `WEB_URL`) required
- **Google OAuth** (optional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **WorkOS** enterprise SSO (optional): `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`
- Signup gating: `CAP_ALLOWED_SIGNUP_DOMAINS`, `CAP_CHROME_EXTENSION_ID`
- Encryption: `DATABASE_ENCRYPTION_KEY` (32-byte hex) encrypts stored secrets like AWS keys

## External Services (APIs)

**Email:** Resend (`RESEND_API_KEY`, `RESEND_FROM_DOMAIN`) — optional; without it, login links print to container logs.

**AI / transcription (all optional):**
- Deepgram `DEEPGRAM_API_KEY` (transcription)
- Groq `GROQ_API_KEY` (preferred summaries), OpenAI `OPENAI_API_KEY` (fallback)
- Anthropic `ANTHROPIC_API_KEY` (chat), Replicate `REPLICATE_API_TOKEN` (audio enhance)
- Supermemory `SUPERMEMORY_API_KEY`, `SUPERMEMORY_KNOWLEDGE_TAG`

**Media processing:** companion media-server — `MEDIA_SERVER_URL`, `MEDIA_SERVER_WEBHOOK_SECRET`, `MEDIA_SERVER_WEBHOOK_URL`. Also Mux (`@mux/mux-node`), AWS MediaConvert for cloud transcode.

**Payments (Cap Cloud only):** Stripe — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

**Analytics (optional):** PostHog (`POSTHOG_PERSONAL_API_KEY`), Tinybird (`TINYBIRD_HOST`, `TINYBIRD_TOKEN`), Dub (`DUB_API_KEY`).

## Monitoring & Observability

- OpenTelemetry: `@vercel/otel`, `@effect/opentelemetry`, `@kubiks/otel-drizzle` (DB span instrumentation). Local collector via `pnpm lgtm-otel` (Grafana otel-lgtm).
- Discord webhooks (Cap Cloud): `DISCORD_FEEDBACK_WEBHOOK_URL`, `DISCORD_LOGS_WEBHOOK_URL`.

## CI/CD & Deployment

**Hosting:**
- Cap Cloud: Vercel (extensive `VERCEL_*` env: `VERCEL_ENV`, `VERCEL_PROJECT_ID`, `VERCEL_AWS_ROLE_ARN`, etc.)
- Self-host: **Coolify / Docker Compose** (`docker-compose.coolify.yml`) — cap-web + media-server + mysql + minio + minio-setup on one bridge network.

**Images:** `ghcr.io/capsoftware/cap-web`, `ghcr.io/capsoftware/cap-media-server`. Web Dockerfile build via `pnpm build:web:docker`.

## Environment Configuration

**Required for web (Coolify self-host):**
- `WEB_URL` (public URL), `NEXTAUTH_URL` (= WEB_URL), `NEXTAUTH_SECRET`
- `DATABASE_URL` (`mysql://…`) — or `MYSQL_PASSWORD`/`MYSQL_ROOT_PASSWORD` when using the bundled MySQL
- `DATABASE_ENCRYPTION_KEY` (32-byte hex)
- `CAP_AWS_BUCKET`, `CAP_AWS_REGION`, `CAP_AWS_ACCESS_KEY`, `CAP_AWS_SECRET_KEY`, `S3_PUBLIC_ENDPOINT`, `S3_INTERNAL_ENDPOINT`, `S3_PATH_STYLE` (MinIO creds: `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `S3_BUCKET`)
- `MEDIA_SERVER_URL`, `MEDIA_SERVER_WEBHOOK_SECRET`, `MEDIA_SERVER_WEBHOOK_URL`
- `NODE_ENV`

**Optional:** Resend, Google/WorkOS auth, all AI keys, Stripe, analytics, CloudFront, Discord, `CAP_VIDEOS_DEFAULT_PUBLIC`, `CAP_ALLOWED_SIGNUP_DOMAINS`, `WORKFLOWS_RPC_URL`/`WORKFLOWS_RPC_SECRET`.

**Secrets location:** Coolify env vars → `docker-compose.coolify.yml` interpolation. Local dev: root `.env` (gitignored). Template: `docker-compose.coolify.env.example`. Never committed.

## Webhooks & Callbacks

**Incoming:** Stripe webhook (`STRIPE_WEBHOOK_SECRET`); media-server processing callbacks authenticated by `MEDIA_SERVER_WEBHOOK_SECRET` to `MEDIA_SERVER_WEBHOOK_URL` (→ `http://cap-web:3000`).
**Outgoing:** Discord feedback/logs webhooks (Cap Cloud); calls out to media-server, Resend, Stripe, AI providers.

## Coolify Deployment Notes

- 5-service compose: `cap-web` (3000, depends on healthy mysql+minio), `media-server` (3456), `mysql` (8.0, persistent `cap-mysql-data`), `minio` (9000/9001 console, persistent `cap-minio-data`), `minio-setup` (one-shot bucket create).
- Health checks: cap-web `GET /` on 3000; media-server `GET /health` on 3456 — use `/health` for media-server gate, but cap-web has no `/health`, gate on `/`.
- `S3_PUBLIC_ENDPOINT` must be internet-reachable (video playback served from it); `S3_INTERNAL_ENDPOINT` stays on the cluster network for cheaper upload traffic.
- DB is MySQL — do not provision Postgres for this app.

---

*Integration audit: 2026-06-27*
