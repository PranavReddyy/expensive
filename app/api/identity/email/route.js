import { reserveEmailBudget } from '../../../../lib/identity/email-budget.mjs';
import { brandedActionLink, accountEmail } from '../../../../lib/identity/account-email.mjs';
import { identityAdmin, verifiedIdentity, corsHeaders, failure } from '../../../../lib/identity/admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  let headers;
  let stage = 'configuration';
  let refund;
  try {
    headers = corsHeaders(request);
    if (!process.env.RESEND_API_KEY) throw new Error('Resend is not configured');
    const text = await request.text();
    if (text.length > 1024) throw Object.assign(new Error('Request too large.'), { status: 413 });
    let body;
    try { body = JSON.parse(text); } catch { throw Object.assign(new Error('Invalid request.'), { status: 400 }); }
    const { kind } = body || {};
    if (!['verify', 'reset'].includes(kind)) throw Object.assign(new Error('Invalid request.'), { status: 400 });
    const { auth, db } = identityAdmin();
    const email = kind === 'verify' ? (await verifiedIdentity(request, false)).user.email : String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw Object.assign(new Error('Enter a valid email.'), { status: 400 });
    stage = 'email-budget';
    const dailyLimit = Math.max(1, Number(process.env.AUTH_EMAIL_DAILY_LIMIT) || 90);
    refund = await reserveEmailBudget(db, kind, email, dailyLimit);
    if (!refund) {
      if (kind === 'reset') return Response.json({ sent: true }, { headers });
      throw Object.assign(new Error('Please wait before requesting another email.'), { status: 429 });
    }
    const settings = { url: process.env.NEXT_PUBLIC_IDENTITY_URL || 'https://expensive.itsbypranav.com' };
    stage = 'firebase-link';
    let link;
    try { link = kind === 'verify' ? await auth.generateEmailVerificationLink(email, settings) : await auth.generatePasswordResetLink(email, settings); }
    catch (error) { if (kind === 'reset' && error.code === 'auth/user-not-found') return Response.json({ sent: true }, { headers }); throw error; }
    link = brandedActionLink(link, kind, settings.url);
    const message = accountEmail(kind, link);
    stage = 'resend';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM || 'Expensive <expensive@itsbypranav.com>', to: [email], ...message }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      // Log only provider error codes, never addresses, links, keys, or tokens.
      console.error('identity.email.rejected', { status: response.status, code: String(details.name || 'unknown').slice(0, 80) });
      await refund(); refund = null;
      throw new Error('Email delivery failed');
    }
    refund = null;
    return Response.json({ sent: true }, { headers });
  } catch (error) {
    // A transport timeout may have been accepted by Resend: retain that allowance.
    if (refund && stage !== 'resend') await refund().catch(() => {});
    if (!error.status || error.status >= 500) console.error('identity.email.failed', { stage, code: String(error.code || error.name || 'unknown').slice(0, 80) });
    return failure(error, headers);
  }
}
export async function OPTIONS(request) {
  try { return new Response(null, { status: 204, headers: corsHeaders(request) }); }
  catch (error) { return failure(error); }
}
