# BTLTL-008 — Freely Design Contract

## 1. Evidence, observations and hypotheses

### Trusted evidence

Trusted evidence is a structured measurement, test result, or trusted circuit fact with recorded provenance that Freely may use during troubleshooting.

Example: the user reports measuring 5.02 V at the input rail. Freely records the value, what was measured, and that it was user-reported; it does not claim the physical reading was independently verified.

A trusted circuit fact must come from context explicitly designated as trustworthy for the session, such as the circuit fixture or verified documentation. An arbitrary user diagnostic claim does not become a trusted circuit fact.

### Reported observation

A reported observation is descriptive user context that has not been independently verified and does not by itself establish component identity or cause.

For example, "there is a dark mark beside the package labelled U3" is an observation. "U3 is burned", "U3 is a regulator", and "U3 has failed" are interpretations and remain unverified claims.

### Unverified hypothesis

An unverified hypothesis is a possible component identity, diagnosis, or causal explanation that has not been established by a trusted source.

Example: "the regulator is faulty" remains a hypothesis even when measurements are consistent with regulator failure.

### Status rule

For BuildIt, user diagnostic claims and model-generated causal or identity conclusions remain unverified hypotheses.

The backend does not decide whether an electronics diagnosis is semantically correct; doing so would recreate the model's reasoning as hand-written fault logic.

Repetition, user confidence, model confidence, or merely consistent evidence cannot promote a diagnostic hypothesis to established fact.

This sprint implements no separate authority for verifying causal diagnoses, so causal and identity hypotheses are not promoted during BuildIt.

## 2. Session state

Freely keeps:

- reported symptoms and observations
- measurements and test results, with provenance
- trusted circuit facts
- user claims and assumptions
- model-generated hypotheses
- tests already recommended
- results reported for those tests
- verification status
- the minimum circuit or device context needed for reasoning

Measurements, observations, claims and hypotheses remain distinct rather than being collapsed into conversation text.

Freely deliberately does not retain:

- hidden ground-truth answers from evaluation cases
- the model's private reasoning process
- raw voice audio after the useful observation has been extracted
- temporary presentation state that does not affect troubleshooting

Hidden evaluation answers must never enter the model's troubleshooting context.

## 3. Reasoning engine output contract

For each turn, the reasoning engine returns exactly one of four outcomes. The backend validates that outcome before treating it as valid troubleshooting output.

### One next test

When enough context exists to continue, the engine returns:

- exactly one recommended next test
- a short reason explaining what the test helps distinguish
- references to the recorded evidence or context used to choose it
- any causal or identity conclusion only as an unverified hypothesis

It must not return a list of competing tests merely to avoid choosing a useful next step.

### More context required

When choosing a useful test would otherwise require guessing, the engine returns:

- the specific missing information
- a short reason explaining why it is needed
- references to relevant recorded context when such context exists

It must not invent a test merely to avoid asking for missing information.

### Refusal with a separating test

When the user asserts a cause that the recorded information does not establish, and a useful safe test can distinguish it from remaining candidates, the engine returns:

- a refusal to treat the asserted cause as established
- exactly one separating next test
- a short reason explaining what the test distinguishes
- references to the recorded evidence or context supporting the refusal and test

Repeating the unsupported claim alone does not change its verification status.

New evidence may change the next diagnostic step, but causal and identity conclusions remain unverified under the BuildIt status rule.

### Bare uncertainty

When the available information cannot establish a cause and no useful test can reliably settle it from the current context, the engine returns:

- a clear statement that the cause cannot currently be established
- a short reason explaining why the available information is insufficient
- references to relevant recorded evidence or context when any exists

If an unsupported assertion cannot be separated by a useful safe test, this is the outcome used instead of refusal-with-test.

The engine must not invent a cause or test simply to sound decisive.

A component identity inferred only from appearance must never be returned as established fact.

## 4. Circuit independence

The troubleshooting engine remains independent of any particular circuit.

The following stay circuit-independent:

- evidence, observation, claim and hypothesis classification
- session-state handling
- the four reasoning outcomes
- refusal and uncertainty behaviour
- provenance and verification-status handling
- continuity across turns

Adding a new circuit may require:

