import "dotenv/config";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  session: { type: "string" }, circuit: { type: "string", default: "circuit-one" },
  turn: { type: "string" }, reply: { type: "string" }, message: { type: "string" },
} });

try {
  if (!values.message?.trim()) throw new Error("Provide --message with your observation or result");
  const { default: repository } = await import("../src/repositories/supabaseSession.repository.js");
  const { default: extractor } = await import("../src/providers/geminiExtractor.provider.js");
  const { default: reasoner } = await import("../src/providers/reasonerFactory.js");
  const { default: service } = await import("../src/services/turnProcessing.service.js");
  const { default: circuits } = await import("../src/services/circuitContext.service.js");
  const sessionId = values.session || randomUUID();
  if (!values.session) {
    circuits.loadCircuitContext(values.circuit);
    await repository.createSession({ id: sessionId,
      circuitId: values.circuit, createdAt: new Date().toISOString() });
  }
  const turnId = values.turn || randomUUID();
  // Print IDs before processing so a failure can be retried deliberately.
  console.log(JSON.stringify({ sessionId, turnId }));
  const result = await service.processUserTurn({ repository,
    provider: new extractor.GeminiExtractorProvider(),
    reasoningProvider: reasoner.createReasoner(),
    sessionId, turnId, replyToTurnId: values.reply || null, userMessage: values.message });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
