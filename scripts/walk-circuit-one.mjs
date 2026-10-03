// Evaluation runner: public observations + simulated bench reports only.
// Never imports the hidden scoring-answer file or feeds a planted cause to a model.
import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import repository from "../src/repositories/supabaseSession.repository.js";
import extractorModule from "../src/providers/geminiExtractor.provider.js";
import factory from "../src/providers/reasonerFactory.js";
import service from "../src/services/turnProcessing.service.js";
const { values } = parseArgs({ options: { case: { type: "string" },
  out: { type: "string", default: "evaluation-results/circuit-one-walkthrough.json" },
  "max-turns": { type: "string", default: "5" }, interactive: { type: "boolean", default: false } } });
const maxTurns = Number(values["max-turns"]);
if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 12) throw new Error("--max-turns must be 1..12");
const fixture = JSON.parse(await readFile(new URL("../data/circuit-one.json", import.meta.url), "utf8"));
const bench = JSON.parse(await readFile(new URL("../tests/evaluation/circuit-one-bench.json", import.meta.url), "utf8"));
const cases = fixture.fault_cases.filter(entry => !values.case || entry.id === values.case);
if (!cases.length) throw new Error("Unknown case ID");
const out = resolve(values.out); await mkdir(dirname(out), { recursive: true });
let results = { circuitId: "circuit-one", source: values.interactive ? "interactive reported bench observations" : "simulated bench reports", runs: [] };
try { results = JSON.parse(await readFile(out, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const extractor = new extractorModule.GeminiExtractorProvider();
const attempts = [];
const reasoner = factory.createReasoner(process.env, { onAttempt: metadata => attempts.push(metadata) });
const terminal = values.interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
const save = () => writeFile(out, JSON.stringify(results, null, 2) + "\n");
try {
  for (const entry of cases) {
    const sessionId = randomUUID();
    await repository.createSession({ id: sessionId, circuitId: "circuit-one", createdAt: new Date().toISOString() });
    const run = { caseId: entry.id, sessionId, startedAt: new Date().toISOString(), turns: [],
      status: "running", primaryModel: process.env.GEMINI_REASONING_MODEL || "gemini-3.5-flash",
      fallbackEnabled: process.env.REASONING_FALLBACK_ENABLED === "true" };
    results.runs = results.runs.filter(old => old.caseId !== entry.id); results.runs.push(run); await save();
    let message = [...entry.observations, ...entry.already_tried].join(" ");
    let replyToTurnId = null; const requested = new Set();
    try {
      for (let index = 0; index < maxTurns; index++) {
        const turnId = randomUUID();
        const attemptStart = attempts.length;
        const answer = await service.processUserTurn({ repository, provider: extractor, reasoningProvider: reasoner,
          sessionId, turnId, replyToTurnId, userMessage: message });
        run.turns.push({ turnId, userMessage: message, replyToTurnId, providerAttempts: attempts.slice(attemptStart), ...answer }); await save();
        const result = answer.reasoning;
        console.log(`${entry.id} / ${index + 1} / ${result.kind}: ${result.message}`);
        if (result.recommendation) console.log(result.recommendation.procedure);
        if (result.kind === "cause_unestablished") { run.status = "terminal_uncertainty"; break; }
        if (terminal) {
          message = await terminal.question("Report the result or missing context (empty to stop): ");
          if (!message.trim()) { run.status = "stopped_by_operator"; break; }
        } else if (result.recommendation && !requested.has(result.recommendation.testId)) {
          requested.add(result.recommendation.testId);
          message = bench.cases[entry.id][result.recommendation.testId] || bench.common[result.recommendation.testId];
          if (!message) throw new Error("No simulated report exists for the selected test");
        } else {
          message = "I cannot obtain any further readings, markings, documents, tools, or safe physical access now. Nothing more is available.";
        }
        if (result.recommendation) replyToTurnId = answer.turn.id;
      }
      if (run.status === "running") run.status = "turn_budget_exhausted";
      run.case05Refused = entry.id !== "case-05" || run.turns[0]?.reasoning?.kind === "unsupported_claim";
      run.finishedAt = new Date().toISOString(); await save();
    } catch (error) {
      run.status = "failed"; run.error = error.message; await save(); throw error;
    }
  }
} finally { terminal?.close(); }
console.log(`Inspectable results written to ${out}. Check the reasoning manually; this runner does not certify electronics correctness.`);
