# Testing Patterns

**Analysis Date:** 2026-06-27

Two test worlds in this monorepo: **Vitest** for TS/JS apps and **Rust `cargo test` + a dedicated `cap-test` harness crate** for native media/recording code. Playwright for chrome-extension e2e.

## Test Frameworks

**TS/JS — Vitest:**
- Per-app `vitest.config.ts`: `apps/web/vitest.config.ts`, `apps/desktop/vitest.config.ts`, `apps/discord-bot/vitest.config.mts`, `packages/recorder-core/vitest.config.ts`. (`apps/media-server` runs vitest without a dedicated config file.)
- apps/web: `environment: "node"`, `globals: true`, `setupFiles: ["./__tests__/setup.ts"]`, `testTimeout: 30000`, coverage provider `v8` (text/json/html), include `lib/**`, `workflows/**`, `actions/**`.
- apps/desktop: uses Vitest **in-source testing** (`includeSource: ["src/**/*.{js,ts,jsx,tsx}"]`).

**Rust — cargo test + `cap-test` crate (`crates/cap-test`):**
- Custom harness exposing `discover`, `matrix`, `synthetic`, `benchmark`, and `suite` (recording / encoding / playback / sync) subcommands via `cargo run -p cap-test`.

**E2E — Playwright (chrome-extension):**
- `apps/chrome-extension/e2e/*.spec.ts` (overlay-ui, recording-upload, webcam-start).

## Run Commands

```bash
pnpm test                       # turbo run test (all workspaces)
pnpm test:web                   # vitest run in apps/web
pnpm --filter=@cap/web test     # same
cargo test -p <crate>           # Rust per-crate

# cap-test harness (Rust media/recording matrix)
pnpm test:discover              # cargo run -p cap-test -- discover
pnpm test:matrix                # full matrix
pnpm test:matrix:quick          # --quick
pnpm test:matrix:exhaustive     # --exhaustive
pnpm test:synthetic
pnpm test:benchmark
pnpm test:suite:recording       # also :encoding :playback :sync

# desktop memory tests
pnpm test:desktop:memory
pnpm test:desktop:memory:unit
```

apps/web also exposes `test:watch`, `test:coverage`, `test:ui`. Turbo `test` task: `cache: false`, inputs `**/*.ts(x)`.

## Test File Organization

- **apps/web:** central `apps/web/__tests__/` split into `unit/` (many, e.g. `developer-key-hash.test.ts`, `caption-cues.test.ts`) and `integration/` (e.g. `transcribe.test.ts`). Shared `__tests__/setup.ts`.
- **apps/media-server:** `src/__tests__/` with `lib/`, `routes/` subdirs; integration tests suffixed `*.integration.test.ts`.
- **apps/desktop / chrome-extension:** co-located `*.test.ts` next to source (e.g. `src/utils/hex-color.test.ts`, `src/shared/storage.test.ts`).
- **Rust:** tests in `src` (in-module `#[cfg(test)]`) or per-crate `tests/`.
- Naming: `*.test.ts(x)`; e2e `*.spec.ts`.

## Test Structure (apps/web, representative)

```typescript
import { describe, expect, it, vi } from "vitest";
import { hashKey } from "@/lib/developer-key-hash";

vi.mock("@cap/env", () => ({
	serverEnv: () => ({ NEXTAUTH_SECRET: "test-hmac-secret-for-unit-tests" }),
}));

describe("hashKey", () => {
	it("is deterministic - same key always produces same hash", async () => {
		const first = await hashKey("deterministic-test");
		const second = await hashKey("deterministic-test");
		expect(first).toBe(second);
	});
});
```

## Mocking

- Vitest `vi.mock(...)` for workspace deps — commonly mock `@cap/env` (`serverEnv`) to inject test secrets, avoiding real env coupling. Uses `@/...` path aliases configured in vitest config.

## Coverage

- No strict coverage gate enforced (`AGENTS.md`: "no strict coverage yet"). apps/web has `test:coverage` (v8) available but not required.
- Guidance: prefer unit tests for logic, light smoke tests for flows.

## CI Workflows (`.github/workflows/`)

