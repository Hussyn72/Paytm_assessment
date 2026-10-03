import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { pool } from '../../src/db/client.js';
import { resetMetricsForTests } from '../../src/observability/metrics.js';

let app: FastifyInstance;
beforeAll(async()=>{app=buildApp({jwtSecret:'observability-secret',logger:false});await app.ready();});
beforeEach(async()=>{
  await pool.query('TRUNCATE idempotency_keys, reservation_seats, seats, user_show_inventory, reservations, shows CASCADE');
  resetMetricsForTests();
});
afterAll(async()=>{await app.close();await pool.end();});

async function createShow(){
  const admin=app.jwt.sign({sub:'admin',role:'admin'});
  return (await app.inject({method:'POST',url:'/shows',headers:{authorization:`Bearer ${admin}`},payload:{name:'metrics',seats:['A1'],price_paise:1000}})).json();
}

describe('operational observability',()=>{
  it('reports liveness and database-backed readiness',async()=>{
    const live=await app.inject({method:'GET',url:'/health/live'});
    const ready=await app.inject({method:'GET',url:'/health/ready'});
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({status:'ok'});
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({status:'ready',database:'up'});
  });

  it('returns 503 when the database readiness check fails', async () => {
    const unhealthy = buildApp({
      jwtSecret: 'unhealthy-secret',
      logger: false,
      readinessCheck: async () => { throw new Error('database unavailable'); },
    });
    await unhealthy.ready();
    const response = await unhealthy.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', database: 'down' });
    await unhealthy.close();
  });
  it('exposes Prometheus HTTP and reservation outcome metrics using route templates',async()=>{
    const show=await createShow();
    const firstToken=app.jwt.sign({sub:'u1',role:'user'});
    const secondToken=app.jwt.sign({sub:'u2',role:'user'});
    await app.inject({method:'POST',url:`/shows/${show.id}/reserve`,headers:{authorization:`Bearer ${firstToken}`},payload:{seats:['A1'],idempotency_key:'m1'}});
    const conflict=await app.inject({method:'POST',url:`/shows/${show.id}/reserve`,headers:{authorization:`Bearer ${secondToken}`},payload:{seats:['A1'],idempotency_key:'m2'}});
    expect(conflict.statusCode).toBe(409);

    const metrics=await app.inject({method:'GET',url:'/metrics'});
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain('seat_reservation_http_requests_total');
    expect(metrics.body).toContain('route="/shows/:showId/reserve"');
    expect(metrics.body).toContain('status_code="201"');
    expect(metrics.body).toContain('status_code="409"');
    expect(metrics.body).toContain('seat_reservation_reservation_outcomes_total{outcome="confirmed"} 1');
    expect(metrics.body).toContain('seat_reservation_reservation_outcomes_total{outcome="SEAT_TAKEN"} 1');
    expect(metrics.body).not.toContain(show.id);
  });

  it('tracks cancellation success and authorization declines',async()=>{
    const show=await createShow();
    const owner=app.jwt.sign({sub:'owner',role:'user'});
    const reservation=(await app.inject({method:'POST',url:`/shows/${show.id}/reserve`,headers:{authorization:`Bearer ${owner}`},payload:{seats:['A1'],idempotency_key:'m3'}})).json();
    const attacker=app.jwt.sign({sub:'attacker',role:'user'});
    await app.inject({method:'POST',url:`/reservations/${reservation.reservation_id}/cancel`,headers:{authorization:`Bearer ${attacker}`}});
    await app.inject({method:'POST',url:`/reservations/${reservation.reservation_id}/cancel`,headers:{authorization:`Bearer ${owner}`}});
    const metrics=(await app.inject({method:'GET',url:'/metrics'})).body;
    expect(metrics).toContain('seat_reservation_cancellation_outcomes_total{outcome="FORBIDDEN"} 1');
    expect(metrics).toContain('seat_reservation_cancellation_outcomes_total{outcome="cancelled"} 1');
  });
});
