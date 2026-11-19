import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, inlineModule } from '../scripts/build-web.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('docs/index.html matches a fresh build', () => {
  assert.equal(readFileSync(join(root, 'docs', 'index.html'), 'utf8'), build());
});

test('built page has no module syntax, a no-network CSP and all examples', () => {
  const html = build();
  assert.doesNotMatch(html, /^\s*(import|export)\b/m);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /connect-src|https?:\/\/[^"]*\.js/);
  for (const name of ['exceptions', 'healthy', 'incomplete']) assert.match(html, new RegExp(`"${name}":\\{"source"`));
  assert.equal(html.match(/<\/script>/g).length, 1);
});

test('inlineModule strips imports and export keywords only', () => {
  const out = inlineModule("import { a } from './a.js';\nexport const x = 1;\nexport function f() { return 'export const'; }\n", 't.js');
  assert.doesNotMatch(out, /^import|^export/m);
  assert.match(out, /const x = 1;/);
  assert.match(out, /'export const'/);
  assert.throws(() => inlineModule('export default 1;\n', 'bad.js'), /unsupported/);
});
