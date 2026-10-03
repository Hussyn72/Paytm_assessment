# Paytm Money - Seat Reservation at Scale

Backend-only assigned-seat reservation API designed for correctness under heavy contention.

## Live API
Public Railway service: paytm-api-production.up.railway.app

Endpoints: GET /health/live, GET /health/ready, GET /metrics, POST /shows, POST /shows/:showId/reserve, POST /reservations/:reservationId/cancel, GET /shows/:showId.

## Stack
Node.js 22, TypeScript, Fastify, PostgreSQL, Drizzle schema definitions, explicit SQL transactions, Zod, JWT, Prometheus metrics, Vitest, k6, Docker and Railway. PostgreSQL is the sole correctness authority; API instances are stateless.

## Reservation algorithm
A reservation transaction establishes and locks idempotency state, locks the user's show inventory row, enforces the per-user limit, locks requested seats in sorted order, verifies availability, creates the reservation, confirms seats, updates the active count, stores the replay response, and commits. There is no correctness-critical read-then-write outside the transaction.

## Guarantees
- Exactly one winner for a contested seat; losers are clean 409 domain outcomes.
- Reconciliation invariant: available + held + confirmed = total seats. Version 1 has no expiring hold, so held is zero.
- Same idempotency key/body replays one reservation; same key with another body is 409.
- Per-user limit remains correct under concurrency.
- JWT identity is authoritative and cancellation is owner-only.
- Money is represented as integer paise.

## Local setup
Copy .env.example to .env, start PostgreSQL with Docker Compose, then run npm ci, npm run db:migrate, and npm run dev. Run npm run typecheck, npm test, and npm run build for the regression gate.

The six live HTTP attacks are available through npm run test:correctness. See PHASE8_TESTING.md for definitions and measured evidence.

## Docker
Build with: docker build -t paytm-seat-reservation .
Run migrations before a release with: node dist/db/migrate.js
Start with: node dist/server.js

## Railway
The production project contains a GitHub-connected paytm-api service and a private Postgres service with persistent storage. DATABASE_URL is supplied through Railway configuration and is never committed. Migrations run before deployment and /health/ready is the release health check.

## Verified testing evidence
- 500-user A12 race: 1 x 201, 499 x 409, 0 x 5xx.
- 1,000-request contention burst: 200 x 201, 800 x 409, 0 x 5xx.
- 100 same-key concurrent retries resolved to one reservation.
- Per-user limit and JWT ownership attacks passed.
- 32/32 application tests passed.
- k6 completed 18,263 requests with zero unexpected 5xx and p95 1.12 seconds on the local single-instance test. The 500-VU ceiling dropped scheduled iterations, which is documented as a capacity limitation rather than hidden.

See WRITEUP.md for design tradeoffs, consistency choices, observability, AI disclosure, and next steps.
