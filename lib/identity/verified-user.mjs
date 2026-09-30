// Token signature/audience/issuer and revocation must already have been checked
// by Firebase Admin. Recheck the current account before any migration or claim.
export function requireVerifiedUser(claims, user, requireVerified = true) {
  if (claims.uid !== user.uid || (requireVerified && (!claims.email_verified || !user.emailVerified)) ||
      !user.email || user.email !== claims.email || user.disabled) {
    throw Object.assign(new Error('Verify your email, then refresh and continue.'), { status: 403 });
  }
}
