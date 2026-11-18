# JSK HRM & PM — Implementation Log

Chronological execution history for the implementation plan (`IMPLEMENTATION_TODO.md`). Source of truth: `JSK_HRM_PM_Architecture_Specification.md`.

---

## FOUND-001 — Create monorepo structure per Spec §26

Status: COMPLETE

Architecture references:
- Spec §26 (Phase 26) repository layout
- Spec Phase 4 §3 (module boundaries)

Changes:
- Created npm-workspace monorepo root (`package.json` with `workspaces: ["apps/*","packages/*"]`)
- Created directory tree exactly matching Spec §26: apps (web/api/worker), packages (10 domain/shared packages), infra (iac/ci), db (migrations/seeders), tests (unit/integration/e2e/load), docs
- Scaffolded 13 workspace packages: `package.json` (`@jsk/*` names), `tsconfig.json` extending shared base, `src/index.ts` placeholder, README
- Added root `.gitignore`, `.editorconfig`, `tsconfig.base.json`

Files:
- Root: `package.json`, `.gitignore`, `.editorconfig`, `tsconfig.base.json`, `package-lock.json`
- 13 package scaffolds under `apps/` and `packages/`

Database migrations:
- None (no DB work in this task)

Tests executed:
- `npm install` (workspace resolution + install)
- `npm ls --workspaces` (package-name resolution)

Results:
- Install: PASS (0 vulnerabilities)
- Workspace resolution: PASS (all 13 `@jsk/*` packages resolve)

Issues found:
- None

Decisions:
- DEVIATION (environment): pnpm/corepack unavailable → npm workspaces used instead. Same name-resolution semantics; no architecture impact.
- `turbo.json` (optional per TODO) skipped — npm workspaces + root scripts suffice at this scale.
- No git commit (per execution rules).

Next eligible task:
- FOUND-002 — TypeScript configuration, lint, format, typecheck

---
## FOUND-002 — TypeScript configuration, lint, format, typecheck

Status: COMPLETE

Architecture references:
- Spec Phase 21 (quality gate sequence: lint → format → type)
- NFR-008 (data types; decimal-as-string DTO convention)

Changes:
- Hardened `tsconfig.base.json` (strict, noImplicitAny, exactOptionalPropertyTypes, esModuleInterop, noUnused*, decorators for NestJS)
- Added ESLint flat config + Prettier config + per-package quality scripts
- Installed pinned toolchain (typescript 5.9.3, eslint 9.39.5, @eslint/js 9.39.5, typescript-eslint 8.67.0, prettier 3.9.6, globals 17.11.0)

Files:
- `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`
- Root `package.json` (devDependencies + delegating scripts)
- 13 workspace `package.json` (lint/format:check/typecheck scripts)
- 13 `src/index.ts` (formatted)

Database migrations:
- None

Tests executed:
- `npm run lint` → PASS
- `npm run format:check` → PASS (after prettier --write of placeholders)
- `npm run typecheck` → PASS

Results:
- All three quality gates PASS across all 13 workspaces

Issues found:
- Initial `format:check` failed on double-quoted placeholder strings → fixed with prettier --write (not a code defect)

Decisions:
- Pinned TypeScript 5.x / ESLint 9.x due to Node 18 engine constraints (2026 latest majors require newer Node)
- `no-explicit-any` enforced as error

Next eligible task:
- FOUND-003 — Backend app scaffold (NestJS), worker entrypoint, shared-kernel package

---
## FOUND-003 — Backend app scaffold (NestJS), worker entrypoint, shared-kernel package

Status: COMPLETE

Architecture references:
- Spec Phase 4 §2 (same codebase, different entrypoint), Phase 19 (containerization)
- Spec Phase 6 (API error format, pagination, filter/sort params, X-Request-Id, ISO-8601)
- FR-003 (invalid pagination clamped, never 500), NFR-008 (decimal-as-string)

Changes:
- `apps/api`: NestJS 10 scaffold (core/common/platform-express 10.4.22, reflect-metadata, rxjs). `RequestIdMiddleware` implements `NestMiddleware` applied to `'*'`: passes through valid UUID `X-Request-Id`, else generates one (`crypto.randomUUID`); header treated as correlation only, never trusted. `GET /health` returns `{status:'ok',service:'api',requestId}`; port from `process.env.PORT ?? 3000`; `main.ts` uses NestJS `Logger`.
- `apps/worker`: `NestFactory.createApplicationContext(WorkerModule)` with empty `@Module({})` — boots DI, zero processors (BullMQ deferred to JOB-001).
- `packages/shared-kernel` first release: error.ts, pagination.ts, filters.ts, decimal.ts, iso8601.ts, request-id.ts, barrel `index.ts`; `main`/`types` moved to `dist`.
- Root scripts build shared-kernel before consumers (`dev:api`, `dev:worker`, `build:api`, `build:worker`, `typecheck`).
- Root `overrides` added for vulnerable transitive deps: qs 6.15.3, multer 2.2.0, body-parser 1.20.6, file-type 21.3.4.

