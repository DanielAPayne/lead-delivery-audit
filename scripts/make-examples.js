// Regenerate the synthetic examples in examples/. Deterministic; no real data.
// node scripts/make-examples.js

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const ids = Array.from({ length: 100 }, (_, i) => `F-${String(i + 1).padStart(3, '0')}`);
const start = Date.UTC(2026, 9, 1, 0, 0, 0);
const at = (id, offsetMs) => new Date(start + (Number(id.slice(2)) - 1) * 7 * 3600e3 + offsetMs).toISOString();

const dropped = new Set(['F-024', 'F-052', 'F-089']);
const repeats = ['F-005', 'F-036', 'F-071'];

function csv(header, rows) {
  return [header.join(','), ...rows.map(r => r.join(','))].join('\n') + '\n';
}
const sourceRows = () => ids.map(id => [id, at(id, 0), 'synthetic-form']);
const routerRows = list => list.map(id => [`run-${id.slice(2)}`, id, at(id, 2e3)]);
const crmRows = list => list.map((id, k) => [`evt-${String(k + 1).padStart(3, '0')}`, id ?? '', at(id ?? ids[k], 30e3)]);

const cases = {
  exceptions: {
    router: ids.filter(id => id !== 'F-024'),
    crm: [...ids.filter(id => !dropped.has(id)), ...repeats],
  },
  healthy: { router: ids, crm: ids },
  incomplete: { router: ids, crm: ids.map(id => (dropped.has(id) ? null : id)) },
};

for (const [name, c] of Object.entries(cases)) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'source.csv'), csv(['submission_id', 'created_time', 'form'], sourceRows()));
  writeFileSync(join(dir, 'router.csv'), csv(['execution_id', 'submission_id', 'observed_at'], routerRows(c.router)));
  writeFileSync(join(dir, 'crm.csv'), csv(['event_id', 'submission_id', 'observed_at'], crmRows(c.crm)));
}
console.log(`wrote ${Object.keys(cases).length} examples to ${root}`);
