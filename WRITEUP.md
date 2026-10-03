# Design Write-up

## Correctness mechanism
PostgreSQL is the single correctness authority. Reservation decisions run inside one transaction with row locks. The transaction locks the idempotency key, then the user's show inventory row, then requested seats in sorted order. This prevents read-then-write races and makes competing requests serialize at the rows that represent the contested resource.

## Deadlock avoidance
All requested seats are sorted before locking, so concurrent multi-seat reservations acquire seat locks in deterministic order. The user/show inventory row is acquired before seat rows consistently.

## Idempotency
Idempotency is scoped by authenticated user, show, and key. The request body is hashed. A retry with the same key and hash replays the stored response; reusing the key for a different request is rejected with 409.

## Cancellation and holds
Version 1 uses explicit cancellation and no expiring holds. Confirmed seats point at their current reservation. Cancellation releases those seats and decrements the locked per-user inventory count. Reservation-seat membership remains historical so a cancelled seat can later appear in another reservation.

## Consistency choice
The API is stateless and PostgreSQL provides ACID transactions and row-level locking. Redis is intentionally not part of the correctness path. This favors strong consistency for inventory over availability during a database partition; an instance that cannot reach PostgreSQL should fail readiness rather than accept unsafe reservations.

## Observability
The service emits structured request logs with request IDs, liveness/readiness endpoints, and Prometheus metrics for HTTP latency and reservation/cancellation outcomes. Expected domain declines are 4xx responses and are separated from unexpected 5xx failures.

## Testing
The automated attack runner covers the six assessment attacks. A verified local run produced one winner and 499 clean 409 declines for a 500-user hot-seat race, zero 5xx in the 1,000-request contention burst, correct reconciliation, one reservation from a 100-request idempotency storm, exact per-user-limit enforcement, and JWT ownership protection. The k6 profile completed 18,263 requests with zero unexpected 5xx and p95 1.12 seconds; the local 500-VU ceiling also dropped scheduled iterations, so this is not presented as a production throughput claim.

## Production deployment
The API and a dedicated PostgreSQL service are deployed in one Railway project. The database is private to the project and has persistent storage. Schema migrations run before an API release, and Railway checks /health/ready before considering the service healthy. The public API domain is paytm-api-production.up.railway.app.

## AI usage disclosure
AI assistance was used for architecture review, implementation support, test generation, debugging, deployment automation, and documentation. Outputs were not accepted as evidence by themselves: correctness claims in this submission come from executable tests, database constraints, observed HTTP outcomes, and deployment health/log verification.

## Next steps
For a larger production system I would add short-lived holds with expiry workers, admission control/backpressure, production-sized load tests, dashboards and alerting, database connection-pool tuning, multi-region disaster recovery, secret rotation, and deployment SLOs. Horizontal API replicas are safe because reservation correctness remains in PostgreSQL.