Files:
- `apps/api/src/{main.ts,app.module.ts,app.controller.ts,request-id.middleware.ts}`, `apps/api/package.json`
- `apps/worker/src/{main.ts,worker.module.ts}`, `apps/worker/package.json`
- `packages/shared-kernel/src/{error.ts,pagination.ts,filters.ts,decimal.ts,iso8601.ts,request-id.ts,index.ts}`, `packages/shared-kernel/package.json`
- Root `package.json` (scripts + overrides)

Database migrations:
- None

Tests executed:
- `npm run build --workspace @jsk/{shared-kernel,api,worker}` → PASS
- `npm run typecheck`, `npm run lint`, `npm run format:check` → PASS
- Live: `dev:api` served `/health` for no-header (generated id), valid id (echoed), invalid id (regenerated); 404 verified; worker booted and exited cleanly with no processing
- `npm audit` → 2 moderate (documented below)

Results:
- API health route live and correct; worker boots without processing; shared-kernel types compile; all quality gates PASS

Issues found:
- `format:check` initially flagged 13 new files → fixed with `prettier --write`
- `lint` flagged `consistent-type-imports` on `MiddlewareConsumer`/`NestModule`/`NestMiddleware` → fixed with `import type`
- npm overrides initially did not re-resolve against the existing lockfile → clean reinstall applied them

Decisions:
- DEVIATION (environment): `npm audit fix --force` would force NestJS 11.2.1 which requires Node >= 20; pinned to NestJS 10 on Node 18.
- KNOWN LIMITATION (tracked): 2 moderate advisories remain on `@nestjs/core` <=11.1.17 (GHSA-36xv-jgw5-4q75, "improperly neutralizes special elements in output" — console/log output injection). Only fix is NestJS 11 / Node >= 20; revisit on runtime upgrade. Low risk for server usage emitting structured logs.
- shared-kernel must be built (`tsc`) before api/worker gates — encoded in root scripts.

Next eligible task:
- FOUND-004 — Frontend app scaffold (Vite + React + TS + React Router)

---
## FOUND-004 — Frontend app scaffold (Vite + React + TS + React Router)

Status: COMPLETE

Architecture references:
- Spec Phase 4 §4 (frontend), Phase 20 (observed SPA routes)
- Spec Phase 21 (quality gates)

Changes:
- Created Vite React-TS SPA in `apps/web`: `index.html`, `vite.config.ts`, `src/{main.tsx,router.tsx,styles.css,vite-env.d.ts}`, `src/components/AppLayout.tsx`
- `AppLayout` nav shell with routes mirroring Spec §20 modules: Dashboard, HR, Projects, Attendance, Leave, Training
- Web `tsconfig.json` extends shared base with bundler resolution, react-jsx, DOM libs, `types: ["vite/client"]`
- Removed FOUND-001 placeholder `src/index.ts` (Vite entry is `main.tsx`)

Files:
- `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html}`
- `apps/web/src/{main.tsx,router.tsx,styles.css,vite-env.d.ts}`, `apps/web/src/components/AppLayout.tsx`

Database migrations:
- None

Tests executed:
- `tsc --noEmit` (typecheck) → PASS
- `vite build` → PASS (34 modules)
- `dev:web` → served index.html; `/projects` history-fallback 200; main.tsx transpiled
- Root `lint` / `typecheck` / `format:check` → PASS
- `npm audit` → 4 moderate (documented below)

Results:
- SPA serves a page in dev and builds cleanly; all quality gates PASS

Issues found:
- Inherited `rootDir: "src"` from base broke including `vite.config.ts` → overrode `rootDir "."` in web tsconfig
- React 19 types removed the global `JSX` namespace → typed `AppLayout` return as `ReactElement`
- Initial `format:check` flagged 4 web files → fixed with `prettier --write`

Decisions:
- Pinned Vite 6.4.3 / @vitejs/plugin-react 4.7.0 / react-router-dom 6.30.4 (2026 latest majors require Node >= 20)
- KNOWN LIMITATION (tracked): 2 new react-router advisories (GHSA-wrjc-x8rr-h8h6 open-redirect in Link/useNavigate; GHSA-337j-9hxr-rhxg deserializeErrors SSR hydration). Both unreachable in a pure SPA using only internal links with no SSR; only fix is React Router 7 / Node >= 20 — revisit on runtime upgrade.

