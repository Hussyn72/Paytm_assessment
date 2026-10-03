import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

const JWT_SECRET = 'test-secret-with-sufficient-entropy';
const SHOW_ID = '11111111-1111-4111-8111-111111111111';
const RESERVATION_ID = '22222222-2222-4222-8222-222222222222';

describe('Phase 3 API contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({ jwtSecret: JWT_SECRET, logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects reservation requests without a bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/shows/${SHOW_ID}/reserve`,
      payload: { seats: ['A12'], idempotency_key: 'attempt-1' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('derives reservation identity from JWT subject', async () => {
    const token = app.jwt.sign({ sub: 'user-123', role: 'user' });
    const response = await app.inject({
      method: 'POST',
      url: `/shows/${SHOW_ID}/reserve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { seats: ['A12'], idempotency_key: 'attempt-2' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().actor_user_id).toBe('user-123');
  });

  it('rejects spoofed user_id in the reservation body', async () => {
    const token = app.jwt.sign({ sub: 'real-user', role: 'user' });
    const response = await app.inject({
      method: 'POST',
      url: `/shows/${SHOW_ID}/reserve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { seats: ['A12'], idempotency_key: 'attempt-3', user_id: 'victim-user' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('requires admin role to create a show', async () => {
    const userToken = app.jwt.sign({ sub: 'user-123', role: 'user' });
    const denied = await app.inject({
      method: 'POST',
      url: '/shows',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name: 'friday-night', seats: ['A1'], price_paise: 25000 },
    });
    expect(denied.statusCode).toBe(403);

    const adminToken = app.jwt.sign({ sub: 'admin-1', role: 'admin' });
    const allowed = await app.inject({
      method: 'POST',
      url: '/shows',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'friday-night', seats: ['A1'], price_paise: 25000 },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().actor_user_id).toBe('admin-1');
  });

  it('rejects duplicate seat numbers in a request', async () => {
    const token = app.jwt.sign({ sub: 'user-123', role: 'user' });
    const response = await app.inject({
      method: 'POST',
      url: `/shows/${SHOW_ID}/reserve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { seats: ['A12', 'A12'], idempotency_key: 'attempt-4' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('derives cancellation actor from JWT subject', async () => {
    const token = app.jwt.sign({ sub: 'owner-9', role: 'user' });
    const response = await app.inject({
      method: 'POST',
      url: `/reservations/${RESERVATION_ID}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().actor_user_id).toBe('owner-9');
  });
});