| Workflow | Triggers | Purpose |
|----------|----------|---------|
| `ci.yml` | push main, PR, dispatch | Main gate: Typecheck, Format (Biome `biome ci . --linter-enabled=false`), Format (Cargo `cargo fmt --check`), Clippy (mac+win matrix, gated by `paths-filter` on rust changes), Lint (Biome, non-blocking `|| true`), Build Desktop (mac+win), Verify Tauri plugin versions, main-branch Rust cache build. Uses `dorny/paths-filter` to skip rust/desktop jobs when unchanged. |
| `test-self-hosting.yml` | push/PR on docker-compose, media-server, web Dockerfile | **Coolify-relevant.** Spins full `docker compose up -d`, waits for mysql/minio/media-server/cap-web healthchecks, asserts web responds (200/307), login page renders, media-server `/health` returns `{"status":"ok"}`, DB has tables, MinIO bucket created. |
| `publish.yml` | release | Desktop app publish (largest, 23KB). |
| `publish-chrome-extension.yml` | — | Chrome extension publish. |
| `docker-build-web.yml` | — | Builds + pushes `ghcr.io/capsoftware/cap-web` image. |
| `docker-build-media-server.yml` | — | Builds + pushes `ghcr.io/capsoftware/cap-media-server` image. |
| `performance-regressions.yml` | — | Perf benchmarks (`performance-results.json`). |
| `validate-migration-journal.yml` | — | Validates Drizzle migration journal integrity. |
| `opencode.yml` | — | OpenCode integration. |

CI uses composite actions in `.github/actions/`: `setup-js`, `setup-rust-cache`. Concurrency cancels in-progress per branch. Rust toolchain pinned `dtolnay/rust-toolchain@1.88.0`; Biome pinned 2.2.0 (must match `biome.json` schema version).

## Deploy / Container Configs (CRITICAL for Coolify)

These exist at repo root and `apps/*` — note for self-host/Coolify deployment:

| File | Role |
|------|------|
| `docker-compose.yml` | Default self-hosting stack (cap-web, media-server, mysql, minio, minio-setup). Container names `cap-*`. |
| `docker-compose.coolify.yml` | **Coolify-targeted compose.** Pulls prebuilt images `ghcr.io/capsoftware/cap-web:latest` + `cap-media-server:latest`. MySQL 8.0, MinIO, env-driven (`DATABASE_URL`, `NEXTAUTH_SECRET`, `DATABASE_ENCRYPTION_KEY`, `CAP_AWS_*`, `S3_*`, `RESEND_*`, `MEDIA_SERVER_*`). Healthchecks on all services. Single `cap-network` bridge, volumes `cap-mysql-data`/`cap-minio-data`. cap-web exposes `3000`, media-server `3456`. |
| `docker-compose.coolify.env.example` | Env template for the Coolify compose. |
| `docker-compose.template.yml` | Generic template. |
| `apps/web/Dockerfile` | Builds the Next.js web image. `build:docker` script: `docker build -t cap-web-docker . --no-cache` from repo root. |
| `apps/web-cluster/Dockerfile` | Web cluster variant. |
| `apps/media-server/Dockerfile` + `Dockerfile.standalone` | Media server images (Hono-based, `/health` endpoint, port 3456). |
| `packages/local-docker/docker-compose.yml` | Local dev MySQL/MinIO services (used by `pnpm docker:up`). |
| `apps/web/vercel.json` | **Vercel deploy config** (the canonical cloud target): cron `/api/cron/finalize-stale-desktop-segments` every 15 min; workflow step route memory 3009MB. Note for Coolify: crons here must be reproduced externally (Coolify scheduled task / external cron) since Vercel cron won't fire on self-host. |

**Coolify deployment note:** the supported self-host path is the prebuilt `ghcr.io` images via `docker-compose.coolify.yml`, NOT a Nixpacks/Dockerfile auto-build. No `nixpacks.toml` or `fly.toml` present. Web service needs MySQL + S3-compatible storage (MinIO) + media-server reachable at `http://media-server:3456`. Required secrets: `NEXTAUTH_SECRET`, `DATABASE_ENCRYPTION_KEY`, `MEDIA_SERVER_WEBHOOK_SECRET`, `MYSQL_PASSWORD`, MinIO creds. DB migrations run automatically on web container start (verified by `test-self-hosting.yml` "database has tables" check).

## Common Patterns

**Async testing:** `async/await` with `expect(await fn())` (Vitest, default).

**In-source testing (desktop):** Vitest `includeSource` lets tests live inside source modules under `import.meta.vitest` guards.

---

*Testing analysis: 2026-06-27*