Next eligible task:
- FOUND-005 — Docker Compose local development environment

---
## FOUND-005 — Docker Compose local development environment

Status: COMPLETE (with environment-blocked validation)

Architecture references:
- Spec Phase 20 ("Local" environment, mocked adapters), Phase 19 (containerization, same image/different entrypoint)

Changes:
- Created `infra/docker-compose.yml` with 8 services: db (postgres:15), redis (redis:7), minio (S3-compatible storage) + minio-init (one-shot `mc` job creating `S3_BUCKET`), mailpit (SMTP catch-all, UI :8025), api, worker, web
- Healthchecks on db (`pg_isready`), redis (`redis-cli ping`), minio, api (`fetch /health`); named volumes; `depends_on` with `service_healthy` conditions
- App services load env from `infra/.env` (`env_file`); all values templated with `:-` defaults
- `infra/Dockerfile`: parameterized `node:18-alpine` image (build arg `APP`) building one workspace via npm workspaces, running as non-root `node`; api and worker share the image approach per Spec Phase 19
- `infra/.env.example`: complete placeholder set; no secrets committed

Files:
- `infra/docker-compose.yml`, `infra/Dockerfile`, `infra/.env.example`

Database migrations:
- None (DB runs in container; migrations land in db/ tasks)

Tests executed:
- YAML parse (pyyaml) → PASS; 8 services / 4 volumes confirmed
- All 20 env interpolations have `:-` defaults; every referenced var documented in `.env.example`

Results:
- Compose file is structurally valid and complete

Issues found / BLOCKED:
- `docker compose up` / `docker compose config` could NOT be executed — Docker is not installed in this environment. Full acceptance (all services healthy, API health reachable, MinIO bucket init) must be re-validated on a machine with Docker.

Decisions:
- DEVIATION (environment): added `infra/Dockerfile` (parameterized by APP) so the compose file is runnable when Docker becomes available; without it the api/worker/web build contexts would be dangling.
- Storage/email adapters mocked locally via MinIO + Mailpit per Phase 20; S3_FORCE_PATH_STYLE=true for path-style local buckets.

Next eligible task:
- FOUND-006 — Environment management & validation

---
## FOUND-006 — Environment management & validation

Status: COMPLETE

Architecture references:
- Spec Phase 20 (env-per-environment), Phase 19 (config via env vars + secrets manager)

Changes:
- Added shared Zod env schema `packages/shared-kernel/src/config/env.ts`: `EnvSchema`, `parseEnv`, `EnvConfig`
- Added `zod@^3.25.76` dep to shared-kernel; `dotenv@^17.4.2` deps to api + worker
- api/worker `main.ts` now load `.env` (`import 'dotenv/config'`) and call `parseEnv(process.env)` before creating the Nest context; on failure `Logger.error` + `process.exit(1)`
- Startup logs now include `env.NODE_ENV`
- Fixed `infra/.env.example` `SMTP_FROM` to `jsk@example.com` (zod `.email()` needs a dot-domain)

Files:
- `packages/shared-kernel/src/config/env.ts`, `packages/shared-kernel/src/index.ts`, `packages/shared-kernel/package.json`
- `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `apps/api/package.json`, `apps/worker/package.json`
- `infra/.env.example`

Database migrations:
- None

Tests executed:
- No-env boot → exit 1, clear message listing all 10 missing vars
- Invalid-value boot → per-field rejections (enum, URL schemes, secret length + placeholder, strict boolean, port NaN, email, web origin)
- Valid env boot → `/health` ok, log shows `(development)`; boolean/default coercion verified via parseEnv; worker boots with env
- Root `lint` / `typecheck` / `format:check` → PASS

Results:
- Fail-fast env validation live in both apps; secrets never appear in messages

Issues found:
- Initially referenced `env.nodeEnv` (camelCase) — schema keys are the env var names (`NODE_ENV`); fixed to `env.NODE_ENV`
- zod `.email()` rejects dot-less local domains → `.env.example` corrected

Decisions:
- zod pinned to 3.25.76 (CJS); zod 4 is ESM-only and our build emits CommonJS
- Boolean env vars use explicit `true`/`false` coercion (plain `z.coerce.boolean()` treats `"false"` as true)
- Schema is `.passthrough()` so unrelated process env vars don't break boot
- Shared schema lives in shared-kernel (no dedicated config package exists in Spec §26 layout)

Next eligible task:
- FOUND-007 — Test infrastructure scaffolding

---
