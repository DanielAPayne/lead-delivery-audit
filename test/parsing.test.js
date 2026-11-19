import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBytes, parseRows, parseCsv, detectDelimiter } from '../src/csv.js';
import { loadReceipts, normalizeId, parseTime } from '../src/receipts.js';

test('quoted fields, escaped quotes, embedded newlines and CRLF', () => {
  const rows = parseRows('a,b\r\n"x, y","he said ""hi"""\r\n"line1\nline2",z\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"'], ['line1\nline2', 'z']]);
});

test('BOM is stripped and blank lines ignored', () => {
  const { header, records } = parseCsv('﻿id,name\n1,A\n\n2,B');
  assert.deepEqual(header, ['id', 'name']);
  assert.equal(records.length, 2);
});

test('delimiter detection: tab and semicolon', () => {
  assert.equal(detectDelimiter('id\tcreated_time\tform\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('"a;b",c;d;e\n'), ';');
});

test('unterminated quote is an error', () => {
  assert.throws(() => parseRows('a\n"oops'), /quoted field/);
});

test('UTF-16 LE export with BOM decodes', () => {
  const text = 'id\tcreated_time\nl:123\t2026-10-01T00:00:00+0000\n';
  const body = Buffer.from(text, 'utf16le');
  const bytes = new Uint8Array([0xff, 0xfe, ...body]);
  const { receipts } = loadReceipts(decodeBytes(bytes), { label: 'source' });
  assert.equal(receipts[0].submissionId, '123');
});

test('normalizeId strips Meta l: prefix and blanks', () => {
  assert.equal(normalizeId(' l:98765 '), '98765');
  assert.equal(normalizeId(''), null);
  assert.equal(normalizeId(undefined), null);
  assert.equal(normalizeId(42), '42');
});

test('parseTime: offsets honored, naive read as UTC and flagged', () => {
  assert.equal(parseTime('2026-10-01T05:00:00-05:00').at.toISOString(), '2026-10-01T10:00:00.000Z');
  const naive = parseTime('2026-10-01 05:00');
  assert.equal(naive.naive, true);
  assert.equal(naive.at.toISOString(), '2026-10-01T05:00:00.000Z');
  assert.equal(parseTime('soon').invalid, true);
  assert.equal(parseTime('').at, null);
});

test('loadReceipts keeps only ID, time and row reference', () => {
  const { receipts, stats } = loadReceipts('email,Lead ID,created_time,phone\nx@example.com,abc,2026-10-01,555\n', { label: 'source' });
  assert.deepEqual(Object.keys(receipts[0]).sort(), ['observedAt', 'ref', 'submissionId']);
  assert.equal(receipts[0].ref, 'source:2');
  assert.equal(stats.idColumn, 'Lead ID');
  assert.equal(stats.naiveTimes, 1);
});

test('explicit ID column, missing column error, JSON Lines', () => {
  assert.equal(loadReceipts('hs_id,x\n7,1\n', { idColumn: 'HS_ID' }).receipts[0].submissionId, '7');
  assert.throws(() => loadReceipts('a,b\n1,2\n', { label: 'crm' }), /no submission ID column/);
  assert.throws(() => loadReceipts('a,b\n1,2\n', { idColumn: 'nope' }), /"nope" not found/);
  const j = loadReceipts('{"lead_id":"1","observed_at":"2026-10-01T00:00:00Z"}\n{"lead_id":null}\n');
  assert.deepEqual(j.receipts.map(x => x.submissionId), ['1', null]);
});
