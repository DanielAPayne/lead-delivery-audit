import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lda.js');
const lda = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

test('example exit codes', () => {
  assert.equal(lda('example', 'healthy').status, 0);
  assert.equal(lda('example', 'exceptions').status, 10);
  assert.equal(lda('example', 'incomplete').status, 11);
});

test('markdown report lists exceptions with last step and no contact fields', () => {
  const out = lda('example', 'exceptions').stdout;
  assert.match(out, /\*\*Verdict: exceptions\.\*\*/);
  assert.match(out, /\| F-052 \| Seen by router, no CRM receipt \| router \|/);
  assert.match(out, /\| F-024 \| Present at source only \| source \|/);
});

test('audit with real-looking export: PII never reaches the report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lda-'));
  writeFileSync(join(dir, 's.csv'), 'id,email,full_name,created_time\nl:1,a@example.com,Ann Lee,2026-10-02T00:00:00Z\nl:2,b@example.com,Bo Kim,2026-10-03T00:00:00Z\n');
  writeFileSync(join(dir, 'c.csv'), 'Record ID,Email,Meta Lead ID\n9,a@example.com,1\n');
  const out = join(dir, 'r.json');
  const res = lda('audit', '--source', join(dir, 's.csv'), '--crm', join(dir, 'c.csv'), '--crm-id-column', 'Meta Lead ID', '--format', 'json', '--out', out);
  assert.equal(res.status, 10, res.stderr);
  const text = readFileSync(out, 'utf8');
  assert.doesNotMatch(text, /example\.com|Ann|Kim/);
  const report = JSON.parse(text);
  assert.equal(report.summary.missing, 1);
  assert.equal(report.exceptions[0].submissionId, '2');
});

test('usage errors exit 2', () => {
  assert.equal(lda('audit', '--source', 'nope.csv').status, 2);
  assert.equal(lda('audit', '--source', 'nope.csv', '--crm', 'nope.csv').status, 2);
  assert.equal(lda('example', 'other').status, 2);
  assert.equal(lda('bogus').status, 2);
  assert.equal(lda('example', 'healthy', '--bad-flag').status, 2);
  assert.equal(lda('example', 'healthy', '--from', '2026-11-01', '--to', '2026-10-01').status, 2);
});
