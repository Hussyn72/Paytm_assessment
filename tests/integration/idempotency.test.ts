import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { createShow } from '../../src/services/show-service.js';
import { reserveSeats } from '../../src/services/reservation-service.js';

beforeEach(async () => {
  await pool.query('TRUNCATE idempotency_keys, reservation_seats, seats, user_show_inventory, reservations, shows CASCADE');
});
afterAll(async () => { await pool.end(); });

describe('durable reservation idempotency', () => {
  it('returns the exact original response for a sequential retry', async () => {
    const show = await createShow({ name: 'retry', seats: ['A1'], pricePaise: 25000, perUserLimit: 4 });
    const input = { showId: show.id, userId: 'u1', seats: ['A1'], idempotencyKey: 'same-key' };
    const first = await reserveSeats(input);
    const retry = await reserveSeats(input);
    expect(retry).toEqual(first);
    expect((await pool.query('SELECT count(*)::int AS count FROM reservations')).rows[0].count).toBe(1);
  });

  it('creates exactly one reservation across 100 concurrent same-key retries', async () => {
    const show = await createShow({ name: 'retry-storm', seats: ['A12'], pricePaise: 25000, perUserLimit: 4 });
    const input = { showId: show.id, userId: 'u1', seats: ['A12'], idempotencyKey: 'storm-key' };
    const responses = await Promise.all(Array.from({ length: 100 }, () => reserveSeats(input)));
    expect(new Set(responses.map((r) => r.reservation_id)).size).toBe(1);
    for (const response of responses) expect(response).toEqual(responses[0]);
    expect((await pool.query('SELECT count(*)::int AS count FROM reservations')).rows[0].count).toBe(1);
    const idem = await pool.query('SELECT response_status, reservation_id FROM idempotency_keys WHERE user_id=$1 AND show_id=$2 AND key=$3',['u1',show.id,'storm-key']);
    expect(idem.rows).toHaveLength(1);
    expect(idem.rows[0].response_status).toBe(201);
  }, 20_000);

  it('returns 409 conflict when the same key is reused for a different seat set', async () => {
    const show = await createShow({ name: 'conflict', seats: ['A1','A2'], pricePaise: 25000, perUserLimit: 4 });
    await reserveSeats({ showId:show.id,userId:'u1',seats:['A1'],idempotencyKey:'reused-key' });
    await expect(reserveSeats({ showId:show.id,userId:'u1',seats:['A2'],idempotencyKey:'reused-key' }))
      .rejects.toMatchObject({ code:'IDEMPOTENCY_KEY_CONFLICT', statusCode:409 });
    expect((await pool.query('SELECT count(*)::int AS count FROM reservations')).rows[0].count).toBe(1);
  });

  it('canonicalizes seat order when hashing the request', async () => {
    const show = await createShow({ name:'order',seats:['A1','A2'],pricePaise:1000,perUserLimit:4 });
    const first=await reserveSeats({showId:show.id,userId:'u1',seats:['A2','A1'],idempotencyKey:'order-key'});
    const retry=await reserveSeats({showId:show.id,userId:'u1',seats:['A1','A2'],idempotencyKey:'order-key'});
    expect(retry).toEqual(first);
  });
});
