import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { DomainError } from './errors/domain-error.js';
import { cancellationOutcomesTotal, reservationOutcomesTotal } from './observability/metrics.js';
import { observabilityPlugin, type ReadinessCheck } from './observability/plugin.js';
import { contractRoutes } from './routes/contracts.js';

export interface AppOptions {
  jwtSecret?: string;
  logger?: boolean;
  readinessCheck?: ReadinessCheck;
}

function outcomeFor(error: unknown) {
  return error instanceof DomainError ? error.code : 'INTERNAL_ERROR';
}

export function buildApp(options: AppOptions = {}) {
  const jwtSecret = options.jwtSecret ?? process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is required');

  const app = Fastify({ logger: options.logger ?? true });
  app.register(jwt, { secret: jwtSecret });

  app.setErrorHandler((error, request, reply) => {
    if (request.routeOptions.url === '/shows/:showId/reserve') reservationOutcomesTotal.inc({ outcome: outcomeFor(error) });
    else if (request.routeOptions.url === '/reservations/:reservationId/cancel') cancellationOutcomesTotal.inc({ outcome: outcomeFor(error) });

    if (error instanceof DomainError) {
      request.log.warn({ request_id: request.id, error_code: error.code, status_code: error.statusCode }, 'domain request declined');
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details }, request_id: request.id,
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' }, request_id: request.id });
    }
    request.log.error({ err: error, request_id: request.id }, 'Unhandled request error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, request_id: request.id });
  });

  app.get('/', async () => ({ service: 'paytm-seat-reservation', status: 'ok' }));
  app.get('/health/live', async () => ({ status: 'ok' }));
  observabilityPlugin(app, options.readinessCheck);
  app.register(contractRoutes);
  return app;
}
