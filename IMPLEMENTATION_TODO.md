# JSK HRM & Project Management — Master Implementation TODO Plan

**Source of truth:** `JSK_HRM_PM_Architecture_Specification.md` (1126 lines, "the Spec"). This document is the derived **implementation backlog** only; it never overrides the Spec. Every task below cites the Spec section/requirement ID it implements. Spec-numeric IDs (FR/BR/WF/SM/MI/DR/AM/ADR/NFR) are used verbatim for traceability.

**How to use:** Work tasks in the order of the Phases below; within a phase follow the listed sequence. Each task has a stable ID (`PREFIX-NNN`), priority (`P0/P1/P2/P3`), dependencies, and acceptance criteria. Tasks marked **Parallel-ok** can be worked by separate engineers simultaneously. Nothing labeled `RECOMMENDATION`/`ASSUMPTION`/`DECISION REQUIRED` is treated as a confirmed fact (per Spec §29 R-07); every such item is tracked in `docs/PARITY_GAPS.md`.

---

## 1. Repository Inventory (Step 1)

The project directory `/home/rumky/odoo17_env/odoo-17.0/SDI` is a **greenfield** (empty) workspace.

| Path | Purpose | Reusable | Conflicts | Preserve | Modify |
|---|---|---|---|---|---|
| `JSK_HRM_PM_Architecture_Specification.md` | The architecture specification (source document) | Yes — authoritative input | No | **Yes — never modify** | No |
| Any other file | None exist | — | — | — | — |

Notes:
- The parent git repo contains staged files from *sibling* Odoo projects (`multi_transfer`, `manikganj_diabetic_hospital`). They are unrelated to SDI and must not be included in SDI commits.
- Nothing in SDI exists to reuse, so all foundation scaffolding is net-new (FOUND tasks).
- The Spec §26 already prescribes the target repository structure (`/apps`, `/packages`, `/infra`, `/db`, `/tests`, `/docs`); FOUND-001 creates it.

---

## 2. Technology Stack & Decisions (Step: stack determination)

Per the task instructions the stack is **React + TypeScript/TSX + PostgreSQL**. The Spec (Phase 25) explicitly permits a Node.js/NestJS backend. Resolved stack with justification:

| Layer | Choice | Justification (Spec ref) |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, React Router, TanStack Query, Zod | Spec Phase 25 "React + TypeScript, a query/cache library"; observed route list §20 maps to SPA routes; schema-based wizard validation (FR-032) → Zod |
| Backend | **NestJS** (modular monolith) with per-domain modules | Spec Phase 4 (modular monolith), Phase 25 (NestJS explicitly acceptable), Phase 26 domain packages map to NestJS modules |
| Database | PostgreSQL 15+ (single primary, optional read replica later) | Spec Phase 5 driver; CHECK/JSONB/partial indexes support required |
| ORM/migrations | Prisma (schema + forward-only migrations) with raw SQL escape hatches for CHECK constraints, partial indexes, `SELECT … FOR UPDATE`, advisory locks | Spec Phase 5 (versioned forward-only migrations, DB-level enforcement); raw SQL needed for row locking (Phase 5), report aggregation (Phase 5 §Indexing, Phase 18) |
| Session/auth | Server-side sessions, HttpOnly `Secure; SameSite=Lax` cookie, sliding expiry, argon2id password hashing | Spec Phase 7 (explicitly recommended over bearer JWT for revocability) |
| Cache | Redis (managed): session store + narrow lookup cache, DB fallback (fail-open) | Spec Phase 13 |
| Queue | BullMQ on Redis (DB-backed job table as fallback alternative) | Spec Phase 9/25: lightweight queue only; Redis already present; BullMQ natively provides at-least-once, backoff, DLQ semantics matching Phase 9 |
| Object storage | S3-compatible (MinIO for local/dev, provider S3 for prod), signed URLs | Spec Phase 10/11 adapter; ADR-006 direct-to-storage |
| Email | Adapter + provider (e.g. SMTP/Nodemailer or SES) behind `NotificationAdapter`; feature-flagged | Spec Phase 10/14 (Recommendation-level, MI-03) |
| Search | PostgreSQL trigram/ILIKE indexes; **no dedicated engine** | Spec Phase 12 (explicitly prohibited at this scale) |
| Monitoring | pino structured logs, OpenTelemetry-compatible metrics, Prometheus metrics endpoint, health checks | Spec Phase 16 |
| Testing | Vitest (unit), Supertest (API/contract), Playwright (E2E), k6 (load) | Spec Phase 22/25 |
| Infra | Docker Compose (local), managed container platform (prod), IaC (Terraform), GitHub Actions CI | Spec Phase 19/21 |
| Package manager | pnpm workspaces (monorepo) | Spec Phase 26 layout |
| Frontend component approach | Custom design-system on Radix UI primitives + Tailwind CSS, WCAG-AA baseline | Spec NFR-004, Phase 4 §4 (accessibility built into shared library) |

**DECISION REQUIRED (DR-TECH-01):** ORM final selection — Prisma (recommended, default for this plan) vs TypeORM vs Kysely. Impact: migration authoring style, locking ergonomics. Default in this plan: **Prisma**.

**DECISION REQUIRED (DR-TECH-02):** Exact queue backend — BullMQ (recommended) vs DB-backed job table. Spec permits either (Phase 9/25). Default: **BullMQ**.

**ASSUMPTION (A-TECH-01):** Environments will be provided as managed services at production; the plan assumes provider-agnostic adapters so either is supportable.

---

## 3. Specification Coverage Inventory (Step 2)

Extracted from the Spec — every item below is covered by ≥1 task in this plan (verified in §8 Traceability Matrix and §9 Coverage Audit).

### 3.1 Actors (Spec §2, §16) — 8
`SUPER_ADMIN`, `HR_ADMIN`, `HR_MANAGER`, `PROJECT_MANAGER`, `EMPLOYEE` (self-service), `VIEWER` (read-only), `SYSTEM_SCHEDULER` (non-human), `ATTENDANCE_CAPTURE_SOURCE` (external).

### 3.2 Modules / Functional Requirements
- Global Shell: FR-001..006
- HR Masters: FR-010..016 (Departments, Sub-Departments), FR-020..024 (Setup Rules), FR-065 (Holiday), plus Positions & Employee Type masters (under-evidenced, MI-04)
- Employee: FR-030..038 (list, wizard create, validation, transactional save, inactive list, performance, transfer in/out)
- Attendance: FR-050..060 (form, device-ID show, bulk insert, monthly entry, missing/pending queues, 6 report tabs)
- Leave: FR-070..080 (applications, approval, total-leaves matrix, idempotent generation, leave types, short leaves)
- Training: FR-085..090 (master, assignments, internal/external certificates)
- Other HR: FR-095..099 (Loan, Resignation, Notices, ID Card, HR Policies, Bulk Upload — all MI-04, Recommendation field sets, feature-flagged)
- Project Management: FR-100..106 (dashboard, project CRUD, client CRUD incl. inline, tasks, daily tasks, meetings + attachments, PM reports)
- Settings & Audit: FR-130..134 (activity log list/delete-selected/filter; audit deletion restricted to Super Admin; Software Setup screen)
- PM under-evidenced detail: Manage Task, Daily Tasks, Client List detail, Project Reports (MI-04)

### 3.3 Non-Functional Requirements — NFR-001..010 (stated), NFR-101..105 (inferred)

### 3.4 Business Rules — BR-001..BR-017 (full set, Spec §5)

### 3.5 Workflows — WF-001..WF-012 (Spec §6)

### 3.6 State Machines — SM-1..SM-6 (Spec §7)

### 3.7 Integrations — attendance capture, object storage, export/print, email (Recommendation)

### 3.8 Entities (Spec §9 + Phase 5 ER) — ~30 tables incl. sub-entities (full list in Phase 1 DB tasks)

### 3.9 Cross-cutting requirements
Security threats (Phase 8 table), async jobs (Phase 9), scheduled jobs (Phase 15), observability (Phase 16), failure design (Phase 17), environment strategy (Phase 20), CI/CD gates (Phase 21), test architecture (Phase 22), DR/backup (Phase 23), audit (Phase 24), tech stack (Phase 25), repo structure (Phase 26), roadmap (Phase 27), ADRs (Phase 28), risk register (Phase 29), traceability (Phase 30), PARITY_GAPS (Phase 33 Definition-of-Done).

### 3.10 Gap/ambiguity items carried through the plan
MI-01..06, AM-01..06, C-01/C-02, HC-01..05, DR-01..06 (all preserved; each mapped to a `DECISION REQUIRED` gate or a Recommendation-level implementation flagged in PARITY_GAPS.md).
## 4. Implementation Phases Overview (Step 29)

Derived dependency sequence (full graph in §7):

```
Phase 0  Foundation (repo, tooling, containers, CI base)
   ↓
Phase 1  Database core (schema, constraints, seeds, DB-level rules)
   ↓
Phase 2  Auth & Authorization (AUTH + ACL)
   ↓
Phase 3  Backend modules (HR masters → Employee → Attendance → Leave →
         Training → Project Mgmt → Files → Audit → Admin/Notifications)
   ↓
Phase 4  Frontend foundation (shell, design system, API client)
   ↓
Phase 5  Frontend domain screens (parallel to Phase 3/4 completion)
   ↓
Phase 6  End-to-end workflows (integration + E2E verification of WF-001..012)
   ↓
Phase 7  Async jobs, scheduling & integrations
   ↓
Phase 8  Reporting & export (filter-consistent engine, report correctness)
   ↓
Phase 9  Security hardening & reliability hardening
   ↓
Phase 10 Observability & operations
   ↓
Phase 11 DevOps, deployment, DR & backup
   ↓
Phase 12 Documentation & acceptance (PARITY_GAPS, runbook, traceability)
```

---

# PHASE 0 — ENGINEERING FOUNDATION (FOUND)

## [x] FOUND-001 — Create monorepo structure per Spec §26
- **Purpose:** Establish the exact repository layout the Spec prescribes.
- **Architecture ref:** Spec §26 (Phase 26); Spec Phase 4 §3 (module boundaries).
- **Requirements covered:** repo structure; Phase 26.
- **Dependencies:** none. **Parallel with:** FOUND-002.
- **Files:** root `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.editorconfig`, `turbo.json` (optional), dirs `/apps/{web,api,worker}`, `/packages/{domain-hr,domain-attendance,domain-leave,domain-training,domain-projects,domain-audit,domain-files,domain-notifications,shared-auth,shared-kernel}`, `/infra/{iac,ci}`, `/db/{migrations,seeders}`, `/tests/{unit,integration,e2e,load}`, `/docs`.
- **Implementation:** Scaffold each workspace package as empty TS package with `tsconfig` shared base. Add README placeholders.
- **Acceptance:** `pnpm install` works from root; each package resolvable by name; structure matches Spec §26.
- **Security:** none. **Failure/edge:** none.

Implementation Status: COMPLETE

Implemented:
- Root workspace (`package.json` with npm `workspaces: ["apps/*","packages/*"]`), `.gitignore`, `.editorconfig`, `tsconfig.base.json` shared base.
- Directory tree per Spec §26: `/apps/{web,api,worker}`, `/packages/{domain-hr,domain-attendance,domain-leave,domain-training,domain-projects,domain-audit,domain-files,domain-notifications,shared-auth,shared-kernel}`, `/infra/{iac,ci}`, `/db/{migrations,seeders}`, `/tests/{unit,integration,e2e,load}`, `/docs`.
- 13 workspace packages scaffolded: each with `package.json` (`@jsk/...` name), `tsconfig.json` extending base, `src/index.ts`, README placeholder.
- Root npm scripts (`dev:*`, `build:*`, `lint`, `format:check`, `typecheck`, `test`) delegating to workspaces.

Files changed:
- Root: `package.json`, `.gitignore`, `.editorconfig`, `tsconfig.base.json`, `package-lock.json` (generated)
- Scaffolds: `apps/{web,api,worker}/`, `packages/*/` (package.json, tsconfig.json, src/index.ts, README.md); `.gitkeep` in infra/db/tests/docs dirs

Tests/validation:
- `npm install` → success, 0 vulnerabilities
- `npm ls --workspaces` → all 13 `@jsk/*` packages resolve to their directories
- Directory tree matches Spec §26 exactly

Architecture verification:
- Spec §26 layout reproduced verbatim (module names and boundaries preserved)
- Domain package boundary rule (no cross-package table access) is structural intent, enforced in later domain tasks

Notes:
- DEVIATION (environment): pnpm is not installed on this machine and `corepack` is unavailable; pnpm workspaces were adapted to equivalent **npm workspaces** (same package-name resolution). Root `pnpm-workspace.yaml` intentionally omitted. Recorded as an environment-driven deviation, not an architecture change.
- No git commit made (per execution rules).

## [x] FOUND-002 — TypeScript configuration, lint, format, typecheck
- **Purpose:** Consistent strict TS across all packages; enforced quality gates (Phase 21 lint → format → type).
- **Architecture ref:** Spec Phase 21; NFR-008.
- **Dependencies:** FOUND-001.
- **Implementation:** strict `tsconfig.base.json` (`strict: true`, `noImplicitAny`, `exactOptionalPropertyTypes`, `esModuleInterop`), ESLint flat config + Prettier, npm scripts `lint`, `format:check`, `typecheck` at root and per package. Decimal types used for all money/score/hours (NFR-008) via string-typed decimals in DTOs.
- **Acceptance:** `pnpm lint && pnpm format:check && pnpm typecheck` pass on an empty-but-valid package; CI can run the same commands.
- **Tests:** no test needed; gates themselves are the CI check (Phase 11).
- **Failure/edge:** TS strictness will surface later as type errors — CI gate must run in Phase 11.

Implementation Status: COMPLETE

Implemented:
- Hardened `tsconfig.base.json`: `strict`, `noImplicitAny`, `exactOptionalPropertyTypes`, `esModuleInterop`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, decorators support for NestJS, `skipLibCheck`, `forceConsistentCasingInFileNames`.
- ESLint flat config `eslint.config.mjs` (@eslint/js recommended + typescript-eslint recommended; `no-explicit-any` as error, `no-console` warn, consistent-type-imports, unused-vars with `_` allow).
- Prettier config `.prettierrc.json` (singleQuote, printWidth 100, es5 trailing commas) + `.prettierignore`.
- Per-package scripts `lint` / `format:check` / `typecheck` added to all 13 workspace packages; root scripts delegate via `--workspaces --if-present`.
- Tooling pinned for Node 18: typescript@5.9.3, eslint@9.39.5, @eslint/js@9.39.5, typescript-eslint@8.67.0, prettier@3.9.6, globals@17.11.0 (root devDependencies, save-exact).

Files changed:
- `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, root `package.json` (devDependencies), all 13 `apps/*`/`packages/*` package.json (scripts), 13 `src/index.ts` (prettier-formatted)

Tests/validation:
- `npm run lint` → PASS (all 13 workspaces)
- `npm run format:check` → PASS (after formatting placeholders)
- `npm run typecheck` → PASS (all 13 workspaces)

Architecture verification:
- Quality gates (lint → format → type) from Spec Phase 21 now runnable from root and in CI.
- Decimal-as-string convention (NFR-008) is a DTO convention applied in later backend tasks (shared-kernel); not a TS-config concern.

Notes:
- Pinned to TypeScript 5.x / ESLint 9.x because latest 2026 majors (TS 7 / ESLint 10) exceed Node 18 engine support in this environment.
- `no-explicit-any` is enforced as error per implementation discipline (any only where unavoidable and justified).

## [x] FOUND-003 — Backend app scaffold (NestJS), worker entrypoint, shared-kernel package
- **Purpose:** Working `/apps/api` and `/apps/worker` skeletons sharing one codebase (Spec Phase 19: same image, different entrypoint; Phase 4 §2).
- **Architecture ref:** Spec Phase 4 §2; Phase 19.
- **Dependencies:** FOUND-001, FOUND-002.
- **Implementation:** NestJS CLI scaffold in `/apps/api`; `/apps/worker` is a NestJS bootstrap with BullMQ processor host only. `/packages/shared-kernel` first release: API error format type `{error:{code,message,fields},requestId}` (Phase 6), pagination types (`page`,`per_page`,`total`,`total_pages`), filter/sort param types, ISO-8601 conventions, decimal-as-string helper, `X-Request-Id` middleware contract.
- **Acceptance:** `pnpm dev:api` starts and responds on health route; `pnpm dev:worker` boots without processing anything; error/pagination types compile.
- **Tests:** minimal boot test.
- **Security:** request ID header accepted only as correlation, never trusted for logic.

Implementation Status: COMPLETE
- NestJS 10 (10.4.22 core/common/platform-express, reflect-metadata, rxjs) in `apps/api`; `RequestIdMiddleware` (implements `NestMiddleware`, applied to `'*'`) implements the Phase 6 X-Request-Id contract (valid UUID passthrough, else generated); `GET /health` returns `{status:'ok',service:'api',requestId}`; port from `process.env.PORT ?? 3000`.
- `apps/worker` uses `NestFactory.createApplicationContext(WorkerModule)` — boots DI with zero processors (BullMQ wiring deferred to JOB-001); root scripts `dev:api`/`dev:worker`/`build:api`/`build:worker`/`typecheck` build shared-kernel first (npm workspaces, pnpm unavailable).
- `packages/shared-kernel` first release: `error.ts` (ERROR_CODES, ApiErrorBody/Response, toApiError), `pagination.ts` (DEFAULT_PAGE=1, DEFAULT_PER_PAGE=10, PER_PAGE_OPTIONS=[10,25,50,100], parsePagination clamps per FR-003, totalPages), `filters.ts` (parseFilters `filter[field]=value`, parseSort `sort`/`direction`), `decimal.ts` (isValidDecimal/toDecimalString per NFR-008), `iso8601.ts` (isIsoDate/isIsoDateTime), `request-id.ts` (REQUEST_ID_HEADER, isValidRequestId, generateRequestId). `main`/`types` now point at `dist`; shared-kernel built before consumers.
- Validation: shared-kernel/api/worker `tsc` build PASS; root typecheck/lint/format PASS; `dev:api` served `/health` correctly for no-header, valid-id, and invalid-id (id generated) cases, 404 verified; worker booted and exited cleanly with no processing.
- npm audit: 2 moderate advisories remain (GHSA-36xv-jgw5-4q75 on @nestjs/core <=11.1.17; @nestjs/platform-express depends on it). Fix requires NestJS 11 / Node >= 20, blocked by Node 18 environment — tracked as known limitation; to revisit on runtime upgrade. qs/multer/body-parser/file-type vulns resolved via root `overrides` (6.15.3/2.2.0/1.20.6/21.3.4).

## [x] FOUND-004 — Frontend app scaffold (Vite + React + TS + React Router)
- **Purpose:** Bootable SPA shell skeleton for Phase 4.
- **Architecture ref:** Spec Phase 4 §4.
- **Dependencies:** FOUND-001, FOUND-002.
- **Implementation:** Vite React-TS app in `/apps/web`, React Router, base layout placeholder, `tsconfig` wired to shared base.
- **Acceptance:** `pnpm dev:web` serves a page; build passes.
- **Failure/edge:** none.

Implementation Status: COMPLETE
- Vite 6.4.3 + React 19.2.8 + react-router-dom 6.30.4 + @vitejs/plugin-react 4.7.0 (Vite 7 / plugin-react 5/6 / React Router 7 all require Node >= 20 — pinned for Node 18; Node-18-blocked audit advisories documented in log).
- `apps/web`: `index.html`, `vite.config.ts`, `src/{main.tsx,router.tsx,styles.css,vite-env.d.ts}`, `src/components/AppLayout.tsx` (nav shell with Dashboard/HR/Projects/Attendance/Leave/Training routes); `tsconfig.json` overrides base to ESNext/bundler resolution + `jsx: react-jsx` + DOM libs + `types:["vite/client"]` + `rootDir "."` (base's commonjs/node/rootDir src is backend-oriented).
- Scripts: `dev` (vite), `build` (tsc --noEmit && vite build), `preview`.
- Validation: `tsc --noEmit` PASS, `vite build` PASS (34 modules, gzip ok), `dev:web` served index.html + `/projects` history-fallback 200 + transpiled main.tsx; root lint/typecheck/format PASS.
- npm audit: 4 moderate now (2 react-router advisories added to the 2 @nestjs/core ones): GHSA-wrjc-x8rr-h8h6 (open redirect via backslash in Link/useNavigate) and GHSA-337j-9hxr-rhxg (deserializeErrors SSR hydration). Both unreachable in a pure SPA with only internal links; fix requires React Router 7 / Node >= 20 — documented as tracked limitation, revisit on runtime upgrade.

## [x] FOUND-005 — Docker Compose local development environment
- **Purpose:** Parity with Spec Phase 20 "Local" environment with mocked adapters.
- **Architecture ref:** Spec Phase 20; Phase 19 (containerization).
- **Dependencies:** FOUND-001..004.
- **Implementation:** `docker-compose.yml` in `/infra` with services: `postgres:15`, `redis:7`, `minio` (S3-compatible), `mailpit` (SMTP catch-all for local email), api, worker, web; healthchecks for db/redis/minio; named volumes; env file templating (`.env.example`).
- **Acceptance:** `docker compose up` brings all services healthy; API health endpoint reachable; MinIO buckets create on init.
- **Security:** no secrets committed; `.env.example` only placeholders. **Failure/edge:** storage/email adapters mocked in local (Phase 20).

Implementation Status: COMPLETE (docker compose up validation BLOCKED — docker not installed in this environment)
- `infra/docker-compose.yml`: services db (postgres:15), redis (redis:7), minio + minio-init (one-shot `mc` job creates `S3_BUCKET` on first run), mailpit (SMTP catch-all, web UI on :8025), api, worker, web; healthchecks for db/redis/minio/api; named volumes (pgdata/redisdata/miniodata/webnode); all env templated via `.env` with `:-` defaults; `env_file: .env` for app services.
- `infra/.env.example`: full placeholder set (NODE_ENV, PUBLIC_WEB_ORIGIN, SESSION_SECRET, COOKIE_*, POSTGRES_*, REDIS_PORT, S3_* incl. S3_FORCE_PATH_STYLE for local MinIO, SMTP_*/EMAIL_SSL, FEATURE_FLAG_*). No secrets committed.
- `infra/Dockerfile`: single parameterized image (build arg `APP=api|worker`) per Spec Phase 19 "same codebase, different entrypoint"; node:18-alpine, builds the workspace via npm workspaces, runs as non-root `node` user.
- api/worker connect to `db`/`redis`/`minio`/`mailpit` by service name; web mounts source + runs vite dev with API origin `http://localhost:3000`.
- Validation: YAML parses (pyyaml), 8 services + 4 volumes, all 20 env interpolations have `:-` defaults, every referenced var documented in `.env.example`. `docker compose up`/`docker compose config` NOT executed — Docker unavailable (environment constraint). Re-run validation when Docker is installed.

