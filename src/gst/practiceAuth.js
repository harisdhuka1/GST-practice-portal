const SESSION_KEY = "gst-practice:session:v1";
export const DEMO_USERNAME = "sample.taxpayer";
export const DEMO_PASSWORD = "Practice@123";
export const SESSION_TTL = 30 * 60 * 1000;
export function createCaptcha(now = Date.now()) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint8Array(6);
  globalThis.crypto.getRandomValues(values);
  return {
    text: Array.from(values, (v) => alphabet[v % alphabet.length]).join(""),
    expiresAt: now + 5 * 60 * 1000,
  };
}
export function loginPractice(
  { username, password, captcha, challenge },
  storage = globalThis.sessionStorage,
  now = Date.now(),
) {
  if (username.trim() !== DEMO_USERNAME || password !== DEMO_PASSWORD)
    throw Error("Use the practice username and password shown below.");
  if (!challenge || now >= challenge.expiresAt)
    throw Error("The practice captcha expired. Refresh it and try again.");
  if (String(captcha).trim().toUpperCase() !== challenge.text)
    throw Error("The captcha does not match. Enter the six characters shown.");
  const session = { username: DEMO_USERNAME, expiresAt: now + SESSION_TTL };
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    throw Error(
      "Session storage is unavailable. Enable browser storage to sign in.",
    );
  }
  return session;
}
export function readSession(
  storage = globalThis.sessionStorage,
  now = Date.now(),
) {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s.username === DEMO_USERNAME &&
      Number.isFinite(s.expiresAt) &&
      s.expiresAt > now
      ? s
      : null;
  } catch {
    return null;
  }
}
export function logoutPractice(storage = globalThis.sessionStorage) {
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    throw Error(
      "Unable to clear the practice session. Close this tab to end it.",
    );
  }
}
