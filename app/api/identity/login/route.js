import {createHash} from 'node:crypto';
import {serverClient,sameOrigin,failure} from '../../../../lib/supabase-server';
export const runtime='nodejs';
export async function POST(request) {
 try {
  sameOrigin(request);
  const text=await request.text();
  if(text.length>8192)throw Object.assign(new Error('Request too large.'),{status:413});
  const {identifier,password}=JSON.parse(text);
  const invalid=()=>Object.assign(new Error('Username, email, or password is incorrect.'),{status:401});
  if(typeof identifier!=='string'||typeof password!=='string'||!password||password.length>4096||identifier.length>254)throw invalid();
  const admin=serverClient();
  const address=process.env.VERCEL?request.headers.get('x-vercel-forwarded-for')||'unknown':'local';
  const key=createHash('sha256').update(address).digest('hex');
  const limited=await admin.rpc('limit_password_login',{p_key:key});
  if(limited.error)throw limited.error;
  if(!limited.data)throw Object.assign(new Error('Too many attempts. Try again in a minute.'),{status:429});
  let email=identifier.trim().toLowerCase();
  if(!email.includes('@')){
   const lookup=await admin.rpc('login_email',{p_username:email});
   if(lookup.error)throw lookup.error;
   // Always attempt password verification to avoid a fast username-existence oracle.
   email=lookup.data || 'nonexistent-login@invalid.example';
  }
  const client=serverClient(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const {data,error}=await client.auth.signInWithPassword({email,password});
  if(error||!data.session)throw invalid();
  return Response.json(data.session,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return failure(error);}
}