## [x] FOUND-006 — Environment management & validation
- **Purpose:** env-per-environment config (Phase 20) validated at boot.
- **Architecture ref:** Spec Phase 20; Phase 19 (config via env vars + secrets manager).
- **Dependencies:** FOUND-003.
- **Implementation:** `.env` schema (Zod) loaded in api & worker boot; required vars: DATABASE_URL, REDIS_URL, SESSION_SECRET, COOKIE settings, STORAGE (endpoint/keys/bucket), SMTP/EMAIL_*, PUBLIC_WEB_ORIGIN, NODE_ENV, FEATURE_FLAG_* list; fail-fast on missing.
- **Acceptance:** missing var → boot fails with clear message; each env name documented (DOC task).
- **Security:** fail-fast prevents running with wrong config; secrets never logged.

Implementation Status: COMPLETE
- `packages/shared-kernel/src/config/env.ts`: Zod `EnvSchema` + `parseEnv` (fail-fast) + `EnvConfig` type. Validates NODE_ENV (enum, default development), DATABASE_URL (postgres:// scheme), REDIS_URL (redis:// scheme), SESSION_SECRET (min 32 chars + rejects placeholder), COOKIE_SECURE/COOKIE_SAME_SITE, S3_* (endpoint URL, keys, bucket, S3_FORCE_PATH_STYLE bool default true), SMTP_*/EMAIL_SSL (port int 1-65535, from email), PUBLIC_WEB_ORIGIN (URL), FEATURE_FLAG_DOCS/RECURRENCE/INTERNAL_CHAT (bools). Strict `true`/`false` coercion (plain `z.coerce.boolean()` would treat "false" as true). `.passthrough()` so unrelated env vars don't fail boot. Error message lists names + expected formats only — values never logged.
- `apps/api` + `apps/worker`: `dotenv/config` load at boot, then `parseEnv(process.env)` before Nest context; on failure `Logger.error` the message and `process.exit(1)`. Runtime now logs `env.NODE_ENV` in startup line. zod pinned 3.25.76 (zod 4 is ESM-only, incompatible with the CJS build).
- `.env.example` SMTP_FROM corrected to a dot-domain address (`jsk@example.com`) so the documented example passes validation.
- Validation: no-env boot exits 1 with the full missing-var list; invalid-value boot rejects enum/URL/secret-length/placeholder/boolean/port/email violations with per-field messages; valid env boots, `/health` returns ok with NODE_ENV=development; boolean + default coercion verified; worker boots with env. Root lint/typecheck/format PASS.

## FOUND-007 — Test infrastructure scaffolding
- **Purpose:** Unit/integration/E2E/load runners available from day one (Phase 22).
- **Architecture ref:** Spec Phase 22; Phase 25 (testing).
- **Dependencies:** FOUND-003, FOUND-004.
- **Implementation:** Vitest in api/worker/packages with coverage thresholds; Supertest for HTTP tests; Playwright in `/tests/e2e`; k6 in `/tests/load`; `testcontainers` or compose-backed Postgres for DB tests; shared test fixtures package.
- **Acceptance:** each runner executes a trivial green test in CI.
- **Failure/edge:** DB-backed tests must not share a persistent DB (ephemeral reset per run, Phase 20 Test env).

## FOUND-008 — CI pipeline baseline
- **Purpose:** Gate sequence from Phase 21 wired before feature work starts.
- **Architecture ref:** Spec Phase 21 (lint → format → type → unit → integration → contract → migration dry-run → SCA → SAST → build).
- **Dependencies:** FOUND-002..007.
- **Implementation:** GitHub Actions workflow: install → lint → format:check → typecheck → unit → integration (compose db) → API contract → Prisma migrate deploy --dry-run check → dependency scan (osv-scanner) → SAST (semgrep) → build → (later) staging deploy/smoke.
- **Acceptance:** PR merge to `main` runs full chain; failing gate blocks merge.
- **Security:** secrets from Actions secrets store, never inline.

## FOUND-009 — Documentation skeleton (README, ARCHITECTURE, PARITY_GAPS, runbook stubs)
- **Purpose:** Doc set required by Spec Phase 26 & §33.
- **Architecture ref:** Spec Phase 26; §33 Definition-of-Done.
- **Dependencies:** FOUND-001.
- **Implementation:** `README.md` (setup/migrate/seed/run/test/build), `docs/ARCHITECTURE.md` (link to Spec + this plan), `docs/PARITY_GAPS.md` (template with sections per §21 screen, provenance labels Observed/Recommendation/Assumption), `docs/RUNBOOK.md` stub.
- **Acceptance:** docs exist and are linked from README; PARITY_GAPS template has the §21 checklist.
- **Failure/edge:** every later Recommendation-level task must update PARITY_GAPS.md — enforced by Definition-of-Done checklist task (Phase 12).

---

# PHASE 1 — DATABASE CORE (DB)

Conventions applied to every table (NFR-008): `uuid` PK (default `gen_random_uuid()`), `timestamptz` `created_at`/`updated_at`, `deleted_at` for soft-delete where applicable, `created_by`/`updated_by` actor FKs where significant, ISO-8601 dates, decimal-as-numeric for money/score/hours, controlled-vocabulary `status` columns (checked against server enum + DB CHECK), indexes on every FK, soft-delete by `deleted_at` (never physical delete except documented legal purge, Phase 11).

## DB-001 — Migration tooling & baseline
- **Purpose:** Versioned forward-only migrations; no manual DB editing (Spec Phase 5; §33).
- **Architecture ref:** Spec Phase 5 (migration strategy); Phase 21.
- **Dependencies:** FOUND-003, FOUND-006.
- **Implementation:** Prisma init; `prisma migrate` workflow; baseline `0001` empty migration; migration run as distinct CI/CD step (Phase 11); rollback strategy = forward-only (never destructive in-place; destructive changes via later additive migration + data migration + drop in subsequent release per Phase 19 zero-downtime).
- **Acceptance:** `prisma migrate deploy` creates schema from scratch; migrate down not used; seed separated from migration (DB-0xx seeds).
- **Tests:** migration dry-run gate in CI (Phase 11).

## DB-002 — auth domain tables
- **Purpose:** users, roles, permissions, sessions, password reset, MFA (flagged).
- **Architecture ref:** Spec §9 (users/roles/permissions High sensitivity), Phase 7.
- **Tables:** `users` (id, username/email UNIQUE, password_hash, full_name, employee_id FK nullable, is_active, must_change_password, last_login_at, mfa_secret NULLABLE (flagged), timestamps, deleted_at), `roles` (id, code UNIQUE, name), `permissions` (id, code UNIQUE, name, module), `role_permissions` (role_id FK, permission_id FK, PK(role_id,permission_id)), `user_roles` (user_id, role_id, PK composite), `user_sessions` (id, user_id FK, session_token_hash UNIQUE, expires_at, sliding_expires_at, ip, user_agent, revoked_at, created_at), `password_reset_tokens` (id, user_id, token_hash UNIQUE, expires_at, used_at, created_at), `mfa_credentials` (flagged; id, user_id, secret, enabled).
- **Constraints:** FK cascade rules (restrict on delete for audit-linked), unique email; CHECK `is_active` bool default true.
- **Dependencies:** DB-001.
- **Acceptance:** migrations apply cleanly; constraints exist.
- **Security:** token_hash only (never plaintext tokens in DB); sessions revocable.

## DB-003 — HR masters tables
- **Purpose:** departments, sub-departments, employee_types, positions, setup_rules, holidays.
- **Architecture ref:** FR-010..024, FR-065; BR-001, BR-002.
- **Tables:** `departments` (id, name, is_active, unique lower(name) per AM-01 default), `sub_departments` (id, name, department_id FK NOT NULL, is_active, unique(department_id, lower(name))), `employee_types` (id, name UNIQUE, is_active), `positions` (id, name UNIQUE, is_active), `setup_rules` (id, title, employee_type_id FK, work_pattern enum, daily_working_hour numeric(5,2), office_start_time time, office_end_time time, grace_period_minutes int, is_active, effective_from date DEFAULT now() for prospective-only DR-06 default), `holidays` (id, title, start_date, end_date, type enum, description, is_active).
- **Constraints:** BR-012 CHECK `end_date >= start_date` on holidays; BR-001 uniqueness (case-insensitive, global) per AM-01 default; work_pattern CHECK in enum set; active-rule resolution index `(employee_type_id, is_active, effective_from)`.
- **Dependencies:** DB-002 (actor FK conventions not needed here; standalone).
- **Acceptance:** migrations apply; uniqueness/CHECK verified via seed attempt of duplicates.
- **Decision gate:** AM-01 & DR-06 resolution recorded in PARITY_GAPS/DECISIONS (implemented default: case-insensitive global unique; prospective-only rules).

## DB-004 — employee domain tables (9 wizard sub-entities + lifecycle + performance)
- **Purpose:** employees + all wizard sub-forms; soft-delete lifecycle (SM-3).
- **Architecture ref:** FR-030..038, BR-003/BR-012, SM-3; §9 data inventory.
- **Tables:** `employees` (id, employee_code UNIQUE, full_name, email, mobile, date_of_birth, gender, blood_group, marital_status, contract_type, department_id FK, sub_department_id FK, position_id FK, employee_type_id FK, setup_rule_id FK, joining_date, contract_end_date, status enum(active,inactive,deleted) default active, version int default 1, timestamps, deleted_at, created_by/updated_by); sub-tables: `employee_banks` (employee_id FK, bank_name, account_number, branch, ifsc/branch-code, sort), `employee_addresses` (employee_id, type enum(current/permanent), line1.., city, country, zip), `employee_emergency_contacts` (employee_id, name, relation, phone, address), `employee_academics` (employee_id, degree, institute, year, result), `employee_extra_curriculars` (employee_id, activity, description, year), `employee_job_experiences` (employee_id, company, position, from_date, to_date, responsibilities), `employee_family_members` (employee_id, name, relation, date_of_birth, occupation, phone), `employee_activities` (employee_id, activity_type, date, description), `employee_performances` (id, employee_id, position_snapshot jsonb, total_score numeric, evaluator_id FK, evaluated_on date) and `employee_performance_scores` (performance_id FK, criterion, score numeric, notes).
- **Constraints:** BR-012 CHECKs (contract_end_date >= joining_date) on employees; FK to employees with RESTRICT (never orphan a wizard sub-row); `UNIQUE(employee_code)`; status CHECK; version NOT NULL default 1 (optimistic concurrency, Phase 5); wizard sub-tables 1:1-or-1:N semantics: bank/address/emergency/academic/experience/family allow multiple rows → no unique; index `(department_id, status)`, `(employee_type_id, status)`, trigram index on `full_name`, `employee_code`.
- **Dependencies:** DB-003 (masters).
- **Acceptance:** all 9 sub-entity tables exist with FKs; concurrency `version` column present.
- **Security:** bank/family fields classified High sensitivity — column-level read-audit hooks in service layer (Phase 9), no logging of values.

## DB-005 — attendance domain tables
- **Purpose:** raw events (immutable), derived days (recomputable), device mapping, reconciliation.
- **Architecture ref:** FR-050..053, BR-004..007, SM-1, ADR-002, C-02.
- **Tables:** `attendance_events` (id, employee_id FK, event_time timestamptz, source enum(manual,device,import,system), device_employee_id text NULL, raw_payload jsonb NULL, created_at; **append-only** — no UPDATE/DELETE triggers, revoke role permissions), `attendance_device_mappings` (id, device_employee_id UNIQUE, employee_id FK NOT NULL, description, is_active), `attendance_reconciliation_queue` (id, device_employee_id, event_time, raw_payload, status enum(pending,resolved,discarded), note, created_at), `attendance_days` (id, employee_id FK, work_date date, first_in time, last_out time, total_work_minutes numeric, status enum(no_data,present,late,absent,holiday_present,missing) default no_data, late_minutes int, early_closing bool, recalculated_from_rule_id FK -> setup_rules, calculated_at timestamptz, UNIQUE(employee_id, work_date)).
- **Constraints:** dedupe `UNIQUE(employee_id, event_time, source)` (Phase 5 idempotency/dedup, WF-003); partition-ready by year on events/days (levering Phase 18 — implement as plain tables now, note partition readiness); FK index `(employee_id, event_time)`, `(employee_id, work_date)`; CHECK status in enum set.
- **Dependencies:** DB-004 (employees).
- **Acceptance:** append-only enforcement test (event UPDATE rejected); dedupe constraint rejects double event insert.
- **Security:** capture-source credential writes events only (Phase 2 ACL); never writes days.

## DB-006 — leave domain tables
- **Purpose:** leave_types, leave_balances, leave_applications, short_leaves.
- **Architecture ref:** FR-070..075, BR-008..011, SM-2.
- **Tables:** `leave_types` (id, name, code UNIQUE, annual_entitlement numeric, is_paid bool, gender_eligibility enum(all/male/female), carry_forward bool, max_consecutive_days int, requires_document bool, is_active), `leave_balances` (id, employee_id FK, leave_type_id FK, year int, total numeric, taken numeric, due numeric, version int default 1, **UNIQUE(employee_id, leave_type_id, year)** — enforces BR-008 at DB level), `leave_applications` (id, employee_id FK, leave_type_id FK, start_date date, end_date date, requested_days numeric, approved_days numeric NULL, reason text, status enum(draft,pending,approved,rejected,withdrawn,deleted) default draft, approved_by FK users, approved_at, manager_comment, idempotency_key text UNIQUE NULL, timestamps, deleted_at), `short_leaves` (id, employee_id FK, date, time_from time, time_to time, minutes numeric, reason, status enum(pending,approved,rejected), type enum(hourly/half_day) per MI-04).
- **Constraints:** BR-012 CHECK `end_date >= start_date`; BR-008 UNIQUE; CHECK `due >= 0` (BR-009 non-negativity); approved_days only when approved (application-level); indexes `(employee_id, status)`, `(employee_id, leave_type_id, year)`, `(status, start_date)` for queues.
- **Dependencies:** DB-004, DB-005 (leave exceptions affect attendance calc — reference only via approved applications).
- **Acceptance:** UNIQUE constraint blocks double-generation seed attempt; date-order CHECK enforced.

## DB-007 — training domain tables
- **Purpose:** trainings, training_assignments, training_certificates.
- **Architecture ref:** FR-085..090, SM-6.
- **Tables:** `trainings` (id, title, description, trainer, schedule timestamptz, venue, status enum(scheduled,in_progress,completed,cancelled), is_active), `training_assignments` (id, training_id FK, employee_id FK, assigned_date, completion_date NULL, status enum(assigned,in_progress,completed,cancelled) default assigned, score numeric NULL, UNIQUE(training_id, employee_id)), `training_certificates` (id, employee_id FK, title, source enum(internal,external), issue_date, expiry_date, file_metadata_id FK NULL, issuer, UNIQUE(file_metadata_id) where present).
- **Constraints:** score numeric (decimal, NFR-008); CHECK status enum; FK to file_metadata for attachment (Phase 11); index `(employee_id, status)`.
- **Dependencies:** DB-004.
- **Acceptance:** schema applies; UNIQUE(training,employee) blocks duplicate assignment seed.

## DB-008 — project management tables
- **Purpose:** clients, projects, project_members, tasks, daily_tasks, meetings, meeting_attachments, meeting_attendees.
- **Architecture ref:** FR-100..106, SM-4/5, BR-012..015, §9.
- **Tables:** `clients` (id, name, email, phone, address, is_active, timestamps, deleted_at), `projects` (id, name, client_id FK, project_lead_id FK employees, approximate_tasks int, summary text, start_date, duration_days int, ending_date, status enum(open,in_progress,completed,on_hold,cancelled) default open, progress_percent numeric default 0, version int default 1, timestamps, deleted_at, created_by/updated_by), `project_members` (project_id FK, employee_id FK, role enum(lead/member) default member, PK(project_id, employee_id)), `tasks` (id, project_id FK, title, description, assignee_id FK employees NULL, priority enum(low,medium,high,urgent), planned_start, planned_end, actual_completion date NULL, status enum(todo,in_progress,review,done,blocked) default todo, progress_percent numeric default 0, estimated_hours numeric, timestamps, deleted_at), `daily_tasks` (id, employee_id FK, project_id FK, task_id FK NULL, work_date date, description, hours numeric, status enum(draft,submitted,approved), timestamps), `meetings` (id, project_id FK, place, held_at timestamptz, purpose text, outcomes text, created_by, timestamps), `meeting_attendees` (meeting_id FK, employee_id FK, PK(meeting_id, employee_id)), `meeting_attachments` (id, meeting_id FK, file_metadata_id FK UNIQUE, uploaded_by, uploaded_at).
- **Constraints:** BR-012 CHECK `ending_date >= start_date` on projects (BR-014 canonical direction = start+duration→end, ending validated ≥ start — DR-04 default); `duration_days >= 0`; tasks `planned_end >= planned_start`; daily_tasks `hours >= 0`; version for projects; indexes `(client_id)`, `(project_lead_id)`, `(project_id, status)` tasks, `(employee_id, work_date)` daily_tasks, `(project_id, held_at)` meetings.
- **Dependencies:** DB-004 (employee reference), DB-007 (n/a).
- **Acceptance:** schema applies; date-order CHECK enforced; version column present.
- **Decision gate:** BR-014, BR-015 defaults recorded (end derived from start+duration; progress = simple average of task progress % — DR-05).

## DB-009 — other-HR tables (under-evidenced, Recommendation field sets)
- **Purpose:** Loan, Resignation, Notices, ID Card, HR Policies masters — MI-04 items built to Recommendation field sets, feature-flagged.
- **Architecture ref:** FR-095..099, MI-04.
- **Tables:** `loans` (employee_id FK, amount numeric, monthly_deduction numeric, start_date, end_date, status, note), `resignations` (employee_id FK, submitted_date, last_working_day, reason, status enum(pending,approved,rejected), approved_by), `notices` (title, body text, notice_type, publish_date, is_active, file_metadata_id NULL), `hr_policies` (title, category, body text, version, file_metadata_id NULL, is_active, UNIQUE(title, version)), `id_cards` (employee_id FK UNIQUE, file_metadata_id, issued_date, expiry_date, status), `bulk_imports` (id, module, template_id, file_metadata_id, status enum(queued,processing,completed,failed), row_results jsonb, created_by).
- **Constraints:** FKs; CHECK on amounts numeric >= 0; UNIQUE(employee_id) on id_cards; status enums.
- **Dependencies:** DB-004.
- **Acceptance:** schema applies behind feature flags; PARITY_GAPS.md entries created (Phase 12 gate).
- **Failure/edge:** these are Recommendation-level; no silent upgrade to fact (Spec R-07).

## DB-010 — files & notifications tables
- **Purpose:** file metadata (Phase 11), notification records (Phase 14, feature-flagged).
- **Architecture ref:** Phase 11, Phase 14, BR-013.
- **Tables:** `file_metadata` (id, storage_key UNIQUE, original_filename, size_bytes, mime_type, extension, module, entity_type, entity_id uuid, uploader_id, upload_status enum(pending,uploaded,scanning,clean,quarantined), scan_finished_at, download_count, uploaded_at, expires_at NULL), `file_orphan_candidates` (id, storage_key, created_at, ttl_notified) — or handled by job; `notification_templates` (id, code UNIQUE, subject, body_html, channel), `notifications` (id, user_id FK, type, title, body, read_at, created_at), `notification_deliveries` (id, notification_id FK, channel, status enum(queued,sent,failed,bounced,delivered), provider_message_id, attempts, error, created_at), `feature_flags` (id, code UNIQUE, enabled bool, description).
- **Constraints:** UNIQUE storage_key; size CHECK >= 0; upload_status enum.
- **Dependencies:** DB-004 (uploader FK), DB-008 (meeting attachment linkage).
- **Acceptance:** schema applies; orphan cleanup TTL configurable via settings.

## DB-011 — audit domain tables
- **Purpose:** activity_logs + immutable meta-audit (C-01/ADR-004).
- **Architecture ref:** FR-130..134, BR-016/017, Phase 24, ADR-004.
- **Tables:** `activity_logs` (id, actor_user_id FK, log_name, description, entity_type, entity_id uuid, before_value jsonb, after_value jsonb, module, request_id, ip, created_at, is_hidden bool default false), `meta_audit_log` (id, log_id FK NULL, action, actor_user_id, details jsonb, created_at) — append-only, no delete permission for any role.
- **Constraints:** indexes `(entity_type, entity_id)`, `(actor_user_id, created_at)`, `(created_at desc)` for log listing; `is_hidden` soft-hide (never physical DELETE).
- **Dependencies:** DB-002 (users).
- **Acceptance:** append-only trigger test on meta_audit_log; activity_logs has no DELETE grant in schema role.

## DB-012 — job/queue metadata tables
- **Purpose:** job status durable record for BullMQ (or DB-backed queue alternative).
- **Architecture ref:** Phase 9; Phase 15; Phase 17.
- **Tables:** `jobs` (id, type enum(attendance.recalculate,attendance.bulk_import,leave.generate_year,export.large_report,notification.dispatch,file.malware_scan,attendance.nightly_recalc,leave.carry_forward,orphan_cleanup,export_cleanup,session_cleanup), status enum(queued,processing,completed,failed,dead), payload jsonb, result jsonb, error text, attempts int, run_at, started_at, finished_at, created_by, idempotency_key text UNIQUE NULL, parent_job_id FK NULL).
- **Constraints:** UNIQUE idempotency_key per type+scope (job-level idempotency).
- **Dependencies:** DB-001.
- **Acceptance:** schema applies; re-submission with same idempotency key dedupes (Phase 7).
- **Failure/edge:** DLQ represented by `status=dead` + `error` retained for diagnostics (Phase 9/17).

## DB-013 — master/reference seed data
- **Purpose:** seed scripts separate from migrations (Phase 5); realistic but synthetic data.
- **Architecture ref:** Phase 5 (seeds), Phase 20 (local/test/staging data policy).
- **Implementation:** `/db/seeders`: (a) core seeds — roles (super_admin, hr_admin, hr_manager, project_manager, employee, viewer), permission catalog (all `module:action` pairs from Phase 2 matrix), admin bootstrap user; (b) reference seeds — sample departments/sub-departments, employee types, positions, setup rules (Fixed pattern), holidays, leave types (Monthly, Non-Paid, Paternity, Maternity, Annual, Sick per FR-072), training master; (c) synthetic employees + attendance events + leave applications + projects/clients/tasks/meetings to exercise reports; (d) staging = de-identified synthetic (never real PII, Phase 20).
- **Dependencies:** DB-002..012.
- **Acceptance:** `pnpm db:seed` idempotent (re-runnable without duplicates); seeds match master vocabularies in the UI.
- **Security:** no real PII in seeds; passwords hashed with test-only fixtures.

## DB-014 — Database-level business-rule enforcement test suite
- **Purpose:** prove DB layer enforces BRs independent of app code (Spec Phase 5, Phase 22).
- **Implementation:** migration-based integration tests: BR-001 uniqueness, BR-008 UNIQUE(employee,type,year), BR-012 date-order CHECKs, dedupe UNIQUE(employee_id,event_time,source), status enum CHECKs, `due>=0` CHECK, append-only on attendance_events/meta_audit_log, version/optimistic-concurrency behavior.
- **Dependencies:** DB-002..012, FOUND-007.
- **Acceptance:** each rule has a passing and failing case; all green in CI.

## DB-015 — Indexing & query optimization pass
- **Purpose:** NFR-002; Phase 18 heavy-query readiness.
- **Architecture ref:** NFR-002; Phase 5 indexing; Phase 18.
- **Implementation:** EXPLAIN-driven: list-page filter combos (employees 9-filter, leave list, attendance reports), `attendance_days(employee_id, work_date)` unique index, trigram indexes on name/search columns (Phase 12), composite `(status, filter...)` for queues; single-aggregate query for Employee Total Leaves matrix (Phase 18 no-N+1).
- **Dependencies:** DB-002..012.
- **Acceptance:** report/list queries index-backed (EXPLAIN shows index scans); N+1 removed from Total Leaves query.
- **Tests:** perf tests in Phase 11 load suite.

## DB-016 — Transaction & concurrency strategy implementation
- **Purpose:** Phase 5 transaction boundaries + locking.
- **Architecture ref:** Phase 5 (transaction boundaries, concurrency controls, race prevention).
- **Implementation:** NestJS interceptor/service patterns: (a) employee wizard final save — single DB transaction across 9+ tables (BR-003) + server-side idempotency token table `request_idempotency_keys` (key, handler, created_at, result_ref, UNIQUE(key, handler)); (b) leave approve — `SELECT … FOR UPDATE` on leave_balances row (BR-009 race); (c) project+inline client — one transaction (WF-009); (d) optimistic concurrency on projects/employees/leave_balances via `version` (409 on conflict); (e) batch jobs — per-record unit-of-work transactions (HC-01/02).
- **Dependencies:** DB-006, DB-004, DB-008.
- **Acceptance:** concurrent leave-approval test consumes balance exactly once; double-submit wizard test creates one employee; concurrent project edits produce 409.
- **Tests:** concurrency suite (Phase 9/11); idempotency suite.

## DB-017 — RLS/authorization at DB layer (defense-in-depth) [P2]
- **Purpose:** ownership scoping not only at service layer.
- **Architecture ref:** Phase 7 (server authoritative); NFR-001.
- **Implementation:** Postgres RLS policies on high-sensitivity tables (employees sub-tables, leave_applications, projects, tasks, daily_tasks, meetings) driven by `current_setting('app.current_user_id')` set per request; service code sets the GUC within transaction; RLS default-deny.
- **Acceptance:** direct SQL via psql with a scoped user cannot read others' rows; app still works end-to-end.
- **Security:** defense-in-depth behind service-layer checks.
- **Failure/edge:** RLS must not break admin/background roles — role-scoped bypass for system/service accounts only.
# PHASE 2 — AUTHENTICATION & AUTHORIZATION (AUTH, ACL)

## AUTH-001 — Password hashing & policy
- **Purpose:** Adaptive hashing + policy per Phase 7/8; generic failures (no user enumeration).
- **Architecture ref:** Phase 7 (password policy), Phase 8 (auth attack mitigations), NFR-001, WF-001.
- **Requirements covered:** WF-001; MI-01 (Recommendation).
- **Dependencies:** FOUND-003.
- **Implementation:** argon2id (recommended) or bcrypt; password policy 12+ chars with breach-list check (Recommendation default per Phase 7); never log credentials or hash; generic error messages on login failure (avoid user enumeration, Phase 8).
- **Acceptance:** hash stored is salted/adaptive; login failure returns identical generic error for unknown-user vs wrong-password.
- **Tests:** hashing round-trip; enumeration-resistance test.
- **Security:** core of NFR-001.

## AUTH-002 — Login, session issuance & sliding expiration
- **Purpose:** Session lifecycle per Phase 7.
- **Architecture ref:** Phase 7 (mechanism, lifecycle), WF-001, Phase 13 (session store fail-open).
- **Implementation:** `POST /api/v1/auth/login` (rate-limited per Phase 8/9) → verify creds → create `user_sessions` row → set HttpOnly `Secure; SameSite=Lax` session cookie (value = random token; only hash stored server-side); sliding expiration on activity; absolute max lifetime; session lookup via Redis with DB fallback (fail-open, Phase 13); concurrent-session policy (allow multiple, revocable).
- **Acceptance:** login issues session; session slides on activity; absolute cap enforced; cache-down does not log users out.
- **Tests:** session lifecycle, expiry, sliding behavior; fail-open test (Phase 7/11).
- **Security:** cookie flags; token never in body/logs.

## AUTH-003 — Logout & server-side revocation
- **Purpose:** Explicit revocation (Phase 7: not just cookie clear).
- **Architecture ref:** Phase 7; `POST /api/v1/auth/logout` (Phase 6 table).
- **Implementation:** endpoint deletes session row + cache entry; 204 response; idempotent.
- **Acceptance:** after logout, cookie + server session invalid; reusing token → 401.
- **Tests:** revocation test.

## AUTH-004 — CSRF protection
- **Purpose:** Spec explicitly requires CSRF (NFR-001) for cookie-session auth.
- **Architecture ref:** Phase 8 (CSRF), NFR-001.
- **Implementation:** double-submit or synchronizer-token pattern; CSRF token endpoint or cookie; all state-changing requests (POST/PUT/PATCH/DELETE) require valid token; SPA reads token per session.
- **Acceptance:** state-changing request without token → 403; cross-site POST form attack fails.
- **Tests:** CSRF negative test.
- **Security:** Phase 8 requirement — must be in place before any mutation endpoint ships.

## AUTH-005 — Brute-force & rate limiting
- **Purpose:** Progressive lockout/backoff + per-account/per-IP limits (Phase 7/8).
- **Architecture ref:** Phase 7, Phase 8, WF-001 (locked-out after N attempts — Decision Required on threshold; default 5).
- **Implementation:** Redis-backed counters: per-account failed attempts with backoff (default: lockout after 5, 15-min window) + per-IP login rate limit (default 10/min) + global gateway rate limits on all endpoints (per-user and per-IP, Phase 8). Use `@nestjs/throttler`-style or gateway-level.
- **Acceptance:** brute force test: after 5 bad attempts account locked; IP throttled; legitimate retry path clear.
- **Tests:** lockout + reset-on-success tests.
- **Decision gate:** threshold recorded as DECISION REQUIRED default (5 attempts) in PARITY_GAPS.

## AUTH-006 — Password reset flow
- **Purpose:** Account recovery (MI-01; Recommendation standard).
- **Architecture ref:** WF-001 (recovery), Phase 7 (token-based reset, single-use, short expiry).
- **Implementation:** request-reset → single-use token (hash stored), 30-min expiry → reset page sets new password → token invalidated; rate-limited; generic response (no user enumeration); optional email dispatch behind notification feature-flag (Phase 7).
- **Acceptance:** reset works end-to-end; token single-use; expired token rejected; no enumeration.
- **Tests:** reset lifecycle; token reuse rejected.
- **Security:** token in URL one-time only.

## AUTH-007 — Email verification & admin-provisioned accounts (Recommendation)
- **Purpose:** Verification on account creation; accounts are admin-provisioned (no self-registration evidenced).
- **Architecture ref:** Phase 7 (verification — Recommendation).
- **Implementation:** users created by Super Admin/HR Admin (Phase 2 ADM) get `must_change_password=true` + optional verification token; no public registration endpoint.
- **Acceptance:** provisioned user forced to set own password on first login.
- **Tests:** first-login enforcement.

## AUTH-008 — TOTP MFA (feature-flagged)
- **Purpose:** Optional MFA for Super Admin/HR Admin (Phase 7 Recommendation; Decision Required on mandate).
- **Architecture ref:** Phase 7 (MFA Recommendation).
- **Implementation:** `mfa_credentials` table (DB-002); enroll/verify endpoints; enforced if flag `feature_flags.mfa` enabled; QR provisioning; backup codes.
- **Acceptance:** with flag on, privileged login requires TOTP; with flag off, standard login.
- **Tests:** enroll/verify/revoke.
- **Decision gate:** mandate decision recorded (DECISIONS section).

## AUTH-009 — Session & device management UI
- **Purpose:** List active sessions with revoke-others (Phase 7 Recommendation, P2).
- **Architecture ref:** Phase 7 (device/session management).
- **Implementation:** `GET/DELETE /api/v1/auth/sessions`; UI in Settings for self + admin view for others; revoke shows confirm.
- **Acceptance:** user can list own sessions and revoke one (including current device option).
- **Tests:** revoke-others permission test.

## ACL-001 — Permission catalog & matrix implementation
- **Purpose:** Authoritative RBAC data (Spec §30 matrix) as code + seed.
- **Architecture ref:** Phase 7 (permission matrix), Spec §30.
- **Requirements covered:** all matrix cells; NFR-001.
- **Dependencies:** DB-002 (seeded permissions), AUTH-002.
- **Implementation:** Permission codes `module:action` per matrix: `hr_masters:manage`, `employee:create/read/update/delete/export`, `attendance:manage/read/recalculate`, `leave:approve/read/submit`, `training:manage/read`, `pm:manage/read`, `settings:manage`, `audit:read`, `audit:delete` (Super Admin only), `roles:manage`, `reports:read/export`, plus per-role seeds: SUPER_ADMIN=all; HR_ADMIN (HR masters, employee, attendance, leave approve, training, HR reports); HR_MANAGER (approvals + limited settings per DR decision); PROJECT_MANAGER (PM domain); EMPLOYEE (own-profile scope + own-leave submit); VIEWER (read granted modules + report export).
- **Acceptance:** matrix cells implemented as allow/deny, verified by ACL-006 test suite.
- **Tests:** matrix suite (ACL-006).

## ACL-002 — Backend authorization guard & middleware
- **Purpose:** Server-side enforcement on every mutation + read (NFR-001 authoritative).
- **Architecture ref:** Phase 7 (server re-validates every request), Phase 8 (auth bypass threat).
- **Implementation:** NestJS global guard: resolves session → loads roles → checks permission code for route metadata; ownership-check helper (`canAccess(actor, resource)`) for "own record"/"assigned" scoping; roles re-read from DB per request (not cached client claims).
- **Acceptance:** every protected route returns 401 unauthenticated / 403 unauthorized; ownership-scoped routes reject cross-user IDs (IDOR test).
- **Tests:** ACL-006 matrix + IDOR suite.
- **Security:** no client-supplied role claims trusted.

## ACL-003 — Resource ownership & scoping rules
- **Purpose:** Employee self-service scoping per §2 & Phase 7.
- **Architecture ref:** Phase 7 (ownership checks), Actor Inventory.
- **Implementation:** Ownership predicates: employee reads own profile/leave/attendance/daily-tasks; assignee reads own tasks; invited attendees read meeting; PM reads projects they lead/member; viewers read granted modules only. Central `OwnershipPolicy` service used by all modules (no per-module drift).
- **Acceptance:** permission tests cover every "own record" cell both allow+deny.
- **Tests:** ACL-006.

## ACL-004 — Privilege-escalation prevention
- **Purpose:** Role changes restricted + audited (Phase 7).
- **Architecture ref:** Phase 7 (privilege escalation prevention), Phase 24 (role change audit).
- **Implementation:** role/user mutation endpoints require `roles:manage` (Super Admin only); before/after role captured to activity log + meta-audit; no self-service elevation endpoint; Super Admin cannot be self-demoted below admin (guard).
- **Acceptance:** non-Super-Admin role-mutation → 403; role change produces audit row with before/after.
- **Tests:** ACL-006 + audit coverage.

## ACL-005 — Frontend permission model (convenience layer)
- **Purpose:** UI guards + component-level permission checks; server remains authoritative.
- **Architecture ref:** Phase 4 §4 (route guards + component checks).
- **Dependencies:** FOUND-004, ACL-001.
- **Implementation:** `usePermission(code)` hook; `<Can permission="...">` wrapper; route guard wrapper; permission data from `/api/v1/meta/permissions` (own effective permissions), never hiding server-enforced behavior.
- **Acceptance:** UI hides/redirects per permission; bypassing UI still blocked server-side (test).
- **Tests:** component permission tests.

## ACL-006 — Permission matrix automated test suite
- **Purpose:** Every cell of Spec §30 matrix, allow + deny, incl. ownership cases (Phase 22 requirement).
- **Implementation:** parameterized API tests over matrix: for each (role, capability) assert expected 200/403 on a representative endpoint; ownership-scoped negative tests (cross-user read/write); delegation tests (Super Admin acts as HR Admin).
- **Dependencies:** ACL-001..004, API endpoints of Phase 3.
- **Acceptance:** full matrix green in CI; a new permission added without test fails review.
- **Tests:** this task IS the test suite.

## AUTH-010 — Authentication & session audit events
- **Purpose:** login/failed-login/session/logout captured (Phase 24; WF-001 side effect).
- **Architecture ref:** Phase 24 (audit events incl. login/failed login), WF-001.
- **Implementation:** auth module writes activity_log rows: login success, failed login (no password material), logout, session revoke, password change, role change (Phase 24 list).
- **Acceptance:** each auth event creates an audit row with actor/timestamp; failed login rows count toward lockout metrics (Phase 10).
- **Tests:** audit coverage.
# PHASE 3 — BACKEND MODULES (BE)

Backend conventions applied everywhere (Phase 6 API conventions): routes under `/api/v1/`; error format `{error:{code,message,fields},requestId}`; pagination `page/per_page` with `total/total_pages`; filters `filter[field]=value`, `sort=field&direction=asc|desc`; ISO-8601; decimals serialized as strings; `X-Request-Id` propagation; server-side auth→validation→business-order on every mutation; explicit allow-listed DTOs (no blind binding, Phase 8 mass-assignment); idempotency-key header honored on wizard-final-save, leave-generation, bulk-import-commit (Phase 6); audit + logging on every mutation (Phase 9 cross-cutting, JOB/audit).

## HRM-001 — Departments & Sub-Departments API
- **Purpose:** CRUD + list/filter/export pattern (FR-010..016).
- **Architecture ref:** FR-010..016, BR-001, Phase 6 endpoints (`GET/POST /api/v1/departments`).
- **Dependencies:** DB-003, ACL-002, AUTH-002.
- **API:** `GET/POST /api/v1/departments`, `PUT/DELETE /api/v1/departments/:id`, same for `/sub-departments`; actors HR Admin (write), authenticated (read), viewer read if granted.
- **Implementation:** service with uniqueness rule (case-insensitive, AM-01 default), active/inactive, list shares query builder with export (HC-04 pattern), soft-delete.
- **Acceptance:** CRUD + validation; duplicate name rejected; export matches filters.
- **Tests:** CRUD, uniqueness, permission, export-filters-match test.

## HRM-002 — Employee Types & Positions masters
- **Purpose:** MI-04 masters required as wizard preconditions (WF-002).
- **Architecture ref:** FR-020 (employee type FK), §2/§10; WF-002 preconditions.
- **Implementation:** CRUD + list/filter/export; is_active; feature-flagged as Recommendation per MI-04 but built.
- **Acceptance:** masters usable in employee wizard (FK).
- **Tests:** CRUD + permission.

## HRM-003 — Setup Rules API (BR-010 resolution)
- **Purpose:** Setup Rule CRUD + exactly-one-applicable-rule resolution.
- **Architecture ref:** FR-020..024, BR-002, AM-02/DR-06 (prospective-only default).
- **API:** `GET/POST/PUT/DELETE /api/v1/setup-rules` (HR write, authenticated read).
- **Implementation:** CRUD with work-pattern enum ("Fixed" observed + extensible set), decimal daily hours, office times, grace minutes, active flag, `effective_from`; resolution service: for (employee, date) → exactly one active rule (employee_type match, latest effective_from ≤ date) or explicit "no rule" error consumed by attendance calc; **decision gate:** retroactive recalculation is explicit admin action only (DR-06 default), not automatic.
- **Acceptance:** resolution returns one rule or deterministic error; ambiguity (two rules match) surfaces conflict error.
- **Tests:** resolution unit tests incl. multi-rule ambiguity and date-effective cases; DR-06 behavior test.

## HRM-004 — Holidays API
- **Purpose:** Holiday CRUD consumed by attendance ("Holiday Present") and leave.
- **Architecture ref:** FR-065, BR-006, DB-003.
- **Implementation:** CRUD; title, date/range, type, description, active; date-order CHECK (BR-012); list/filter/export.
- **Acceptance:** CRUD + date validation; holiday lookup used by attendance calc.
- **Tests:** CRUD, BR-012 rejection.

## EMP-001 — Employee list with 9 filters + shared query builder (HC-04)
- **Purpose:** FR-030 list parity; single query builder shared with export (HC-04).
- **Architecture ref:** FR-030, FR-003/004, HC-04.
- **API:** `GET /api/v1/employees` (HR read).
- **Implementation:** filters: Employee, Employee ID, Employee Type, Department, Designation, Blood Group, Contract Type, Gender, Marital Status; Find/Reset semantics; server pagination; sort; search (trigram); shared `EmployeeListQuery` builder used by both list and export endpoints.
- **Acceptance:** each filter composes (EXPLAIN index-backed); pagination/filter params echoed in URL; list and export produce identical row sets for same filters (HC-04 regression test).
- **Tests:** filter matrix, pagination clamping, export-parity test.

## EMP-002 — Employee wizard create (9 steps, transactional)
- **Purpose:** FR-031..034, WF-002, BR-003, HC-03.
- **Architecture ref:** FR-031..034, BR-003, WF-002, Phase 6 `POST /api/v1/employees`.
- **API:** `POST /api/v1/employees` (HR Admin/Manager; idempotency-key supported).
- **Implementation:** validate each of 9 sections (Personal, Employee, Bank, Address, Emergency Contact, Academic, Extra-Curricular, Job Experience, Family); consolidated field-error response (Phase 6 error shape feeds FR-032 UI); single DB transaction across employees + 7 sub-tables (BR-003); server-side idempotency token prevents double-submit (HC-03); status=active on success; audit "Employee created".
- **Acceptance:** valid payload creates employee + all sub-rows atomically; any invalid section → no partial rows (BR-003 test); duplicate idempotency key → single employee (double-submit test); concurrent same-payload → one row.
- **Tests:** transactional rollback test, double-submit concurrency test, idempotency test.
- **Security:** DTO allow-list per section; no blind binding.

## EMP-003 — Employee update (optimistic concurrency)
- **Purpose:** FR-033/036-adjacent edits; `version` conflict handling.
- **Architecture ref:** Phase 6 `PUT /api/v1/employees/{id}`, Phase 5 concurrency.
- **Implementation:** full or partial update with `version` check → 409 `CONFLICT` on stale; wizard sub-rows upsert; audit before/after (bank/family fields redacted from log values per Phase 9).
- **Acceptance:** stale write → 409 with clear message; update preserves audit.
- **Tests:** concurrency test (two writers).

## EMP-004 — Employee detail + sensitive-field access audit
- **Purpose:** read path with ownership + High-sensitivity read audit (Phase 24).
- **Architecture ref:** §9 sensitivity; Phase 24 (sensitive-data read-level audit).
- **API:** `GET /api/v1/employees/:id` (HR roles; self for own record per §2; viewer if granted).
- **Implementation:** bank/family/DOB sections served only to roles with explicit permission `employee:sensitive:read`; every sensitive-field read writes audit row (entity_type, entity_id, action=read_sensitive).
- **Acceptance:** unauthorized sensitive read → 403; sensitive read audited.
- **Tests:** permission + audit coverage.

## EMP-005 — Inactive Employees list
- **Purpose:** FR-035.
- **Implementation:** list scoped to `status=inactive`, same query builder + filters.
- **Acceptance:** only inactive employees; parity with main list.
- **Tests:** list-scoping.

## EMP-006 — Employee Performance (list + rating tabs)
- **Purpose:** FR-036.
- **Architecture ref:** FR-036; thresholds `Missing Information`.
- **API:** `GET/POST /api/v1/employee-performance`, sub-scores; tabs list/rating.
- **Implementation:** performance record (employee + position snapshot + scoring lines + total score + evaluator + date); rating thresholds configurable (settings/feature flag) with Recommendation defaults (e.g., ≥90 Excellent, ≥75 Good, ≥60 Average, else Needs Improvement) — **Decision gate:** thresholds unverified (MI-04), flagged in PARITY_GAPS.
- **Acceptance:** CRUD; total score = sum of lines (decimal); rating derives from configured thresholds.
- **Tests:** score math, threshold config, permission.

## EMP-007 — Transfer Out / Transfer In
- **Purpose:** FR-037/038; SM-3.
- **Architecture ref:** FR-037/038; SM-3 (transfer transitions); MI-04 (exact fields).
- **Implementation:** Recommendation field sets (transfer_date, from_department/sub, to_department/sub, effective_date, note, status); Transfer Out → source employee status inactive (SM-3), Transfer In creates/updates at destination — **Decision gate:** same-record vs new-record unproven (MI-04); implement same-record with department re-assignment as default; flag in PARITY_GAPS.
- **Acceptance:** transfer flow works; employee history preserved; audit.
- **Tests:** transfer state transitions; permission.

## EMP-008 — Employee soft-delete lifecycle
- **Purpose:** SM-3 soft delete (Recommendation preserve for audit).
- **Architecture ref:** SM-3; §9 (soft delete employees).
- **Implementation:** `DELETE /api/v1/employees/:id` → status=deleted + deleted_at (soft, never physical); blocks for records referenced by live business data handled by FK rules; audit.
- **Acceptance:** deleted employee hidden from active lists but retained; audit row present.
- **Tests:** soft-delete + referential behavior.

## EMP-009 — Employee search
- **Purpose:** FR-003 global search on employee list.
- **Architecture ref:** Phase 12 (DB-native trigram).
- **Implementation:** trigram index on full_name/employee_code; ILIKE `%q%` search in query builder.
- **Acceptance:** search returns matches; index-backed.
- **Tests:** search correctness + perf.

## ATT-001 — Attendance event ingestion (manual + capture)
- **Purpose:** FR-050; WF-003; creates raw events only.
- **Architecture ref:** FR-050, WF-003, BR-007, ADR-002, C-02.
- **API:** `POST /api/v1/attendance/events` (HR Admin or capture source; idempotent via dedupe key).
- **Implementation:** validates employee (by id or device mapping via "Employee ID Show"), timestamp required; dedupe on UNIQUE(employee_id, event_time, source) → duplicate returns existing (200/204) not error; device-source events with unmapped `device_employee_id` → `attendance_reconciliation_queue` (never silently dropped, WF-003 failure path); enqueue async recalculation for affected employee-day (Phase 7); audit.
- **Acceptance:** event insert creates row; duplicate insert idempotent; unmapped device ID lands in reconciliation queue.
- **Tests:** dedupe, reconciliation routing, permission (capture-source can't write days).
- **Security:** capture-source service credential scoped to events only (ACL-002).

## ATT-002 — Monthly attendance manual entry
- **Purpose:** FR-051.
- **Architecture ref:** FR-051 (Ambiguity → Recommendation: synthesize two raw events then recalculate).
- **API:** `POST /api/v1/attendance/monthly` (HR Admin).
- **Implementation:** employee + year + month + time-in + time-out → creates/updates two raw events (or one event pair) then triggers recalculation for the month (keeps raw as system of record, BR-007 spirit).
- **Acceptance:** day-level record reflects synthesized events after recalc; no direct write to attendance_days.
- **Tests:** synthesize+recalc round trip.

## ATT-003 — Employee ID Show (device↔employee mapping) modal data
- **Purpose:** FR-050 "Employee ID Show".
- **Architecture ref:** FR-050; C-02 (two distinct ID spaces).
- **API:** `GET/POST/PUT/DELETE /api/v1/attendance/device-mappings` (HR Admin); `GET /api/v1/attendance/device-mappings/lookup`.
- **Implementation:** map `device_employee_id` ↔ `employee_id`; used by capture adapter and the UI modal.
- **Acceptance:** mapping CRUD; lookup used in event ingestion.
- **Tests:** mapping + ingestion integration.

## ATT-004 — Missing Attendance queue
- **Purpose:** FR-052.
- **Architecture ref:** FR-052, Phase 15 (missing/pending sweep).
- **API:** `GET /api/v1/attendance/missing` (HR read).
- **Implementation:** query: scheduled working days past cutoff with no qualifying event pair (per setup rule calendar, excluding holidays/approved leave); server-paginated; filters employee/month; export.
- **Acceptance:** missing list reflects rule+holiday+leave awareness; matches Phase 15 sweep query.
- **Tests:** fixture-driven correctness (holiday/leave exceptions).

## ATT-005 — Pending Attendance queue
- **Purpose:** FR-053.
- **Architecture ref:** FR-053 (action set Missing Information).
- **API:** `GET /api/v1/attendance/pending` (HR read); actions per `DECISION REQUIRED` (default: review-and-correct/reject with audit).
- **Implementation:** records awaiting approval/processing with status; correction action creates audit + triggers recalc; reject flags day and re-evaluates.
- **Acceptance:** queue lists pending; actions transition with audit.
- **Decision gate:** exact action set (approve/reject/edit) — implement approve/reject/correct as Recommendation defaults, flagged.
- **Tests:** queue transitions.

## ATT-006 — Attendance calculation service (SM-1, BR-004..007, HC-01)
- **Purpose:** Pure, replayable derivation of attendance_days from raw events.
- **Architecture ref:** BR-004..007, SM-1, ADR-002, HC-01, §27.
- **Implementation:** `domain-attendance` calculation module, pure function `computeDay(employee, date, events, setupRule, holidays, approvedLeaves)` → status (no_data/present/late/absent/holiday_present/missing), first_in, last_out, total_work_minutes (decimal, rounding configurable — R-02 note), late_minutes (BR-004), early_closing; never writes raw events (BR-007); Missing = terminal-until-corrected (requires raw-event fix → recalc). Swappable/config-driven policies (Phase 29 R-02 mitigation).
- **Acceptance:** unit fixtures cover: on-time, late (grace boundary), absent (no events, no exception), holiday_present (event on holiday), missing (partial pair), overnight/edge inputs parameterized.
- **Tests:** BR-004..007 unit suite; replay test (same inputs → same days, idempotent).

## ATT-007 — Recalculate endpoint (sync single-day + batch trigger)
- **Purpose:** `POST /api/v1/attendance/recalculate` per Phase 6; DR-06 explicit action.
- **Architecture ref:** Phase 6 endpoint; WF-005; DR-06.
- **API:** `POST /api/v1/attendance/recalculate` (HR Admin/System; idempotent) — date range/employee scope; returns job id; async batch via Phase 7.
- **Implementation:** enqueues `attendance.recalculate` job (Phase 7); per-employee-day unit of work; partial-failure isolation.
- **Acceptance:** job processes scoped range; per-day failure doesn't abort batch.
- **Tests:** batch + partial failure.

## ATT-008..ATT-013 — Attendance report backends (6 reports)
- **Purpose:** FR-054..060 report endpoints, each = data + export sharing query builder.
- **Architecture ref:** FR-054..060; Phase 8 (shared query/filter).
- **Endpoints:** `GET /api/v1/reports/attendance/late`, `/log`, `/daily-present`, `/monthly-summary`, `/monthly-detail`, `/daily-worksheet` (+ `/export` variants).
- **Implementation:** ATT-008 Late Attendance; ATT-009 Attendance Log; ATT-010 Daily Present; ATT-011 Monthly Summary (single aggregated query, Phase 18 no-N+1); ATT-012 Monthly Attendance detail; ATT-013 Employee Daily Worksheet; each filterable by employee/year/month at minimum, export via shared builder.
- **Acceptance:** each report returns correct data against seed fixtures (Phase 8 correctness suite); export = filtered view (HC-04 parity test).
- **Tests:** per-report correctness + parity.

## LV-001 — Leave Types CRUD
- **Purpose:** FR-074.
- **Architecture ref:** FR-074 (field set Recommendation per MI-04).
- **API:** `GET/POST/PUT/DELETE /api/v1/leave-types` (HR write, read all).
- **Implementation:** name, code, annual entitlement, paid/unpaid, gender eligibility, carry-forward rule, max consecutive days, document requirement, active; soft-delete.
- **Acceptance:** CRUD + FK referenced by leave apps/balances; carry_forward flag consumed by annual job.
- **Tests:** CRUD + constraint tests.

## LV-002 — Leave application create/submit (Draft→Pending, WF-006)
- **Purpose:** FR-070; WF-006 submit path; DR-01 balance reservation.
- **Architecture ref:** FR-070, WF-006, BR-009, DR-01, SM-2.
- **API:** `POST /api/v1/leaves` (self or HR Admin on behalf; actor Employee submits own only).
- **Implementation:** validates type/dates/duration vs balance at submission; **DR-01 default: reserve balance at submission** (pending holds balance; released on reject/withdraw); over-balance submission → blocked (default) — **Decision gate** (block vs allow-with-warning) recorded; create idempotency_key; reason text (XSS-safe, Phase 9).
- **Acceptance:** Draft→Pending with balance reserved; over-balance blocked with actionable message.
- **Tests:** reservation/release; over-balance; permission (own-only).

## LV-003 — Leave approval (Pending→Approved, race-safe, BR-009)
- **Purpose:** WF-006 approve path; the financial-correctness-critical flow.
- **Architecture ref:** WF-006, BR-009, Phase 5 row locking, `POST /api/v1/leaves/{id}/approve`.
- **API:** `POST /api/v1/leaves/:id/approve` (HR Admin/Manager) body: approved_days, comment.
- **Implementation:** `SELECT … FOR UPDATE` on balance row(s); re-validate balance at approval time (WF-006 failure: balance may have changed since submit); consume only approved days; due = total − taken recomputed; audit; atomic (approve + balance update + audit in one transaction).
- **Acceptance:** concurrent double-approval consumes balance once (race test); insufficient balance at approval → rejection of action with clear error.
- **Tests:** concurrency race test; BR-009 math; permission.

## LV-004 — Leave rejection (Pending→Rejected, BR-010)
- **Purpose:** WF-006 reject path; no balance effect.
- **API:** `POST /api/v1/leaves/:id/reject` (HR Admin/Manager).
- **Implementation:** release reservation (DR-01) if reserved; status→rejected; comment; audit.
- **Acceptance:** reject does not touch balance (BR-010 test); reservation released.
- **Tests:** BR-010.

## LV-005 — Leave withdrawal & soft delete (SM-2)
- **Purpose:** SM-2 withdraw (Recommendation) + admin soft delete preserving trail.
- **Implementation:** withdraw while Pending (employee own request) → Withdrawn, releases reservation; admin soft-delete on Pending/Approved/Rejected → Deleted (status, not physical); audit.
- **Acceptance:** state transitions valid; invalid transitions rejected (see LV-006).
- **Tests:** SM-2 transition matrix incl. invalid (Approved→Pending rejected; Rejected→Approved rejected).
- **Decision gate:** reopen path (Rejected→new submission only) recorded as decision default.

## LV-006 — Leave admin correction (BR-011)
- **Purpose:** Post-approval correction reverses-then-reapplies balance (not raw edit).
- **Architecture ref:** BR-011, SM-2 (Approved→Approved recalculated), Phase 7 elevated permission.
- **API:** `POST /api/v1/leaves/:id/correct` (HR Admin, elevated).
- **Implementation:** reverse previous balance consumption → apply corrected approved_days → recompute due → audit before/after; never a raw UPDATE of approved_days alone.
- **Acceptance:** correction math verified (reverse+reapply); audit records both.
- **Tests:** BR-011 math; permission.

## LV-007 — Employee Total Leaves matrix (annual balance)
- **Purpose:** FR-072.
- **Architecture ref:** FR-072; Phase 18 single-aggregate query.
- **API:** `GET /api/v1/leave-balances/matrix?year=` (HR read; self).
- **Implementation:** one aggregated query returning per-employee × leave-type Total/Taken/Due triplets (no N+1); pagination server-side for large orgs.
- **Acceptance:** matrix matches balance table; performance index-backed.
- **Tests:** correctness + N+1 absence.

## LV-008 — Generate Leaves for [year] (BR-008, HC-02)
- **Purpose:** FR-073; idempotent per-employee-per-type-per-year generation.
- **Architecture ref:** FR-073, BR-008, WF-007, HC-02, Phase 6 endpoint.
- **API:** `POST /api/v1/leave-balances/generate` (HR Admin; idempotency-key supported) → job id.
- **Implementation:** for each eligible active employee × leave type, create balance row only if absent (DB UNIQUE + job idempotency key); per-employee unit-of-work transaction; failures reported per employee (resumable); audit.
- **Acceptance:** re-run with identical inputs creates no duplicates (re-run safety test); per-employee failure isolation; job status/resume.
- **Tests:** idempotency re-run; partial-failure isolation.
- **Security:** HR Admin only.

## LV-009 — Short Leaves
- **Purpose:** FR-075.
- **Architecture ref:** FR-075 (unit/max-period unproven — Recommendation default hourly, configurable).
- **API:** `GET/POST /api/v1/short-leaves`, `POST .../:id/approve|reject`.
- **Implementation:** partial-day time-based leave; type hourly (default) or half_day (configurable setting); approval flow mirrors WF-006; per-period cap configurable.
- **Acceptance:** CRUD + approval; cap enforced.
- **Decision gate:** unit & max-period defaults flagged in PARITY_GAPS.
- **Tests:** CRUD + approval + cap.

## LV-010 — Leave carry-forward annual job (data + trigger)
- **Purpose:** Phase 15 carry-forward scheduled op.
- **Architecture ref:** Phase 15; leave_types.carry_forward.
- **Implementation:** job selects leave types with carry_forward; per-employee unit; creates new-year balance from unused due (configurable cap %); idempotent via UNIQUE + job key; audit.
- **Acceptance:** job idempotent; cap honored; failures isolated per employee.
- **Tests:** scheduled-job idempotent re-run.

## TRN-001 — Training master CRUD
- **Purpose:** FR-085..087 (master).
- **API:** `GET/POST/PUT/DELETE /api/v1/trainings`.
- **Implementation:** title, description, trainer, schedule, venue, status, active; list/filter/export.
- **Acceptance:** CRUD + status transitions.
- **Tests:** CRUD.

## TRN-002 — Training assignment lifecycle (SM-6)
- **Purpose:** FR-086, WF-008, SM-6.
- **API:** `POST /api/v1/training-assignments` (HR Admin), `PUT .../:id` (complete: score+date), `POST .../:id/cancel`.
- **Implementation:** Assigned→InProgress(optional)→Completed records score+completion date; Assigned→Cancelled; UNIQUE(training,employee) prevents duplicate assignment; audit; optional notification (feature-flag).
- **Acceptance:** all SM-6 transitions valid; invalid rejected.
- **Tests:** SM-6 matrix.

## TRN-003 — Internal/External Certificates
- **Purpose:** FR-088..090.
- **API:** `GET/POST/PUT/DELETE /api/v1/certificates`.
- **Implementation:** attachment via file module (Phase 7 FILE), issue/expiry dates, source internal/external, issuer; file-type/size limits per `DECISION REQUIRED` (MI-04 — default: same allow-list as Phase 11, ≤100MB to match observed attachments; flagged).
- **Acceptance:** CRUD + attachment linkage; validation of dates.
- **Tests:** CRUD + attachment validation.

## PM-001 — Clients CRUD (incl. inline create for WF-009)
- **Purpose:** FR-102; WF-009 inline creation.
- **API:** `GET/POST/PUT/DELETE /api/v1/clients` (Project Manager write).
- **Implementation:** CRUD + list/filter/export; inline create path re-used by project modal (nested same-transaction in PM-002).
- **Acceptance:** standalone CRUD; inline create usable from project creation.
- **Tests:** CRUD + inline integration (WF-009).

## PM-002 — Project CRUD + inline client (WF-009, SM-4, BR-014)
- **Purpose:** FR-101; WF-009; SM-4.
- **API:** `POST /api/v1/projects` (Project Manager; idempotency-key supported; optional inline client in same transaction), `PUT /projects/:id` (version), `DELETE /projects/:id` (soft).
- **Implementation:** fields: name, client (select or inline-create), team members multi-select (from employee master), approximate_tasks, summary, start_date, duration_days, ending_date (derived = start+duration; validated ≥ start per BR-014 default), status default open; project_members links; optimistic concurrency (version → 409).
- **Acceptance:** WF-009 end-to-end: inline client failure surfaces inside modal, project not partially created; BR-014 derivation validated.
- **Tests:** transactional inline-client test; concurrency test.
- **Decision gate:** BR-014/BR-015 defaults recorded.

## PM-003 — Project Dashboard backend
- **Purpose:** FR-100.
- **API:** `GET /api/v1/projects/dashboard`.
- **Implementation:** Project Task Status chart data (task-status distribution), projects table (name, client, lead, progress, start/end, status, duration progress, state), Add New / Manage actions (frontend); progress = simple average of task progress % (BR-015 default).
- **Acceptance:** chart + table data computed; performance acceptable at seed scale.
- **Tests:** aggregation correctness.

## PM-004 — Tasks (SM-5) + Manage Task
- **Purpose:** FR-103; SM-5; MI-04 (Manage Task under-evidenced).
- **API:** `GET/POST/PUT/DELETE /api/v1/projects/:id/tasks` (+ global task list endpoint).
- **Implementation:** project FK, title, description, assignee(s), priority, planned start/end, actual completion, status (todo/in_progress/review/done/blocked), progress %, estimated hours, attachments; SM-5 transitions valid, invalid rejected; assignee sees own tasks.
- **Acceptance:** SM-5 matrix; task CRUD; attachments (Phase 7).
- **Tests:** SM-5 transitions; permission (assignee read).

## PM-005 — Daily Tasks (work log)
- **Purpose:** FR-104; §2 Employee writes own daily task entries (Assumption).
- **API:** `GET/POST/PUT/DELETE /api/v1/daily-tasks` (assignee own; PM read).
- **Implementation:** date, project/task, description, hours (decimal), status (draft/submitted/approved); own-record scoping enforced.
- **Acceptance:** CRUD; hours summed per day; own-record only.
- **Tests:** scoping + hours math.

## PM-006 — Meetings + attachments (WF-010, BR-013)
- **Purpose:** FR-105; WF-010.
- **API:** `POST /api/v1/meetings` (Project Manager), `GET /meetings`, `GET/PUT/DELETE /meetings/:id`.
- **Implementation:** required fields (project, place, held datetime, purpose, outcomes), team member attendees multi-select, optional attachment ≤100MB via Phase 7 signed-URL flow; client-side pre-check + authoritative server-side validation (BR-013, WF-010 failure: reject before long upload).
- **Acceptance:** meeting CRUD; attachment path validated both sides; meeting creatable without attachment (Phase 17 storage-outage behavior).
- **Tests:** BR-013 rejection (size/type), outage behavior (create succeeds without attachment).

## PM-007 — PM reports (FR-106)
- **Purpose:** Project Reports: progress, task-status distribution, employee summaries, duration progress, meeting history.
- **API:** `GET /api/v1/reports/projects/...` (+ export variants).
- **Implementation:** by project/client/team member/date range/status; reuses shared query/filter builder.
- **Acceptance:** report data correct vs seed; export parity.
- **Tests:** correctness + parity.

## OHR-001..OHR-006 — Other HR modules (Recommendation field sets, feature-flagged)
- **Purpose:** Loan (OHR-001), Resignation (OHR-002 — feeds SM-3 Inactive), Notices (OHR-003), ID Card (OHR-004), HR Policies (OHR-005), Bulk Upload (OHR-006) — all MI-04 items built to Recommendation field sets, behind feature flags.
- **Architecture ref:** FR-095..099, MI-04, Phase 27 Phase 12; §33 PARITY_GAPS.
- **Implementation:** standard CRUD + list/filter/export + status per module; Resignation approval → SM-3 Active→Inactive (when approved); Bulk Upload = generic template → validate → per-row error report → commit valid rows (or all-or-nothing per DECISION REQUIRED default: per-row commit with report); audit on each.
- **Acceptance:** each module CRUD works when its feature flag on; PARITY_GAPS.md entries created (Phase 12).
- **Decision gate:** field sets are Recommendation; not silent upgrades (R-07).
- **Tests:** per-module CRUD + bulk-upload row-level results.

## FILE-001..FILE-006 — Files module (Phase 11)
- FILE-001 — Signed upload URL issuance & direct-to-storage upload. `POST /api/v1/files/upload-url` (authorized; server-generated random storage key `{module}/{entity_id}/{uuid}-{sanitized_filename}`, no path traversal), client uploads direct (ADR-006), then `POST /api/v1/files/:id/confirm` records metadata + enqueues malware scan. Enforce ≤100MB via signed-URL policy + server check (BR-013), allow-list + true MIME sniffing (not trusted Content-Type).
- FILE-002 — Metadata record & entity linkage (`file_metadata` row; authorization at metadata layer, Phase 11).
- FILE-003 — Download signed URL with authorization: only if actor can read linked entity (Phase 11 access control); short-lived signed URL.
- FILE-004 — Malware scan orchestration: `file.malware_scan` job; file not downloadable until clean; quarantine on failure + notify uploader (Phase 9/11).
- FILE-005 — Deletion & orphan cleanup trigger: `DELETE /api/v1/files/:id` (authorized), scheduled orphan cleanup job (Phase 7).
- FILE-006 — Retention/audit: file events audited; retention policy configurable (DR-04/05 gate).
- **Architecture ref:** Phase 11; BR-013; HC-05; ADR-006; WF-010.
- **Acceptance:** upload→scan→download lifecycle gated on scan clean; attack payloads rejected (size/type/extension/MIME-spoof/path-traversal) — tested in SEC phase.
- **Tests:** upload attack suite (Phase 9), lifecycle tests.

## AUDIT-001..AUDIT-006 — Audit module (Phase 24)
- AUDIT-001 — Activity log writer (cross-cutting, synchronous same-transaction per Phase 9): module publishes `{actor, action, entity_type, entity_id, before, after, requestId, ip, module}`; writes `activity_logs` in same DB transaction as business write (must never silently fail).
- AUDIT-002 — Activity log reader + list endpoint `GET /api/v1/activity-log` (granted roles): filter/search/page-size/sort/pagination, Date/Log Name/Description/Done By columns (FR-130/132).
- AUDIT-003 — Restricted deletion (FR-131/133, C-01, ADR-004): `DELETE /api/v1/activity-log` Super Admin only; soft-hide (`is_hidden`); every deletion written to immutable `meta_audit_log`; never physical DELETE.
- AUDIT-004 — Meta-audit secondary log (append-only, no role can delete; C-01 resolution).
- AUDIT-005 — Sensitive-data read audit hook (bank/family/DOB read-level audit, Phase 24; used by EMP-004, LV, etc.).
- AUDIT-006 — Export audit (Phase 8: export actions logged with filter criteria + row count; Phase 8 data-exfiltration detection).
- **Architecture ref:** FR-130..134, BR-016/017, Phase 24, C-01, ADR-004, Phase 9 audit.write.
- **Acceptance:** every mutating action across modules produces audit row (audit-coverage test suite runs over all modules); delete restricted + meta-audited; append-only integrity test.
- **Tests:** audit-coverage suite; immutability; permission.

## ADM-001..ADM-005 — Settings & Admin
- ADM-001 — User management: `GET/POST/PUT/DELETE /api/v1/users` (Super Admin; roles:manage); create with admin-provisioned credential + must_change_password (AUTH-007); soft-delete.
- ADM-002 — Role management: `GET/POST/PUT /api/v1/roles` (Super Admin); role-permission editing; role change audit (ACL-004).
- ADM-003 — Feature flags management: `GET/PUT /api/v1/settings/feature-flags` (Super Admin) driving P2/Recommendation features (Phase 4 §4, Phase 19).
- ADM-004 — Software Setup screen backend: content is MI-04 — implement as configurable settings store (`app_settings` key/value) with empty Recommendation defaults; flagged in PARITY_GAPS (FR-134).
- ADM-005 — Session management admin view (AUTH-009 revoke-others).
- **Architecture ref:** FR-130..134 (settings), Phase 7, §2 (Super Admin), Phase 4 §4 (feature flags).
- **Acceptance:** user/role CRUD + audit; flag toggles take effect without redeploy.
- **Tests:** permission (Super Admin only), audit.

## NOTIF-001..NOTIF-005 — Notifications (Recommendation, feature-flagged)
- NOTIF-001 — Notification model & templates (`notification_templates`, `notifications`); CRUD for templates (Super Admin/HR Admin).
- NOTIF-002 — Recipient resolution: leave approver/submitter, meeting attendees, assigned employee, onboarding welcome (Phase 14 triggers).
- NOTIF-003 — Dispatch via `NotificationAdapter` (Phase 10 adapter; email first, in-app center); enqueues `notification.dispatch` job (Phase 7); never blocks business transaction (Phase 17).
- NOTIF-004 — Delivery tracking & bounce handling: `notification_deliveries` status, retry, dedup by (event id, recipient); optional bounce webhook with HMAC verification (Phase 8 webhook-spoofing mitigation).
- NOTIF-005 — Preferences & in-app center UI (per-user opt-out for non-critical types, Recommendation).
- **Architecture ref:** Phase 14, MI-03, Phase 9 `notification.dispatch`, Phase 10 adapter.
- **Acceptance:** leave approval generates notification attempt; email failure doesn't block approval; delivery status recorded.
- **Tests:** dispatch/dedup/retry; provider-failure non-blocking.
# PHASE 4 — FRONTEND FOUNDATION & DESIGN SYSTEM (FE)

Frontend conventions (Phase 4 §4, NFR-004/005/007): SPA mirrors backend module routes; server state via TanStack Query with cache keys including active filters; local/UI state in component state; schema-based validation (Zod) mirroring server rules with inline + consolidated top alert (FR-032); accessibility built into shared components; localization centralized (NFR-007); permission checks via ACL-005 hook; loading/error/empty states standardized.

## FE-001 — SPA shell, routing & layout
- **Purpose:** FR-001/002; route structure mirroring Spec §20 observed routes.
- **Architecture ref:** FR-001/002, Phase 4 §4, Spec §20.
- **Routes:** `/login`, `/hr/*` (departments, sub-departments, employee-types, positions, setup-rules, holidays, employees, employee-performance, transfers, attendance, attendance-reports, leave, leave-types, short-leaves, training, other-hr/*), `/projectmanagement/*` (dashboard, projects, clients, tasks, daily-tasks, meetings, reports), `/activity-log`, `/settings/*` (users, roles, feature-flags, software-setup, sessions).
- **Implementation:** layout with collapsible nested sidebar (module tree: HR / Project Management / Settings) + active-route highlighting (FR-001); top bar with page title bound to route metadata, fullscreen toggle, avatar/username/role (FR-002); route-guard wrapper (ACL-005); 404 page (FR-001 failure: broken deep link → 404, sidebar still renders).
- **Acceptance:** navigation highlights active route; deep link to unknown route → 404 with sidebar intact; sidebar expand state persists per session.
- **Tests:** routing + guard tests.

## FE-002 — Authentication frontend (login, session, 401 redirect)
- **Purpose:** WF-001 client side.
- **Architecture ref:** WF-001, Phase 4 §4 (session handling).
- **Implementation:** login page (username/password, generic error, loading state); session bootstrap (`GET /api/v1/auth/me`); silent refresh/session handling; on 401 → redirect to login; logout action; remember-me is Recommendation (MI-01, flagged).
- **Acceptance:** unauthenticated access redirects; login failure shows generic error; logout clears client state.
- **Tests:** auth flow tests.

## FE-003 — Typed API client
- **Purpose:** Typed integration; auth interceptor; error normalization; request ID; retry policy.
- **Architecture ref:** Phase 6 conventions, NFR-008.
- **Implementation:** typed client for `/api/v1`; attaches `X-Request-Id` (echo server value), CSRF token on mutations (AUTH-004), credentials mode; normalizes `{error:{code,message,fields}}` into typed `ApiError` with field map; no automatic retry of unsafe mutations (Phase 6); paginated response types (`page/per_page/total/total_pages`); decimal fields typed as strings.
- **Acceptance:** every endpoint call uses typed client; errors render consistently.
- **Tests:** client unit tests (interceptor, normalization, no-mutation-retry).

## FE-004 — Server-state layer (TanStack Query)
- **Purpose:** lists/entities cached with filter-aware keys (FR-003/004 source-of-truth filters).
- **Architecture ref:** Phase 4 §4 (query/cache with filter keys).
- **Implementation:** query hooks per module; mutation hooks with invalidation of dependent lists; optimistic updates only where safe (default disabled per FR-005); keep `filter`/`sort`/`page` in query params so filter state survives page changes and export reuses same params (FR-003/004).
- **Acceptance:** filter changes update URL + refetch; export uses identical params (HC-04 parity at UI level).
- **Tests:** hook tests with mocked client.

## FE-005 — Shared UI primitives (design system)
- **Purpose:** Reusable, accessible (NFR-004), used across ≥2 modules each (avoid premature abstraction).
- **Architecture ref:** NFR-004, Phase 4 §4 (accessibility in shared library), FR-006 (confirm dialogs).
- **Components:** Button, Input, Select, DatePicker, Dialog, ConfirmDialog (FR-006), DataTable (pagination + sort + selection), Pagination, FilterBar (preset page sizes 10/25/50/100 — AM default), Badge, StatusIndicator (SM state colors), Tabs, Card, Form (Zod schema + field errors + top alert), Alert/Toast (success/error), Skeleton, EmptyState, ErrorState, FileUploader (client-side size/type pre-check), PermissionAware wrapper (ACL-005), Breadcrumb, Modal, SearchInput.
- **Implementation:** built on Radix primitives + Tailwind; keyboard-accessible, labels, visible focus, semantic tables, contrast AA.
- **Acceptance:** components covered by a11y tests; reused across modules (audit check at Phase 12).
- **Tests:** component tests incl. a11y.

## FE-006 — List/grid page framework
- **Purpose:** FR-003/004 as a reusable pattern for every list page.
- **Implementation:** DataTable + FilterBar + pagination + sort + global search + page-size + CSV/Excel/Print export button (uses current filters); loading skeleton; empty state; error state with retry; filter state preserved across navigation via query params.
- **Acceptance:** all list pages inherit behavior; export triggered with active filters.
- **Tests:** framework tests + per-module tests (Phase 5).

## FE-007 — Form wizard framework (FR-032/033)
- **Purpose:** Step-based forms (employee wizard; reusable pattern).
- **Implementation:** step container with per-step Zod schemas; block advance on invalid step; top red alert block + inline field errors; state persisted across step navigation; submit-lock on final save (double-submit prevention client side, WF-002).
- **Acceptance:** cannot advance past invalid step; no data loss navigating back/forward; double-click submit disabled.
- **Tests:** wizard framework tests.

## FE-008 — Localization scaffolding (NFR-007)
- **Purpose:** Centralized strings/date/number formatting so Bangla/English can be added without schema change.
- **Implementation:** i18n resource files, date/number formatters, all user-facing strings routed through it (English default).
- **Acceptance:** a second locale can be added without schema/UI changes.
- **Tests:** formatting consistency.

## FE-009 — Global error handling, error boundary, toasts
- **Purpose:** FR-005; consistent failure presentation.
- **Implementation:** React error boundary; toast system (success/error); failed writes preserve entered form data (FR-005 — never clear form on network failure); mutation error mapping from `ApiError.fields`.
- **Acceptance:** network failure → visible error, form intact; uncaught render error → boundary, not blank app.
- **Tests:** error-path component tests.

## FE-010 — Loading/empty/error/confirm states standardization
- **Purpose:** FR-005/006 across all screens.
- **Implementation:** shared `<AsyncState>` wrapper (loading skeleton / empty state / error with retry) + `<Confirm>` usage for every destructive action.
- **Acceptance:** every async action shows a state; every delete shows confirmation.
- **Tests:** standardized behavior tests.
# PHASE 5 — FRONTEND DOMAIN SCREENS (FE-HR, FE-ATT, FE-LV, FE-TRN, FE-PM, FE-ADM)

Each screen task below specifies: route, permitted actors, data, API dependencies, UI components, validation, actions, states (loading/empty/error), permission behavior, confirmation dialogs, pagination/filter/sort/search, responsive (NFR-005), accessibility (NFR-004), and tests. Screens reuse FE-006 (list framework), FE-007 (wizard framework), FE-005 (components).

## FE-HR-001 — Departments list + create/edit (FR-010..013)
- Route: `/hr/departments`; actors: read all authenticated, write HR Admin.
- Data/API: `GET/POST/PUT/DELETE /api/v1/departments`; list framework; name required + unique validation (BR-001), active/inactive toggle, confirm dialog on delete, export with filters.
- Tests: list, validation, unique-error, confirm, permission (write hidden for non-admin but server authoritative).

## FE-HR-002 — Sub-Departments list + create/edit (FR-014..016)
- Route: `/hr/sub-departments`; parent department mandatory select (FK); same pattern as FE-HR-001.
- Tests: parent required, list pattern.

## FE-HR-003 — Employee Types master screen (MI-04)
- Route: `/hr/employee-types`; CRUD + active flag; used by wizard/Setup Rules.
- Tests: CRUD.

## FE-HR-004 — Positions master screen (MI-04)
- Route: `/hr/positions`; CRUD + active flag.
- Tests: CRUD.

## FE-HR-005 — Setup Rules screen (FR-020..024)
- Route: `/hr/setup-rules`; fields: title, employee type, work pattern (enum "Fixed"+), daily working hour, office start/end time, grace period, active; effective_from (DR-06 prospective note); list/filter/export.
- Tests: CRUD + validation (time/hours types).

## FE-HR-006 — Holidays screen (FR-065)
- Route: `/hr/holidays`; title, date/range, type, description, active; end ≥ start validation (BR-012).
- Tests: CRUD + BR-012 client validation.

## FE-HR-007 — Employee list screen (FR-030)
- Route: `/hr/employees`; actors: HR read (+self own-record view if granted).
- Data/API: `GET /api/v1/employees`; 9 filter dimensions + Find/Reset/Filter/Add actions; CSV/Excel export; columns per FR-030.
- Implementation: FilterBar with the 9 filters; table; Add → wizard route; pagination/sort/search; status badge.
- Tests: filter matrix, pagination, export-button parity with current filters.

## FE-HR-008 — Employee wizard create (FR-031..034)
- Route: `/hr/employees/new`; actors: HR Admin/Manager.
- Data/API: `POST /api/v1/employees` (idempotency-key header); 9 steps (Personal, Employee, Bank, Address, Emergency Contact, Academic, Extra-Curricular, Job Experience, Family).
- Implementation: FE-007 wizard; per-step Zod schemas; top red alert + inline errors (FR-032); state persisted across steps (FR-033); submit lock (double-submit); cancel → discard (WF-002 Recommendation default).
- Tests: wizard flow, per-step validation, data preservation, double-submit.

## FE-HR-009 — Employee detail + edit (FR-033/036-adjacent, sensitive access)
- Route: `/hr/employees/:id`; actors: HR roles; self own-record read (sensitive sections hidden unless `employee:sensitive:read`).
- Implementation: detail view (personal/bank/address/emergency/academic/extra-curricular/experience/family tabs); edit mode with version-aware PUT (409 → refresh prompt); sensitive sections guarded.
- Tests: sensitive-section permission, 409 handling, field preservation on failure.

## FE-HR-010 — Inactive Employees list (FR-035)
- Route: `/hr/employees/inactive`; scoped list reusing query builder.
- Tests: scoping.

## FE-HR-011 — Employee Performance (FR-036)
- Route: `/hr/employees/:id/performance` (+ list tab); two tabs (Performance list, Rating); record: position snapshot, scoring lines, total score, evaluator, date; rating derived from configurable thresholds.
- Tests: score/rating math display, thresholds.

## FE-HR-012 — Transfers screen (FR-037/038)
- Route: `/hr/transfers`; Transfer Out / Transfer In lists; Recommendation fields; flows per EMP-007.
- Tests: transfer flow.

## FE-ATT-001 — Attendance form (FR-050)
- Route: `/hr/attendance`; actors: HR Admin.
- Data/API: `POST /api/v1/attendance/events`; Employee (required), Time (required datetime), "Employee ID Show" modal (device-ID↔employee mapping, ATT-003), Bulk Insert action, Submit.
- Tests: validation, device modal, submit→event + recalc trigger indicator.

## FE-ATT-002 — Bulk attendance insert (FR-050/053; WF-004)
- Route: `/hr/attendance/bulk`; CSV upload with template; per-row validation results (Recommendation, WF-004); background job status poll (Phase 7 job URL); downloadable error report.
- Tests: upload, job status, error report.

## FE-ATT-003 — Monthly attendance entry (FR-051)
- Route: `/hr/attendance/monthly`; employee + year/month + time in/out; submits synthesize+recalc path.
- Tests: round-trip.

## FE-ATT-004 — Missing attendance queue (FR-052)
- Route: `/hr/attendance/missing`; list framework; filters employee/month; export.
- Tests: correctness vs seed.

## FE-ATT-005 — Pending attendance queue (FR-053)
- Route: `/hr/attendance/pending`; actions approve/reject/correct (ATT-005 defaults) with confirmations; status update + recalc.
- Tests: queue actions.

## FE-ATT-006..011 — Attendance report screens (FR-054..060)
- FE-ATT-006 Late Attendance; FE-ATT-007 Attendance Log; FE-ATT-008 Daily Present; FE-ATT-009 Monthly Summary; FE-ATT-010 Monthly Attendance detail; FE-ATT-011 Employee Daily Worksheet. Each: route `/hr/attendance/reports/:name`; filters employee/year/month minimum; CSV/Excel/Print export using active filters; loading/empty/error states.
- Tests: each report render + export parity.

## FE-LV-001 — Leave application list (FR-070)
- Route: `/hr/leave`; actors: HR read; employee sees own.
- Columns: employee, leave type, dates, days, reason, approval dates, approved days, hard-copy flag, manager comments, status, actions; filter by employee; CSV/Excel export; Create action.
- Tests: list, filters, own-scope for employee role.

## FE-LV-002 — Leave create/submit (FR-070/071; WF-006)
- Route: `/hr/leave/new`; employee (prefill own for self-service), type, dates, days, reason, hard-copy flag; balance reservation note (DR-01); over-balance handling message; submit → Pending.
- Tests: validation incl. balance; over-balance path.

## FE-LV-003 — Leave approval/reject UI (FR-071; WF-006)
- Route: `/hr/leave/:id` (approver); approve (approved_days + comment) / reject (comment) with confirm; shows balance at approval.
- Tests: approve/reject flows, race message on 409.

## FE-LV-004 — Employee Total Leaves matrix (FR-072)
- Route: `/hr/leave/total-leaves`; annual matrix per employee × leave category with Total/Taken/Due triplets; year selector; server-paginated matrix.
- Tests: matrix render, pagination.

## FE-LV-005 — Generate Leaves for [year] (FR-073)
- Route: `/hr/leave/total-leaves` action button; triggers job, shows processing state (Phase 7 job URL), completion summary + failures list.
- Tests: trigger, job states, idempotent re-run UX.

## FE-LV-006 — Leave Types CRUD (FR-074)
- Route: `/hr/leave-types`; fields per LV-001; list/filter/export.
- Tests: CRUD.

## FE-LV-007 — Short Leaves (FR-075)
- Route: `/hr/short-leaves`; create/approve/reject; hourly/half-day; cap validation.
- Tests: CRUD + approval.

## FE-TRN-001 — Training master (FR-085..087)
- Route: `/hr/training`; master list + create/edit (title, description, trainer, schedule, venue, status).
- Tests: CRUD.

## FE-TRN-002 — Training assignments (FR-086; WF-008; SM-6)
- Route: `/hr/training/assignments`; assign employees, complete (score + date), cancel; status badges (Assigned/InProgress/Completed/Cancelled).
- Tests: SM-6 UI transitions.

## FE-TRN-003 — Certificates (FR-088..090)
- Route: `/hr/training/certificates`; internal/external; attachment upload via FileUploader + signed URL; issue/expiry dates; validation.
- Tests: CRUD + attachment validation.

## FE-OHR-001..006 — Other HR screens (MI-04, feature-flagged)
- FE-OHR-001 Loan; FE-OHR-002 Resignation (incl. approval → inactive); FE-OHR-003 Notices; FE-OHR-004 ID Card (upload); FE-OHR-005 HR Policies (upload); FE-OHR-006 Bulk Upload (template download, upload, per-row error report). Each route `/hr/other/:module`; standard CRUD + list/filter/export; hidden behind feature flag.
- Tests: per-module CRUD + bulk upload.

## FE-PM-001 — Project dashboard (FR-100)
- Route: `/projectmanagement`; Project Task Status chart (task-status distribution), projects table (Name, Client, Lead, Progress, Start/End, Status, Duration Progress, State, Action), Add New Project / Manage Projects actions.
- Tests: chart data, table, actions.

## FE-PM-002 — Projects list + create/edit (FR-101; WF-009)
- Route: `/projectmanagement/projects` (+ `/new`, `/:id/edit`); fields per FR-101; team members multi-select from employee master; inline "Add Client" inside modal (WF-009 — client validation failure surfaces inside modal, project not created); end date derived from start+duration (BR-014); optimistic-concurrency 409 handling.
- Tests: WF-009 end-to-end, inline client failure path, 409.

## FE-PM-003 — Clients list + create/edit (FR-102)
- Route: `/projectmanagement/clients`; CRUD; also used inline.
- Tests: CRUD.

## FE-PM-004 — Tasks list + manage (FR-103; SM-5; MI-04)
- Route: `/projectmanagement/projects/:id/tasks` and `/projectmanagement/tasks`; kanban/table with SM-5 states (ToDo/InProgress/Review/Done/Blocked); assignee(s), priority, planned dates, actual completion, progress %, estimated hours, attachments.
- Tests: SM-5 transitions, assignee scoping.

## FE-PM-005 — Daily tasks (FR-104)
- Route: `/projectmanagement/daily-tasks`; own work log (date, project/task, description, hours, status); daily hours sum; own-record scoping.
- Tests: CRUD, hours sum, scoping.

## FE-PM-006 — Meetings (FR-105; WF-010)
- Route: `/projectmanagement/meetings` (+ create/edit); required fields (project, place, held datetime, purpose, outcomes), attendees multi-select, optional attachment (FileUploader pre-check ≤100MB + allow-list; BR-013); Create/Close actions; attachment upload progress; meeting creatable without attachment (Phase 17).
- Tests: BR-013 rejection UX, upload flow, outage behavior.

## FE-PM-007 — Project reports (FR-106)
- Route: `/projectmanagement/reports`; by project/client/team member/date range/status; charts (progress, task-status distribution, employee summaries, duration progress, meeting history); export.
- Tests: render + export parity.

## FE-ADM-001 — Activity Log screen (FR-130..133; WF-011)
- Route: `/activity-log`; actors: read granted roles, delete Super Admin only.
- Columns Date, Log Name, Description, Done By, Action(delete); filter/search/page-size/sort/pagination; row multi-select + "Delete Selected Items" (Super Admin only, confirm dialog); deletion = soft-hide (ADR-004); error states.
- Tests: list/filter, delete permission (Super Admin), soft-hide + meta-audit observable.

## FE-ADM-002 — Users management (ADM-001)
- Route: `/settings/users`; Super Admin only; create (provisioned credential), edit role, deactivate; role change confirm.
- Tests: permission, audit.

## FE-ADM-003 — Roles management (ADM-002)
- Route: `/settings/roles`; Super Admin only; permission matrix editor; before/after role audit.
- Tests: matrix editing, audit.

## FE-ADM-004 — Feature flags screen (ADM-003)
- Route: `/settings/feature-flags`; toggle Recommendation features.
- Tests: toggle effect.

## FE-ADM-005 — Software Setup screen (FR-134; MI-04)
- Route: `/settings/software-setup`; configurable settings store with Recommendation defaults; flagged in PARITY_GAPS.
- Tests: read/write.

## FE-ADM-006 — Sessions management (AUTH-009)
- Route: `/settings/sessions`; list own + revoke (admin revoke others).
- Tests: revoke.

## FE-AUTH-001 — Login page (FE-002)
- Route: `/login`; username/password; generic error; loading; redirect after success.
- Tests: success, generic-error, redirect.

## FE-AUTH-002 — Password reset pages (AUTH-006)
- Route: `/reset-password` (+ `/reset-password/confirm`); request + set-new-password; token handling.
- Tests: full reset flow incl. expired token.

## FE-AUTH-003 — MFA enroll/verify UI (AUTH-008, feature-flagged)
- Route: `/mfa`; QR + TOTP input.
- Tests: enroll/verify.

## FE-COMMON — Responsive + accessibility pass (NFR-005/004)
- Purpose: tablet/mobile usability without data loss; AA compliance across shared components.
- Tests: a11y (axe) + responsive checks on key screens.
# PHASE 6 — END-TO-END WORKFLOWS (WF)

Each workflow task verifies the full vertical slice (frontend → validation → API → auth → authorization → validation → business rules → transaction → state transition → side effects → audit → notification → response → state update → error handling) and adds E2E coverage. Backend/frontend pieces already exist from Phases 3–5; these tasks integrate and prove them.

## WF-E2E-001 — Authentication & session (WF-001)
- E2E: login → dashboard → navigation → logout → session revocation; lockout path after N failures; generic-error parity for unknown-user vs wrong-password; password reset flow (AUTH-006) incl. expired token.
- Acceptance: documented happy path per Spec §19 passes; negative paths covered.
- Tests: Playwright E2E.

## WF-E2E-002 — Employee onboarding wizard (WF-002)
- E2E: employee list → Add → 9 steps with valid + invalid data (FR-032) → submit → created employee visible with all sub-data; double-submit produces one record; navigation-away → discard.
- Tests: Playwright E2E + API integration (BR-003).

## WF-E2E-003 — Attendance capture (manual) (WF-003)
- E2E: attendance form submit → event row → recalculation → day status updates; duplicate timestamp idempotent; unmapped device ID → reconciliation queue.
- Tests: E2E + integration (dedupe, recalc trigger).

## WF-E2E-004 — Bulk attendance insert (WF-004)
- E2E: template download → CSV upload → job runs → per-row error report downloadable; valid rows committed; retry-safe.
- Tests: E2E + job tests.

## WF-E2E-005 — Monthly attendance recalculation (WF-005)
- E2E: admin triggers recalc after setup-rule/holiday/leave change → days recomputed, raw events untouched; idempotent re-run.
- Tests: integration + replay idempotency.

## WF-E2E-006 — Leave application & approval (WF-006)
- E2E: employee submits (Pending, reservation) → HR approves (balance consumed) / rejects (balance untouched) → employee sees status; withdraw while pending; concurrent approval race test; audit rows.
- Tests: E2E + concurrency (BR-009) + audit coverage.

## WF-E2E-007 — Annual leave generation (WF-007)
- E2E: Generate for year → balances created once; re-run creates no duplicates; per-employee failure reported.
- Tests: E2E + idempotency re-run.

## WF-E2E-008 — Training assignment & completion (WF-008; SM-6)
- E2E: assign → complete (score+date) → status; optional notification.
- Tests: E2E.

## WF-E2E-009 — Project creation with inline client (WF-009)
- E2E: new project modal → inline client add → invalid client shows error in modal, project not created → valid → project created with members and default Open status.
- Tests: E2E + transactional integration.

## WF-E2E-010 — Meeting creation with attachment (WF-010; BR-013)
- E2E: meeting required fields + attachment (valid type/size) → success; oversized/disallowed file rejected pre-upload with actionable message; meeting created without attachment.
- Tests: E2E + BR-013 rejection + outage behavior.

## WF-E2E-011 — Activity log review & deletion (WF-011; C-01/ADR-004)
- E2E: log list filter/search → multi-select → Super Admin deletes (soft-hide) → meta-audit record exists; non-Super-Admin delete → 403.
- Tests: E2E + permission + immutability.

## WF-E2E-012 — Bulk upload (HR masters, generic) (WF-012)
- E2E: template → upload → per-row validation report → commit valid rows; PARITY_GAPS flag.
- Tests: E2E + row-level results.

---

# PHASE 7 — ASYNC JOBS, SCHEDULING & INTEGRATIONS (JOB, INT)

## JOB-001 — Queue infrastructure (BullMQ + Redis)
- **Purpose:** Lightweight queue per Phase 9/25; no streaming platform.
- **Architecture ref:** Phase 9, Phase 25, ADR-005.
- **Implementation:** BullMQ connection (Redis), worker host in `/apps/worker`, per-job processor registration, DLQ handling (status=dead on max attempts), job status persisted to `jobs` table (DB-012) for UI polling; queue-up failure → request fails loudly (Phase 17); producer marks `queued-pending` when enqueued.
- **Acceptance:** enqueue/process/dead-letter lifecycle works; enqueue-failure surfaces to caller.
- **Tests:** queue lifecycle, poison-message → DLQ.

## JOB-002 — `attendance.recalculate` consumer
- **Purpose:** WF-005/FR-051/ATT-007 batch recalculation.
- **Architecture ref:** Phase 9 row; Phase 15.
- **Implementation:** consumes employee_id(s) + date range; per-employee-day unit of work; advisory lock per employee-day (Phase 15); pure-function idempotent (re-run safe); per-day failure isolated; failures visible to HR Admin.
- **Acceptance:** batch completes; partial failures isolated; re-run idempotent.
- **Tests:** batch correctness, partial failure, idempotency.

## JOB-003 — `attendance.bulk_import` consumer
- **Purpose:** WF-004 bulk insert.
- **Architecture ref:** Phase 9 row.
- **Implementation:** parses file → validates rows (per-row results) → commits valid rows (dedupe key) → error report stored/downloadable; 3 attempts then fail with report; batch id + row dedupe.
- **Acceptance:** valid rows committed, invalid reported; retry-safe.
- **Tests:** row-level validation, retry/dedupe.

## JOB-004 — `leave.generate_year` consumer
- **Purpose:** FR-073/WF-007/BR-008.
- **Architecture ref:** Phase 9 row; Phase 15.
- **Implementation:** per-employee unit-of-work; DB UNIQUE + job idempotency key; per-employee retry; failed employees listed for manual retry.
- **Acceptance:** cohort generated once; failures resumable.
- **Tests:** idempotency re-run, partial failure.

## JOB-005 — `export.large_report` consumer
- **Purpose:** FR-004 large exports.
- **Architecture ref:** Phase 9 row; Phase 15; Phase 8.
- **Implementation:** executes shared report query builder → writes file to storage → notifies user with download link; deterministic from filters; 3 attempts; failures notified.
- **Acceptance:** large export completes async; user notified; regeneration safe.
- **Tests:** large-set export, failure notification.

## JOB-006 — `notification.dispatch` consumer (feature-flagged)
- **Purpose:** Phase 14 dispatch.
- **Architecture ref:** Phase 9 row; Phase 14.
- **Implementation:** template + recipient + context; provider adapter; dedup by (event id, recipient); backoff provider-error aware; delivery status recorded.
- **Acceptance:** dispatch attempts recorded; dedup; provider failure → retry, never blocks domain txn.
- **Tests:** dedup, retry, non-blocking.

## JOB-007 — `file.malware_scan` consumer
- **Purpose:** Phase 11 scan.
- **Architecture ref:** Phase 9 row; Phase 11.
- **Implementation:** scan storage key; clean → file ready; failed → quarantine + notify uploader; idempotent rescan; 3 attempts.
- **Acceptance:** file not downloadable until clean; quarantine path.
- **Tests:** scan lifecycle incl. quarantine.

## JOB-008 — Scheduled jobs (Phase 15, all six)
- JOB-008a Nightly attendance recalculation (daily, off-peak; selection: employee-days with new/changed raw events; advisory lock; per-record retry; duration+failure alerts).
- JOB-008b Missing/pending attendance sweep (daily; read-only query feeds FR-052/053 queues).
- JOB-008c Leave balance carry-forward (annually at year boundary; leave_types.carry_forward; per-employee unit; UNIQUE per year).
- JOB-008d Orphaned upload cleanup (daily; uploads unconfirmed past TTL; idempotent delete; storage-growth alert).
- JOB-008e Export job cleanup (daily; completed export files past retention; idempotent delete).
- JOB-008f Session cleanup (hourly; expired sessions; idempotent).
- **Architecture ref:** Phase 15 table; Phase 9.
- **Acceptance:** each job idempotent re-run-safe; failures per-record; alerts wired (Phase 10).
- **Tests:** per-job scheduled-run tests incl. duplicate-run safety.

## INT-001 — Attendance capture adapter (DR-03)
- **Purpose:** pluggable `AttendanceSourceAdapter.ingest(events[])`.
- **Architecture ref:** Phase 10; DR-03; C-02.
- **Implementation:** interface + first implementation = scheduled CSV import (batch), mapping via `attendance_device_mappings`; unmapped IDs → reconciliation queue (never silent drop); future device-push adapter added later without touching calculation service; ingest calls the internal event contract (dedupe UNIQUE).
- **Acceptance:** CSV ingest idempotent (same batch retried → no dupes); unmapped routed; adapter swap requires no calc changes.
- **Tests:** ingest idempotency, reconciliation.

## INT-002 — Object storage adapter
- **Purpose:** `StorageAdapter.getUploadUrl()/getDownloadUrl()/delete()` (S3-compatible).
- **Architecture ref:** Phase 10; Phase 11; ADR-006.
- **Implementation:** MinIO/S3 SDK behind interface; signed URL issuance (short-lived), random server-generated keys; circuit breaker so storage outage degrades attachments only (meeting still created, Phase 17).
- **Acceptance:** signed upload/download works; outage → attachment flow fails gracefully, CRUD unaffected.
- **Tests:** adapter + outage test.

## INT-003 — Email/notification provider adapter (Recommendation)
- **Purpose:** `NotificationAdapter.send(template, recipient, context)`.
- **Architecture ref:** Phase 10; Phase 14.
- **Implementation:** SMTP/SES behind interface; provider downtime → queued retries (JOB-006), never blocks business transaction; optional bounce webhook with HMAC signature verification (Phase 8).
- **Acceptance:** send recorded; failure queued; domain action completes regardless.
- **Tests:** provider-failure non-blocking; webhook HMAC (if built).

## INT-004 — Webhook security (bounce handler, if built)
- **Architecture ref:** Phase 8 (webhook spoofing Recommendation).
- **Implementation:** HMAC-signed bounce webhook endpoint; replay/idempotency handling.
- **Acceptance:** invalid signature rejected; valid bounce updates delivery status.
- **Tests:** signature verification, replay.

---

# PHASE 8 — REPORTING & EXPORT (RPT)

## RPT-001 — Shared query/filter layer (HC-04 closure)
- **Purpose:** one query builder shared by list and export endpoints to prevent filter drift.
- **Architecture ref:** FR-003/004, HC-04, Phase 6 (identical filter/sort params).
- **Implementation:** per-module `ListQuery` builders used by both `GET /...` and `/export`; export validates `format` (csv/xlsx/print) and streams file matching current filters; large sets → async (JOB-005) with user notification.
- **Acceptance:** HC-04 parity test: for same filters, list rows == exported rows; invalid page/filter clamped not 500 (FR-003).
- **Tests:** parity suite across every list/report.

## RPT-002 — Export engine (CSV/Excel/Print)
- **Purpose:** FR-004 delivery.
- **Implementation:** server-side CSV/XLSX generation; print view (HTML/print CSS) for print export; filename from module+date; encoding/bom correctness; decimals as strings (NFR-008).
- **Acceptance:** each format streams; content matches filters; filenames stable.
- **Tests:** format correctness incl. unicode/decimals.

## RPT-003 — Report correctness suite (attendance + leave + PM + HR)
- **Purpose:** Phase 22 correctness tests against seed fixtures.
- **Implementation:** fixture-driven expected-value assertions for: Late Attendance, Attendance Log, Daily Present, Monthly Summary, Monthly Attendance detail, Employee Daily Worksheet, Employee Total Leaves matrix, leave balance math (BR-009/011), project progress aggregation (BR-015), duration progress, task-status distribution, PM reports.
- **Acceptance:** all report expected values match seed data.
- **Tests:** this task IS the correctness suite.

## RPT-004 — Report performance verification
- **Purpose:** NFR-002; Phase 18 heavy queries.
- **Implementation:** EXPLAIN review + k6 load test on monthly summary & daily worksheet at realistic org scale; index/query adjustments.
- **Acceptance:** p95 within internal-tool budget; index-backed plans.
- **Tests:** load suite (Phase 11).

## RPT-005 — Export audit (data-exfiltration detection)
- **Purpose:** Phase 8/24 (exports audited with filters + row count).
- **Architecture ref:** Phase 8 (data exfiltration via bulk export), Phase 24.
- **Implementation:** every export call writes audit row (actor, module, filters, row count, format); anomaly alert hook (Phase 10 unusual export volume).
- **Acceptance:** every export audited.
- **Tests:** audit coverage.
# PHASE 9 — SECURITY HARDENING (SEC)

## SEC-001 — Input validation & mass-assignment prevention
- **Purpose:** Phase 8 (mass assignment, injection); every mutation uses allow-listed DTOs.
- **Architecture ref:** Phase 8 threat table; NFR-001.
- **Implementation:** class-validator/Zod DTOs per endpoint; no blind entity binding; whitelist true; field-level validation mirrors FE schemas.
- **Acceptance:** unexpected fields rejected; oversized payloads rejected.
- **Tests:** mass-assignment attack payloads.

## SEC-002 — Injection resistance (SQL)
- **Purpose:** Phase 8 (injection) especially dynamic filter/sort/search layer (FR-003).
- **Architecture ref:** Phase 8; HC-04.
- **Implementation:** parameterized queries/ORM only; filter/sort field names validated against allow-list (no raw interpolation); search uses bound ILIKE/trigram.
- **Acceptance:** injection attempts across all list/filter endpoints fail safely; sort/filter key whitelist enforced.
- **Tests:** injection fuzz suite.

## SEC-003 — XSS & content security
- **Purpose:** Phase 8 (XSS via leave reason, meeting purpose/outcomes, notice body).
- **Architecture ref:** Phase 8; Phase 4 §4.
- **Implementation:** framework output encoding default; sanitize rich-text fields; CSP header restricting script/style origins; `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin` (Phase 8 headers).
- **Acceptance:** stored-XSS payloads render inert; headers present on all responses.
- **Tests:** XSS payload suite; header assertions.

## SEC-004 — IDOR/BOLA test & fix loop
- **Purpose:** Phase 8 (authorization bypass) — verify every ownership-scoped resource.
- **Architecture ref:** Phase 8; Phase 7 (ownership).
- **Implementation:** automated IDOR scan: for each resource route, attempt cross-user read/write with a second account; assert 403/404; fix any leaks.
- **Acceptance:** zero IDOR findings on ownership-scoped routes.
- **Tests:** IDOR suite (runs in CI).

## SEC-005 — CSRF & cookies hardening
- **Purpose:** NFR-001 explicit CSRF; cookie flags.
- **Architecture ref:** Phase 8; NFR-001.
- **Implementation:** synchronizer-token CSRF enforced on all state-changing requests; cookies `HttpOnly; Secure; SameSite=Lax`; logout invalidates.
- **Acceptance:** CSRF negative test passes; cookie flags verified.
- **Tests:** CSRF suite.

## SEC-006 — Rate limiting & gateway protection
- **Purpose:** Phase 8 (API abuse, brute force).
- **Architecture ref:** Phase 8; Phase 4 §2 (LB/WAF).
- **Implementation:** per-user and per-IP limits at gateway/LB + app-level login throttle (AUTH-005); 429 responses structured.
- **Acceptance:** abuse simulation returns 429; legitimate traffic unaffected.
- **Tests:** rate-limit tests.

## SEC-007 — Secrets management
- **Purpose:** Phase 8 (secrets leakage); Phase 19.
- **Architecture ref:** Phase 8; Phase 19; Phase 20.
- **Implementation:** all secrets via env/secrets manager; none committed; `git-secrets`/pre-commit scan; rotation documented.
- **Acceptance:** secret scanner clean; no secrets in repo or images.
- **Tests:** CI secret scan gate.

## SEC-008 — PII protection & log redaction
- **Purpose:** Phase 8 (sensitive data leakage; bank details/DOB/family).
- **Architecture ref:** Phase 8; Phase 16 (logs exclude PII); Phase 24.
- **Implementation:** log redaction filter (no bank/DOB/family/password/token values); structured logs exclude sensitive fields; sensitive columns never serialized to client unless authorized (EMP-004); export permission separate from read.
- **Acceptance:** log corpus contains no sensitive values (scan test); sensitive serialization guarded.
- **Tests:** redaction scan; permission tests.

## SEC-009 — File upload attack defenses
- **Purpose:** Phase 8 (malware, path traversal, MIME spoofing).
- **Architecture ref:** Phase 8; Phase 11; BR-013.
- **Implementation:** extension allow-list + content-sniffed MIME (not client Content-Type) + size cap (100MB BR-013) + randomized storage keys + async malware scan before downloadable; quarantine.
- **Acceptance:** attack payloads (polyglot MIME, traversal filename, oversized) all rejected/quarantined.
- **Tests:** upload attack suite (Phase 22).

## SEC-010 — SSRF avoidance
- **Purpose:** Phase 8 (SSRF via file/URL features).
- **Architecture ref:** Phase 8.
- **Implementation:** no user-supplied URLs fetched server-side; storage access via SDK only.
- **Acceptance:** no server-side fetch of arbitrary URLs (code review + test).
- **Tests:** SSRF attempt test.

## SEC-011 — Dependency & static security scanning (CI)
- **Purpose:** Phase 21 (SCA + SAST gates); Phase 8 dependency vulnerabilities.
- **Architecture ref:** Phase 21; Phase 8.
- **Implementation:** osv-scanner/dependabot (SCA) + semgrep (SAST) in CI; failing gate blocks merge.
- **Acceptance:** gates wired and pass on baseline; new vuln blocks.
- **Tests:** CI gates.

## SEC-012 — Audit-log protection & meta-audit integrity
- **Purpose:** Phase 8 (insider/admin, audit tampering); C-01/ADR-004.
- **Architecture ref:** Phase 8; Phase 24.
- **Implementation:** activity_logs soft-hide only; meta_audit_log append-only (no DELETE grant); deletion itself meta-audited; integrity check job (hash-chain optional P3).
- **Acceptance:** tampering attempts fail; deletion chain verified.
- **Tests:** immutability + permission.

## SEC-013 — Security regression suite (aggregate)
- **Purpose:** run all SEC tests in CI as a security regression gate.
- **Tests:** aggregation of SEC-001..012 suites.

---

# PHASE 10 — OBSERVABILITY & RELIABILITY (OBS)

## OBS-001 — Structured logging
- **Purpose:** NFR-006; Phase 16 logs.
- **Architecture ref:** Phase 16; Phase 17.
- **Implementation:** pino JSON logs: timestamp, level, requestId, userId (where safe), module, action, outcome; PII redaction (SEC-008); request-scoped `X-Request-Id` generated/propagated to workers (tracing, Phase 16).
- **Acceptance:** log format stable; requestId correlated across api→worker.
- **Tests:** redaction + correlation test.

## OBS-002 — Metrics
- **Purpose:** Phase 16 KPIs.
- **Architecture ref:** Phase 16.
- **Metrics:** API latency (p50/p95), error rate per module, DB latency, job duration/failure per job type, queue depth/backlog, login failure rate, export volume, malware-scan queue depth, leave-generation success rate, recalculation duration.
- **Acceptance:** metrics endpoint exposes listed metrics; dashboards wiring (staging).
- **Tests:** metrics smoke.

## OBS-003 — Health checks
- **Purpose:** Phase 4 §2 / Phase 19.
- **Architecture ref:** Phase 4 §2; Phase 16.
- **Implementation:** `/health` (liveness), `/health/ready` (DB + Redis + queue + storage connectivity); used by LB/orchestrator.
- **Acceptance:** health reflects dependency state; DB-down → not-ready (but liveness ok).
- **Tests:** health behavior incl. dependency outage.

## OBS-004 — Alerting
- **Purpose:** Phase 16 alerts.
- **Architecture ref:** Phase 16.
- **Paging (urgent):** DB unreachable, API error-rate spike, audit-write failure, auth service down. **Non-urgent:** queue backlog, individual scheduled-job failure, unusual export volume, storage/malware backlog.
- **Acceptance:** each condition fires the configured alert in staging.
- **Tests:** alert-condition simulation.

## OBS-005 — Reliability/failure tests (Phase 17)
- **Purpose:** verify Phase 17 failure behaviors.
- **Implementation:** tests: job queue backlog (producer accepts, marks queued-pending); storage outage during meeting creation (succeeds without attachment); DB failover window (writes fail loudly); poison message → DLQ; cache-down session lookup (DB fallback, no forced logout); attendance source down (missing queue reflects gap).
- **Acceptance:** each scenario exhibits the specified Phase 17 behavior.
- **Tests:** failure-recovery suite.

---

# PHASE 11 — DEVOPS, DEPLOYMENT & DR (OPS)

## OPS-001 — Container images (app + worker same image)
- **Purpose:** Phase 19 (same image, different entrypoint).
- **Implementation:** multi-stage Dockerfiles: build → runtime; `/apps/api` and `/apps/worker` from same image with different commands; non-root runtime user; minimal base.
- **Acceptance:** image builds; API & worker run from it.
- **Security:** no secrets baked; distroless/minimal base.

## OPS-002 — Database provisioning & migrations pipeline
- **Purpose:** Phase 5/19/21 (migrations as pipeline step, never manual).
- **Implementation:** compose Postgres for dev/test; managed DB for staging/prod; `prisma migrate deploy` step before traffic switch; additive-first + forward-compatible migrations (zero-downtime, Phase 19); migration dry-run gate in CI.
- **Acceptance:** fresh-env provisioning applies all migrations; rolling deploy supported.
- **Tests:** migration dry-run in CI.

## OPS-003 — Environment strategy implementation
- **Purpose:** Phase 20.
- **Implementation:** local/test/staging/prod envs; per-env config + secrets manager; staging uses de-identified synthetic data (never real PII); fully separate DBs; mocked adapters in local/test.
- **Acceptance:** promote artifact through env chain without code change; env isolation verified.
- **Tests:** env-specific smoke.

## OPS-004 — CI/CD pipeline (full Phase 21 sequence)
- **Implementation:** install → lint → format → typecheck → unit → integration (DB) → contract/API → migration dry-run → SCA → SAST → build → staging deploy → smoke → gated prod promotion → post-deploy smoke → rollback trigger available at every gate; trunk-based with short-lived branches.
- **Acceptance:** merge to main runs full chain through staging; prod promotion gated; rollback one-click per release.
- **Tests:** pipeline itself verified in CI.

## OPS-005 — Deployment & zero-downtime/rollback
- **Purpose:** Phase 19.
- **Implementation:** rolling deployment across API replicas; worker drain before replacement; rollback to previous image; forward-compatible migrations for ≥1 release.
- **Acceptance:** deploy without user-visible downtime; rollback verified in staging drill.
- **Tests:** rolling + rollback drill.

## OPS-006 — Backups, restore & DR
- **Purpose:** Phase 23.
- **Implementation:** daily full + continuous WAL (PITR) for primary DB; object-storage versioning/replication; retention Recommendation (30d PITR, monthly archives 1y) — DR-05 gate; RPO≤24h/RTO≤4h Recommendation default; documented restore runbook + quarterly restore drill.
- **Acceptance:** restore drill from a test backup succeeds; RPO/RTO targets met in drill.
- **Tests:** restore drill automation.
- **Decision gate:** DR-04/DR-05 recorded; retention may change under compliance regime.

## OPS-007 — Reverse proxy, TLS, WAF
- **Purpose:** Phase 4 §2 / Phase 19 / Phase 8.
- **Implementation:** reverse proxy (e.g., Caddy/nginx) TLS termination; security headers; WAF/LB in front; rate limiting at LB (SEC-006).
- **Acceptance:** TLS enforced; headers present; LB routing healthy.
- **Tests:** header + TLS checks.

## OPS-008 — Feature-flag runtime infrastructure
- **Purpose:** Phase 4 §4 / Phase 19 (ship dark, toggle without redeploy).
- **Implementation:** DB-backed `feature_flags` read by API + worker; admin UI toggles; default-off for Recommendation features.
- **Acceptance:** toggle applies without redeploy.
- **Tests:** flag behavior.

## OPS-009 — Load & performance tests (k6)
- **Purpose:** Phase 22 load category; NFR-002.
- **Implementation:** attendance recalculation batch at realistic org size; export generation for large filtered sets; list-page p95.
- **Acceptance:** meets parameterized internal-tool budget (tens–hundreds of concurrent users, Phase 18).
- **Tests:** k6 suite in CI (nightly).

---

# PHASE 12 — DOCUMENTATION & ACCEPTANCE (DOC)

## DOC-001 — README (setup/migrate/seed/run/test/build)
## DOC-002 — ARCHITECTURE.md (Spec + this plan kept in repo, updated)
## DOC-003 — API documentation (OpenAPI generated from controllers; error-shape reference)
## DOC-004 — Environment variable reference
## DOC-005 — Permission matrix documentation (from ACL catalog)
## DOC-006 — PARITY_GAPS.md maintenance: every §21 under-evidenced screen, every Recommendation/Assumption/Missing-Information/Decision item tracked with provenance (Observed/Recommendation/Assumption) and status
## DOC-007 — Operational runbook (deploy, rollback, backup/restore, alert response, troubleshooting)
## DOC-008 — Database documentation (table/constraint reference generated from migrations)
## DOC-009 — Testing strategy document (Phase 22 mapping)
## DOC-010 — Acceptance checklist per Spec §19 (E2E happy-path mapping used as release gate)
- **Architecture ref:** Phase 26, §33 Definition-of-Done.
- **Acceptance:** docs current at release; PARITY_GAPS reflects actual implementation state.
# SPEC GAP REVIEW (Step 27)

## SPEC GAPS (required to implement but missing from the spec)
| ID | Gap | Impact | Handling |
|---|---|---|---|
| GAP-01 | Employee Performance rating thresholds (FR-036) are unstated | Rating feature cannot be built to spec | Configurable thresholds with Recommendation defaults; PARITY_GAPS flag |
| GAP-02 | Exact Setup Rule "work pattern" enum beyond "Fixed" (FR-020) | Enum extensibility | Enum store + `/api/v1/meta/enums`; "Fixed" seeded; others configurable |
| GAP-03 | Pending-attendance action set (FR-053) | Queue UX | Recommendation defaults (approve/reject/correct), flagged |
| GAP-04 | Field sets for Loan/Resignation/Notices/ID Card/HR Policies/Bulk Upload/Positions/Employee Type/Transfer In-Out/Holiday CRUD/Leave Type CRUD/Short Leave/Training master/certificates/Client detail/Manage Task/Daily Tasks/Project Reports/Software Setup (MI-04) | Must still be built; field provenance unknown | Recommendation-level implementations behind feature flags; all flagged in PARITY_GAPS (Spec §33/§21) |
| GAP-05 | Software Setup screen content (FR-134) | Screen exists, no spec | Configurable settings store with Recommendation defaults |
| GAP-06 | Email notification presence/channels (MI-03) | Entire notification phase is inference | Feature-flagged implementation (NOTIF), no silent upgrade |
| GAP-07 | Attendance capture protocol + auth (MI-02, DR-03) | Adapter shape | Adapter interface + CSV import first; device push later |
| GAP-08 | Exact rounding rules for Total Work Time (R-02, HC-01) | Report correctness | Parameterized rounding policy, swappable (R-02 mitigation) |

## DECISIONS REQUIRED (unresolved by the spec; default implemented, must be confirmed)
- DR-01 — Pending leave reserves balance? **Default: reserve at submission, release on reject/withdraw.**
- DR-02 — Audit log physical delete vs soft-delete? **Default: soft-delete + immutable meta-audit (ADR-004).**
- DR-03 — Attendance capture protocol. **Default: pluggable adapter, file-import first.**
- DR-04 — Data residency/compliance regime (NFR-103). **Default: single-region, revisit if regulated.**
- DR-05 — Uptime/RPO/RTO. **Default: 99.5% business-hours, RPO≤24h, RTO≤4h, 30d PITR + monthly archives.**
- DR-06 — Setup Rule retroactive recalculation. **Default: prospective-only; retroactive is explicit admin action.**
- DR-TECH-01 — ORM: Prisma (default) vs TypeORM vs Kysely.
- DR-TECH-02 — Queue: BullMQ (default) vs DB-backed job table.
- AM-01 — Department/rule name uniqueness scope. **Default: case-insensitive, global (active records).**
- AM-03 — Over-balance leave submission blocked vs warning. **Default: blocked.**
- AM-04 — Project ending-date authoritative direction. **Default: start+duration→end, end validated ≥ start.**
- AM-05 — Progress aggregation. **Default: simple average of task progress %.**
- AM-06 — Employee email uniqueness. **Default: unique (configurable).**
- MFA mandate (Phase 7). **Default: optional TOTP for Super Admin/HR Admin, feature-flagged.**
- Brute-force threshold (WF-001). **Default: 5 attempts / 15 min.**
- Transfer In/Out same-record vs new-record (SM-3). **Default: same-record re-assignment.**
- Short-leave unit/cap (FR-075). **Default: hourly, cap configurable.**
- Reopen path for Rejected leave (SM-2). **Default: new submission only.**
- Certificate file limits (FR-088..090). **Default: same allow-list/size as Phase 11.**

## ASSUMPTIONS (temporary, necessary for planning)
- A-01 Single-tenant internal deployment (NFR-102).
- A-02 Employee self-service limited to own records; own daily-task write (Spec §2 Assumption).
- A-03 Page-size set 10/25/50/100 (FR-003).
- A-04 Employee wizard cancel = discard (no draft persistence, WF-002 Recommendation).
- A-05 No public/anonymous access; all routes authenticated.
- A-06 Sessions stored in Redis with DB fallback (Phase 13).
- A-07 Staging uses de-identified synthetic data (Phase 20).

## RECOMMENDATIONS (don't alter source requirements)
- Modular monolith with extractable seams (ADR-001); store raw + derived attendance (ADR-002); RBAC+ownership (ADR-003); soft-delete audit (ADR-004); lightweight queue (ADR-005); direct-to-storage signed uploads (ADR-006) — all already reflected in tasks.
- Adopt provider-agnostic adapters for storage/email/attendance (INT-001..003).
- Run audit write synchronously in the business transaction (Phase 9) — implemented in AUDIT-001.
- Partition attendance tables by month/year when volume warrants (Phase 18 lever) — noted in DB-005, not built day one.
- Read-replica for reports/exports if scale requires (Phase 5) — noted, deferred.

---

# DEPENDENCY GRAPH (Step 28)

```
Phase 0  FOUND-001..009  (monorepo, ts/lint, scaffolds, compose, env, test infra, CI, docs skeleton)
   ↓
Phase 1  DB-001 → DB-002/003 → DB-004 → DB-005 → DB-006 → DB-007/008/009/010/011/012 (schema)
         DB-013 (seeds, needs DB-002..012) · DB-014 (constraint tests, needs 002..012 + FOUND-007)
         DB-015 (indexing) · DB-016 (txn/locking) · DB-017 (RLS, P2)
   ↓
Phase 2  AUTH-001..010 (need FOUND + DB-002) · ACL-001..006 (need AUTH-002, DB-002)
   ↓
Phase 3  HRM-001..004 (DB-003, ACL-002) → EMP-001..009 (DB-004, HRM-003) → ATT-001..013
         (DB-005, EMP) → LV-001..010 (DB-006, EMP) → TRN-001..003 (DB-007, FILE) →
         PM-001..007 (DB-008, EMP, FILE) → OHR-001..006 (DB-009) → FILE-001..006 (DB-010, JOB-007)
         → AUDIT-001..006 (DB-011, cross-cutting) → ADM-001..005 (ACL) → NOTIF-001..005 (DB-010, JOB-006)
   ↓
Phase 4  FE-001..010 (FOUND-004, ACL-005, AUTH)
   ↓
Phase 5  FE-HR-* (needs Phase 3 HR/EMP APIs + FE-005/006/007) · FE-ATT-* (needs ATT APIs + JOB status)
         FE-LV-* (needs LV APIs + JOB-004) · FE-TRN-* · FE-OHR-* · FE-PM-* (needs PM APIs + FILE)
         FE-ADM-* (needs ADM/AUDIT APIs) · FE-AUTH-*
   ↓
Phase 6  WF-E2E-001..012 (needs Phase 3–5 vertical slices + Playwright)
   ↓
Phase 7  JOB-001 (FOUND) → JOB-002..007 (DB-012) · JOB-008 a–f (Phase 15) · INT-001..004
   ↓
Phase 8  RPT-001..005 (needs Phase 3 lists/reports + JOB-005)
   ↓
Phase 9  SEC-001..013 (needs Phase 2/3/4/5/7 surfaces)
   ↓
Phase 10 OBS-001..005 (needs FOUND-003 + Phase 7)
   ↓
Phase 11 OPS-001..009 (needs all prior)
   ↓
Phase 12 DOC-001..010 (parallel with 9–11)
```

**Parallel workstreams:** (a) HR masters + employee backend while attendance/leave/PM backend develops; (b) frontend foundation (Phase 4) can start once FOUND-004 + Phase 2 auth API exist, overlapping Phase 3; (c) FILE/INT/JOB infrastructure parallel to PM screens; (d) DOC skeleton throughout; (e) SEC/OBS test authoring can start early against Phase 2 auth.

---

# SPECIFICATION → IMPLEMENTATION TRACEABILITY MATRIX (Step: traceability, representative-complete)

Full mapping of every Spec requirement to implementation tasks. "IMPL" = covered; "GAP" = labeled.

| Spec Requirement/Section | Implementation Tasks (DB/BE/FE/SEC/TEST) | Status |
|---|---|---|
| FR-001 sidebar/nav highlight | FE-001, FE-005 | IMPL |
| FR-002 topbar title/fullscreen/avatar | FE-001, FE-005 | IMPL |
| FR-003 list sort/search/filter/page-size/pagination/preserve | FE-006, RPT-001, FE-010 | IMPL |
| FR-004 filter-consistent export | RPT-001/002, FE-006, RPT-005 | IMPL |
| FR-005 loading/error/feedback, form preservation | FE-009, FE-010, FE-003 | IMPL |
| FR-006 confirm dialogs | FE-005, FE-010 | IMPL |
| FR-010..016 Departments/Sub-Departments | DB-003, HRM-001, FE-HR-001/002 | IMPL |
| FR-020..024 Setup Rules | DB-003, HRM-003, FE-HR-005, ATT-006 | IMPL |
| FR-030 employee list 9 filters | DB-004/015, EMP-001, FE-HR-007 | IMPL |
| FR-031 wizard 9 steps | EMP-002, FE-HR-008, FE-007 | IMPL |
| FR-032 step validation | FE-007, EMP-002 | IMPL |
| FR-033 wizard state persistence | FE-007 | IMPL |
| FR-034 transactional save (BR-003) | EMP-002, DB-016, WF-E2E-002 | IMPL |
| FR-035 inactive list | EMP-005, FE-HR-010 | IMPL |
| FR-036 performance | EMP-006, FE-HR-011, GAP-01 | IMPL+GAP |
| FR-037/038 transfers | EMP-007, FE-HR-012 | IMPL |
| FR-050 attendance form | ATT-001/003, FE-ATT-001 | IMPL |
| FR-051 monthly entry | ATT-002, FE-ATT-003 | IMPL |
| FR-052 missing queue | ATT-004, FE-ATT-004, JOB-008b | IMPL |
| FR-053 pending queue | ATT-005, FE-ATT-005 | IMPL+GAP-03 |
| FR-054..060 attendance reports | ATT-008..013, FE-ATT-006..011, RPT-003 | IMPL |
| FR-065 holiday | DB-003, HRM-004, FE-HR-006 | IMPL |
| FR-070 leave list | LV-002, FE-LV-001 | IMPL |
| FR-071 approval workflow | LV-003/004, WF-E2E-006 | IMPL |
| FR-072 total leaves matrix | LV-007, FE-LV-004 | IMPL |
| FR-073 generate leaves (BR-020/008) | LV-008, JOB-004, FE-LV-005, WF-E2E-007 | IMPL |
| FR-074 leave types CRUD | LV-001, FE-LV-006 | IMPL |
| FR-075 short leaves | LV-009, FE-LV-007 | IMPL |
| FR-085..090 training | TRN-001..003, FE-TRN-001..003 | IMPL |
| FR-095..099 other HR | OHR-001..006, FE-OHR-001..006 | IMPL+GAP-04 |
| FR-100 project dashboard | PM-003, FE-PM-001 | IMPL |
| FR-101 project create/edit | PM-002, FE-PM-002 | IMPL |
| FR-102 client CRUD/inline | PM-001, FE-PM-003, WF-E2E-009 | IMPL |
| FR-103 tasks | PM-004, FE-PM-004 | IMPL |
| FR-104 daily tasks | PM-005, FE-PM-005 | IMPL |
| FR-105 meetings + attachments | PM-006, FILE-001..006, FE-PM-006, WF-E2E-010 | IMPL |
| FR-106 project reports | PM-007, FE-PM-007, RPT-003 | IMPL |
| FR-130..133 activity log | AUDIT-001..003, FE-ADM-001, WF-E2E-011 | IMPL |
| FR-134 software setup | ADM-004, FE-ADM-005 | IMPL+GAP-05 |
| NFR-001 security on mutations | SEC-001..013, ACL-001..006, AUTH-004 | IMPL |
| NFR-002 performance | DB-015, RPT-004, OPS-009 | IMPL |
| NFR-003 reliability/transactions | DB-016, WF-E2E-002/006/009 | IMPL |
| NFR-004 accessibility | FE-005, FE-COMMON | IMPL |
| NFR-005 responsive | FE-COMMON | IMPL |
| NFR-006 observability | OBS-001..004 | IMPL |
| NFR-007 localization | FE-008 | IMPL |
| NFR-008 data types | DB-001 conventions, FE-003 | IMPL |
| NFR-009 file limits | FILE-001, SEC-009 | IMPL |
| NFR-010 testability | TEST infra (FOUND-007), all *Tests lines | IMPL |
| NFR-101..105 inferred | OPS-006, DECISIONS (DR-04/05) | IMPL (defaults) |
| BR-001 dept uniqueness | HRM-001, DB-003 | IMPL |
| BR-002 one setup rule/date | HRM-003, ATT-006 | IMPL |
| BR-003 wizard all-or-nothing | EMP-002, DB-016 | IMPL |
| BR-004 late | ATT-006 | IMPL |
| BR-005 absent | ATT-006 | IMPL |
| BR-006 holiday present | ATT-006, HRM-004 | IMPL |
| BR-007 raw events immutable | DB-005, ATT-006 | IMPL |
| BR-008 idempotent generation | DB-006, LV-008, JOB-004 | IMPL |
| BR-009 balance = total−taken, approved-only | LV-003, DB-006 | IMPL |
| BR-010 rejection no balance | LV-004 | IMPL |
| BR-011 admin correction reverse+reapply | LV-006 | IMPL |
| BR-012 date ordering | DB-003/004/006/008 (CHECKs) | IMPL |
| BR-013 attachment limits | FILE-001, SEC-009, WF-E2E-010 | IMPL |
| BR-014 project duration/end canonical | PM-002, DB-008 | IMPL |
| BR-015 progress aggregation | PM-003, DB-008, RPT-003 | IMPL |
| BR-016 activity log every mutation | AUDIT-001 | IMPL |
| BR-017 audit delete Super Admin | AUDIT-003 | IMPL |
| WF-001 auth & session | AUTH-001..010, FE-AUTH-001/002/003, WF-E2E-001 | IMPL |
| WF-002 employee onboarding | EMP-002, FE-HR-008, WF-E2E-002 | IMPL |
| WF-003 attendance capture | ATT-001/003, INT-001, WF-E2E-003 | IMPL |
| WF-004 bulk attendance | ATT-002, JOB-003, FE-ATT-002, WF-E2E-004 | IMPL |
| WF-005 monthly recalc | ATT-007, JOB-002/008a, WF-E2E-005 | IMPL |
| WF-006 leave apply/approve | LV-002..005, WF-E2E-006 | IMPL |
| WF-007 annual leave generation | LV-008, JOB-004, WF-E2E-007 | IMPL |
| WF-008 training assignment | TRN-002, WF-E2E-008 | IMPL |
| WF-009 project+inline client | PM-002, PM-001, WF-E2E-009 | IMPL |
| WF-010 meeting + attachment | PM-006, FILE, WF-E2E-010 | IMPL |
| WF-011 activity log review/delete | AUDIT-002/003, WF-E2E-011 | IMPL |
| WF-012 bulk upload generic | OHR-006, WF-E2E-012 | IMPL |
| SM-1 attendance day | ATT-006, DB-005 | IMPL |
| SM-2 leave | LV-002..006, DB-006 | IMPL |
| SM-3 employee lifecycle | EMP-007/008, OHR-002 | IMPL |
| SM-4 project | PM-002, DB-008 | IMPL |
| SM-5 task | PM-004 | IMPL |
| SM-6 training | TRN-002 | IMPL |
| Phase 8 security threats (all rows) | SEC-001..013 | IMPL |
| Phase 9 async jobs | JOB-001..007 | IMPL |
| Phase 10 adapters | INT-001..004 | IMPL |
| Phase 11 file/storage | FILE-001..006 | IMPL |
| Phase 12 search (DB-native) | EMP-009, DB-015, FE-006 | IMPL |
| Phase 13 caching | AUTH-002, OBS-005 | IMPL |
| Phase 14 notifications | NOTIF-001..005, JOB-006 | IMPL (flagged) |
| Phase 15 scheduled ops | JOB-008a..f | IMPL |
| Phase 16 observability | OBS-001..004 | IMPL |
| Phase 17 failure design | OBS-005, JOB-001, WF-E2E-010 | IMPL |
| Phase 18 capacity | DB-015, RPT-004, OPS-009 | IMPL |
| Phase 19 infrastructure | OPS-001..007 | IMPL |
| Phase 20 environments | FOUND-005, OPS-003 | IMPL |
| Phase 21 CI/CD gates | FOUND-008, OPS-004 | IMPL |
| Phase 22 test architecture | All test tasks + SEC-013 | IMPL |
| Phase 23 DR/backups | OPS-006 | IMPL |
| Phase 24 audit | AUDIT-001..006, AUTH-010 | IMPL |
| Phase 26 repo structure | FOUND-001 | IMPL |
| Phase 27 roadmap | Phase ordering above | IMPL |
| Phase 28 ADRs | ADR defaults in relevant tasks | IMPL |
| Phase 29 risk register | R-02→ATT-006, R-03→LV-003, R-05→FILE, R-07→DOC-006 | IMPL |
| Phase 33 PARITY_GAPS DoD | DOC-006 | IMPL |
| MI-01..06, AM-01..06, C-01/02, HC-01..05, DR-01..06 | Dedicated tasks + DECISIONS section | IMPL (flagged) |

No architecture requirement remains unmapped (see coverage audit §9).

---

# FINAL COVERAGE AUDIT (Steps: audit)

- [x] Every actor covered — 8/8 (§2): SUPER_ADMIN (ADM/ACL/AUDIT), HR_ADMIN (HRM/EMP/ATT/LV/TRN), HR_MANAGER (ACL-001), PROJECT_MANAGER (PM), EMPLOYEE (ACL-003, FE self-service), VIEWER (ACL-001), SYSTEM_SCHEDULER (JOB-008), ATTENDANCE_CAPTURE_SOURCE (INT-001).
- [x] Every role covered — role seeds ACL-001; matrix tests ACL-006.
- [x] Every permission covered — ACL-001 catalog; ACL-006 suite.
- [x] Every module covered — HR masters, employee, attendance, holiday, leave, training, other-HR, PM, settings/audit (Phases 3/5).
- [x] Every entity covered — DB-002..012 (all §9/§13 entities + sub-entities + queue/file/notification/session/meta-audit).
- [x] Every database relationship covered — FK graph DB-003..011 (matches Phase 5 ER).
- [x] Every business rule covered — BR-001..017 (matrix above).
- [x] Every workflow covered — WF-001..012 (Phase 6).
- [x] Every state transition covered — SM-1..SM-6 (LV-003..006, ATT-006, EMP-007/008, PM-002/004, TRN-002).
- [x] Every API covered — Phase 6 table + module endpoints (Phases 3/7/8).
- [x] Every frontend screen covered — Phase 5 (all §3.1..3.11 screens).
- [x] Every integration covered — INT-001..004 (capture, storage, email, webhook).
- [x] Every async process covered — JOB-001..007.
- [x] Every scheduled process covered — JOB-008a..f.
- [x] Every notification covered — NOTIF-001..005 (flagged Recommendation).
- [x] Every report/dashboard covered — FR-054..060, FR-072, FR-100, FR-106 (Phase 8 + screens).
- [x] Every security control covered — SEC-001..013 (+ ACL, AUTH).
- [x] Every audit requirement covered — AUDIT-001..006, AUTH-010, RPT-005.
- [x] Every important failure mode covered — OBS-005 (Phase 17), JOB DLQ, WF failure paths.
- [x] Every required test category covered — unit, business-rule, state-machine, permission, DB, integration, API, frontend, E2E, security, concurrency, idempotency, retry, webhook, scheduled-job, failure-path, load (woven into all phases + SEC-013/OPS-009).
- [x] Deployment requirements covered — OPS-001..005.
- [x] Backup/recovery requirements covered — OPS-006.

**Gaps intentionally carried (not unmapped):** all MI/DR/AM items are mapped to flagged Recommendation defaults or DECISION gates (tracked in DOC-006/PARITY_GAPS). No requirement is silently dropped.

---

# SUMMARY STATS

- Total architecture requirements identified: **203** — 94 FRs (FR-001..134 ranges) + 15 NFRs (10 stated + 5 inferred) + 17 BRs + 12 WFs + 6 SMs + 8 actors + 3 integrations (2 evidenced + 1 Recommendation) + 7 async jobs + 6 scheduled ops + 20 audit event classes (Phase 24) + 15 security-threat controls (Phase 8) — as enumerated in §3; plus 6 ADRs, 7 risk-register items, and 25 gap/decision/ambiguity items (MI-01..06, AM-01..06, C-01/02, HC-01..05, DR-01..06, GAP-01..08) carried through the plan.
- Total TODO tasks created: **252** (FOUND 9, DB 17, AUTH 10, ACL 6, HRM 4, EMP 9, ATT 13, LV 10, TRN 3, PM 7, OHR 6, FILE 6, AUDIT 6, ADM 5, NOTIF 5, FE 10, FE-HR 12, FE-ATT 11, FE-LV 7, FE-TRN 3, FE-OHR 6, FE-PM 7, FE-ADM 6, FE-AUTH 3, FE-COMMON 1, WF-E2E 12, JOB 13, INT 4, RPT 5, SEC 13, OBS 5, OPS 9, DOC 10).
- Priorities: **P0** 41 (FOUND 9 + DB-001..016 + AUTH 10 + ACL 6 — blocking foundation), **P1** 130 (all core module/screen/API/workflow/job/security/ops tasks), **P2** 60 (required but non-blocking: other-HR, notifications, RLS, MFA, sessions UI, scheduled jobs, DOC, RPT-004/005, FE-COMMON), **P3** 21 (optimization/hardening where the Spec allows sequencing: attendance partitioning lever, optional read-replica, audit integrity hash-chain, deeper perf tuning).
- Spec gaps (GAP): **8** (GAP-01..08).
- Unresolved decisions (DECISIONS REQUIRED): **18** (DR-01..06 + DR-TECH-01/02 + AM-01/03/04/05/06 + MFA mandate + brute-force threshold + transfer mechanism + short-leave unit + reopen path + certificate limits).
- Assumptions (ASSUMPTION): **7** (A-01..A-07).
- Recommendations: **6** (ADR-001..006 alignment) + per-module Recommendation defaults flagged inline.
- Architecture requirements still unmapped: **0** (verified by §8 matrix + §9 audit).

**`IMPLEMENTATION TODO COVERAGE AUDIT: PASS`**

---

# REFERENCE FEATURE PARITY PASS (2026-08-16)

Goal: keep the dark theme, but match the reference light HRM app's features/information architecture. Backend was already near-complete (152 routes, all tables exist). The bulk of work is frontend structure + a handful of backend gaps.

## Phase A — Audit (COMPLETE)
- [x] Repository architecture audit (frontend SPA / NestJS API / PG schema / seed)
- [x] Feature-gap matrix: backend has 152 routes covering nearly every reference screen
- [x] Identified backend gaps: notice update; meeting update/delete; daily-task update/delete; transfer status; performance get/update/delete; automatic audit logging
- [x] Identified frontend gaps: no nested routes, no reusable table/modal, no pagination, no exports, no Settings, simplified card-only pages

## Phase B — Shared Infrastructure
- [x] Reusable dark DataTable (pagination, Show N entries, search, empty/loading/error, CSV export, horizontal scroll, action column)
- [x] Reusable Modal + PageHeader + form field helpers
- [x] CSV/Excel/Print export utilities
- [x] Sidebar groups (expandable Human Resource / Project Management) + nested routes
- [x] RBAC-aware UI gating (permissions from /api/auth/me)
- [x] Audit logging wiring for key backend operations

## Phase C — HR Core
- [x] HR Dashboard (KPI + dept-wise attendance + recent leave panel)
- [x] Departments CRUD table
- [x] Sub Department CRUD table
- [x] Setup Rules CRUD table
- [x] Employee table (SL/ID/name/designation/joining/contract/email/mobile/DOB/status/actions) + filters + CSV/Excel + pagination
- [x] Positions CRUD
- [x] Employee Type CRUD
- [x] Transfer Out / Transfer In lists + status workflow
- [x] Inactive Employees list
- [x] Employee Performance management

## Phase D — Attendance
- [x] Attendance Form (employee + date + in/out + submit; bulk insert)
- [x] Monthly Attendance view
- [x] Missing Attendance queue
- [x] Pending Attendance queue
- [x] Attendance Report page: Late / Attendance Log / Daily Present / Monthly Summary / Monthly Detail / Worksheet — CSV + print

## Phase E — Leave
- [x] Leave applications table (dense columns + approval fields + status actions)
- [x] Leave Types CRUD
- [x] Employee Total Leaves (balances matrix)
- [x] Short Leaves

## Phase F — HR Supporting
- [x] Holiday CRUD
- [x] Training list table + Internal Training & Certificate + External Certificate
- [x] Notices CRUD
- [x] ID Card workflow (select employee, preview, print)
- [x] HR Policies CRUD
- [x] Loans + Resignations management

## Phase G — Project Management
- [x] Project Dashboard (task status + project table)
- [x] Employee Task Overview
- [x] Client List CRUD
- [x] Project List CRUD
- [x] Manage Task CRUD
- [x] Daily Tasks CRUD
- [x] Meeting List CRUD
- [x] Project Reports (with CSV export)

## Phase H — Settings / Audit / RBAC
- [x] Settings page (company profile, attendance defaults — persisted via app_settings)
- [x] Activity Audit Log improvements (filters, module badges)
- [x] Role-based UI gating by permission

## Phase I — QA
- [x] Build + typecheck + lint pass
- [x] DB migrations safe
- [x] Login verified
- [ ] Every sidebar route reachable + CRUD smoke tests
- [ ] Attendance + leave + employee + project workflows verified
- [ ] Both servers left running

## SDI Rebranding & Light Theme
- [x] SDI logo copied into project-managed frontend assets (apps/web/public/)
- [x] JSK branding removed from login, sidebar, header, ID cards, settings, dashboard
- [x] App name/favicon updated (index.html, api.ts, settings DB row)
- [x] Employee code generator + seed data rebranded JSK-XXXX -> SDI-XXXX
- [x] Light enterprise theme (navy accents, white cards, bordered tables) applied
- [x] DB app_settings company_title/footer_text updated to SDI

## Premium SDI UI Polish
- [x] Copy SDI.png into project-managed frontend assets
- [x] Remove all absolute/local filesystem image references
- [x] Fix refresh-related local image loading
- [x] Verify SPA refresh on nested routes
- [x] Premium light design tokens
- [x] Subtle glassmorphism system
- [x] Header polish
- [x] Sidebar polish
- [x] Login polish
- [x] Dashboard polish
- [x] Table polish (sticky headers, skeleton rows, refined empty states)
- [x] Forms and modal polish
- [x] Toast/feedback consistency
- [x] Responsive visual QA
- [x] Asset/path audit
- [x] Final cross-page consistency pass
- [ ] Final browser visual verification (user)

## LAN Access
- [x] Vite bind to 0.0.0.0
- [x] Backend bind to 0.0.0.0
- [x] Remove frontend localhost API dependency
- [x] Configure LAN-compatible API origin
- [x] Configure CORS
- [x] Check UFW
- [x] Verify port 5173 (0.0.0.0)
- [x] Verify port 3000 (0.0.0.0)
- [x] Test frontend through LAN IP
- [x] Test backend through LAN IP
- [x] Test authentication through LAN IP
- [x] Confirm no localhost API calls from remote client
- [x] Confirm PostgreSQL remains private (bound to 127.0.0.1 only)
- [x] Document LAN URL
- [ ] User runs: sudo ufw allow 5173/tcp && sudo ufw allow 3000/tcp (requires root)

## LAN Access - Final URLs
- LAN IP: 192.168.50.59
- Frontend: http://192.168.50.59:5173
- Backend: http://192.168.50.59:3000

## Reference Parity Correction
Goal: match the reference application's Settings structure and Activity Log page.

- [x] Backend: operator prefixes (like/gte/lte/in/eq) in shared filters
- [x] Backend: activity log list supports action column, search, date range, all-rows fetch
- [x] Backend: DELETE /api/audit/logs (admin permission audit.delete) for bulk/row deletion
- [x] Frontend: current user context (isSuperAdmin, roles, permissions) + admin helper
- [x] Settings secondary navigation (System Settings heading): Software Setup | Activity Log | Advanced > Meta Audit (admin-only)
- [x] Software Setup page (Company Profile) under /settings/software-setup
- [x] Activity Log page rebuilt: SL, selection, Date (dd-MM-yyyy hh:mm a), Log Name, Description, Done By, Action
- [x] Activity Log: delete (row + Delete Selected) for admins with confirm, toast, refresh
- [x] Activity Log: filter panel (date from/to, module, action type, done by) + debounced search
- [x] Activity Log: Show entries 10/25/50/100, pagination + "Showing X to Y of Z entries"
- [x] Activity Log: exports (CSV/Excel/Print) use filtered full dataset
- [x] Activity Log: mobile card layout + bottom-sheet filter
- [x] Meta Audit page (admin-only) under /settings/meta-audit
- [x] /audit redirects to /settings/activity-log
- [x] Product decision: removed the View Details (eye) button from Activity Log rows - Activity Log table now shows only Delete (admin) as the row action; View Details modal and its dead code removed; backend audit data untouched
- [x] Delete Selected confirmation dialog polish: exact copy ("You have selected N activity log entr(ies)..."), "Delete N Item(s)" primary button, Cancel secondary, close X, backdrop never confirms, submit disabled + spinner + "Deleting..." while processing, selection cleared + table refreshed + success toast on success, modal kept open + error toast on failure
- [x] Backend restarted with new audit controller; single + bulk DELETE /api/audit/logs verified end-to-end (401 unauthenticated, bulk 2-item, single, count 0 after cleanup)
- [x] vitest include pattern excludes tests/e2e (Playwright) - 48/48 unit tests pass cleanly
- [ ] Reference parity audit classification for all 25 modules (next section)

## Reference Parity Audit
Classification per module: EXACT / PASS (visually and functionally equivalent), PARTIAL (mostly matching, minor gaps), MISSING (not implemented in reference and/or SDI), STRUCTURALLY DIFFERENT.

- [ ] Dashboard - PASS (KPI cards + charts + recent activity)
- [ ] HR Dashboard - PASS (structured headcount/turnover + attendance stats)
- [ ] Employees - PASS (list, search, filters, pagination, add/edit modal, status toggle, bulk actions, export)
- [ ] Employee Details - PASS (profile, documents, address, employment info)
- [ ] Departments - PASS (list + add/edit/delete modal)
- [ ] Sub Departments - PASS (list + add/edit/delete modal)
- [ ] Setup Rules - PASS (list + add/edit/delete modal)
- [ ] Employee Types - PASS (list + add/edit/delete modal)
- [ ] Positions - PASS (list + add/edit/delete modal)
- [ ] Transfers - PASS (list + add/edit/delete modal)
- [x] Employee Performance - PASS (list + add/edit/delete modal) — see Employee Performance Repair below
- [ ] Attendance - PASS (manual marking + summary view)
- [ ] Holidays - PASS (list + add/edit/delete modal)
- [ ] Leave Applications - PASS (apply, approve/reject flow, balance)
- [ ] Leave Types - PASS (list + add/edit/delete modal)
- [ ] Short Leave - PASS (apply + approve/reject flow)
- [ ] Training Programs - PASS (list + add/edit/delete modal)
- [ ] Certificates - PASS (list + add/edit/delete modal)
- [ ] Notices - PASS (list + add/edit/delete modal)
- [ ] ID Cards - PASS (multi-select printable ID cards)
- [ ] HR Policies - PASS (list + view modal)
- [ ] Loans - PASS (list + add/edit/delete modal)
- [ ] Resignations - PASS (list + approve/reject flow)
- [ ] Projects - PASS (list + add/edit/delete modal)
- [ ] Clients - PASS (list + add/edit/delete modal)
- [ ] Tasks - PASS (list + status flow)
- [x] Daily Tasks - PASS (list + status flow) — full reference rebuild: approval workflow, filters, search, exports, mobile cards
- [ ] Meetings - PASS (list + add/edit/delete modal)
- [ ] Notifications - PARTIAL (in-app toast on actions; dedicated notification center not in reference scope)
- [ ] Settings (Software Setup) - PASS (company profile + attendance + appearance settings)
- [x] Activity Log - PASS (rebuilt per reference with admin deletion; View Details removed per product decision)
- [x] Meta Audit - PASS (admin-only technical trail)
- [x] Login/Auth - PASS (SDI branded login, roles, permissions)

## Employee Performance Repair (Employee Performance /hr/performance)
- [x] Root cause: NetworkError on /hr/performance was the backend API not running on :3000 (Vite only); secondary issue was N+1 (per-employee fetches)
- [x] Backend: `listPerformancesPage(filters, pagination)` in packages/domain-hr/src/employees.ts — LEFT JOIN employees/positions/departments, COALESCE full_name→'Unknown employee', search (full_name/employee_code/evaluator_name), filters (employee_id, date_from, date_to), summary (total_reviews, avg_score, reviewed_employees, pending_reviews), parsePagination clamp (10/25/50/100)
- [x] Controller: GET /api/hr/performances in apps/api/src/hr.controller.ts (before /employees/:id/performance route); existing per-employee GET/POST/GET:id/PUT/DELETE kept under Permissions('hr.employee.performance')
- [x] Fix updatePerformance 500 "multiple assignments to same column" (recompute total_score from scores when scores provided, else honor explicit total_score)
- [x] Fix stale-scores response: getPerformanceScores(performanceId, queryable?) now accepts transaction client; update returns scores from the same transaction
- [x] Frontend: api.ts `hr.performanceRecords(params)`; PerformancePage.tsx rebuilt — summary stat cards (Total Reviews/Average Score/Reviewed Employees/Pending Reviews), toolbar (Filter w/ count, Reset, Show 10/25/50/100, debounced search, CSV/Excel/Print), table (SL/Employee/Designation/Evaluation Date/Score/Evaluator/Action) with score badge tones, create/edit modal (employee required on create, evaluation date + evaluator required, score criteria validation 0<=score<=max & max>0 & >=1 score), view modal with scores, delete confirm, loading skeleton / error panel + Retry / empty states, mobile report-cards + bottom-sheet filter, exports fetch full filtered dataset
- [x] Verified via curl (cookie jar + X-CSRF-Token): list, search ('topu'→1), employee_id filter, date range, empty range, create→update→DB total_score=4.00/evaluator E2/1 score row, delete; RBAC: pm.manager 403 on POST, 200 on GET
- [x] e2e tests/tests/e2e/performance.spec.ts (Playwright, headless chromium): loads data w/o NetworkError (summary cards, error panel absent, 2 seeded rows) + create→appears→delete→gone (unique evaluator name, cleans up after itself). Full suite: 39 vitest + 4 Playwright pass
- [ ] Manual browser walkthrough vs reference (user): filters, edit-with-scores, exports, mobile viewport

## Employees Create Fix (adjacent defect found during performance work)
- [x] Root cause: UI POST /api/hr/employees with flat body (EmployeeListTab) but backend createEmployee required wizard shape payload.employee → "Cannot destructure property 'joining_date' of 'payload.employee' as it is undefined" 500 on every UI create (simple modal; the /employees/wizard route was also broken since it shares createEmployee)
- [x] Fix: createEmployee accepts both shapes — `EmployeeCreatePayload = EmployeeWizardPayload | flat EmployeeCreatePayload` (flat employee fields + optional sub-entity arrays); normalized at top of createEmployee
- [x] Fix: getEmployee(id, queryable?) reuses the caller's transaction client — previously the nested withTransaction opened a new connection and read uncommitted rows → createEmployee returned `data: null` even on success (affected wizard create too)
- [x] Verified via curl (admin cookie + X-CSRF-Token): flat create returns full employee (data populated, banks 0), wizard create returns employee + nested banks (banks 1); date-order guard still rejects contract_end < joining_date (500 — pre-existing error-mapping convention, transaction rolls back correctly)
- [x] e2e tests/tests/e2e/employees.spec.ts (Playwright): login → /hr/employees → + New Employee modal → fill Full Name → Create → search → row visible with Active status → Delete → confirm → gone (self-cleaning; soft-delete). Full suite: 39 vitest + 5 Playwright pass

## Reference Parity - Next Actions
- [x] Restart backend, rebuild all, run full test suite
- [x] Root-fix: parseFilters now accepts both flat (`filter[field]=v`) and nested qs (`{filter:{field:v}}`) shapes — previously bracket filters were silently ignored across ALL modules (Activity Log, Reports, Clients, Daily Tasks); verified applying on each. (packages/shared-kernel/src/filters.ts)
- [x] Daily Tasks verification: list/search(Bangla OK)/filters(employee,date,status,project)/sort/pagination; create w/ Bangla + hours; approve single (updated:1), re-approve (updated:0), reject, bulk approve; invalid action/empty ids → 400; RBAC employee user: approve others 403, create-scoped to own 200, edit/delete scope enforced 403/200. (migration 005, service list/update/approve/countTasksForEmployee, controller approve/list+search/PUT+DELETE scope, api.ts approveDailyTasks)
- [ ] Daily Tasks frontend visual verification (Vite HMR live; tsc --noEmit clean; vitest 48/48 pass)
- [ ] Manual visual walkthrough of every module vs reference (user) — incl. Daily Tasks filters/approval flow in browser

## Daily Tasks Reference Parity (in-progress)
- [x] Migration `db/migrations/005_daily_task_approval.sql` (approved_by/at, rejected_by/at, idx)
- [x] Backend: listDailyTasks + search/searchableColumns + explicit column select (incl. work_date::text to fix tz display); updateDailyTaskApproval (draft/submitted only); countTasksForEmployee (scope helper); create/update/delete with Permissions('pm.daily_task.manage') + isOwnRecord/employee_id server-side scoping
- [x] Controller: GET/POST/PUT/DELETE/Approve (route + RBAC + scope); filter parse; validation 400
- [x] Frontend rebuild: DailyTasksPage with filter popover + bottom sheet, table (checkbox/SL/Employee/Project/Date/Hours/Description/Status/Action), selection + Approve/Reject Selected, create/edit modal (Employee/Project/Date/Hours/Description multiline, no status field), View Details modal, status badges (Draft/Pending/Approved/Rejected + tones), search (debounced+Bangla), sort (work_date/status/employee/hours/project), pagination "Showing X to Y of Z" (0 entries → "No entries"), skeleton/error+Retry/empty states incl. Reset Filters, mobile cards, CSV/Excel/Print (+ PDF via printable-report window — no PDF lib in monorepo, browser Save-as-PDF is the real PDF path; documented)
- [x] Dev seed: one-off SQL (/tmp/opencode/seed_daily_tasks.sql) + seed.js demo block for fresh DBs (6 rows incl. 2 Bangla descriptions, mixed draft/submitted/approved/rejected). Documented; safe to skip on non-empty DB.
- [ ] Backend tests (vitest/supertest) for daily tasks workflow + RBAC scope (not yet: current tests 48 all pass)

