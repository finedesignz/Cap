# Coding Conventions

**Analysis Date:** 2026-06-27

This is a Turborepo monorepo (pnpm workspaces) mixing TypeScript/JS apps and Rust crates. The authoritative source of truth for conventions is `AGENTS.md` (root, ~270 lines, "Pre-Generation Invariants" section) — it is CI-enforced. Do NOT duplicate or weaken it.

## Tooling Summary

| Concern | Tool | Config |
|---------|------|--------|
| TS/JS/JSON/CSS format + lint | Biome 2.2.0 | `biome.json` |
| Rust format | rustfmt (default) | `rust-toolchain.toml` (channel 1.88.0) |
| Rust lint | clippy `-D warnings` | `[workspace.lints]` in `Cargo.toml` |
| Typecheck | `tsc -b` + `next typegen` | root `tsconfig.json` (project references) |
| Task runner | Turbo 2.3.4 | `turbo.json` |
| Package manager | pnpm 10.5.2 | `pnpm-workspace.yaml`, `.npmrc` |

## Naming Patterns

**Files:**
- kebab-case for TS/JS files: `user-menu.tsx`, `developer-key-hash.ts`

**Components:**
- React/Solid components PascalCase

**Hooks:**
- `useX` prefix

**Rust:**
- Modules snake_case; crates kebab-case (e.g. `enc-ffmpeg`, `scap-direct3d`)

## Code Style (Biome — `biome.json`)

**Formatting:**
- **Indent: TAB** (`formatter.indentStyle: "tab"`). Not spaces. New files and edits must use tabs.
- **Quotes: DOUBLE** for JS/TS string literals (`javascript.formatter.quoteStyle: "double"`). Never single quotes.

**Linting:**
- `linter.rules.recommended: true`
- `suspicious.noShadowRestrictedNames: "off"` (only disabled rule globally)
- Everything else applies: unused vars, `noExplicitAny`, dead code.

**Per-area overrides:**
- `apps/desktop/**`: a11y rules OFF.
- `**/*.css`: `noUnknownAtRules`, `noUnknownTypeSelector`, `noDescendingSpecificity` OFF.

**Biome ignores** (do not lint/format): `**/tauri.ts`, `**/queries.ts`, `apps/desktop/src/utils/tauri.ts`, `apps/desktop/src/global.d.ts`, `apps/web/public/gif.worker.js`, `packages/ui-solid/src/auto-imports.d.ts`.

## Import Organization

- `assist.actions.source.organizeImports: "on"` — Biome auto-sorts/groups imports. Don't hand-sort against the grain; don't leave unused imports.

**Path aliases (apps/web, `vitest.config.ts` + tsconfig):** `@/app`, `@/components`, `@/pages`, `@/utils`, `@/lib`, `@/actions`, `@/data`, `@/services`, `@/workflows`. Desktop uses `~` → `src`.

## TypeScript Strictness

- Avoid `any`. Use `unknown` + narrowing, or shared types from `@cap/utils`, `@cap/web-domain`, generated bindings.
- No `@ts-expect-error` / `@ts-ignore` without a concrete documented reason — prefer fixing the type.

## Rust Conventions (clippy `deny` — write clean the FIRST time)

`[workspace.lints]` in `Cargo.toml` denies a large set. Key ones (full table in `AGENTS.md`):
- `dbg!()` → use `tracing::debug!(?x)` or delete
- `let _ = async_fn();` → `.await` or `tokio::spawn(...)`
- `Duration`/`Instant` subtraction → `.saturating_sub()`
- collapsible `if` → `if a && b`
- `&Vec<T>`/`&String` params → `&[T]`/`&str`
- `v.len() == 0` → `v.is_empty()`
- `value.min(max).max(min)` → `value.clamp(min, max)`
- `unused_must_use = "deny"`: every `Result`/`Option`/`#[must_use]` must be handled. `let _ = ...;` allowed ONLY for `Result`-returning calls consciously discarded (e.g. `let _ = tx.send(msg);`), NOT for unit-returning calls.
- Never suppress with `#[allow(...)]`, `// biome-ignore`, or `any` without explicit approval.

## Comments Policy (zero-tolerance, all languages)

- **Default: NO code comments.** Add a comment only after solving a bug/complex issue, and only for non-obvious context a future investigator needs (why a fix looks the way it does, platform bug worked around, non-obvious invariant/trade-off, link to PR/issue).
- Banned: narrating what code does, restating types, JSDoc paraphrasing param names, "TODO: refactor", comments describing the change being made.
- Prefer better naming/types over a comment.

## Generated Files — NEVER edit by hand

`**/tauri.ts`, `apps/desktop/src-tauri/gen/**`, `packages/ui-solid/src/auto-imports.d.ts`, Drizzle migration SQL under `packages/database/migrations/`. They stay committed (CI + fresh clones depend on them); commit binding changes alongside the Rust change that produced them. Note: `apps/desktop/src/utils/queries.ts` is hand-written — edit normally.

## Effect Usage (apps/web)

- Next.js API routes in `apps/web/app/api/*` use `@effect/platform` `HttpApi` builder — copy the existing class/group/endpoint pattern, no ad-hoc handlers.
- Acquire backend services inside `Effect.gen`, wire via `Layer.provide`/`HttpApiBuilder.group`, translate domain errors to `HttpApiError`.
- Convert to Next handler with `apiToHandler(ApiLive)` from `@/lib/server`; never call `runPromise` in route files.
- Server: run via `EffectRuntime.runPromise` from `@/lib/server`, after `provideOptionalAuth`.
- Client: use `useEffectQuery`/`useEffectMutation` from `@/lib/EffectRuntime` — do not call `EffectRuntime.run*` directly in components.

## Post-Edit Checks (run before saying "done")

Prefer SCOPED, fast checks over full-repo gates:
- Rust touched → `cargo fmt --all` and `cargo check -p <crate>`. Add `--all-targets`/`--workspace`/clippy only for explicit requests or CI/PR final validation.
- TS/JS/JSON/CSS/MD touched → narrowest formatter first: `pnpm exec biome check --write <files>`. Full `pnpm format`, `pnpm lint`, `pnpm typecheck` only when explicitly requested or change spans shared types/packages.
- DB schema touched → `pnpm db:generate` before relying on it.

Root quality scripts: `pnpm format` (`biome check --write`), `pnpm lint` (`biome lint`), `pnpm typecheck` (`next typegen` + `tsc -b`).

## Commits & PRs

- **Conventional Commits:** `feat:`, `fix:`, `chore:`, `improve:`, `refactor:`, `docs:` (e.g., `fix: hide watermark for pro users`).
- PRs: clear description, linked issues, screenshots/GIFs for UI, env/migration notes. Keep scope tight; update docs when behavior changes.
- `.git-blame-ignore-revs` present (one bulk-format revision ignored for blame).

## Config & Env Management

- Single root `.env`, generated by `pnpm env-setup` (`scripts/env-cli.js`); native deps via `pnpm cap-setup` (`scripts/setup.js`).
- Most scripts wrap with `dotenv -e .env --` (see `pnpm with-env`). Turbo `globalDependencies: [".env"]`, `globalEnv: ["*"]`.
- Keep secrets OUT of VCS — configure via `.env`. CI injects env via repo secrets (PostHog, Sentry, `NEXT_PUBLIC_WEB_URL`, etc.) written into `.env` at job start.
- `.npmrc`: `auto-install-peers = true`, `force-legacy-deploy = true`.
- Node 20+, pnpm 10.5.2, Rust 1.88+, Docker (MySQL/MinIO) required for local dev.

---

*Convention analysis: 2026-06-27*
