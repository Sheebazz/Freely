# BuildIt Challenge — Rules, Evidence Map and Current Gap

**Ticket:** BTLTL-001  
**Project:** Freely  
**Recorded on:** 21 September 2026  
**Rules source:** BuildIt Challenge Rules, About and Small Print pages inside the Blacksmith Experience challenge interface.

## Purpose

This document records the BuildIt Challenge rules that directly affect the current Freely sprint.

It has four purposes:

1. record the challenge requirements somewhere visible to the team;
2. state the current qualification position using confirmed numbers;
3. map every sprint ticket to the visible engineering evidence it is expected to produce;
4. record anything that is still unclear instead of filling the gap with assumptions.

This document does not assume that every ticket, pull request, review or competency signal earns a fixed number of points. Where the challenge does not expose an exact scoring conversion, that limitation is stated explicitly.

---

# 1. Challenge window

BuildIt scoring runs from:

**14 September 2026 to 27 September 2026**

Scoring closes at:

**27 September 2026, 11:59 PM GMT+1**

Freely is being built from Nigeria.

Nigeria uses:

**West Africa Time — WAT — UTC/GMT+1**

Therefore the local deadline is also:

**27 September 2026, 11:59 PM WAT**

There is no timezone difference between the challenge deadline and the local working timezone for this project.

---

# 2. Qualification requirements

The challenge requires both of the following:

1. signals in at least **4 of the 8 competencies**;
2. a total challenge score of **more than 500 points**.

Because the rule says **more than 500**, the minimum qualifying score is:

**501 points**

The eight competencies are:

- Technical Depth
- System Design
- Production Sense
- Judgment
- Ownership
- Communication
- Code Review
- Mentorship

These are separate from the engineering level shown on the Growth page.

A higher engineering level does not replace either BuildIt qualification requirement.

---

# 3. Evidence recognised by the challenge

The challenge states that scoring can draw from visible engineering work such as:

- tickets;
- pull requests;
- code reviews;
- design notes;
- calls;
- and other visible engineering work recorded through the Blacksmith project.

For this sprint, visible evidence is therefore treated as part of the engineering work rather than something written after implementation is complete.

The intention is not to create unnecessary documentation.

The intention is to ensure that important decisions, implementation work, reviews, trade-offs and demonstrations are visible enough to be evaluated.

---

# 4. Mandatory challenge requirements

The following requirements are mandatory regardless of the competency and point totals:

- attendance at Demo Day;
- publication of a public post about the project;
- use of `#BuildItChallenge`;
- submission of the public-post link through the challenge share task.

The public post and Demo Day are not treated as optional stretch work.

BTLTL-007 is responsible for:

- the final runbook;
- the public write-up;
- submission of the required public-post evidence;
- and demo rehearsal.

BTLTL-009 is responsible for producing a live address that another person can open without installing Freely locally.

---

# 5. Current qualification position

## 5.1 Competency coverage

The BuildIt requirement is:

**at least 4 competencies with signals**

The latest confirmed team record states that Freely already has signals across:

**8 competencies**

Therefore:

**Required:** 4 competencies  
**Current confirmed:** 8 competencies  
**Shortfall:** 0 competencies

The competency-count threshold is currently satisfied.

This does not mean every competency has the same signal strength or that all calibration activity is complete.

It only means the minimum requirement of signals across at least four competencies has already been crossed.

---

## 5.2 Challenge points

The BuildIt requirement is:

**more than 500 points**

The minimum qualifying score is therefore:

**501 points**

The current confirmed challenge score is:

**269 points**

The remaining numerical gap is:

`501 - 269 = 232`

Therefore:

**Current point shortfall: 232 points**

This calculation uses the score currently shown by the challenge system rather than an estimated future score.

---

## 5.3 Engineering level and review state

The current engineering level is:

**Level 2**

Some competency signals may still appear in review or calibration workflows with Adaeze.

Those review states are not treated in this document as challenge points waiting to be awarded.

The challenge points are already reflected in the confirmed score shown by the platform.

The remaining reviews are used for purposes such as:

- validating competency signals;
- calibration;
- clearing competency evidence;
- and engineering-level progression.

Therefore this document does not add a separate pool of "pending points" to the current 269-point score.

The current confirmed challenge score remains:

**269 points**

until the challenge interface itself shows a different total.

---

# 6. Sprint execution order

Ticket numbers do not represent execution order.

The agreed execution sequence for this sprint is:

1. **BTLTL-008 — Design contract**
2. **BTLTL-001 — Put the BuildIt rules on record**
3. **BTLTL-002 — Circuit one as data**
4. **BTLTL-003 — Session memory and evidence**
5. **BTLTL-004 — One next test, refusal and honesty**
6. **BTLTL-005 — Circuit two through the same engine**
7. **BTLTL-006 — Voice**
8. **BTLTL-009 — Going Live**
9. **BTLTL-010 — File Uploads**
10. **BTLTL-007 — Runbook, public write-up and demo rehearsal**

