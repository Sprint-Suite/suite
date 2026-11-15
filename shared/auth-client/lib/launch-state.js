// lib/launch-state.js
const { randomBytes, timingSafeEqual } = require('node:crypto');

const STATE_PATTERN = /^[a-f0-9]{64}$/;

function newState() {
  return randomBytes(32).toString('hex');
}

function isState(value) {
  return typeof value === 'string' && STATE_PATTERN.test(value);
}

function statesMatch(a, b) {
  if (!isState(a) || !isState(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = { newState, statesMatch };
