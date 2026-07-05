// ISSUE-059 — Step 2: the <external_data> boundary-wrap ordering guarantee (FR-6.INJ.004 / NFR-SEC.007).
// This slice owns only the PIPELINE ORDERING — sanitize-then-tag-then-inject. The tag APPLICATION at tool
// read is ISSUE-032 (C3); the Layer-1 "data, not instructions" instruction is ISSUE-043 (C4). Here we
// guarantee: no tool content leaves the pipeline toward a prompt layer un-wrapped, and the wrap carries the
// provenance attributes (source/channel/timestamp) required by NFR-SEC.007 / AC-6.INJ.004.1.

export interface Provenance {
  source_tool: string; // slack | ghl | gmail | drive
  channel?: string; // e.g. slack channel / gmail thread
  timestamp: string; // ISO — when the content was read
  source_record_id?: string;
}

/** The single boundary-wrap primitive. Escapes any literal tag in content so it cannot forge a boundary. */
export function wrapExternalData(content: string, prov: Provenance): string {
  // Defensive: neutralise any pre-existing </external_data> in the content so injected text cannot close
  // the boundary early and smuggle instructions outside it (#2). We escape the angle brackets of any
  // external_data tag the content itself contains.
  const neutralised = content.replace(/<(\/?)external_data([^>]*)>/gi, '&lt;$1external_data$2&gt;');
  const attrs = [
    `source="${escapeAttr(prov.source_tool)}"`,
    prov.channel ? `channel="${escapeAttr(prov.channel)}"` : '',
    `timestamp="${escapeAttr(prov.timestamp)}"`,
    prov.source_record_id ? `record="${escapeAttr(prov.source_record_id)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<external_data ${attrs}>${neutralised}</external_data>`;
}

function escapeAttr(v: string): string {
  return v.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** True iff the string is a fully-formed external_data boundary (the seam-check used by the pipeline). */
export function isBoundaryWrapped(s: string): boolean {
  return /^<external_data\b[^>]*>[\s\S]*<\/external_data>$/.test(s);
}
