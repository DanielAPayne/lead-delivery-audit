// Turn an export (CSV, TSV or JSON Lines) into receipts:
//   { submissionId: string|null, observedAt: Date|null, ref: string }
// Only the ID, the timestamp and a row reference are kept. Names, emails, phone
// numbers and every other column are dropped at load time, so reports cannot leak them.

import { parseCsv } from './csv.js';

export const ID_COLUMN_CANDIDATES = [
  'submission_id', 'lead_id', 'leadgen_id', 'meta_lead_id', 'facebook_lead_id',
  'lead id', 'leadgen id', 'submission id', 'id',
];
export const TIME_COLUMN_CANDIDATES = [
  'observed_at', 'created_time', 'created_at', 'submitted_at', 'conversion date',
  'date', 'timestamp', 'time',
];

function pickColumn(header, wanted, candidates, label) {
  if (wanted) {
    const hit = header.find(h => h === wanted) ?? header.find(h => h.toLowerCase() === wanted.toLowerCase());
    if (!hit) throw new Error(`${label} column "${wanted}" not found. Columns: ${header.join(', ')}`);
    return hit;
  }
  for (const c of candidates) {
    const hit = header.find(h => h.trim().toLowerCase() === c);
    if (hit) return hit;
  }
  return null;
}

/** Columns of an export, for column pickers. */
export function readHeader(text) {
  if (text.trimStart().startsWith('{')) {
    const keys = new Set();
    for (const line of text.split(/\r?\n/).slice(0, 200)) {
      if (!line.trim()) continue;
      try { Object.keys(JSON.parse(line)).forEach(k => keys.add(k)); } catch { /* reported at load */ }
    }
    return { format: 'jsonl', header: [...keys] };
  }
  return { format: 'csv', header: parseCsv(text).header };
}

/** Auto-detected ID and time columns for a header (null when none match). */
export function detectColumns(header) {
  return {
    idColumn: pickColumn(header, null, ID_COLUMN_CANDIDATES, 'ID'),
    timeColumn: pickColumn(header, null, TIME_COLUMN_CANDIDATES, 'time'),
  };
}

/** Normalize a submission ID. Meta exports prefix lead IDs with "l:"; strip that and whitespace. */
export function normalizeId(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (/^l:/i.test(s)) s = s.slice(2).trim();
  return s === '' ? null : s;
}

const NAIVE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;

/** Parse a timestamp. Timestamps without an offset are read as UTC and flagged. */
export function parseTime(value) {
  if (value === null || value === undefined || String(value).trim() === '') return { at: null, naive: false };
  const s = String(value).trim();
  if (NAIVE.test(s)) {
    const iso = s.length === 10 ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`;
    const t = Date.parse(iso);
    return { at: Number.isNaN(t) ? null : new Date(t), naive: true, invalid: Number.isNaN(t) };
  }
  const t = Date.parse(s);
  return { at: Number.isNaN(t) ? null : new Date(t), naive: false, invalid: Number.isNaN(t) };
}

/**
 * Load receipts from export text.
 * @param {string} text
 * @param {{format?: 'csv'|'jsonl', idColumn?: string, timeColumn?: string, label?: string}} opts
 */
export function loadReceipts(text, opts = {}) {
  const label = opts.label ?? 'input';
  const format = opts.format ?? (text.trimStart().startsWith('{') ? 'jsonl' : 'csv');
  let header;
  let records;
  if (format === 'jsonl') {
    records = text.split(/\r?\n/).filter(l => l.trim()).map((l, k) => {
      try { return JSON.parse(l); } catch { throw new Error(`${label}: line ${k + 1} is not valid JSON`); }
    });
    header = [...new Set(records.flatMap(r => Object.keys(r)))];
  } else {
    ({ header, records } = parseCsv(text));
  }
  const idCol = pickColumn(header, opts.idColumn, ID_COLUMN_CANDIDATES, `${label}: ID`);
  if (!idCol) throw new Error(`${label}: no submission ID column found. Pass one explicitly. Columns: ${header.join(', ')}`);
  const timeCol = pickColumn(header, opts.timeColumn, TIME_COLUMN_CANDIDATES, `${label}: time`);

  const stats = { rows: records.length, idColumn: idCol, timeColumn: timeCol, naiveTimes: 0, invalidTimes: 0 };
  const receipts = records.map((r, k) => {
    const time = timeCol ? parseTime(r[timeCol]) : { at: null };
    if (time.naive) stats.naiveTimes += 1;
    if (time.invalid) stats.invalidTimes += 1;
    return { submissionId: normalizeId(r[idCol]), observedAt: time.at, ref: `${label}:${format === 'csv' ? k + 2 : k + 1}` };
  });
  return { receipts, stats };
}
