import {serverClient,verifiedSession,sameOrigin,failure} from '../../../../lib/supabase-server';
export const runtime='nodejs';
export async function POST(request){
 try {
  sameOrigin(request);
  const {user,claims}=await verifiedSession(request);
  const passwordTime=Math.max(0,...(claims.amr || []).filter(item=>item.method==='password').map(item=>Number(item.timestamp)||0));
  const age=Date.now()-passwordTime*1000;
  if(!Number.isFinite(age)||age<0||age>300000)throw Object.assign(new Error('Sign out and sign in again, then delete within five minutes.'),{status:403});
  const body=await request.json();
  if(body.confirmation!=='DELETE EXPENSIVE DATA')throw Object.assign(new Error('Type DELETE EXPENSIVE DATA to confirm.'),{status:400});
  const {error}=await serverClient().rpc('delete_expensive_data',{p_owner:user.id});
  if(error)throw error;
  return Response.json({deleted:true},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return failure(error);}
}
