import { Counter, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
  prefix: 'seat_reservation_',
});

export const httpRequestsTotal = new Counter({
  name: 'seat_reservation_http_requests_total',
  help: 'Total HTTP requests completed by the API',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'seat_reservation_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const reservationOutcomesTotal = new Counter({
  name: 'seat_reservation_reservation_outcomes_total',
  help: 'Reservation attempts by domain outcome',
  labelNames: ['outcome'] as const,
  registers: [metricsRegistry],
});

export const cancellationOutcomesTotal = new Counter({
  name: 'seat_reservation_cancellation_outcomes_total',
  help: 'Cancellation attempts by domain outcome',
  labelNames: ['outcome'] as const,
  registers: [metricsRegistry],
});

export function resetMetricsForTests() {
  metricsRegistry.resetMetrics();
}
