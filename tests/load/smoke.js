// Load test — smoke profile hitting the API health endpoint (Spec Phase 22 / Phase 25).
// Run with: k6 run smoke.js  (set API_URL to target environment)
import { check } from 'k6';
import http from 'k6/http';
import { Rate } from 'k6/metrics';

const failureRate = new Rate('failed_requests');

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/health`);
  const ok = res.status === 200 && res.json().status === 'ok';
  failureRate.add(!ok);
  check(res, {
    'status is 200': () => res.status === 200,
    'status field is ok': () => res.json().status === 'ok',
  });
}