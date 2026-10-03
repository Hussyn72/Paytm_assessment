import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { pool } from '../../src/db/client.js';

const SECRET = 'phase-4-integration-secret';
let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp({ jwtSecret: SECRET, logger: false });
  await app.ready();
});
beforeEach(async () => {
  await pool.query('TRUNCATE idempotency_keys, reservation_seats, seats, user_show_inventory, reservations, shows CASCADE');
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('reservation HTTP integration', () => {
  it('creates a show and returns a confirmed reservation with JWT identity', async () => {
    const admin = app.jwt.sign({ sub: 'admin-1', role: 'admin' });
    const created = await app.inject({
      method: 'POST', url: '/shows', headers: { authorization: `Bearer ${admin}` },
      payload: { name: 'friday-night', seats: ['A1', 'A2'], price_paise: 25000 },
    });
    expect(created.statusCode).toBe(201);
    const show = created.json();

    const user = app.jwt.sign({ sub: 'user-7', role: 'user' });
    const reserved = await app.inject({
      method: 'POST', url: `/shows/${show.id}/reserve`, headers: { authorization: `Bearer ${user}` },
      payload: { seats: ['A1'], idempotency_key: 'phase4-placeholder' },
    });
    expect(reserved.statusCode).toBe(201);
    expect(reserved.json()).toMatchObject({
      show_id: show.id, user_id: 'user-7', seats: ['A1'], amount_paise: 25000, status: 'confirmed',
    });
  });

  it('maps a contested seat to HTTP 409 instead of 500', async () => {
    const admin = app.jwt.sign({ sub: 'admin-1', role: 'admin' });
    const created = await app.inject({
      method: 'POST', url: '/shows', headers: { authorization: `Bearer ${admin}` },
      payload: { name: 'hot-http', seats: ['A12'], price_paise: 25000 },
    });
    const show = created.json();

    const requests = Array.from({ length: 50 }, (_, i) => {
      const token = app.jwt.sign({ sub: `http-user-${i}`, role: 'user' });
      return app.inject({
        method: 'POST', url: `/shows/${show.id}/reserve`, headers: { authorization: `Bearer ${token}` },
        payload: { seats: ['A12'], idempotency_key: `key-${i}` },
      });
    });
    const responses = await Promise.all(requests);
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(49);
    expect(responses.filter((response) => response.statusCode >= 500)).toHaveLength(0);
    expect(responses.filter((response) => response.statusCode === 409).every((response) => response.json().error.code === 'SEAT_TAKEN')).toBe(true);
  }, 20_000);
});
