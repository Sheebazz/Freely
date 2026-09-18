# BTLTL-008 — Freely Design Contract

## 1. Evidence vs hypothesis

### Trusted evidence

Trusted evidence is information recorded in the session with known provenance that Freely is allowed to use as evidence for reasoning. A user-reported measurement is trusted as a record of what the user measured, not as independently verified physical truth.

Example: the user reports measuring 5.02 V at the input rail with a multimeter.

### Unverified hypothesis

An unverified hypothesis is a possible explanation or claim that has not yet been supported by enough recorded evidence.

Example: "the regulator is faulty" remains a hypothesis if no measurement or other recorded evidence establishes that fault.
A user claim or model conclusion does not become established merely because it is repeated confidently.

## 2. Session state

### What the session keeps

Freely keeps only the information needed to continue the same troubleshooting investigation across turns:

- the user's reported symptoms and observations
- measurements, together with their source and verification status
- user claims and assumptions, kept separate from established evidence
- model-generated hypotheses, kept separate from established evidence
- tests already recommended
- results the user reports from those tests
- the current verification status of conclusions
- the minimum device or circuit context needed to interpret the session

This allows each response to build on what has already been checked instead of restarting the diagnosis from scratch.

### What the session deliberately does not keep

The BuildIt troubleshooting state does not retain:

- hidden ground-truth answers from evaluation cases
- the model's private reasoning process
- raw voice audio after the required observation has been extracted
- temporary presentation or interface state that does not affect troubleshooting

Unsupported user claims, model conclusions and appearance-based component identities may still be recorded, but only as unverified claims or hypotheses. They are never promoted to established evidence merely because they were stored or repeated.

## 3. Reasoning engine output contract

The reasoning engine may return one of three outcomes for a turn.

### One next test

When the available context is sufficient to continue troubleshooting, the engine returns:

- exactly one recommended next test
- a short reason explaining what that test helps distinguish
- any resulting hypothesis as a hypothesis unless the recorded evidence already supports it
- references to the session evidence the recommendation depends on

It must not return a list of possible tests or present an unsupported cause as established.

### More context required

If an important piece of context is missing and choosing a test would otherwise require guessing, the engine asks for the specific missing information instead of pretending it can continue reliably.

### Uncertainty or refusal

If the available evidence cannot support a reliable conclusion, or the requested conclusion would require guessing, the engine must say that the cause cannot yet be established.

A model-generated conclusion that is not supported by recorded evidence may be returned only as an unverified hypothesis. Its unverified status is attached by the backend rather than left for the model to label itself.

A component identity inferred only from appearance must never be returned as established evidence.

## 4. Circuit independence

The troubleshooting engine must remain independent of any particular circuit. Its responsibilities do not change when a new circuit is introduced.

The following stay circuit-independent:

- how session evidence is recorded and classified
- how claims and hypotheses are kept separate from established evidence
- how the model is given session context
- how one next test is requested
- how unsupported conclusions are handled
- how uncertainty and refusal are represented
- how previous tests and measurements are carried across turns

Adding a new circuit may require:

- a description of the circuit and relevant components or connections
- the context the model needs to reason about that circuit
- evaluation fault cases with hidden ground truth
- expected observations or measurements used to test whether the reasoning loop behaves correctly

Adding a new circuit must not require new fault-specific rules inside the reasoning engine.

If circuit two requires changing the core reasoning behaviour solely because it is circuit two, the abstraction has failed. Circuit-specific information should enter as data and context, while the same reasoning path handles both circuits.

## 5. Model vs backend responsibility

The model reasons about the electronics. The backend governs the troubleshooting record and enforces the rules that must still hold even when the model behaves incorrectly.

### The model is responsible for

- interpreting available symptoms, measurements and circuit context
- forming possible explanations for the fault
- choosing the single most useful next test
- explaining why that test helps narrow the fault
- identifying when more context is needed

### The backend is responsible for

- recording the source and status of evidence, claims and hypotheses
- keeping session state across turns
- preventing unsupported conclusions from becoming established facts
- attaching verification status to claims independently of the model
- enforcing the allowed response contract
- preserving the distinction between circuit data and the generic reasoning engine

A rule is considered enforced only when the backend can still uphold it if the model ignores the instruction. Rules that exist only in the model prompt are requested behaviour, not guarantees.

## 6. Alternatives and trade-offs

The following decisions had reasonable alternatives. Both the chosen approach and the rejected path carry costs.

| Decision                      | Chosen approach                                                                                     | Cost accepted                                                                  | Alternative rejected                                        | Cost of the alternative                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Session memory                | Keep structured session state with provenance for measurements, claims, hypotheses and test results | More backend modelling and validation work                                     | Rely mainly on conversation history and prompt instructions | Faster initially, but evidence and claims can blur together and important rules become harder to enforce  |
| Unsupported model conclusions | Surface them only as backend-marked unverified hypotheses                                           | The user must understand that an unverified hypothesis is not established fact | Reject and retry, or suppress the conclusion                | Retrying adds latency, model cost and possible retry loops; suppression can discard useful reasoning      |
| Reliability rules             | Enforce critical rules in the backend where possible                                                | More application logic and tests                                               | Depend on prompting alone                                   | Simpler to build, but a confident model can ignore the instruction and violate the rule                   |
| Circuit support               | Keep one generic reasoning path and provide circuit-specific information as data and context        | Requires a stronger abstraction up front                                       | Add fault-specific code for each circuit                    | Faster for the first circuit, but creates coupling and requires engine changes as more circuits are added |

## 7. BuildIt speed trade-offs

The BuildIt window forces Freely to prove the reasoning loop before expanding the product around it.

For this sprint:

- the first version uses only two circuits rather than trying to cover many device types
- voice remains a core input layer, but it does not get a separate reasoning path
- the interface is intentionally plain; polish is secondary to proving the loop
- deployment only needs to produce a reachable working address, not a production-grade hosting setup
- file uploads come after the core loop and may be dropped if they threaten the reasoning work
- uploaded images are accepted only as context; the system does not interpret them automatically
- authentication, user accounts, automatic schematic parsing and broader embedded-system features are postponed

Without the BuildIt deadline, the next steps would include stronger observability, broader evaluation coverage, more robust retry and failure handling, richer document and image processing, authentication, and production hardening.

The trade-off is deliberate: this sprint optimizes for a small system whose core behaviour can be tested clearly, rather than a broader product with weaker reasoning guarantees.
