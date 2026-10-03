import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { createShow, getShowState } from '../../src/services/show-service.js';
import { reserveSeats } from '../../src/services/reservation-service.js';
import { DomainError } from '../../src/errors/domain-error.js';

beforeAll(async () => { await pool.query('SELECT 1'); });
beforeEach(async () => { await pool.query('TRUNCATE idempotency_keys, reservation_seats, seats, user_show_inventory, reservations, shows CASCADE'); });
afterAll(async () => { await pool.end(); });

describe('reservation engine concurrency', () => {
  it('allows exactly one winner when 500 users contend for the same seat', async () => {
    const show = await createShow({ name: 'hot-seat', seats: ['A12'], pricePaise: 25000, perUserLimit: 4 });
    const outcomes = await Promise.allSettled(Array.from({ length: 500 }, (_, i) =>
      reserveSeats({ showId: show.id, userId: `user-${i}`, seats: ['A12'], idempotencyKey: `hot-${i}` })));
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const losers = outcomes.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(losers).toHaveLength(499);
    expect(losers.every((x) => x.reason instanceof DomainError && x.reason.code === 'SEAT_TAKEN')).toBe(true);
    expect((await getShowState(show.id)).counts).toEqual({ total: 1, available: 0, held: 0, confirmed: 1 });
  }, 30_000);

  it('enforces a four-seat user limit under parallel reservations', async () => {
    const seatNumbers = Array.from({ length: 10 }, (_, i) => `A${i + 1}`);
    const show = await createShow({ name: 'limit-race', seats: seatNumbers, pricePaise: 1000, perUserLimit: 4 });
    const outcomes = await Promise.allSettled(seatNumbers.map((seat) =>
      reserveSeats({ showId: show.id, userId: 'same-user', seats: [seat], idempotencyKey: `limit-${seat}` })));
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(4);
    const declines = outcomes.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(declines).toHaveLength(6);
    expect(declines.every((x) => x.reason.code === 'PER_USER_LIMIT_EXCEEDED')).toBe(true);
    const inventory = await pool.query<{ active_seat_count: number }>('SELECT active_seat_count FROM user_show_inventory WHERE show_id=$1 AND user_id=$2',[show.id,'same-user']);
    expect(inventory.rows[0]?.active_seat_count).toBe(4);
  }, 20_000);

  it('keeps a multi-seat reservation all-or-nothing', async () => {
    const show = await createShow({ name:'atomic-multi', seats:['A1','A2','A3'], pricePaise:5000, perUserLimit:4 });
    await reserveSeats({ showId:show.id,userId:'winner',seats:['A2'],idempotencyKey:'winner-1' });
    await expect(reserveSeats({ showId:show.id,userId:'loser',seats:['A1','A2'],idempotencyKey:'loser-1' })).rejects.toMatchObject({code:'SEAT_TAKEN'});
    const state=await getShowState(show.id);
    expect(state.seats.find((x)=>x.seat_number==='A1')?.status).toBe('available');
    expect(state.counts).toEqual({total:3,available:2,held:0,confirmed:1});
  });

  it('locks overlapping multi-seat requests in deterministic order', async () => {
    const show=await createShow({name:'lock-order',seats:['A1','A2','A3'],pricePaise:1000,perUserLimit:4});
    const outcomes=await Promise.allSettled([
      reserveSeats({showId:show.id,userId:'u1',seats:['A1','A2'],idempotencyKey:'u1-1'}),
      reserveSeats({showId:show.id,userId:'u2',seats:['A2','A1'],idempotencyKey:'u2-1'}),
    ]);
    expect(outcomes.filter((x)=>x.status==='fulfilled')).toHaveLength(1);
    expect((outcomes.find((x)=>x.status==='rejected') as PromiseRejectedResult).reason.code).toBe('SEAT_TAKEN');
  });

  it('calculates amount in integer paise and canonicalizes seat order', async () => {
    const show=await createShow({name:'money',seats:['B1','B2'],pricePaise:25000,perUserLimit:4});
    const r=await reserveSeats({showId:show.id,userId:'buyer',seats:['B2','B1'],idempotencyKey:'money-1'});
    expect(r.amount_paise).toBe(50000); expect(r.seats).toEqual(['B1','B2']);
  });
});
