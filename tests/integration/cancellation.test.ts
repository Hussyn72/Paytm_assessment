import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { cancelReservation } from '../../src/services/cancellation-service.js';
import { reserveSeats } from '../../src/services/reservation-service.js';
import { createShow, getShowState } from '../../src/services/show-service.js';

beforeEach(async () => {
  await pool.query('TRUNCATE idempotency_keys, reservation_seats, seats, user_show_inventory, reservations, shows CASCADE');
});
afterAll(async () => { await pool.end(); });

describe('transactional cancellation', () => {
  it('releases seats, decrements inventory, and preserves reservation history', async () => {
    const show=await createShow({name:'cancel',seats:['A1','A2'],pricePaise:1000,perUserLimit:4});
    const reserved=await reserveSeats({showId:show.id,userId:'owner',seats:['A1','A2'],idempotencyKey:'reserve-1'});
    const cancelled=await cancelReservation(reserved.reservation_id,'owner');
    expect(cancelled).toMatchObject({reservation_id:reserved.reservation_id,status:'cancelled',seats:['A1','A2']});
    expect((await getShowState(show.id)).counts).toEqual({total:2,available:2,held:0,confirmed:0});
    const inventory=await pool.query('SELECT active_seat_count FROM user_show_inventory WHERE show_id=$1 AND user_id=$2',[show.id,'owner']);
    expect(inventory.rows[0].active_seat_count).toBe(0);
    const history=await pool.query('SELECT count(*)::int AS count FROM reservation_seats WHERE reservation_id=$1',[reserved.reservation_id]);
    expect(history.rows[0].count).toBe(2);
  });

  it('rejects cancellation by a different authenticated user without changing state', async () => {
    const show=await createShow({name:'owner-only',seats:['A1'],pricePaise:1000,perUserLimit:4});
    const reserved=await reserveSeats({showId:show.id,userId:'owner',seats:['A1'],idempotencyKey:'reserve-2'});
    await expect(cancelReservation(reserved.reservation_id,'attacker')).rejects.toMatchObject({code:'FORBIDDEN',statusCode:403});
    expect((await getShowState(show.id)).counts).toEqual({total:1,available:0,held:0,confirmed:1});
  });

  it('treats repeated owner cancellation as an idempotent success', async () => {
    const show=await createShow({name:'repeat',seats:['A1'],pricePaise:1000,perUserLimit:4});
    const reserved=await reserveSeats({showId:show.id,userId:'owner',seats:['A1'],idempotencyKey:'reserve-3'});
    const first=await cancelReservation(reserved.reservation_id,'owner');
    const second=await cancelReservation(reserved.reservation_id,'owner');
    expect(second).toEqual(first);
    const inventory=await pool.query('SELECT active_seat_count FROM user_show_inventory WHERE show_id=$1 AND user_id=$2',[show.id,'owner']);
    expect(inventory.rows[0].active_seat_count).toBe(0);
  });

  it('serializes concurrent cancels so inventory is decremented exactly once', async () => {
    const show=await createShow({name:'cancel-race',seats:['A1','A2'],pricePaise:1000,perUserLimit:4});
    const reserved=await reserveSeats({showId:show.id,userId:'owner',seats:['A1','A2'],idempotencyKey:'reserve-4'});
    const results=await Promise.all([
      cancelReservation(reserved.reservation_id,'owner'),
      cancelReservation(reserved.reservation_id,'owner'),
    ]);
    expect(results[0]).toEqual(results[1]);
    const inventory=await pool.query('SELECT active_seat_count FROM user_show_inventory WHERE show_id=$1 AND user_id=$2',[show.id,'owner']);
    expect(inventory.rows[0].active_seat_count).toBe(0);
  });

  it('allows a cancelled seat to be safely rebooked and keeps both history rows', async () => {
    const show=await createShow({name:'rebook',seats:['A1'],pricePaise:1000,perUserLimit:4});
    const first=await reserveSeats({showId:show.id,userId:'u1',seats:['A1'],idempotencyKey:'first'});
    await cancelReservation(first.reservation_id,'u1');
    const second=await reserveSeats({showId:show.id,userId:'u2',seats:['A1'],idempotencyKey:'second'});
    expect(second.reservation_id).not.toBe(first.reservation_id);
    const seat=await pool.query('SELECT reservation_id,status FROM seats WHERE show_id=$1 AND seat_number=$2',[show.id,'A1']);
    expect(seat.rows[0]).toMatchObject({reservation_id:second.reservation_id,status:'confirmed'});
    const history=await pool.query('SELECT count(*)::int AS count FROM reservation_seats');
    expect(history.rows[0].count).toBe(2);
  });

  it('maintains reconciliation after reserve, cancel, and rebook', async () => {
    const show=await createShow({name:'reconcile',seats:['A1','A2','A3','A4'],pricePaise:1000,perUserLimit:4});
    const first=await reserveSeats({showId:show.id,userId:'u1',seats:['A1','A2'],idempotencyKey:'r1'});
    await reserveSeats({showId:show.id,userId:'u2',seats:['A3'],idempotencyKey:'r2'});
    await cancelReservation(first.reservation_id,'u1');
    await reserveSeats({showId:show.id,userId:'u3',seats:['A2'],idempotencyKey:'r3'});
    const counts=(await getShowState(show.id)).counts;
    expect(counts.available+counts.held+counts.confirmed).toBe(counts.total);
    expect(counts).toEqual({total:4,available:2,held:0,confirmed:2});
  });
});