BTLTL-008 has already produced its engineering artefact and merged pull request.

BTLTL-001 records the challenge constraints before the remaining implementation work continues.

---

# 7. Sprint evidence map

Each sprint ticket is mapped below to the visible evidence it is expected to produce.

| Ticket    | Work                                        | Expected visible evidence                                                                                            |
| --------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| BTLTL-008 | Design contract                             | design document, PR #1, review rounds, walkthrough discussion and recorded architectural trade-offs                  |
| BTLTL-001 | BuildIt rules on record                     | this document, ticket discussion, PR and review                                                                      |
| BTLTL-002 | Circuit one as data                         | circuit-data changes, commits, implementation PR, ticket discussion and review                                       |
| BTLTL-003 | Session memory and evidence                 | implementation PR, state-model decisions, tests, ticket discussion and review                                        |
| BTLTL-004 | One next test, refusal and honesty          | reasoning-engine implementation, behaviour tests, PR, ticket discussion and review                                   |
| BTLTL-005 | Circuit two through the same engine         | second-circuit data, generalisation evidence, PR and review                                                          |
| BTLTL-006 | Voice                                       | voice-input implementation, PR, review and evidence that voice uses the same reasoning path as typed input           |
| BTLTL-009 | Going Live                                  | deployment work, reachable URL, deployment evidence and repository changes where required                            |
| BTLTL-010 | File Uploads                                | upload implementation, PR, review and evidence that uploaded material does not automatically become trusted evidence |
| BTLTL-007 | Runbook, public write-up and demo rehearsal | runbook, public-post evidence, link submission, live-system rehearsal and demo notes                                 |

The existence of an artefact does not automatically guarantee a particular number of challenge points.

The table records where visible evidence is expected to come from.

---

# 8. Freely evidence categories for the BuildIt MVP

Freely needs a concrete definition of the information it accepts during troubleshooting.

Terms such as "strong evidence", "good evidence" or "verified information" are not sufficient on their own.

The BuildIt implementation therefore uses explicit categories.

---

## 8.1 Structured measurements

A structured measurement records:

- what quantity was measured;
- the reported value or result;
- where the measurement was taken;
- the test condition where relevant;
- and the source of the report.

Examples include:

- multimeter voltage readings;
- resistance readings;
- continuity results;
- current readings where the test is appropriate and safe;
- and results from a defined diagnostic procedure.

Example:

`Input rail measured at 5.02 V with respect to ground`

is stored differently from:

`I think the regulator is faulty`.

The first is a reported measurement.

The second is a diagnostic claim.

A user-reported measurement is recorded as user-reported.

Freely does not claim that it independently observed the physical meter.

---

## 8.2 Test results

A test result records the result of a specific diagnostic action.

Examples include:

- continuity present between two named points;
- continuity absent between two named points;
- expected input voltage present;
- expected output voltage absent;
- resistance measured across a defined component or path;
- or another explicitly defined diagnostic result.

The stored result must retain enough context to identify what was actually tested.

A bare statement such as:

`It failed`

is not sufficient without knowing what test was performed.

---

## 8.3 Trusted circuit facts

A trusted circuit fact comes from context explicitly accepted as authoritative for the troubleshooting session.

For this MVP, examples include:

- facts defined by the BuildIt evaluation fixture;
- the known circuit description for an evaluation case;
- a schematic verified as belonging to the exact circuit, board or revision being examined;
- board documentation verified as belonging to the exact board or revision;
- and component documentation where the component identity has already been established.

A schematic for a merely similar board is not automatically trusted.

Documentation for an unconfirmed revision is not automatically trusted.

A datasheet for a component whose identity has not been established does not itself establish that identity.

---

## 8.4 Reported observations

An observation describes what the user reports seeing, hearing or otherwise noticing.

Examples include:

- `there is a dark mark beside U3`;
- `the package has eight pins`;
- `the board label beside the component reads U3`;
- `the component marking appears to read NE555`;
- `the motor does not turn`;
- `the LED does not light`.

These observations may help the model choose what to ask or test next.

They do not automatically establish:

- component identity;
- component function;
- component failure;
- circuit topology;
- or root cause.

---

## 8.5 User diagnostic claims

A diagnostic claim is an interpretation supplied by the user.

Examples include:

- `the regulator is bad`;
- `that IC is a 555`;
- `the transistor has failed`;
- `the battery is the problem`.

These remain unverified unless the system has an allowed route for establishing the underlying fact.

For the BuildIt MVP, causal diagnoses and model-generated component identities remain hypotheses rather than being promoted to established diagnoses.

