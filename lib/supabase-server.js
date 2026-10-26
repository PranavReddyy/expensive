import { createClient } from '@supabase/supabase-js';
export function serverClient(key = process.env.SUPABASE_SERVICE_ROLE_KEY) {
  if (!key) throw new Error('Server configuration is missing.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function verifiedSession(request) {
  const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if(!token)throw Object.assign(new Error('Sign in again.'),{status:401});
  const db=serverClient(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const {data,error}=await db.auth.getUser(token);
  if(error || !data.user?.email_confirmed_at)throw Object.assign(new Error('Sign in again.'),{status:401});
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  if(claims.iss!==process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,'')+'/auth/v1' || claims.sub!==data.user.id || claims.aud!=='authenticated')throw Object.assign(new Error('Sign in again.'),{status:401});
  return {user:data.user,token,claims};
}
export function sameOrigin(request) {
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin)throw Object.assign(new Error('Origin not allowed.'),{status:403});
}
export function failure(error) {
  const status=error.status || 503;
  return Response.json({error:status<500?error.message:'Account service unavailable. Please retry.'},{status,headers:{'Cache-Control':'no-store'}});
}
