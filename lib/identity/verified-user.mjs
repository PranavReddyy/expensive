// Token signature/audience/issuer must already have been checked by Firebase
// Admin. Use its freshly fetched UserRecord for revocation and account checks.
export function requireVerifiedUser(claims, user, requireVerified = true) {
  // Same auth_time comparison used by Firebase Admin's revocation verifier.
  if (user.tokensValidAfterTime) {
    const validSince = new Date(user.tokensValidAfterTime).getTime();
    if (!Number.isFinite(claims.auth_time) || !Number.isFinite(validSince) || claims.auth_time * 1000 < validSince) {
      throw Object.assign(new Error('Please sign in again.'), { status: 401 });
    }
  }
  if (claims.uid !== user.uid || (requireVerified && (!claims.email_verified || !user.emailVerified)) ||
      !user.email || user.email !== claims.email || user.disabled) {
    throw Object.assign(new Error('Verify your email, then refresh and continue.'), { status: 403 });
  }
}