- a circuit description and relevant connections
- trusted circuit facts supplied as context
- evaluation fault cases with hidden ground truth
- expected observations or measurements used to evaluate behaviour

Adding a circuit must not require fault-specific branches inside the reasoning engine.

If circuit two requires changing core reasoning behaviour solely because it is circuit two, the abstraction has failed. Circuit-specific knowledge enters as data and context; the reasoning path remains the same.

## 5. Model and backend responsibility

The model reasons about the electronics. The backend governs the troubleshooting record and enforces structural guarantees.

### The model is responsible for

- interpreting symptoms, measurements and circuit context
- forming diagnostic hypotheses
- choosing the single most useful next test
- explaining why that test helps
- identifying missing context
- recognising when the available information cannot settle the question

### The backend is responsible for

- recording provenance and verification status
- keeping session state across turns
- keeping measurements, observations, claims and hypotheses distinct
- allowing only eligible measurements, test results and trusted circuit facts into trusted-evidence status
- preventing model-generated causal or identity conclusions from assigning themselves established status
- validating that exactly one allowed outcome was returned
- rejecting malformed engine output as invalid troubleshooting output
- preserving the boundary between circuit-specific data and the generic reasoning engine

The backend can enforce structural guarantees. It cannot guarantee that the model's electronics reasoning is correct.

Reasoning quality is evaluated through fault cases whose true causes are kept away from the model.

A rule is enforced only when the backend can uphold it even if the model ignores an instruction. Behaviour that exists only in prompting is requested behaviour, not a system guarantee.

## 6. Alternatives and trade-offs

| Decision                | Chosen approach                                                                                             | Cost accepted                                                    | Alternative rejected                                  | Cost of alternative                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Evidence eligibility    | Only structured measurements, test results and explicitly trusted circuit facts may become trusted evidence | More explicit classification and validation                      | Treat all user statements with provenance as evidence | Appearance-based or diagnostic claims could silently enter the evidence record           |
| Session memory          | Keep structured troubleshooting state with provenance                                                       | More backend modelling                                           | Rely mainly on conversation history and prompting     | Evidence, observations and claims can blur across turns                                  |
| Diagnostic status       | Keep causal and identity conclusions unverified throughout BuildIt                                          | Even a likely correct diagnosis remains labelled as a hypothesis | Promote diagnoses after an evidence threshold         | Requires a trustworthy domain-verification rule this sprint does not implement           |
| Unsupported conclusions | Preserve them only as clearly unverified hypotheses                                                         | User must understand that unverified is not established          | Retry or suppress them                                | Retry adds latency, model cost and loop risk; suppression can discard useful reasoning   |
| Engine responses        | Restrict the engine to four defined outcomes                                                                | Less model freedom and more validation                           | Pass arbitrary model text through                     | Downstream tickets would invent behaviour independently and guarantees become unreliable |
| Circuit support         | One generic reasoning path with circuit-specific data and context                                           | Stronger abstraction required up front                           | Add fault-specific engine logic per circuit           | Faster initially but creates coupling and repeated engine changes                        |
| Voice path              | Send spoken observations through the same path as typed observations                                        | Requires transcription and normalisation                         | Build a separate voice reasoning path                 | Duplicates logic and allows voice and text behaviour to drift                            |
| Voice retention         | Discard raw audio after extracting the useful observation                                                   | Cannot re-transcribe or audit the recording later                | Retain raw audio                                      | Adds storage, privacy, retention and security work the sprint does not require           |

## 7. BuildIt speed trade-offs

For this sprint:

- two circuits are enough to test generalisation
- voice remains core but shares the typed reasoning path
- the interface stays deliberately plain
- deployment only needs one reachable working address
- file uploads come after the core loop and are first to drop if the schedule slips
- uploaded images may be stored as context, but Freely does not interpret them automatically
- authentication, user accounts, automatic schematic parsing and broader embedded-system features are postponed

Without the BuildIt deadline, the next version would add broader evaluation, stronger observability, more robust invalid-output recovery, richer document and image processing, authentication and production hardening.

The deliberate trade-off is breadth for a smaller system whose reasoning behaviour can be tested clearly and whose trust boundaries are explicit.
