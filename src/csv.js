// Small RFC 4180 reader. No dependencies, so it runs in Node and in a browser.

/** Decode file bytes. Handles UTF-8 (with or without BOM) and UTF-16 LE/BE with a BOM,
 *  which some ad-platform exports use. */
export function decodeBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  return new TextDecoder('utf-8').decode(b);
}

/** Pick the delimiter that occurs most often outside quotes on the header line. */
export function detectDelimiter(text) {
  let line = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    if (!quoted) line += ch;
  }
  let best = ',';
  let bestCount = 0;
  for (const d of [',', '\t', ';']) {
    const n = line.split(d).length - 1;
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

/** Parse delimited text into an array of row arrays. */
export function parseRows(text, delimiter = detectDelimiter(text)) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i += 1; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i += 1;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

/** Parse delimited text into objects keyed by header. */
export function parseCsv(text) {
  const rows = parseRows(text);
  if (!rows.length) return { header: [], records: [] };
  const header = rows[0].map(h => h.trim());
  const records = rows.slice(1).map(r => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
  return { header, records };
}
