export const dynamic='force-dynamic';
function retired(){return Response.json({error:'Update Expensive to use Supabase sign-in.'},{status:410,headers:{'Cache-Control':'no-store'}});}
export const GET=retired;
export const POST=retired;
