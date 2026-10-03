import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { pool } from '../../src/db/client.js';

let app: FastifyInstance;
beforeAll(async()=>{app=buildApp({jwtSecret:'phase-6-secret',logger:false});await app.ready();});
beforeEach(async()=>{await pool.query('TRUNCATE idempotency_keys, reservation_seats, seats, user_show_inventory, reservations, shows CASCADE');});
afterAll(async()=>{await app.close();await pool.end();});

async function setupReservation(){
  const admin=app.jwt.sign({sub:'admin',role:'admin'});
  const show=(await app.inject({method:'POST',url:'/shows',headers:{authorization:`Bearer ${admin}`},payload:{name:'cancel-http',seats:['A1'],price_paise:5000}})).json();
  const owner=app.jwt.sign({sub:'owner',role:'user'});
  const reservation=(await app.inject({method:'POST',url:`/shows/${show.id}/reserve`,headers:{authorization:`Bearer ${owner}`},payload:{seats:['A1'],idempotency_key:'reserve'}})).json();
  return {show,reservation,owner};
}

describe('cancellation HTTP API',()=>{
  it('allows only the JWT owner to cancel',async()=>{
    const {reservation}=await setupReservation();
    const attacker=app.jwt.sign({sub:'attacker',role:'user'});
    const denied=await app.inject({method:'POST',url:`/reservations/${reservation.reservation_id}/cancel`,headers:{authorization:`Bearer ${attacker}`}});
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN');
  });

  it('returns cancelled state and exposes the released seat through GET show',async()=>{
    const {show,reservation,owner}=await setupReservation();
    const cancelled=await app.inject({method:'POST',url:`/reservations/${reservation.reservation_id}/cancel`,headers:{authorization:`Bearer ${owner}`}});
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({reservation_id:reservation.reservation_id,user_id:'owner',status:'cancelled',seats:['A1']});
    const state=await app.inject({method:'GET',url:`/shows/${show.id}`});
    expect(state.statusCode).toBe(200);
    expect(state.json().counts).toEqual({total:1,available:1,held:0,confirmed:0});
  });

  it('returns 404 for a missing reservation',async()=>{
    const token=app.jwt.sign({sub:'owner',role:'user'});
    const response=await app.inject({method:'POST',url:'/reservations/11111111-1111-4111-8111-111111111111/cancel',headers:{authorization:`Bearer ${token}`}});
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RESERVATION_NOT_FOUND');
  });
});
