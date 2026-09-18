# BTLTL-008 — Freely Design Contract

## 1. Evidence vs hypothesis

### Trusted evidence

Trusted evidence is a recorded observation, measurement, test result, or system-verified fact with known provenance that Freely may use when reasoning about the fault.

A user's diagnostic claim is not trusted evidence merely because the user stated it.

Example: the user reports measuring 5.02 V at the input rail with a multimeter. Freely may treat that as a recorded measurement, while still recognising that it is user-reported rather than independently verified.

### Unverified hypothesis

An unverified hypothesis is a possible explanation or diagnostic claim that has not yet been directly supported by sufficient trusted evidence.

Example: "the regulator is faulty" remains a hypothesis if no measurement or test result establishes that fault.

A user claim or model conclusion does not become established merely because it is repeated confidently.

### Promotion rule

Measurements, observations and test results may become trusted evidence when their source and provenance are recorded.

User diagnostic claims and model-generated causal conclusions do not become trusted evidence merely because evidence is attached to them.

For the BuildIt version, model-generated fault conclusions remain hypotheses. The backend does not attempt to decide whether an electronics diagnosis is semantically correct, because doing so would require rebuilding the model's reasoning as hand-written fault logic.

The backend instead guarantees that the model cannot promote its own conclusion to established fact. It preserves the conclusion as a hypothesis, records the evidence it relies on, and keeps its verification status separate from the model's wording.

Repetition, model confidence and user confidence never change that status on their own.

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

The reasoning engine returns one of four outcomes for a turn. The backend validates the returned outcome before it is shown or recorded.

### One next test

When the available context is sufficient to continue troubleshooting, the engine returns:

- exactly one recommended next test
- a short reason explaining what that test helps distinguish
- any model-generated conclusion only as a hypothesis
- references to the recorded evidence used to choose the test

The backend alone assigns the verification status of any returned hypothesis.

The engine must not return a list of possible tests or present an unsupported cause as established.

### More context required

If choosing a useful test would require guessing because important context is missing, the engine returns:

- the specific information that is missing
- a short reason explaining why that information is needed
- - references to relevant recorded context when such context exists

It must not invent a test merely to avoid asking for missing information.

### Refusal with a separating test

If the user asks Freely to accept a cause that the recorded evidence does not support, and a useful safe test can distinguish that cause from the remaining candidates, the engine returns:

- a refusal to treat the asserted cause as established
- exactly one separating next test
- a short reason explaining what the test distinguishes
- references to the recorded evidence supporting the refusal and test

Repeating the unsupported claim does not change this outcome unless new trusted evidence is added to the session.

### Bare uncertainty

If the available evidence cannot establish a cause and no useful test can reliably settle the question from the current context, the engine returns:

- a clear statement that the cause cannot currently be established
- a short reason explaining why the available evidence is insufficient
- references to the relevant recorded evidence that failed to settle the question

The engine must not invent a cause or a test simply to produce a more decisive answer.

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
- promoting a hypothesis to established only when the contract's promotion rule is satisfied

A rule is considered enforced only when the backend can still uphold it if the model ignores the instruction.

The backend can enforce structural guarantees such as provenance, verification status, session persistence and allowed response shapes. It cannot guarantee that the model's electronics reasoning is correct. The quality of that reasoning is evaluated through the hidden-ground-truth fault cases.

Instructions that depend on the model's judgment rather than backend validation are requested behaviour, not guarantees, and are treated as such in this BuildIt version.

If the model returns something outside the allowed response contract, the backend treats it as an invalid engine response rather than exposing it as a valid troubleshooting result.

## 6. Alternatives and trade-offs

The following decisions had reasonable alternatives. Both the chosen approach and the rejected path carry costs.

| Decision                      | Chosen approach                                                                                                        | Cost accepted                                                                  | Alternative rejected                                        | Cost of the alternative                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Session memory                | Keep structured session state with provenance for measurements, claims, hypotheses and test results                    | More backend modelling and validation work                                     | Rely mainly on conversation history and prompt instructions | Faster initially, but evidence and claims can blur together and important rules become harder to enforce                             |
| Unsupported model conclusions | Surface them only as backend-marked unverified hypotheses                                                              | The user must understand that an unverified hypothesis is not established fact | Reject and retry, or suppress the conclusion                | Retrying adds latency, model cost and possible retry loops; suppression can discard useful reasoning                                 |
| Reliability rules             | Enforce critical rules in the backend where possible                                                                   | More application logic and tests                                               | Depend on prompting alone                                   | Simpler to build, but a confident model can ignore the instruction and violate the rule                                              |
| Circuit support               | Keep one generic reasoning path and provide circuit-specific information as data and context                           | Requires a stronger abstraction up front                                       | Add fault-specific code for each circuit                    | Faster for the first circuit, but creates coupling and requires engine changes as more circuits are added                            |
| Voice retention               | Discard raw audio after the required observation has been extracted, while retaining the resulting session information | Loses the ability to re-transcribe or audit the original recording later       | Retain raw audio as part of the troubleshooting session     | Adds storage, privacy, retention and security concerns for data the BuildIt reasoning loop does not require                          |
| Voice path                    | Convert spoken input into the same troubleshooting input path used by typed observations                               | Requires a reliable transcription/normalisation step before reasoning          | Build a separate reasoning path for voice                   | May be quicker to prototype independently, but duplicates logic and allows typed and spoken troubleshooting behaviour to drift apart |
| Engine responses              | Restrict the reasoning engine to the defined troubleshooting outcomes                                                  | Requires validation and makes the model less free-form                         | Pass arbitrary model text directly to the interface         | Simpler initially, but the backend cannot reliably enforce one-test, refusal and uncertainty behaviour                               |

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
