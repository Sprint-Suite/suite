import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LICENCE_VERSION,
  LICENCE_EFFECTIVE,
  LICENCE_TITLE,
  LICENCE_HTML,
} from '../licence-text.js';
import { ASSETS } from '../manifest.mjs';

test('carries the Suite licence version, date and title', () => {
  assert.equal(LICENCE_VERSION, '1.0');
  assert.equal(LICENCE_EFFECTIVE, '4 June 2026');
  assert.equal(LICENCE_TITLE, 'Free Use Licence');
});

test('holds the full licence body, first section to last', () => {
  assert.ok(LICENCE_HTML.includes('1. Grant of licence.'));
  assert.ok(LICENCE_HTML.includes('11. Governing law.'));
});

test('links the privacy note absolutely, in a new tab', () => {
  assert.match(
    LICENCE_HTML,
    /href="https:\/\/sprintsuite\.uk\/privacy"[^>]*target="_blank"[^>]*rel="noopener"/,
  );
});

test('has no inline styles or scripts (strict style-src surfaces)', () => {
  assert.doesNotMatch(LICENCE_HTML, /\sstyle=|<script/i);
});

test('both licence modules sync into every surface js/', () => {
  for (const src of ['licence-text.js', 'licence-modal.js']) {
    assert.ok(
      ASSETS.some((a) => a.src === src && a.destDir === 'js'),
      `${src} is in the manifest`,
    );
  }
});
