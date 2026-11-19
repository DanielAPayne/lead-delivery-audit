// Reconcile source submissions against router and CRM receipts by submission ID.
// Pure function, no I/O: shared by the CLI and the browser page.

export const CLASSES = {
  delivered: { label: 'Delivered', next: 'None.' },
  repeated: { label: 'Repeated in CRM', next: 'Check for a retried write or repeated logging.' },
  lost_before_router: { label: 'Present at source only', next: 'Review the source-to-router handoff (trigger, form scope, connection).' },
  lost_after_router: { label: 'Seen by router, no CRM receipt', next: 'Review the router run for this ID, destination errors and routing filters.' },
  missing_in_crm: { label: 'No CRM receipt', next: 'Check destination activity; add router logs to locate the break.' },
  unresolved: { label: 'Unresolved', next: 'Some CRM rows carry no submission ID. Map an event-level ID into the CRM, then rerun.' },
};

function countIds(receipts) {
  const counts = new Map();
  let unidentified = 0;
  for (const r of receipts) {
    if (r.submissionId) counts.set(r.submissionId, (counts.get(r.submissionId) ?? 0) + 1);
    else unidentified += 1;
  }
  return { counts, unidentified };
}

/**
 * @param {{source: Receipt[], router?: Receipt[]|null, crm: Receipt[]}} input
 * @param {{from?: Date, to?: Date}} window  Applied to source rows only (from inclusive, to exclusive).
 */
export function reconcile({ source, router = null, crm }, window = {}) {
  const { from, to } = window;
  const notes = { sourceWithoutId: 0, sourceDuplicates: 0, sourceOutsideWindow: 0, sourceWithoutTime: 0 };

  const sourceIds = [];
  const seen = new Set();
  for (const r of source) {
    if (!r.submissionId) { notes.sourceWithoutId += 1; continue; }
    if (from || to) {
      if (!r.observedAt) notes.sourceWithoutTime += 1;
      else if ((from && r.observedAt < from) || (to && r.observedAt >= to)) { notes.sourceOutsideWindow += 1; continue; }
    }
    if (seen.has(r.submissionId)) { notes.sourceDuplicates += 1; continue; }
    seen.add(r.submissionId);
    sourceIds.push(r.submissionId);
  }

  const crmCounts = countIds(crm);
  const routerCounts = router ? countIds(router) : null;

  const findings = sourceIds.map(id => {
    const n = crmCounts.counts.get(id) ?? 0;
    const atRouter = routerCounts ? routerCounts.counts.has(id) : null;
    let cls;
    if (n === 1) cls = 'delivered';
    else if (n > 1) cls = 'repeated';
    else if (crmCounts.unidentified > 0) cls = 'unresolved';
    else if (atRouter === true) cls = 'lost_after_router';
    else if (atRouter === false) cls = 'lost_before_router';
    else cls = 'missing_in_crm';
    const lastStep = n > 0 ? 'crm' : atRouter ? 'router' : 'source';
    return { submissionId: id, class: cls, crmRows: n, atRouter, lastStep };
  });

  const crmOnly = [...crmCounts.counts.keys()].filter(id => !seen.has(id));
  const by = cls => findings.filter(f => f.class === cls).length;
  const absent = findings.filter(f => f.crmRows === 0).length;
  const repeatedExtra = findings.reduce((s, f) => s + Math.max(0, f.crmRows - 1), 0);
  const missing = by('lost_before_router') + by('lost_after_router') + by('missing_in_crm');
  const unresolved = by('unresolved');

  const summary = {
    sourceSubmissions: sourceIds.length,
    routerRows: router ? router.length : null,
    crmRows: crm.length,
    crmRowsWithoutId: crmCounts.unidentified,
    matched: sourceIds.length - absent,
    delivered: by('delivered'),
    repeated: by('repeated'),
    repeatedExtraRows: repeatedExtra,
    missing,
    unresolved,
    // Each CRM row without an ID can account for at most one absent submission.
    minimumMissing: unresolved ? Math.max(0, unresolved - crmCounts.unidentified) : missing,
    crmOnly: crmOnly.length,
  };
  const verdict = unresolved ? 'incomplete' : (missing || summary.repeated) ? 'exceptions' : 'clean';

  return {
    verdict,
    summary,
    exceptions: findings.filter(f => f.class !== 'delivered'),
    crmOnly,
    notes,
    window: { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null },
  };
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One-sentence plain-language result. */
export function describe(result) {
  const s = result.summary;
  if (result.verdict === 'clean') {
    return s.sourceSubmissions === 1 ? 'The one source submission has exactly one CRM receipt.' : `All ${s.sourceSubmissions} source submissions have exactly one CRM receipt.`;
  }
  if (result.verdict === 'incomplete') {
    return `${plural(s.unresolved, 'submission is', 'submissions are')} unresolved: ${plural(s.crmRowsWithoutId, 'CRM row carries', 'CRM rows carry')} no submission ID, so delivery cannot be determined for them. ${s.minimumMissing ? `At least ${plural(s.minimumMissing, 'is', 'are')} missing.` : 'None can be confirmed missing yet.'}`;
  }
  const parts = [];
  if (s.missing) parts.push(`${plural(s.missing, 'source submission has', 'source submissions have')} no CRM receipt`);
  if (s.repeated) {
    const who = s.missing ? plural(s.repeated, 'other has', 'others have') : plural(s.repeated, 'source submission has', 'source submissions have');
    parts.push(`${who} more than one CRM receipt (${plural(s.repeatedExtraRows, 'extra row', 'extra rows')})`);
  }
  let text = parts.join('; ') + '.';
  if (s.crmRows === s.sourceSubmissions) text += ' The raw totals agree.';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
