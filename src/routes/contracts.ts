import type { FastifyInstance } from 'fastify';
import { authenticate, requireAdmin } from '../auth/authenticate.js';
import { createShowBodySchema, reservationIdParamsSchema, reserveBodySchema, showIdParamsSchema } from '../contracts/schemas.js';
import { DomainError } from '../errors/domain-error.js';
import { reserveSeats } from '../services/reservation-service.js';
import { createShow, getShowState } from '../services/show-service.js';

function validate<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { flatten: () => unknown } } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DomainError('VALIDATION_ERROR', 400, 'Request validation failed', result.error.flatten());
  }
  return result.data;
}

export async function contractRoutes(app: FastifyInstance) {
  app.post('/shows', { preHandler: requireAdmin }, async (request, reply) => {
    const body = validate(createShowBodySchema, request.body);
    const show = await createShow({
      name: body.name,
      seats: body.seats,
      pricePaise: body.price_paise,
      perUserLimit: body.per_user_limit,
    });
    return reply.status(201).send(show);
  });

  app.post('/shows/:showId/reserve', { preHandler: authenticate }, async (request, reply) => {
    const params = validate(showIdParamsSchema, request.params);
    const body = validate(reserveBodySchema, request.body);
    const reservation = await reserveSeats({
      showId: params.showId,
      userId: request.user.sub,
      seats: body.seats,
    });
    return reply.status(201).send(reservation);
  });

  app.post('/reservations/:reservationId/cancel', { preHandler: authenticate }, async (request) => {
    const params = validate(reservationIdParamsSchema, request.params);
    return { contract: 'cancel', actor_user_id: request.user.sub, reservation_id: params.reservationId };
  });

  app.get('/shows/:showId', async (request) => {
    const params = validate(showIdParamsSchema, request.params);
    return getShowState(params.showId);
  });
}