---

## 8.6 Model-generated hypotheses

The model may form possible explanations from the available evidence.

Examples include:

- a missing supply path;
- an open connection;
- a possible switching failure;
- a possible component identity.

These remain hypotheses.

The model's confidence does not change their verification status.

---

# 9. What cannot promote a claim to established fact

The following do not promote a diagnostic or identity claim into established fact:

- model confidence;
- confident wording;
- user confidence;
- repetition by the user;
- repetition by the model;
- visual resemblance;
- component size or shape alone;
- colour alone;
- an image by itself;
- a schematic for a similar but unconfirmed board;
- documentation for an unconfirmed board revision;
- a datasheet attached to a component whose identity has not been established;
- evidence that is merely consistent with a hypothesis.

The backend owns verification status.

The model may use uncertain information while reasoning, but it cannot assign established status to its own causal or identity conclusion.

---

# 10. BTLTL-002 — Circuit one as data

The first circuit must enter Freely as data and context rather than as hard-coded troubleshooting logic.

The implementation must keep these concepts separate:

- circuit description;
- trusted circuit facts;
- evaluation fault data;
- expected observations or measurements used for evaluation;
- generic reasoning behaviour.

Circuit-specific information belongs in circuit data or context.

The core reasoning engine must not contain special logic such as:

`if circuit_one_fault_three, recommend test X`

merely to make the evaluation case pass.

The purpose of this ticket is to establish the first circuit representation that later tickets can reason over.

---

# 11. BTLTL-003 — Session memory and evidence

Freely must maintain structured troubleshooting state across turns.

The session must keep these categories distinct:

- reported symptoms;
- reported observations;
- structured measurements;
- test results;
- trusted circuit facts;
- user assumptions and claims;
- model-generated hypotheses;
- previously recommended tests;
- reported results of those tests;
- verification status;
- and the minimum circuit/device context required for reasoning.

The backend is responsible for maintaining these distinctions.

The backend is also responsible for verification status.

The model does not decide that its own conclusion has become established merely because its output sounds confident.

---

# 12. BTLTL-004 — One next test, refusal and honesty

The reasoning engine must not respond to uncertainty by producing a large list of possible causes and tests.

When enough context exists, it should choose exactly one useful next diagnostic step.

When the user asserts a cause that the recorded information does not establish, Freely must not silently agree.

If a useful and safe test can separate the asserted cause from remaining possibilities, Freely should return:

- a refusal to treat the asserted cause as established;
- exactly one separating next test;
- a short explanation of what the test distinguishes;
- and references to the recorded evidence or context used in choosing it.

If the user repeats the unsupported assertion without supplying new relevant evidence, repetition does not change its verification status.

When the available information cannot establish a cause and no useful safe test can settle it from the current context, Freely should state that the cause cannot currently be established rather than inventing certainty.

---

# 13. BTLTL-005 — Circuit two through the same engine

Circuit two is the generalisation test.

It may introduce new:

- circuit descriptions;
- circuit-specific data;
- trusted circuit facts;
- evaluation fault cases;
- expected observations;
- and expected measurements.

It must not require new fault-specific branches inside the generic reasoning engine merely because the circuit is different.

The same reasoning path used for circuit one must handle circuit two.

If the implementation requires rewriting the reasoning engine specifically for circuit two, the intended abstraction has failed.

---

# 14. BTLTL-006 — Voice

Voice is an input method.

It is not a second troubleshooting engine.

Spoken input must be converted into information that enters the same:

- classification path;
- evidence path;
- session-state path;
- and reasoning path

used by typed input.

Example:

If a user says:

`I'm reading 4.98 volts at the input`

the useful information should enter the troubleshooting session as the same kind of structured measurement that would have been produced by typed input.

Voice must not receive separate diagnostic rules merely because the input came from speech.

Raw audio does not need to remain in troubleshooting state after the useful information has been extracted for the BuildIt MVP.

---

# 15. BTLTL-009 — Going Live

Going Live requires a reachable instance of Freely.

Completion means that another person can open a URL and use the BuildIt demonstration without installing the project locally.

The BuildIt deployment does not require:

- production-scale infrastructure;
- a polished commercial interface;
- complex scaling;
- or production authentication.

The required outcome is:

**one reachable working address suitable for the challenge demonstration.**

If deployment work must be reduced because of time pressure, it should shrink to the simplest reliable deployment rather than being removed.

---

# 16. BTLTL-010 — File Uploads

File Uploads is lower priority than:

- session memory;
- reasoning/refusal behaviour;
- circuit-two generalisation;
- voice;
- and Going Live.

Uploaded files may enter Freely as context.

An upload does not automatically establish:

- component identity;
- component function;
- component failure;
- root cause;
- or circuit topology.

