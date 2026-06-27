# Technology Stack

**Analysis Date:** 2026-06-27

Cap is a monorepo: a Rust + Tauri desktop recorder and a Next.js web app. Managed by **pnpm workspaces** + **Turborepo** (JS) and a **Cargo workspace** (Rust).

## Languages

**Primary:**
- TypeScript ^5.8.3 - web app, packages, desktop UI, Chrome extension (`apps/web`, `packages/*`)
- Rust - desktop app, CLI, media crates (`apps/desktop/src-tauri`, `apps/cli`, `crates/*`)

**Secondary:**
- SolidJS/TSX - alternative UI package (`packages/ui-solid`)
- SQL - Drizzle migrations (`packages/database/migrations`)

## Runtime

**Environment:**
- Node.js >=20 (engines enforced root + `apps/web`)
- Rust (stable) via Cargo workspace, `resolver = "2"` (`Cargo.toml`)

**Package Manager:**
- pnpm@10.5.2 (root `packageManager`)
- Lockfile: `pnpm-lock.yaml` present
- Cargo: `Cargo.lock` for Rust workspace

**Workspace globs** (`pnpm-workspace.yaml`): `apps/*`, `packages/*`, `crates/tauri-plugin-*`, `infra`, `scripts/orgIdBackfill`

## Frameworks

**Web (deployable app `apps/web`, `@cap/web` v0.3.1):**
- Next.js 16.2.1 (App Router, `--turbopack` build) - React 19.2.4
- Hono ^4.7.1 + `@ts-rest/core` ^3.52.1 - API route contracts
- Effect ^3.18.4 ecosystem - `@effect/platform`, `@effect/rpc`, `@effect/cluster`, `@effect/sql-mysql2`, `@effect/workflow` (functional core / backend services)
- TanStack Query/Store ^5.x - client state
- Tailwind CSS ^3 + Radix UI + Headless UI + framer-motion/motion - UI
- next-auth ^4.24.5 - session/auth

**Desktop (`apps/desktop`):**
- Tauri 2.5.0 (`tauri.conf.json`, `src-tauri`), specta =2.0.0-rc.20 for TS bindings
- wgpu 25.0.0, ffmpeg-next (custom fork), cpal/nokhwa (custom forks) for capture/encode

**Testing:**
- Vitest ^3.2.0 - web tests (`apps/web` `test`/`test:coverage`/`test:ui`)
- `cap-test` Rust harness - desktop matrix/synthetic/benchmark suites (root `test:*` scripts)

**Build/Dev:**
- Turborepo ^2.3.4 - task orchestration (`turbo.json`)
- Biome 2.2.0 - lint + format (`format`, `lint` scripts; replaces ESLint at root)
- tsdown ^0.15.6 / tsup-style builds for packages
- dotenv-cli - injects root `.env` into tasks

## Key Dependencies

**Database / ORM:**
- drizzle-orm 0.44.6 + drizzle-kit 0.31.0 - **MySQL dialect** (`packages/database`)
- mysql2 ^3.15.2 - driver (`drizzle/mysql2`)
- @planetscale/database ^1.19.0 + @mattrax/mysql-planetscale - PlanetScale serverless adapter support

**Storage / Media:**
- @aws-sdk/client-s3 + s3-presigned-post + s3-request-presigner - S3/S3-compatible storage
- @aws-sdk/client-cloudfront + cloudfront-signer - CDN signing
- @aws-sdk/client-mediaconvert, @mux/mux-node - video processing
- ffmpeg-static, @remotion/webcodecs, mediabunny, hls.js - media handling

**Auth / Identity:**
- next-auth ^4.24.5, @workos-inc/node ^7.34.0 (enterprise SSO), Google OAuth

**AI / Transcription:**
- @deepgram/sdk, groq-sdk, replicate, supermemory, ANTHROPIC/OPENAI (via env)

**Payments / Analytics:**
- @stripe/stripe-js, Stripe (server), posthog-js/node, Tinybird, dub

**Email:** resend 4.6.0, @react-email/*, nodemailer (db package)

## Configuration

**Environment:**
- Centralized via `@cap/env` (`packages/env/server.ts`) using `@t3-oss/env-nextjs` + Zod validation
- Root `.env` consumed through `dotenv -e .env`; see INTEGRATIONS.md for full required set
- Coolify self-host: `docker-compose.coolify.yml` + `docker-compose.coolify.env.example`

**Build:**
- `turbo.json` (pipeline), `apps/web/next.config.*`, `packages/database/drizzle.config.ts`
- TS configs shared via `packages/tsconfig`

## Platform Requirements

**Development:**
- Node >=20, pnpm 10.5.2, Rust toolchain (desktop only), Docker (local MySQL/MinIO via `docker:up`)

**Production (web):**
- Docker image `ghcr.io/capsoftware/cap-web:latest`, port 3000
- Companion `cap-media-server` image (FFmpeg processing, port 3456)
- MySQL 8.0 + S3-compatible store (MinIO/AWS)
- Originally Vercel-targeted (many `VERCEL_*` env vars); self-host via Coolify supported

---

*Stack analysis: 2026-06-27*
