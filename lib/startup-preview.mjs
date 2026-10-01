// Display hints only, never credentials or authorization. Financial queries and
// controls remain blocked until the server verifies the current Firebase user.
const key = 'expensive.startup-preview.v1';
export function readPreview(storage, firebaseUser, now = Date.now()) {
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (!firebaseUser?.emailVerified || !saved || saved.uid !== firebaseUser.uid ||
        saved.user?.email !== firebaseUser.email || !saved.user?.id || !saved.user?.username ||
        !Number.isFinite(saved.at) || saved.at > now || now-saved.at > 3_600_000) return null;
    return saved.user;
  } catch { return null; }
}
export function savePreview(storage, firebaseUser, user, now = Date.now()) {
  try { storage.setItem(key,JSON.stringify({uid:firebaseUser.uid,user,at:now})); } catch {}
}
export function clearPreview(storage) { try { storage.removeItem(key); } catch {} }
