import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { pool } from '../../src/db/client.js';

const SECRET = 'phase-5-integration-secret';
let app: FastifyInstance;
beforeAll(async()=>{ app=buildApp({jwtSecret:SECRET,logger:false}); await app.ready(); });
beforeEach(async()=>{ await pool.query('TRUNCATE idempotency_keys, reservation_seats, seats, user_show_inventory, reservations, shows CASCADE'); });
afterAll(async()=>{ await app.close(); await pool.end(); });

async function createTestShow(seats:string[]) {
  const admin=app.jwt.sign({sub:'admin-1',role:'admin'});
  return (await app.inject({method:'POST',url:'/shows',headers:{authorization:`Bearer ${admin}`},payload:{name:'test-show',seats,price_paise:25000}})).json();
}

describe('reservation HTTP integration',()=>{
  it('creates a show and returns a confirmed reservation with JWT identity',async()=>{
    const show=await createTestShow(['A1','A2']);
    const user=app.jwt.sign({sub:'user-7',role:'user'});
    const reserved=await app.inject({method:'POST',url:`/shows/${show.id}/reserve`,headers:{authorization:`Bearer ${user}`},payload:{seats:['A1'],idempotency_key:'http-1'}});
    expect(reserved.statusCode).toBe(201);
    expect(reserved.json()).toMatchObject({show_id:show.id,user_id:'user-7',seats:['A1'],amount_paise:25000,status:'confirmed'});
  });

  it('maps a contested seat to HTTP 409 instead of 500',async()=>{
    const show=await createTestShow(['A12']);
    const responses=await Promise.all(Array.from({length:50},(_,i)=>{
      const token=app.jwt.sign({sub:`http-user-${i}`,role:'user'});
      return app.inject({method:'POST',url:`/shows/${show.id}/reserve`,headers:{authorization:`Bearer ${token}`},payload:{seats:['A12'],idempotency_key:`key-${i}`}});
    }));
    expect(responses.filter((r)=>r.statusCode===201)).toHaveLength(1);
    expect(responses.filter((r)=>r.statusCode===409)).toHaveLength(49);
    expect(responses.filter((r)=>r.statusCode>=500)).toHaveLength(0);
  },20000);

  it('replays the original 201 response for the same idempotency key and body',async()=>{
    const show=await createTestShow(['B1']);
    const token=app.jwt.sign({sub:'retry-user',role:'user'});
    const request={method:'POST' as const,url:`/shows/${show.id}/reserve`,headers:{authorization:`Bearer ${token}`},payload:{seats:['B1'],idempotency_key:'http-retry'}};
    const first=await app.inject(request);
    const retry=await app.inject(request);
    expect(first.statusCode).toBe(201); expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
  });

  it('returns 409 when the same idempotency key is reused with a different body',async()=>{
    const show=await createTestShow(['C1','C2']);
    const token=app.jwt.sign({sub:'conflict-user',role:'user'});
    await app.inject({method:'POST',url:`/shows/${show.id}/reserve`,headers:{authorization:`Bearer ${token}`},payload:{seats:['C1'],idempotency_key:'http-conflict'}});
    const conflict=await app.inject({method:'POST',url:`/shows/${show.id}/reserve`,headers:{authorization:`Bearer ${token}`},payload:{seats:['C2'],idempotency_key:'http-conflict'}});
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });
});
