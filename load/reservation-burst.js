import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses(201, 409));
export const unexpected5xx = new Counter('unexpected_5xx');

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 500,
      stages: [
        { target: 250, duration: '10s' },
        { target: 1000, duration: '15s' },
        { target: 1000, duration: '15s' },
        { target: 0, duration: '5s' },
      ],
    },
  },
  thresholds: {
    unexpected_5xx: ['count==0'],
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<2000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3000';
const SHOW_ID = __ENV.SHOW_ID;
const TOKEN = __ENV.TOKEN;
const SEAT_COUNT = Number(__ENV.SEAT_COUNT || 200);

export default function () {
  const seat = `B${(__ITER % SEAT_COUNT) + 1}`;
  const response = http.post(
    `${BASE_URL}/shows/${SHOW_ID}/reserve`,
    JSON.stringify({ seats: [seat], idempotency_key: `k6-${__VU}-${__ITER}` }),
    { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } },
  );
  if (response.status >= 500) unexpected5xx.add(1);
  check(response, { 'domain response is expected': (r) => [201, 409].includes(r.status) });
}
