#!/usr/bin/env node
// lda: reconcile lead exports by submission ID.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodeBytes } from '../src/csv.js';
import { loadReceipts } from '../src/receipts.js';
import { reconcile } from '../src/engine.js';
import { toJson, toMarkdown } from '../src/report.js';

export const EXIT = { clean: 0, usage: 2, exceptions: 10, incomplete: 11 };

const HELP = `Usage:
  lda audit --source FILE --crm FILE [--router FILE] [options]
  lda example exceptions|healthy|incomplete [--format md|json]

Options:
  --source-id-column NAME   ID column in the source export (default: auto-detect)
  --router-id-column NAME   ID column in the router export
  --crm-id-column NAME      ID column in the CRM export
  --source-time-column NAME Timestamp column in the source export
  --from DATE               Only source submissions at or after DATE (ISO 8601)
  --to DATE                 Only source submissions before DATE
  --format md|json          Report format (default: md)
  --out FILE                Write the report to FILE instead of stdout

Exit codes: 0 clean, 10 exceptions found, 11 incomplete evidence, 2 usage or input error.
`;

class UsageError extends Error {}

function readReceipts(path, label, idColumn, timeColumn) {
  let bytes;
  try { bytes = readFileSync(path); } catch (e) { throw new UsageError(`${label}: cannot read ${path} (${e.code ?? e.message})`); }
  const format = path.toLowerCase().endsWith('.jsonl') ? 'jsonl' : undefined;
  try {
    return loadReceipts(decodeBytes(bytes), { label, idColumn, timeColumn, format });
  } catch (e) {
    throw new UsageError(e.message);
  }
}

function parseDate(value, flag) {
  if (!value) return undefined;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(t)) throw new UsageError(`${flag}: not a date: ${value}`);
  return new Date(t);
}

export function run(argv, { stdout = process.stdout, now = new Date() } = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      source: { type: 'string' }, router: { type: 'string' }, crm: { type: 'string' },
      'source-id-column': { type: 'string' }, 'router-id-column': { type: 'string' }, 'crm-id-column': { type: 'string' },
      'source-time-column': { type: 'string' },
      from: { type: 'string' }, to: { type: 'string' },
      format: { type: 'string', default: 'md' }, out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, arg] = positionals;
  if (values.help || !cmd) { stdout.write(HELP); return values.help ? EXIT.clean : EXIT.usage; }
  if (!['md', 'json'].includes(values.format)) throw new UsageError('--format must be md or json');

  let paths;
  if (cmd === 'example') {
    if (!['exceptions', 'healthy', 'incomplete'].includes(arg)) throw new UsageError('example: choose exceptions, healthy or incomplete');
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', arg);
    paths = { source: join(dir, 'source.csv'), router: join(dir, 'router.csv'), crm: join(dir, 'crm.csv') };
  } else if (cmd === 'audit') {
    if (!values.source || !values.crm) throw new UsageError('audit needs --source and --crm');
    paths = { source: values.source, router: values.router, crm: values.crm };
  } else {
    throw new UsageError(`unknown command: ${cmd}`);
  }

  const src = readReceipts(paths.source, 'source', values['source-id-column'], values['source-time-column']);
  const rtr = paths.router ? readReceipts(paths.router, 'router', values['router-id-column']) : null;
  const crm = readReceipts(paths.crm, 'crm', values['crm-id-column']);
  const from = parseDate(values.from, '--from');
  const to = parseDate(values.to, '--to');
  if (from && to && from >= to) throw new UsageError('--from must be before --to');
  if ((from || to) && !src.stats.timeColumn) throw new UsageError('source: --from/--to need a timestamp column; pass --source-time-column');

  const result = reconcile({ source: src.receipts, router: rtr?.receipts ?? null, crm: crm.receipts }, { from, to });
  const inputs = { source: src.stats, ...(rtr ? { router: rtr.stats } : {}), crm: crm.stats };
  const meta = { generatedAt: now.toISOString(), inputs };
  const report = values.format === 'json' ? toJson(result, meta) : toMarkdown(result, meta);
  if (values.out) writeFileSync(values.out, report);
  else stdout.write(report);
  return EXIT[result.verdict];
}

const invokedDirectly = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (invokedDirectly) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError || e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      process.stderr.write(`lda: ${e.message}\n`);
      process.exitCode = EXIT.usage;
    } else {
      throw e;
    }
  }
}
