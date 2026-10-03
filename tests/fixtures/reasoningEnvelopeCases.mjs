export function reasoningEnvelopeCases(valid) {
  return [
    ["valid", valid],
    ["null", null],
    ["invalid uncertainty basis", { ...valid, uncertaintyBasis: "no_idea" }],
    ["scalar", 12],
    ["missing explanation", { ...valid, why: undefined }],
    ["numeric explanation", { ...valid, why: 12 }],
    ["unicode blank message", { ...valid, message: "\u00a0\u3000\ufeff" }],
    ["oversized message", { ...valid, message: "x".repeat(4001) }],
    ["unicode message boundary", { ...valid, message: "😀".repeat(4000) }],
    ["unknown kind", { ...valid, kind: "definitive_diagnosis" }],
    ["extra authority field", { ...valid, established: true }],
    ["null item ref", { ...valid, supportingItemIds: [null] }],
    ["malformed item ref", { ...valid, supportingItemIds: ["not-an-id"] }],
    ["scalar recommendation", { ...valid, recommendation: "read_input" }],
    ["missing procedure", { ...valid, recommendation: { ...valid.recommendation, procedure: undefined } }],
    ["wrong response type", { ...valid, recommendation: { ...valid.recommendation, expectedResponseType: "diagnosis" } }],
    ["extra recommendation field", { ...valid, recommendation: { ...valid.recommendation, verificationStatus: "established" } }],
    ["no recommendation", { ...valid, kind: "cause_unestablished", recommendation: null, uncertaintyBasis: "evidence_limit" }],
    ["menu in message", { ...valid, message: "1. Measure supply\n2. Check reset" }],
    ["unicode whitespace menu", { ...valid, message: "\u00a0- Measure supply\n\u00a0- Check reset" }],
    ["multiple recommendations", { ...valid, recommendation: [valid.recommendation, valid.recommendation] }],
    ["context with no test", { ...valid, kind: "context_required", recommendation: null }],
    ["refusal with no separating test", { ...valid, kind: "unsupported_claim", recommendation: null }],
    // Historical reader accepts this; new writes must reject it.
    ["outcome consistency deferred", { ...valid, kind: "context_required" }],
  ];
}
