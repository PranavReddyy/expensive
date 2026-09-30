import { verifiedIdentity, corsHeaders, failure } from '../../../lib/identity/admin';
import { reserveUsername } from '../../../lib/identity/reserve-username.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request) {
  let headers;
  try {
    headers = corsHeaders(request);
    const { auth, db, user, claims } = await verifiedIdentity(request);
    const account = db.collection('identities').doc(user.uid);
    if (request.method === 'POST') {
      const text = await request.text();
      if (text.length > 1024) throw Object.assign(new Error('Request too large.'), { status: 413 });
      let body;
      try { body = JSON.parse(text); } catch { throw Object.assign(new Error('Invalid request.'), { status: 400 }); }
      await reserveUsername(db, user.uid, body?.username);
    }
    const identity = await account.get();
    if (!identity.exists) return Response.json({ needsUsername: true }, { headers });
    if (user.customClaims?.role !== 'authenticated') await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role: 'authenticated' });
    return Response.json({ username: identity.data().username, uid: user.uid, refreshToken: claims.role !== 'authenticated' }, { headers });
  } catch (error) { return failure(error, headers); }
}
export const GET = handle;
export const POST = handle;
export async function OPTIONS(request) {
  try { return new Response(null, { status: 204, headers: corsHeaders(request) }); }
  catch (error) { return failure(error); }
}
