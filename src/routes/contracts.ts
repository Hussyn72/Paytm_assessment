import type { FastifyInstance } from 'fastify';
import { authenticate, requireAdmin } from '../auth/authenticate.js';
import { createShowBodySchema, reservationIdParamsSchema, reserveBodySchema, showIdParamsSchema } from '../contracts/schemas.js';
import { DomainError } from '../errors/domain-error.js';

function validate<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { flatten: () => unknown } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError('VALIDATION_ERROR', 400, 'Request validation failed', result.error.flatten());
  return result.data;
}

export async function contractRoutes(app: FastifyInstance) {
  app.post('/shows', { preHandler: requireAdmin }, async (request) => {
    const body = validate(createShowBodySchema, request.body);
    return { contract: 'create_show', actor_user_id: request.user.sub, input: body };
  });

  app.post('/shows/:showId/reserve', { preHandler: authenticate }, async (request) => {
    const params = validate(showIdParamsSchema, request.params);
    const body = validate(reserveBodySchema, request.body);
    return { contract: 'reserve', actor_user_id: request.user.sub, show_id: params.showId, input: body };
  });

  app.post('/reservations/:reservationId/cancel', { preHandler: authenticate }, async (request) => {
    const params = validate(reservationIdParamsSchema, request.params);
    return { contract: 'cancel', actor_user_id: request.user.sub, reservation_id: params.reservationId };
  });

  app.get('/shows/:showId', async (request) => {
    const params = validate(showIdParamsSchema, request.params);
    return { contract: 'show_state', show_id: params.showId };
  });
}
