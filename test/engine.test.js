import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReceipts } from '../src/receipts.js';
import { reconcile, describe } from '../src/engine.js';

const ex = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const load = (name, stage) => loadReceipts(readFileSync(join(ex, name, `${stage}.csv`), 'utf8'), { label: stage }).receipts;
const runExample = name => reconcile({ source: load(name, 'source'), router: load(name, 'router'), crm: load(name, 'crm') });
const r = (id, at = null) => ({ submissionId: id, observedAt: at, ref: 'x' });

test('exceptions example: equal totals hide 3 missing and 3 repeated', () => {
  const res = runExample('exceptions');
  assert.equal(res.verdict, 'exceptions');
  assert.equal(res.summary.sourceSubmissions, 100);
  assert.equal(res.summary.crmRows, 100);
  assert.equal(res.summary.matched, 97);
  assert.equal(res.summary.missing, 3);
  assert.equal(res.summary.repeatedExtraRows, 3);
  const cls = Object.fromEntries(res.exceptions.map(f => [f.submissionId, f.class]));
  assert.deepEqual(cls, {
    'F-005': 'repeated', 'F-024': 'lost_before_router', 'F-036': 'repeated',
    'F-052': 'lost_after_router', 'F-071': 'repeated', 'F-089': 'lost_after_router',
  });
  assert.equal(res.exceptions.find(f => f.submissionId === 'F-052').lastStep, 'router');
  assert.equal(res.exceptions.find(f => f.submissionId === 'F-024').lastStep, 'source');
  assert.match(describe(res), /raw totals agree/);
});

test('healthy example is clean', () => {
  const res = runExample('healthy');
  assert.equal(res.verdict, 'clean');
  assert.equal(res.exceptions.length, 0);
  assert.equal(res.summary.delivered, 100);
});

test('incomplete example keeps absent IDs unresolved', () => {
  const res = runExample('incomplete');
  assert.equal(res.verdict, 'incomplete');
  assert.equal(res.summary.unresolved, 3);
  assert.equal(res.summary.crmRowsWithoutId, 3);
  assert.equal(res.summary.missing, 0);
  assert.equal(res.summary.minimumMissing, 0);
});

test('minimumMissing counts absences that unidentified rows cannot cover', () => {
  const res = reconcile({ source: [r('a'), r('b'), r('c')], crm: [r(null)] });
  assert.equal(res.summary.unresolved, 3);
  assert.equal(res.summary.minimumMissing, 2);
});

test('without a router, absences are missing_in_crm', () => {
  const res = reconcile({ source: [r('a'), r('b')], crm: [r('a')] });
  assert.equal(res.exceptions[0].class, 'missing_in_crm');
  assert.equal(res.exceptions[0].atRouter, null);
});

test('CRM IDs absent from source are listed, not counted as matches', () => {
  const res = reconcile({ source: [r('a')], crm: [r('a'), r('z')] });
  assert.deepEqual(res.crmOnly, ['z']);
  assert.equal(res.verdict, 'clean');
});

test('source duplicates and missing IDs are noted', () => {
  const res = reconcile({ source: [r('a'), r('a'), r(null)], crm: [r('a')] });
  assert.equal(res.summary.sourceSubmissions, 1);
  assert.equal(res.notes.sourceDuplicates, 1);
  assert.equal(res.notes.sourceWithoutId, 1);
});

test('window filters source rows: from inclusive, to exclusive', () => {
  const d = s => new Date(s);
  const source = [r('a', d('2026-10-01T00:00:00Z')), r('b', d('2026-10-15T00:00:00Z')), r('c', d('2026-11-01T00:00:00Z')), r('n')];
  const res = reconcile({ source, crm: [] }, { from: d('2026-10-01T00:00:00Z'), to: d('2026-11-01T00:00:00Z') });
  assert.deepEqual(res.exceptions.map(f => f.submissionId), ['a', 'b', 'n']);
  assert.equal(res.notes.sourceOutsideWindow, 1);
  assert.equal(res.notes.sourceWithoutTime, 1);
});

test('repeated only: sentence names the subject', () => {
  const res = reconcile({ source: [r('a'), r('b')], crm: [r('a'), r('a'), r('b')] });
  assert.equal(describe(res), '1 source submission has more than one CRM receipt (1 extra row).');
});

test('singular wording for counts of one', () => {
  const res = reconcile({ source: [r('a'), r('b')], crm: [r('b'), r(null)] });
  assert.equal(describe(res), '1 submission is unresolved: 1 CRM row carries no submission ID, so delivery cannot be determined for them. None can be confirmed missing yet.');
  const one = reconcile({ source: [r('a')], crm: [r('a')] });
  assert.equal(describe(one), 'The one source submission has exactly one CRM receipt.');
});
