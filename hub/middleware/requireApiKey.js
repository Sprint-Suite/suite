// middleware/requireApiKey.js
import { setNoStore } from './noStore.js';

export function createRequireApiKey(config) {
  const appByKey = new Map(Object.entries(config.apiKeys).map(([app, key]) => [key, app]));
  return (req, res, next) => {
    setNoStore(res);
    const header = req.headers.authorization || '';
    const m = /^Bearer (.+)$/.exec(header);
    if (!m) return res.status(401).json({ error: 'missing_auth' });
    const app = appByKey.get(m[1]);
    if (!app) return res.status(401).json({ error: 'invalid_auth' });
    req.callingApp = app;
    next();
  };
}
