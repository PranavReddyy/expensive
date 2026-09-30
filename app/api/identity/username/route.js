import { identityAdmin, corsHeaders, failure } from '../../../../lib/identity/admin';
import { normalizeUsername } from '../../../../lib/identity/username.mjs';
import { limitPublicAuth } from '../../../../lib/identity/public-auth.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  let headers;
  try {
    headers = corsHeaders(request);
    let username;
    try { username = normalizeUsername(new URL(request.url).searchParams.get('username')); }
    catch (error) { throw Object.assign(error, { status: 400 }); }
    const { db } = identityAdmin();
    await limitPublicAuth(db, request, 'availability', 60);
    const reservation = await db.collection('usernames').doc(username).get();
    return Response.json({ username, available: !reservation.exists }, { headers });
  } catch (error) { return failure(error, headers); }
}
export async function OPTIONS(request) {
  try { return new Response(null, { status: 204, headers: corsHeaders(request) }); }
  catch (error) { return failure(error); }
}
