import { createClient } from '@supabase/supabase-js';
import { verifiedIdentity, failure } from '../../../../lib/identity/admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request) {
  try {
    const started = performance.now();
    const { db, user, claims } = await verifiedIdentity(request);
    const authenticated = performance.now();
    const identity = await db.collection('identities').doc(user.uid).get();
    const identified = performance.now();
    if (!identity.exists || claims.role !== 'authenticated') throw Object.assign(new Error('Finish setting up your username, then retry.'), { status: 403 });
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('Missing server configuration');
    const dbClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: id, error } = await dbClient.rpc('enroll_firebase_user', { p_uid: user.uid, p_email: user.email, p_project: process.env.FIREBASE_PROJECT_ID });
    if (error) throw error;
    return Response.json({ id, email: user.email, username: identity.data().username, email_confirmed_at: new Date().toISOString() }, { headers: {
      'Cache-Control': 'no-store',
      'Server-Timing': `auth;dur=${(authenticated-started).toFixed(1)}, identity;dur=${(identified-authenticated).toFixed(1)}, database;dur=${(performance.now()-identified).toFixed(1)}`,
    } });
  } catch (error) { return failure(error); }
}
