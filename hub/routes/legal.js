// routes/legal.js
// /license renders the Free Use Licence (views/license.eta) and /privacy renders
// the Data & Privacy Note (views/privacy.eta). /terms remains a "coming soon"
// stub until its copy is finalised (lawyer review). The licence wording is the
// theme's licence-text.js, synced into public/js; Node caches it, so a wording
// change needs a Hub restart.
import {
  LICENCE_HTML,
  LICENCE_VERSION,
  LICENCE_EFFECTIVE,
} from '../public/js/licence-text.js';

const LICENCE = { html: LICENCE_HTML, version: LICENCE_VERSION, effective: LICENCE_EFFECTIVE };
const STUBS = {
  '/terms': 'Terms',
};

export function mountLegal(app, { marketing = [] } = {}) {
  for (const [path, title] of Object.entries(STUBS)) {
    app.get(path, (req, res) => res.render('legal', { title }));
  }
  app.get('/license', (req, res) => res.render('license', { licence: LICENCE }));
  // /privacy carries the consent bar: it hosts the withdraw control in §6, which
  // needs consent-banner.js present to do anything.
  app.get('/privacy', marketing, (req, res) => res.render('privacy'));
}
