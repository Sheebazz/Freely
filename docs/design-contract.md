# BTLTL-008 — Freely Design Contract

## 1. Evidence, observations and hypotheses

### Trusted evidence

Trusted evidence is a structured measurement, test result, or known circuit fact with recorded provenance that Freely may use as evidence during troubleshooting.

Example: the user reports a multimeter reading of 5.02 V at the input rail. Freely records the value, what was measured, and that the measurement was user-reported. It does not claim that the physical reading was independently verified.

### Reported observation

A reported observation is descriptive context supplied by the user that has not been independently verified and does not by itself establish a component identity or cause.

Example: "there is a dark mark beside the package labelled U3" may be kept as a reported observation.

Free-text observations are useful context, but they are not automatically promoted to trusted evidence.

### Unverified hypothesis

An unverified hypothesis is a possible component identity, diagnosis, or causal explanation that has not been established by a trusted verification source.

Example: "U3 is burned", "U3 is a regulator", or "the regulator is faulty" remains an unverified hypothesis unless that information already exists as a known circuit fact.

The boundary is deliberate: describing what was measured or visibly observed is different from interpreting what that observation means.

### Status rule

For the BuildIt version, user diagnostic claims and model-generated causal or identity conclusions remain unverified hypotheses.

The backend does not attempt to decide whether the model's electronics diagnosis is semantically correct. Doing so would require rebuilding the model's reasoning as hand-written fault logic.

Repetition, user confidence, model confidence, or evidence that is merely consistent with a hypothesis cannot promote that hypothesis to established fact.

This sprint does not implement a separate authority capable of verifying causal diagnoses. Therefore causal and identity hypotheses are not promoted during BuildIt.

## 2. Session state

Freely keeps only the information needed to continue the same troubleshooting investigation across turns:

- reported symptoms and observations
- measurements and test results, with their provenance
- known circuit facts supplied as trusted context
- user claims and assumptions
- model-generated hypotheses
- tests already recommended
- results reported for those tests
- the verification status of stored information
- the minimum device or circuit context needed for reasoning

Measurements, observations, claims and hypotheses remain distinct in the session rather than being collapsed into conversation text.

The BuildIt session deliberately does not retain:

- hidden ground-truth answers from evaluation cases
- the model's private reasoning process
- raw voice audio after the useful observation has been extracted
- temporary presentation or interface state that does not affect troubleshooting

Hidden evaluation answers must never enter the model's troubleshooting context.

## 3. Reasoning engine output contract

For each turn, the reasoning engine returns exactly one of four outcomes. The backend validates the outcome before treating it as valid troubleshooting output.

### One next test

When there is enough context to continue troubleshooting, the engine returns:

- exactly one recommended next test
- a short reason explaining what the test helps distinguish
- references to the recorded evidence or context used to choose the test
- any causal or identity conclusion only as an unverified hypothesis

It must not return a list of competing tests merely to avoid choosing the most useful next step.

### More context required

When choosing a useful test would require guessing because important context is missing, the engine returns:

- the specific information that is missing
- a short reason explaining why that information is needed
- references to relevant recorded context when such context exists

It must not invent a test merely to avoid asking for missing information.

### Refusal with a separating test

When the user asserts a cause that the recorded information does not establish, and a useful safe test can distinguish that cause from remaining candidates, the engine returns:

- a refusal to treat the asserted cause as established
- exactly one separating next test
- a short reason explaining what the test distinguishes
- references to the recorded evidence or context supporting the refusal and test

Repeating the unsupported claim does not change this outcome unless new relevant evidence is added to the session.

### Bare uncertainty

When the available information cannot establish a cause and no useful test can reliably settle the question from the current context, the engine returns:

- a clear statement that the cause cannot currently be established
- a short reason explaining why the available information is insufficient
- references to the relevant recorded evidence or context when any exists

The engine must not invent a cause or a test simply to sound decisive.

A component identity inferred only from appearance must never be returned as established fact.

## 4. Circuit independence

The troubleshooting engine remains independent of any particular circuit.

The following stay circuit-independent:

- the distinction between evidence, observations, claims and hypotheses
- session-state handling
- the four allowed reasoning outcomes
- refusal and uncertainty behaviour
- provenance and verification-status handling
- continuity across troubleshooting turns

Adding a new circuit may require:

- a description of the circuit and relevant connections
- known circuit facts supplied as context
- evaluation fault cases with hidden ground truth
- expected observations or measurements used to evaluate the loop

Adding a new circuit must not require fault-specific branches inside the reasoning engine.

If circuit two requires changing core reasoning behaviour solely because it is circuit two, the abstraction has failed. Circuit-specific knowledge enters as data and context; the reasoning path remains the same.

