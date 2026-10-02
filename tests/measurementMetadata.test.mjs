import { describe, it, expect } from 'vitest';
import extraction from '../src/services/extraction.service.js';
const { validateExtraction, extractUserMessage } = extraction;
const make = (sourceText, overrides = {}) => ({ category: 'evidence', kind: 'measurement',
  subject: 'input', value: 5.02, unit: null, content: sourceText, sourceText, ...overrides });
const check = (item, turnContext = null) => validateExtraction({ output: { items: [item], unresolved: [] },
  userMessage: item.sourceText, turnContext });
describe('measurement metadata authority', () => {
  it('keeps an omitted unit unknown rather than assuming volts', () => {
    expect(check(make('I got 5.02 at the input.')).items[0].unit).toBeNull();
    expect(() => check(make('I got 5.02 at the input.', { unit: 'V' }))).toThrow(/unit/);
  });
  it.each([['5.02 mV at input', 'V'], ['5.02 V at input', 'mV'],
    ['5.02 MA at input', 'mA']])('rejects changing scale/case in %s to %s', (source, unit) => {
      expect(() => check(make(source, { unit }))).toThrow(/unit/);
    });
  it.each([['5.02 mV at input', 'mV'], ['5.02 volts at input', 'V'],
    ['5.02 Ω at input', 'ohm'], ['5.02 V at input', 'V']])('accepts attested %s', (source, unit) => {
      expect(check(make(source, { unit })).items[0].unit).toBe(unit);
    });
  it('rejects an invented measurand even when the numeric value matches', () => {
    expect(() => check(make('I got 5.02 at the input.', { subject: 'output rail relative to ground' })))
      .toThrow(/subject/);
  });
  it('allows only the exact backend subject for a contextual reply', () => {
    const context = { expectedResponseType: 'measurement', requestedSubject: 'TP1 voltage relative to ground' };
    expect(check(make('It reads 5.02 V.', { subject: context.requestedSubject, unit: 'V' }), context)
      .items[0].subject).toBe(context.requestedSubject);
    expect(() => check(make('It reads 5.02 V.', { subject: 'TP2', unit: 'V' }), context)).toThrow(/subject/);
  });
  it('uses bounded repair and clarifies an unattested unit that remains invalid', async () => {
    let repairs = 0;
    const bad = { items: [make('I got 5.02 at the input.', { unit: 'V' })], unresolved: [] };
    const result = await extractUserMessage({ userMessage: bad.items[0].sourceText,
      provider: { extract: async () => bad, repair: async () => { repairs++; return bad; } } });
    expect(repairs).toBe(1); expect(result.status).toBe('clarification_required');
  });
  it('documents the semantic bound: a genuine span can still be misclassified', () => {
    // Textual support is not proof of a performed measurement. Semantic eval covers this.
    expect(check(make('input should be 5.02 V', { unit: 'V' })).items).toHaveLength(1);
  });
  it.each([
    ["TP5V reads 5.02", "TP5V", "V"],
    ["input reads 5.02 V2", "input", "V"],
    ["input reads 5.02 mV; TP2 reads 4.8 V", "input", "V"],
  ])("rejects a unit borrowed from an identifier or another reading: %s", (source, subject, unit) => {
    expect(() => check(make(source, { subject, unit }))).toThrow(/unit/);
  });
  it("rejects ambiguous decimal commas instead of deleting them", () => {
    for (const value of [4, 8, 48, 4.8]) {
      expect(() => check(make("input reads 4,8 V", { value, unit: "V" }))).toThrow(/value/);
    }
  });
  it.each(["input reads 1,000 V", "input reads 1000V", "input reads 1e3 V"])
    ("accepts explicitly attested grouped, attached or scientific readings: %s", source => {
      expect(check(make(source, { value: 1000, unit: "V" })).items[0].value).toBe(1000);
    });

  it("accepts a reading followed by sentence punctuation without inventing a unit", () => {
    expect(check(make("input reads 5.02.")).items[0].unit).toBeNull();
  });

  it.each([
    ["TP1 reads 4.8, TP2 reads 5.0", "TP1", 4.8],
    ["TP1 reads 4.8, TP2 reads 5.0", "TP2", 5],
    ["input readings: 4.8, 5.0", "input", 4.8],
    ["input reads 4.8,", "input", 4.8],
    ["input reads 1,234, next reading pending", "input", 1234],
    ["input reads 4.8_note", "input", 4.8],
  ])("accepts a complete reading before separator punctuation: %s", (source, subject, value) => {
    expect(check(make(source, { subject, value })).items[0].value).toBe(value);
  });

  it("extracts two comma-separated measurements without repair", async () => {
    let repairs = 0;
    const userMessage = "TP1 reads 4.8, TP2 reads 5.0";
    const result = await extractUserMessage({ userMessage, provider: {
      extract: async () => ({ items: [
        make("TP1 reads 4.8,", { subject: "TP1", value: 4.8 }),
        make("TP2 reads 5.0", { subject: "TP2", value: 5 }),
      ], unresolved: [] }),
      repair: async () => { repairs++; throw new Error("Valid list must not need repair"); },
    } });
    expect(result.items.map(item => item.value)).toEqual([4.8, 5]);
    expect(repairs).toBe(0);
  });

  it.each([
    ["input reads 1,23", [1, 23, 123]],
    ["input reads 12_345", [12, 345, 12345]],
    ["input reads 1,234,56", [1, 1234, 56, 123456]],
  ])("does not truncate ambiguous digit-connected punctuation: %s", (source, values) => {
    for (const value of values) expect(() => check(make(source, { value }))).toThrow(/value/);
  });

});
