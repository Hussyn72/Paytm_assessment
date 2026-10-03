# Phase 8 - Correctness and Burst Testing

## One-command correctness attacks

Start the API with `DATABASE_URL` and `JWT_SECRET`, then run:

```bash
JWT_SECRET=<same-secret> npm run test:correctness
```

The runner attacks the HTTP API, not service functions, and exits non-zero if any required invariant fails.

## Six correctness attacks

1. **Hot seat:** 500 distinct users concurrently request A12. Exactly one request must return 201; the other 499 must be clean 409 domain declines.
2. **Zero 5xx burst:** 1,000 concurrent reservation requests contend across 200 seats. Any 5xx fails the run.
3. **Reconciliation:** after contention, `available + held + confirmed == total`.
4. **Idempotency:** 100 concurrent retries with the same key/body must resolve to one reservation; reusing that key with another body must return 409.
5. **Per-user limit:** ten concurrent one-seat requests from one user with limit four must produce exactly four reservations.
6. **Identity/cancellation:** a body identity spoof field is rejected, reservation ownership comes from JWT, a non-owner cancel is 403, and the owner can cancel.

## Verified local result - 2026-10-04

- Hot seat: **1 x 201, 499 x 409, 0 x 5xx**; p95 1285.50 ms, p99 1299.93 ms.
- 1,000-request burst: **200 x 201, 800 x 409, 0 x 5xx**; p95 1650.93 ms, p99 1658.02 ms.
- Reconciliation: 20 total = 0 available + 0 held + 20 confirmed.
- Idempotency storm: 100 retries -> 1 unique reservation.
- Per-user limit: 4 x 201 and 6 x 409.
- Identity/cancellation: spoof body 400, non-owner cancel 403, owner cancel 200.

These timings are local-development measurements, not production SLO claims.

## k6 sustained burst profile

`load/reservation-burst.js` uses a ramping arrival rate up to 1,000 iterations/second. It fails on any unexpected 5xx and records HTTP latency and domain-response checks.

Prepare a 200-seat show and load-user JWT with:

```bash
JWT_SECRET=<same-secret> node scripts/prepare-k6.mjs
```

Then run k6 locally or through Docker. When k6 runs in Docker, use `BASE_URL=http://host.docker.internal:3000`.

## Verified k6 Docker result - 2026-10-04

The 45-second ramp reached a requested rate of 1,000 iterations/second with a 500-VU ceiling.

- Completed HTTP requests: **18,263**
- Domain-response checks: **18,263 / 18,263 passed**
- Unexpected 5xx: **0**
- k6 http_req_failed: **0.00%** after explicitly treating 201 and expected 409 domain declines as valid responses
- Average latency: **716.81 ms**
- p95 latency: **1.12 s**
- Maximum observed latency: **1.32 s**
- Dropped scheduled iterations: **10,111**
- Maximum active VUs: **500**

The dropped iterations show the local single-instance environment reached its configured load-generator/application capacity ceiling. This is recorded as capacity evidence and is not hidden or presented as a production throughput claim; correctness thresholds still passed with zero unexpected server errors.