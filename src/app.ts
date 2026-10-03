import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { DomainError } from './errors/domain-error.js';
import { contractRoutes } from './routes/contracts.js';

export interface AppOptions {
  jwtSecret?: string;
  logger?: boolean;
}

export function buildApp(options: AppOptions = {}) {
  const jwtSecret = options.jwtSecret ?? process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required');
  }

  const app = Fastify({ logger: options.logger ?? true });

  app.register(jwt, { secret: jwtSecret });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        request_id: request.id,
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
        request_id: request.id,
      });
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      request_id: request.id,
    });
  });

  app.get('/', async () => ({
    service: 'paytm-seat-reservation',
    status: 'ok',
  }));

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.register(contractRoutes);

  return app;
}
