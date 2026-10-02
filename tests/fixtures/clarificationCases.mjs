// Shared by the raw-RPC differential test and disposable PostgreSQL audit.
const semantic = (entry = { sourceText: 'Maybe 330', reason: 'unclear evidence type' }) =>
  ({ reason: 'semantic_ambiguity', unresolved: [entry] });
const detail = (value = 'Extractor rejected output') =>
  ({ reason: 'extraction_unrecoverable', detail: value });
export const clarificationCases = [
  null, true, 7, 'payload', [], {}, { reason: 'other' },
  semantic(), detail(),
  { ...semantic(), extra: true }, { ...detail(), extra: true },
  ...[null, true, 5, 'entry', [], {}, { sourceText: 'x' }, { reason: 'x' },
    { sourceText: 'x', reason: 'x', extra: true }].map(semantic),
  ...[null, {}, true, 5, '', ' ', '\t\n', '\u00a0', '\uFEFF', 'x'.repeat(1500),
    'x'.repeat(1501), '😀'.repeat(1500), '😀'.repeat(1501)].map(detail),
  ...[null, [], {}, 'array'].map(unresolved => ({ reason: 'semantic_ambiguity', unresolved })),
  ...[null, true, 5, '', 'x'.repeat(1000), 'x'.repeat(1001), '😀'.repeat(1000), '😀'.repeat(1001)]
    .map(sourceText => semantic({ sourceText, reason: 'x' })),
  ...[null, true, 5, '', 'x'.repeat(500), 'x'.repeat(501), '😀'.repeat(500), '😀'.repeat(501)]
    .map(reason => semantic({ sourceText: 'x', reason })),
  semantic({ sourceText: ' ', reason: ' ' }),
  { reason: 'semantic_ambiguity', unresolved: [{ sourceText: 'x', reason: 'x' }, null] },
];
