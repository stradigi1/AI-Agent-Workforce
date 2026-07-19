const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET && process.env.NODE_ENV !== 'test') {
  console.warn('[jwt] JWT_SECRET is not set — set it in Replit Secrets before going live.');
}

const EXPIRES_IN = '12h';

function sign(payload) {
  return jwt.sign(payload, SECRET || 'dev-only-insecure-secret', { expiresIn: EXPIRES_IN });
}

function verify(token) {
  return jwt.verify(token, SECRET || 'dev-only-insecure-secret');
}

module.exports = { sign, verify };
