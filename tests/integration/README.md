# Integration tests (DB-backed)

Home for tests that exercise real adapters (Postgres, MinIO, Mailpit) against the running
local environment (`infra/docker-compose.yml`, Spec Phase 20).

## Postgres strategy

- `testcontainers` is NOT used: Docker is unavailable in the current dev environment
  (documented environment constraint). DB integration tests instead target the compose
  `db` service or any Postgres reachable via `DATABASE_URL`.
- The db/ migration tasks (Phase 1) will wire `vitest` global-setup that applies
  `db/migrations` then runs tests against a disposable schema (e.g. a dedicated test
  database created from `POSTGRES_DB`), with `NODE_ENV=test`.

Convention (Phase 25): every test here must be hermetic per-file — create/seed its own
data and clean up after itself.