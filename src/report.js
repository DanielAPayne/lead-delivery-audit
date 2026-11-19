// Render a reconcile() result. Reports contain submission IDs and counts only:
// no contact details ever reach this layer (see receipts.js).

import { CLASSES, describe } from './engine.js';

const esc = s => String(s).replace(/\|/g, '\\|');

export function toJson(result, meta = {}) {
  return JSON.stringify({ tool: 'lead-delivery-audit', ...meta, ...result, sentence: describe(result) }, null, 2) + '\n';
}

export function toMarkdown(result, meta = {}) {
  const s = result.summary;
  const out = [];
  out.push('# Lead delivery audit', '');
  if (meta.generatedAt) out.push(`Generated ${meta.generatedAt}.`);
  if (result.window.from || result.window.to) {
    out.push(`Window (source time): ${result.window.from ?? 'start'} to ${result.window.to ?? 'end'}.`);
  }
  out.push('', `**Verdict: ${result.verdict}.** ${describe(result)}`, '');

  out.push('| Measure | Count |', '|---|---:|');
  out.push(`| Source submissions | ${s.sourceSubmissions} |`);
  if (s.routerRows !== null) out.push(`| Router rows | ${s.routerRows} |`);
  out.push(`| CRM rows | ${s.crmRows} |`);
  out.push(`| CRM rows without a submission ID | ${s.crmRowsWithoutId} |`);
  out.push(`| Source IDs matched in CRM | ${s.matched} |`);
  out.push(`| Missing | ${s.missing} |`);
  out.push(`| Repeated (extra rows) | ${s.repeated} (${s.repeatedExtraRows}) |`);
  out.push(`| Unresolved | ${s.unresolved} |`);
  out.push(`| CRM IDs not in source | ${s.crmOnly} |`, '');

  if (result.exceptions.length) {
    out.push('## Exceptions', '', '| Submission ID | Finding | Last recorded step | CRM rows | Next check |', '|---|---|---|---:|---|');
    for (const f of result.exceptions) {
      const c = CLASSES[f.class];
      out.push(`| ${esc(f.submissionId)} | ${c.label} | ${f.lastStep} | ${f.crmRows} | ${c.next} |`);
    }
    out.push('');
  }

  if (result.crmOnly.length) {
    out.push('## CRM IDs not in the source export', '',
      'These may belong to other forms, fall outside the window, or come from an incomplete source export.', '',
      result.crmOnly.map(esc).join(', '), '');
  }

  const n = result.notes;
  const lines = [];
  if (n.sourceWithoutId) lines.push(`${n.sourceWithoutId} source rows had no submission ID and were skipped.`);
  if (n.sourceDuplicates) lines.push(`${n.sourceDuplicates} source rows repeated an ID already seen and were counted once.`);
  if (n.sourceOutsideWindow) lines.push(`${n.sourceOutsideWindow} source rows fell outside the window.`);
  if (n.sourceWithoutTime) lines.push(`${n.sourceWithoutTime} source rows had no usable timestamp and were kept.`);
  for (const [stage, st] of Object.entries(meta.inputs ?? {})) {
    if (st.naiveTimes) lines.push(`${stage}: ${st.naiveTimes} timestamps had no time zone and were read as UTC.`);
    if (st.invalidTimes) lines.push(`${stage}: ${st.invalidTimes} timestamps could not be parsed.`);
  }
  out.push('## Notes', '');
  for (const l of lines) out.push(`- ${l}`);
  out.push('- Matching is by submission ID only. A contact record is not a submission receipt.',
    '- Confirm form scope, excluded leads, reporting delays and export completeness before acting on a gap.',
    '- This report contains IDs and counts only; no contact details were read into it.', '');
  return out.join('\n');
}
