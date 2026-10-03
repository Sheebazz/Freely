import circuitService from "../../src/services/circuitContext.service.js";

export function circuit(id = "circuit-one") {
  return circuitService.prepareCircuitContext(id, {
    description: { summary: "A low-voltage test board", bench_tools: ["digital multimeter"] },
    components: [], connections: [], observable_features: ["LED state"],
    test_points: [{ id: "TP_INPUT", description: "Input relative to GND" }],
    available_tests: [{ id: "read_input", tool: "digital multimeter", power_state: "powered",
      procedure: "Measure TP_INPUT relative to GND.", expectedResponseType: "measurement",
      requestedSubject: "TP_INPUT relative to GND", possible_results: [] }],
    fault_cases: [{ true_cause: "HIDDEN_SENTINEL" }],
    hidden_circuit_facts: { identity: "HIDDEN_SENTINEL" },
  });
}

export function output(kind = "next_test", overrides = {}) {
  return { kind, message: "Check whether power reaches the input.",
    why: "This distinguishes missing input power from a downstream problem.",
    testId: ["next_test", "unsupported_claim"].includes(kind) ? "read_input" : null,
    uncertaintyBasis: kind === "cause_unestablished" ? "evidence_limit" : null,
    supportingItemIds: [], hypotheses: [], ...overrides };
}
