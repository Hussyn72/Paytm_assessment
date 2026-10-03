const baseUrl=process.env.BASE_URL??'http://127.0.0.1:3000';
const secret=process.env.JWT_SECRET;if(!secret)throw new Error('JWT_SECRET is required');
const encoder=new TextEncoder();
async function token(sub,role='user'){
 const enc=(v)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const h=enc({alg:'HS256',typ:'JWT'}),p=enc({sub,role,iat:Math.floor(Date.now()/1000)});
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,encoder.encode(`${h}.${p}`))).toString('base64url');
 return `${h}.${p}.${sig}`;
}
const admin=await token('k6-admin','admin');
const seats=Array.from({length:200},(_,i)=>`B${i+1}`);
const response=await fetch(baseUrl+'/shows',{method:'POST',headers:{authorization:`Bearer ${admin}`,'content-type':'application/json'},body:JSON.stringify({name:'k6-burst-'+Date.now(),seats,price_paise:25000,per_user_limit:4})});
if(response.status!==201)throw new Error(`show creation failed: ${response.status} ${await response.text()}`);
const show=await response.json();
console.log(JSON.stringify({show_id:show.id,token:await token('k6-load-user'),seat_count:seats.length}));
