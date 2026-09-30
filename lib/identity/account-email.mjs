const modes = { verify: 'verifyEmail', reset: 'resetPassword' };

// Firebase issues the single-use code; only our own domain is sent to the user.
// A continue URL alone does NOT change Firebase's default action-handler host.
export function brandedActionLink(generatedLink, kind, identityURL) {
  const mode = modes[kind];
  const source = new URL(generatedLink);
  const code = source.searchParams.get('oobCode');
  if (!mode || source.searchParams.get('mode') !== mode || !code) throw new Error('Invalid generated email action');
  const base = new URL(identityURL);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(local && base.protocol === 'http:')) || base.username || base.password) throw new Error('Invalid identity URL');
  const link = new URL('/auth/action', base.origin);
  // Fragments are not sent to the web server or in HTTP referrers.
  link.hash = new URLSearchParams({ mode, oobCode: code }).toString();
  return link.href;
}

export function readEmailAction(url) {
  const parsed = new URL(url);
  const params = parsed.hash ? new URLSearchParams(parsed.hash.slice(1)) : parsed.searchParams;
  return { mode: params.get('mode'), code: params.get('oobCode') };
}

const escapeHTML = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function accountEmail(kind, link) {
  if (!modes[kind]) throw new Error('Invalid email kind');
  const title = kind === 'verify' ? 'Verify your email' : 'Reset your password';
  const description = kind === 'verify'
    ? 'One last step. Confirm your email to finish setting up your shared account.'
    : 'Choose a new password for your shared account. It will work across all our apps.';
  const after = kind === 'verify' ? 'Once verified, return to the app to continue.' : 'After resetting, return to the app and sign in with your new password.';
  const safeLink = escapeHTML(link);
  return {
    subject: `${title} · Expens***`,
    text: `EXPENS***\n\n${title}\n\n${description}\n\n${link}\n\n${after}\n\nIf you didn't request this, you can safely ignore this email. Don't share this link.`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f6f6f6;color:#111;font-family:'Courier New',Courier,monospace;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${description}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f6f6;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="480" cellspacing="0" cellpadding="0" style="width:100%;max-width:480px;background:#fff;border:1px solid #e5e5e5;"><tr><td style="padding:32px;">
<p style="margin:0 0 32px;font-size:16px;font-weight:bold;letter-spacing:1px;">EXPENS***</p>
<h1 style="margin:0 0 16px;font-size:22px;font-weight:normal;line-height:1.4;">${title}</h1>
<p style="margin:0 0 28px;font-size:13px;line-height:1.8;color:#555;">${description}</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#111111" style="background:#111;"><a href="${safeLink}" style="display:inline-block;padding:16px 22px;border:1px solid #111;color:#fff;font-size:13px;text-decoration:none;">${title} &rarr;</a></td></tr></table>
<p style="margin:24px 0;font-size:12px;line-height:1.8;color:#555;">${after}</p>
<hr style="border:0;border-top:1px solid #e5e5e5;margin:28px 0;">
<p style="margin:0 0 12px;font-size:11px;line-height:1.8;color:#777;">Button not working? Copy this link into your browser:</p>
<p style="margin:0 0 24px;font-size:11px;line-height:1.8;word-break:break-all;overflow-wrap:anywhere;"><a href="${safeLink}" style="color:#555;">${safeLink}</a></p>
<p style="margin:0;font-size:11px;line-height:1.8;color:#777;">If you didn’t request this, you can safely ignore this email. Don’t share this link.</p>
</td></tr></table></td></tr></table></body></html>`,
  };
}
