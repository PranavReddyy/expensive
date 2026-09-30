import { identityAdmin, corsHeaders, failure } from '../../../../lib/identity/admin';
import { limitPublicAuth, passwordLogin } from '../../../../lib/identity/public-auth.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request) {
  let headers;
  try {
    headers = corsHeaders(request);
    const { auth, db } = identityAdmin();
    await limitPublicAuth(db, request, 'login', 15);
    const text = await request.text();
    if (text.length > 8192) throw Object.assign(new Error('Request too large.'), { status: 413 });
    let body;
    try { body = JSON.parse(text); } catch { throw Object.assign(new Error('Invalid request.'), { status: 400 }); }
    const result = await passwordLogin({ auth, db, apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      identifier: body?.identifier, password: body?.password });
    return Response.json(result, { headers });
  } catch (error) { return failure(error, headers); }
}
export async function OPTIONS(request) {
  try { return new Response(null, { status: 204, headers: corsHeaders(request) }); }
  catch (error) { return failure(error); }
}