## 5. Model and backend responsibility

The model reasons about the electronics. The backend governs the troubleshooting record and enforces structural guarantees.

### The model is responsible for

- interpreting symptoms, measurements and circuit context
- forming diagnostic hypotheses
- choosing the single most useful next test
- explaining why that test helps narrow the fault
- identifying when important context is missing
- recognising when the available information cannot settle the question

### The backend is responsible for

- recording provenance and verification status
- keeping session state across turns
- keeping measurements, observations, claims and hypotheses distinct
- allowing only eligible structured measurements, test results and known circuit facts to occupy trusted-evidence status
- preventing model-generated causal or identity conclusions from assigning themselves established status
- validating that the engine returned exactly one allowed outcome
- rejecting malformed engine output as invalid troubleshooting output
- preserving the boundary between circuit-specific data and the generic reasoning engine

The backend can enforce structural guarantees. It cannot guarantee that the model's electronics reasoning is correct.

That reasoning is evaluated through fault cases whose true causes are kept away from the model.

A rule is enforced only when the backend can uphold it even if the model ignores an instruction. Behaviour that depends only on the model following a prompt is requested behaviour, not a system guarantee.

## 6. Alternatives and trade-offs

| Decision                | Chosen approach                                                                                                                                     | Cost accepted                                                                  | Alternative rejected                                     | Cost of the alternative                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence eligibility    | Only structured measurements, test results and known circuit facts are eligible for trusted-evidence status; free-text observations remain separate | More explicit state and input handling                                         | Treat all user statements with provenance as evidence    | Simpler, but diagnostic or appearance-based claims can silently enter the evidence record                                                   |
| Session memory          | Keep structured troubleshooting state with provenance                                                                                               | More backend modelling and validation                                          | Rely mainly on conversation history and prompting        | Faster initially, but evidence, observations and claims can blur across turns                                                               |
| Diagnostic status       | Keep user and model causal or identity conclusions unverified throughout BuildIt                                                                    | Even a likely correct diagnosis remains labelled as a hypothesis               | Promote diagnoses after an evidence threshold is reached | Requires a trustworthy domain-verification rule that this sprint does not implement; inventing one would turn backend code into fault logic |
| Unsupported conclusions | Preserve them only as clearly unverified hypotheses                                                                                                 | The user must understand that unverified does not mean established             | Retry the model or suppress the conclusion               | Retry adds latency, model cost and possible loops; suppression can discard useful reasoning                                                 |
| Engine responses        | Restrict the engine to four defined outcomes                                                                                                        | Less model freedom and more backend validation                                 | Pass arbitrary model text through                        | Simpler initially, but later tickets must invent response behaviour independently and structural guarantees become unreliable               |
| Invalid engine output   | Reject it as valid troubleshooting output                                                                                                           | Failure handling is required instead of displaying whatever the model produced | Pass malformed output through                            | Fewer backend checks, but the response contract becomes a request rather than a guarantee                                                   |
| Circuit support         | Keep one generic reasoning path and provide circuit-specific information as data and context                                                        | Requires a stronger abstraction up front                                       | Add fault-specific engine logic per circuit              | Faster for one circuit, but creates coupling and repeated engine changes as coverage grows                                                  |
| Voice path              | Send spoken observations through the same reasoning path as typed observations                                                                      | Requires transcription and normalisation before reasoning                      | Build a separate voice reasoning path                    | Duplicates logic and allows spoken and typed troubleshooting behaviour to drift apart                                                       |
| Voice retention         | Discard raw audio after extracting the useful observation                                                                                           | The original recording cannot later be re-transcribed or audited               | Retain raw audio in the troubleshooting session          | Adds storage, privacy, retention and security work that the BuildIt reasoning loop does not require                                         |

## 7. BuildIt speed trade-offs

The BuildIt window prioritises proving the reasoning loop over broad product scope.

For this sprint:

- two circuits are enough to test whether the engine generalises
- voice remains a core input layer but shares the typed reasoning path
- the interface stays deliberately plain
- deployment only needs one reachable working address
- file uploads come after the core loop and are the first feature to drop if the schedule slips
- uploaded images may be stored as context, but Freely does not interpret them automatically
- authentication, user accounts, automatic schematic parsing and broader embedded-system features are postponed

Without the BuildIt deadline, the next version would add broader evaluation coverage, stronger observability, more robust recovery from invalid model output, richer document and image processing, authentication and production hardening.

The deliberate trade-off is breadth for a smaller system whose core reasoning behaviour can be tested clearly and whose trust boundaries are explicit.
