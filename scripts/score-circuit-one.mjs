// Offline scoring only. Never imported by the runtime, server, or walkthrough runner.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import schema from "../src/models/reasoning.schema.js";
const path = process.argv[2];
if (!path) throw new Error("Pass the walkthrough JSON path");
const results = JSON.parse(await readFile(resolve(path), "utf8"));
const scoring = JSON.parse(await readFile(new URL("../data/evaluation/circuit-one-ground-truth.json", import.meta.url), "utf8"));
const rows = scoring.cases.map(entry => {
  const run = results.runs.find(run => run.caseId === entry.id);
  const valid = !!run?.turns.length && run.turns.every(turn => schema.enforcedReasoningResultSchema.safeParse(turn.reasoning).success
    && turn.items.filter(item => item.provenance.actor === "model").every(item => item.category === "hypothesis" && item.verificationStatus === "unverified"));
  return { caseId: entry.id, structuralPass: valid, status: run?.status || "not_run",
    appearanceClaimRefused: entry.id !== "case-05" || run?.turns[0]?.reasoning?.kind === "unsupported_claim",
    scoringOnlyExpectedCause: entry.true_cause, semanticAssessment: "requires human review" };
});
const destination = resolve(path) + ".scoring.json";
await writeFile(destination, JSON.stringify({ evaluation_only: true, rows }, null, 2) + "\n");
console.log(`Offline scoring artifact: ${destination}. Never supply it to a runtime session.`);
