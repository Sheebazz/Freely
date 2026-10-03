const { createHash } = require("crypto");
const { z } = require("zod");
const { readFileSync } = require("fs");
const { join } = require("path");
const { recommendationSchema } = require("../models/reasoning.schema");

const circuitContextSchema = z.object({
  id: z.string().min(1).max(200),
  description: z.object({
    summary: z.string().max(2000).optional(),
    nominal_supply_v: z.number().positive().optional(),
    operating_supply_range_v: z.object({ min: z.number(), max: z.number() }).strict().optional(),
    intended_behaviour: z.string().max(2000).optional(),
    bench_tools: z.array(z.string().max(200)).optional(),
  }).strict(),
  components: z.array(z.object({
    ref: z.string().min(1).max(100), description: z.string().max(1000).optional(),
    nominal_value: z.string().min(1).max(200).optional(),
    tolerance_percent: z.number().min(0).max(100).optional(),
  }).strict()),
  connections: z.array(z.string().min(1).max(1000)),
  observable_features: z.array(z.string()),
  test_points: z.array(z.object({ id: z.string().min(1).max(100), description: z.string().max(1000) }).strict()),
  limitations: z.array(z.string()),
  available_tests: z.array(z.object({
    id: z.string().min(1).max(200),
    mode: z.string().max(100).optional(), tool: z.string(), power_state: z.string(), procedure: z.string(),
    expectedResponseType: z.enum(["measurement", "observation", "test_result"]),
    requestedSubject: z.string(),
    possible_results: z.array(z.object({ result: z.string(), implication: z.string() })),
  }).strict()),
}).strict();

function prepareCircuitContext(circuitId, input) {
  if (input.evaluation_only === true || input.session_access === "forbidden") {
    throw new Error("Evaluation-only data cannot become runtime circuit context");
  }
  // An allowlisted projection, never spread an entire fixture. In particular,
  // fault_cases, planted causes and evaluation files are not model context.
  const context = circuitContextSchema.parse({
    id: circuitId,
    description: Object.fromEntries(["summary", "nominal_supply_v", "operating_supply_range_v",
      "intended_behaviour", "bench_tools"].filter((key) => Object.hasOwn(input.description, key))
      .map((key) => [key, input.description[key]])),
    components: (input.components ?? []).map((component) => Object.fromEntries(
      ["ref", "description", "nominal_value", "tolerance_percent"]
        .filter((key) => Object.hasOwn(component, key)).map((key) => [key, component[key]]))),
    connections: input.connections ?? [],
    observable_features: input.observable_features ?? [],
    test_points: (input.test_points ?? []).map((point) => ({ id: point.id, description: point.description })),
    limitations: input.limitations ?? [],
    available_tests: (input.available_tests ?? []).map((test) => ({
      id: test.id, tool: test.tool, ...(test.mode ? { mode: test.mode } : {}), power_state: test.power_state,
      procedure: test.procedure,
      expectedResponseType: test.expectedResponseType,
      requestedSubject: test.requestedSubject,
      possible_results: test.possible_results ?? [],
    })),
  });
  const tests = new Map();
  for (const test of context.available_tests) {
    if (tests.has(test.id)) throw new Error("Circuit test IDs must be unique");
    tests.set(test.id, recommendationSchema.parse({
      testId: test.id, procedure: test.procedure, tool: test.mode ? `${test.tool} (${test.mode})` : test.tool,
      powerState: test.power_state,
      expectedResponseType: test.expectedResponseType,
      requestedSubject: test.requestedSubject,
    }));
  }
  const hash = createHash("sha256").update(JSON.stringify(context)).digest("hex");
  const sourceId = `${circuitId}:${hash}`;
  if (sourceId.length > 200) throw new Error("Circuit source ID exceeds persistence bound");
  // Only explicit topology/rating data enters established circuit facts.
  // Test implications and diagnostic prose remain reasoning context.
  const facts = context.connections.map((connection, index) => ({
    factType: "topology", subject: `connection-${index + 1}`,
    value: connection, unit: null, content: connection, sourceText: connection,
  }));
  for (const component of context.components) {
    if (typeof component.ref === "string" && typeof component.nominal_value === "string") {
      const content = `${component.ref} nominal rating: ${component.nominal_value}`;
      facts.push({ factType: "rating", subject: component.ref,
        value: component.nominal_value, unit: null, content, sourceText: content });
    }
  }
  if (new Set(facts.map((fact) => fact.subject)).size !== facts.length) {
    throw new Error("Circuit fact subjects must be unique");
  }
  return { context, hash, sourceId, tests, facts };
}

function loadCircuitContext(circuitId) {
  // Explicit runtime registry: never scan data/ or load evaluation documents.
  const registry = JSON.parse(readFileSync(join(__dirname, "../../data/runtime-circuits.json"), "utf8"));
  if (!Object.hasOwn(registry, circuitId)) {
    throw new Error(`No reviewed runtime fixture is registered for circuit ${circuitId}`);
  }
  const file = registry[circuitId];
  if (typeof file !== "string" || !/^[a-z0-9][a-z0-9-]*\.json$/.test(file)
      || /ground-truth|evaluation/.test(file)) {
    throw new Error("Runtime registry must name a circuit fixture in data/, never an evaluation file");
  }
  const fixture = JSON.parse(readFileSync(join(__dirname, "../../data", file), "utf8"));
  return prepareCircuitContext(circuitId, fixture);
}

function prepareUserBoardContext(description) {
  const summary = z.string().min(1).max(2000).refine(v => v.trim().length > 0).parse(description);
  const board = prepareCircuitContext("user-board", { description: { summary },
    limitations: [
      "This description is user-reported, not reviewed circuit topology or verified component identity.",
      "Use only the generic external observation tests supplied here. Never borrow demo topology or invent measurement locations. Do not assume internet lookup has occurred.",
      "Ask for specific obtainable information when useful. These tests only inspect externally visible information on an unplugged device without opening it or touching exposed conductors. A hot, swollen, smoking or damaged battery requires stopping, not further handling.",
    ], available_tests: [
      { id: "read_external_label", tool: "eyes or camera", power_state: "unplugged; no handling of damaged batteries",
        procedure: "With the device unplugged, read the externally visible model and power-input label. Share its exact text or a clear photo; do not open the device or touch conductors.",
        expectedResponseType: "observation", requestedSubject: "externally visible model and power-input label" },
      { id: "inspect_external_condition", tool: "eyes or camera", power_state: "unplugged; no handling of damaged batteries",
        procedure: "From outside the unplugged device, look for visible connector damage, discoloration or swelling. Describe what you can see without opening it or touching conductors. Stop if a battery is hot, swollen or damaged.",
        expectedResponseType: "observation", requestedSubject: "externally visible device condition" },
    ] });
  board.facts = [];
  // The original user-board identity is the description, not a reviewed fixture.
  // Preserve that identity so earlier context chats remain usable after this update.
  const legacyContext = { ...board.context, available_tests: [], limitations: [
    "This description is user-reported, not reviewed circuit topology or verified component identity.",
    "This mode collects context only. There are no reviewed tests for this board. Do not propose a procedure, reuse demo circuit tests or assume internet lookup has occurred.",
    "Ask for specific obtainable information when useful. If a test is needed but none is approved, state the catalogue limitation honestly.",
  ] };
  board.hash = createHash("sha256").update(JSON.stringify(legacyContext)).digest("hex");
  board.sourceId = `user-board:${board.hash}`;
  return board;
}
module.exports = { loadCircuitContext, prepareCircuitContext, prepareUserBoardContext };
