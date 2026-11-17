// lib/notices.js — map a ?notice=<key> to fixed text. The query value itself is
// never rendered, and inherited keys such as __proto__ are not notices.
export function pickNotice(notices, key) {
  return typeof key === 'string' && Object.hasOwn(notices, key) ? notices[key] : null;
}
