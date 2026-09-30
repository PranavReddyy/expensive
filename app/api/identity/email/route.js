import { createHash } from 'node:crypto';
import { identityAdmin, verifiedIdentity, corsHeaders, failure } from '../../../../lib/identity/admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  let headers;
  try {
    headers = corsHeaders(request);
    if (!process.env.RESEND_API_KEY) throw new Error('Resend is not configured');
    const text = await request.text();
    if (text.length > 1024) throw Object.assign(new Error('Request too large.'), { status: 413 });
    let body;
    try { body = JSON.parse(text); } catch { throw Object.assign(new Error('Invalid request.'), { status: 400 }); }
    const { kind } = body;
    if (!['verify', 'reset'].includes(kind)) throw Object.assign(new Error('Invalid request.'), { status: 400 });
    const { auth, db } = identityAdmin();
    const email = kind === 'verify' ? (await verifiedIdentity(request, false)).user.email : String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw Object.assign(new Error('Enter a valid email.'), { status: 400 });
    // Shared per-address limits survive restarts and apply across all apps.
    const ref = db.collection('emailLimits').doc(createHash('sha256').update(kind + ':' + email).digest('hex'));
    const budget = db.collection('emailLimits').doc('daily-' + new Date().toISOString().slice(0, 10));
    const dailyLimit = Math.max(1, Number(process.env.AUTH_EMAIL_DAILY_LIMIT) || 90);
    const permitted = await db.runTransaction(async tx => {
      const [address, daily] = await Promise.all([tx.get(ref), tx.get(budget)]);
      const old = address.data();
      const now = Date.now();
      const start = old?.start > now - 3600000 ? old.start : now;
      const count = start === old?.start ? old.count : 0;
      if (old?.last > now - 60000 || count >= 5 || (daily.data()?.count || 0) >= dailyLimit) return false;
      tx.set(ref, { start, count: count + 1, last: now, expiresAt: new Date(now + 86400000) });
      tx.set(budget, { count: (daily.data()?.count || 0) + 1, expiresAt: new Date(now + 172800000) });
      return true;
    });
    if (!permitted) {
      if (kind === 'reset') return Response.json({ sent: true }, { headers });
      throw Object.assign(new Error('Please wait before requesting another email.'), { status: 429 });
    }
    const settings = { url: process.env.NEXT_PUBLIC_IDENTITY_URL || 'https://expensive.itsbypranav.com' };
    let link;
    try { link = kind === 'verify' ? await auth.generateEmailVerificationLink(email, settings) : await auth.generatePasswordResetLink(email, settings); }
    catch (error) { if (kind === 'reset' && error.code === 'auth/user-not-found') return Response.json({ sent: true }, { headers }); throw error; }
    const title = kind === 'verify' ? 'Verify your email' : 'Reset your password';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM || 'Expensive <expensive@itsbypranav.com>', to: [email], subject: title,
        text: `${title} for your shared account:\n\n${link}\n\nIf you did not request this, you can ignore this email.` }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Email delivery failed');
    return Response.json({ sent: true }, { headers });
  } catch (error) { return failure(error, headers); }
}
export async function OPTIONS(request) {
  try { return new Response(null, { status: 204, headers: corsHeaders(request) }); }
  catch (error) { return failure(error); }
}