An uploaded image may provide observations such as:

- visible board labels;
- reference designators;
- readable markings;
- visible damage;
- or package characteristics.

Those observations remain distinct from established identity or diagnosis.

An uploaded schematic or document may become trusted circuit context only when its relationship to the exact board, circuit, revision or component has been established.

If the schedule becomes insufficient, File Uploads is the first feature allowed to drop.

---

# 17. BTLTL-007 — Runbook, public write-up and demo rehearsal

The final ticket must make the BuildIt demonstration reproducible.

It includes:

- instructions for using the live system;
- the public BuildIt post;
- `#BuildItChallenge`;
- submission of the required public-post link;
- rehearsal against the deployed address;
- and final demonstration cases.

The rehearsal should happen before the final possible evening.

The purpose is to leave enough time to correct:

- deployment failures;
- reasoning failures;
- voice failures;
- broken demo cases;
- or missing challenge requirements.

---

# 18. Current BTLTL-008 walkthrough defect

BTLTL-008 produced:

- the Freely Design Contract;
- PR #1;
- multiple review rounds;
- a clean approved review;
- and a manually completed walkthrough question with Lars.

The platform walkthrough panel failed to generate Lars's question.

Lars confirmed that:

- no question was waiting on his side;
- he had no control for re-running the walkthrough;
- and he could not close the walkthrough stage.

Maya attempted to close the ticket.

The platform rejected the close because it still believed the walkthrough question had not been answered inside the walkthrough panel.

Lars then asked the walkthrough question manually.

The answer was recorded on the ticket thread and Lars confirmed that the substance held up against the design contract.

Adaeze documented the complete mismatch on the ticket.

Therefore:

**the engineering work is complete, while the platform walkthrough state remains defective.**

The defect is not treated as unfinished engineering work.

---

# 19. Catalogue behaviour

Going Live and File Uploads are implemented as normal tickets within the current sprint.

The catalogue interface showed the following behaviour when Going Live was selected:

it prepared a message asking Adaeze whether the **next sprint** should be planned around the catalogue feature.

That confirms that the catalogue action does not behave like a simple "add this capability to the current ticket list" control.

The current sprint therefore does not depend on activating Going Live or File Uploads through the catalogue interface.

Their implementation is tracked through BTLTL-009 and BTLTL-010.

---

# 20. Known scoring uncertainty

The challenge clearly identifies:

- competency signals;
- visible work;
- and the >500-point threshold.

However, the exact conversion between individual engineering artefacts and challenge points is not fully exposed.

For example, the current record does not establish a fixed rule such as:

- one PR = a fixed number of points;
- one review = a fixed number of points;
- one ticket = a fixed number of points;
- or one competency signal = a fixed number of points.

This document therefore does not invent such conversions.

The challenge interface's displayed score is treated as authoritative for the current confirmed total.

As of 21 September 2026:

**Confirmed score: 269 points**

**Minimum qualifying score: 501 points**

**Remaining gap: 232 points**

---

# 21. Schedule priority and drop order

The current implementation priority is:

1. BTLTL-003 — session memory and evidence;
2. BTLTL-004 — one next test, refusal and honesty;
3. BTLTL-005 — circuit-two generalisation;
4. BTLTL-006 — voice;
5. BTLTL-009 — Going Live;
6. BTLTL-010 — File Uploads;
7. BTLTL-007 — final runbook, public write-up and demo preparation.

BTLTL-002 provides the first circuit representation needed by the core implementation work.

If the schedule slips:

**File Uploads drops first.**

Voice remains.

The reasoning loop remains.

Circuit-two generalisation remains.

Going Live remains, but may be reduced to the simplest working deployment.

A polished interface is lower priority than demonstrating the core reasoning behaviour correctly.

---

# 22. BTLTL-001 completion check

BTLTL-001 is complete when all of the following are true:

- the BuildIt rules are recorded somewhere visible to the team;
- the rule source is identified;
- the date the rules were recorded is identified;
- the challenge deadline is stated in GMT+1;
- the same deadline is stated in the local WAT timezone;
- all other sprint tickets are mapped to the visible evidence they are expected to produce;
- the four-competency threshold is checked against the current record;
- the point threshold is checked against the current score;
- the numerical competency shortfall is stated;
- the numerical point shortfall is stated;
- known scoring uncertainty is identified rather than guessed;
- and the known BTLTL-008 platform defect is recorded separately from the engineering work.

## Current numerical check

**Competency requirement:** 4  
**Current confirmed competency coverage:** 8
**Competency shortfall:** 0

**Minimum qualifying score:** 501  
**Current confirmed score:** 269  
**Point shortfall:** 232

**Current engineering level:** Level 2

These values should be updated if the challenge interface changes before the scoring window closes.
