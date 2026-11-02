const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const User = require('./models/User');

const COOKIE = 'session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(__dirname, '.session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
const SECRET = loadSecret();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, expected.length), expected);
}

const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('hex');

function makeToken(userId) {
  const payload = `${userId}.${Date.now() + MAX_AGE_MS}`;
  return `${payload}.${sign(payload)}`;
}

// Returns the user id from a valid, unexpired token, otherwise null.
function readToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = sign(`${id}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return Number(exp) > Date.now() ? id : null;
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

async function userFromCookieHeader(header) {
  const id = readToken(parseCookies(header)[COOKIE]);
  if (!id) return null;
  try { return await User.findById(id); } catch { return null; }
}

function startSession(res, user) {
  res.cookie(COOKIE, makeToken(user._id), { httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE_MS });
}

function endSession(res) {
  res.clearCookie(COOKIE);
}

async function loadUser(req, res, next) {
  try {
    req.user = await userFromCookieHeader(req.headers.cookie);
    next();
  } catch (err) { next(err); }
}

function requireApi(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in' });
  next();
}

function requirePage(req, res, next) {
  if (req.user) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, userFromCookieHeader,
  startSession, endSession, loadUser, requireApi, requirePage
};
