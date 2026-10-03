import { randomUUID } from 'node:crypto';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required');

const encoder = new TextEncoder();
const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
async function signToken(sub, role='user') {
  const header=b64url({alg:'HS256',typ:'JWT'}); const payload=b64url({sub,role,iat:Math.floor(Date.now()/1000)});
  const key=await crypto.subtle.importKey('raw',encoder.encode(jwtSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(sig).toString('base64url')}`;
}
async function request(method,path,{token,body}={}) {
  const started=performance.now();
  const response=await fetch(baseUrl+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  let json; try{json=await response.json();}catch{json=null;}
  return {status:response.status,body:json,ms:performance.now()-started};
}
async function createShow(name,seats,limit=4) {
  const token=await signToken('attack-admin','admin');
  const r=await request('POST','/shows',{token,body:{name,seats,price_paise:25000,per_user_limit:limit}});
  if(r.status!==201) throw new Error(`create show failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
const assert=(condition,message)=>{if(!condition) throw new Error(message);};
const statusCounts=(results)=>Object.fromEntries([...new Set(results.map(x=>x.status))].sort().map(s=>[s,results.filter(x=>x.status===s).length]));
const no5xx=(results)=>results.filter(x=>x.status>=500).length===0;
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;};

const report={started_at:new Date().toISOString(),base_url:baseUrl,attacks:[]};
async function attack(name,fn){
  const started=performance.now();
  try{const details=await fn();report.attacks.push({name,pass:true,duration_ms:+(performance.now()-started).toFixed(2),...details});console.log(`PASS  ${name}`);}
  catch(error){report.attacks.push({name,pass:false,duration_ms:+(performance.now()-started).toFixed(2),error:error.message});console.error(`FAIL  ${name}: ${error.message}`);}
}

await attack('1. hot seat: 500 users, exactly one winner',async()=>{
  const show=await createShow('attack-hot-'+randomUUID(),['A12']);
  const results=await Promise.all(Array.from({length:500},async(_,i)=>request('POST',`/shows/${show.id}/reserve`,{token:await signToken(`hot-${i}`),body:{seats:['A12'],idempotency_key:`hot-${i}`}})));
  const counts=statusCounts(results); assert(counts[201]===1,`expected 1 winner, got ${counts[201]??0}`); assert(counts[409]===499,`expected 499 conflicts, got ${counts[409]??0}`); assert(no5xx(results),'unexpected 5xx');
  const state=await request('GET',`/shows/${show.id}`); assert(state.body.counts.confirmed===1,'seat not confirmed exactly once');
  return {outcomes:counts,p95_ms:+percentile(results.map(x=>x.ms),.95).toFixed(2),p99_ms:+percentile(results.map(x=>x.ms),.99).toFixed(2)};
});

await attack('2. burst returns zero unexpected 5xx',async()=>{
  const seats=Array.from({length:200},(_,i)=>`B${i+1}`); const show=await createShow('attack-burst-'+randomUUID(),seats,4);
  const results=await Promise.all(Array.from({length:1000},async(_,i)=>request('POST',`/shows/${show.id}/reserve`,{token:await signToken(`burst-${i}`),body:{seats:[seats[i%seats.length]],idempotency_key:`burst-${i}`}})));
  assert(no5xx(results),'burst produced 5xx responses'); return {requests:results.length,outcomes:statusCounts(results),p95_ms:+percentile(results.map(x=>x.ms),.95).toFixed(2),p99_ms:+percentile(results.map(x=>x.ms),.99).toFixed(2)};
});

await attack('3. reconciliation invariant',async()=>{
  const seats=Array.from({length:20},(_,i)=>`C${i+1}`); const show=await createShow('attack-reconcile-'+randomUUID(),seats);
  const results=await Promise.all(Array.from({length:80},async(_,i)=>request('POST',`/shows/${show.id}/reserve`,{token:await signToken(`rec-${i}`),body:{seats:[seats[i%20]],idempotency_key:`rec-${i}`}})));
  assert(no5xx(results),'reconciliation setup produced 5xx'); const state=await request('GET',`/shows/${show.id}`); const c=state.body.counts;
  assert(c.available+c.held+c.confirmed===c.total,`invariant failed: ${JSON.stringify(c)}`); return {counts:c,outcomes:statusCounts(results)};
});

await attack('4. idempotency replay and conflicting reuse',async()=>{
  const show=await createShow('attack-idem-'+randomUUID(),['D1','D2']); const token=await signToken('idem-user');
  const same=await Promise.all(Array.from({length:100},()=>request('POST',`/shows/${show.id}/reserve`,{token,body:{seats:['D1'],idempotency_key:'same-key'}})));
  assert(same.every(x=>x.status===201),'same-key retries were not all 201'); const ids=new Set(same.map(x=>x.body.reservation_id)); assert(ids.size===1,`created ${ids.size} reservations`);
  const conflict=await request('POST',`/shows/${show.id}/reserve`,{token,body:{seats:['D2'],idempotency_key:'same-key'}});
  assert(conflict.status===409,'different body did not return 409'); assert(conflict.body?.error?.code==='IDEMPOTENCY_KEY_CONFLICT','wrong conflict code');
  return {concurrent_retries:100,unique_reservations:ids.size,conflict_status:conflict.status};
});

await attack('5. per-user limit under concurrency',async()=>{
  const seats=Array.from({length:10},(_,i)=>`E${i+1}`); const show=await createShow('attack-limit-'+randomUUID(),seats,4); const token=await signToken('limit-user');
  const results=await Promise.all(seats.map((seat,i)=>request('POST',`/shows/${show.id}/reserve`,{token,body:{seats:[seat],idempotency_key:`limit-${i}`}})));
  const counts=statusCounts(results); assert(counts[201]===4,`expected 4 successes, got ${counts[201]??0}`); assert(counts[409]===6,`expected 6 declines, got ${counts[409]??0}`); assert(no5xx(results),'unexpected 5xx');
  return {outcomes:counts};
});

await attack('6. JWT identity and owner-only cancellation',async()=>{
  const show=await createShow('attack-auth-'+randomUUID(),['F1']); const owner=await signToken('real-owner'); const attacker=await signToken('attacker');
  const reserved=await request('POST',`/shows/${show.id}/reserve`,{token:owner,body:{seats:['F1'],idempotency_key:'auth-1',user_id:'attacker'}});
  assert(reserved.status===400,'strict schema should reject body identity spoof field');
  const good=await request('POST',`/shows/${show.id}/reserve`,{token:owner,body:{seats:['F1'],idempotency_key:'auth-2'}});
  assert(good.status===201 && good.body.user_id==='real-owner','reservation identity did not come from JWT');
  const denied=await request('POST',`/reservations/${good.body.reservation_id}/cancel`,{token:attacker}); assert(denied.status===403,'non-owner cancellation was not forbidden');
  const cancelled=await request('POST',`/reservations/${good.body.reservation_id}/cancel`,{token:owner}); assert(cancelled.status===200,'owner cancellation failed');
  return {spoof_body_status:reserved.status,non_owner_cancel_status:denied.status,owner_cancel_status:cancelled.status};
});

report.finished_at=new Date().toISOString(); report.pass=report.attacks.every(x=>x.pass);
console.log('\n'+JSON.stringify(report,null,2));
if(!report.pass) process.exitCode=1;
