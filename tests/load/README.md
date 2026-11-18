# Load tests (Spec Phase 22 / Phase 25)

Grafana k6 scripts targeting the API from outside the app process.

## Run

The `k6` binary is required (not bundled in this repo — not installed in this dev environment).

```bash
# smoke profile against a running API (default http://localhost:3000)
k6 run smoke.js

# target a specific environment
API_URL=https://api.example.com k6 run smoke.js
```

Add soak/stress/peak profiles here as phases (Phase 10) are implemented. NFR latency
budgets come from the performance requirements in the spec (Phase 21 gates).