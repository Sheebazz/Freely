// Live extractor + reasoner + database checks. Run explicitly; spends Gemini calls.
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import repository from '../src/repositories/supabaseSession.repository.js';
import database from '../src/config/supabase.js';
import service from '../src/services/turnProcessing.service.js';
import extractorModule from '../src/providers/geminiExtractor.provider.js';
import reasonerModule from '../src/providers/geminiReasoner.provider.js';
const provider = new extractorModule.GeminiExtractorProvider();
const reasoningProvider = new reasonerModule.GeminiReasonerProvider();
let lastRun = 0;
async function check(circuitId, userMessage) {
  // Spacing is only for live evaluation, never a user-facing retry loop.
  const wait = Math.max(0, 13000 - (Date.now() - lastRun));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastRun = Date.now();
  const sessionId = randomUUID(), turnId = randomUUID();
  await repository.createSession({ id: sessionId, circuitId, createdAt: new Date().toISOString(),
    ...(circuitId === 'user-board' ? { boardDescription: userMessage } : {}) });
  try {
    const result = await service.processUserTurn({ repository, provider, reasoningProvider,
      sessionId, turnId, userMessage });
    expect(result.status).toBe('completed');
    expect(result.items.some(item => item.category === 'evidence' && item.kind === 'measurement')).toBe(false);
    expect(result.items.filter(item => item.provenance.actor === 'model').every(item => item.verificationStatus === 'unverified')).toBe(true);
    expect((await repository.getChatInputs(sessionId))[0].userMessage).toBe(userMessage);
    const replay = await service.processUserTurn({ repository,
      provider: { extract: () => { throw new Error('Replay called extractor'); } },
      reasoningProvider: { reason: () => { throw new Error('Replay called reasoner'); } },
      sessionId, turnId, userMessage });
    expect(replay.replayed).toBe(true); expect(replay.reasoning).toEqual(result.reasoning);
    return result;
  } finally {
    const { error } = await database.supabase.from('sessions').delete().eq('id', sessionId);
    if (error) throw new Error('Live chat test cleanup failed');
  }
}
describe('live chat pipeline', () => {
  it('demo opening with tool context produces one useful next test', async () => {
    const result = await check('circuit-one', 'LED1 stays dark when I switch on the 5 V supply. I have a digital multimeter.');
    expect(result.reasoning.kind).toBe('next_test');
    expect(result.reasoning.recommendation).not.toBeNull();
    expect(result.reasoning.message).not.toMatch(/cannot classify|sourceText|eligible evidence|reader envelope/i);
  }, 90000);
  it('unfamiliar-board opening gets a useful question or generic observation step without demo facts', async () => {
    const result = await check('user-board', 'This is a battery-powered desk lamp. It normally lights up when I press its button, but now it stays dark. I do not know the board’s name or its component identities.');
    expect(['context_required', 'next_test']).toContain(result.reasoning.kind);
    if (result.reasoning.recommendation) expect(['read_external_label', 'inspect_external_condition']).toContain(result.reasoning.recommendation.testId);
    expect(result.items.some(item => item.kind === 'trusted_fact')).toBe(false);
  }, 90000);
});
