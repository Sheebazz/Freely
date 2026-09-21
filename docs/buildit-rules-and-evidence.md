# BuildIt Challenge — Rules and Sprint Evidence Map

**Ticket:** BTLTL-001  
**Project:** Freely  
**Recorded on:** 21 September 2026  
**Rules read on:** 21 September 2026  
**Rules source:** BuildIt Challenge Rules, About and Small Print pages in the Blacksmith Experience challenge interface.

## Purpose

This document records the BuildIt Challenge rules that affect the current Freely sprint, checks the two numerical qualification thresholds against the current challenge record, and maps every other sprint ticket to the visible evidence it is expected to produce.

Where the available challenge rules do not state something precisely, this document marks it as unclear instead of assuming an answer.

Freely's engineering behaviour is specified separately in `docs/design-contract.md`. This document does not redefine that behaviour.

---

## 1. Challenge window and deadline

The BuildIt scoring window runs from:

**14 September 2026 to 27 September 2026**

Scoring closes at:

**27 September 2026, 11:59 PM GMT+1**

The project owner is working from Nigeria, which uses West Africa Time:

**WAT = GMT+1**

Therefore the deadline in the project owner's local timezone is also:

**27 September 2026, 11:59 PM WAT**

There is no timezone conversion difference between the published GMT+1 deadline and WAT.

---

## 2. Qualification thresholds

The challenge requires both of the following:

1. signals in at least **4 of the 8 competencies**
2. a total challenge score of **more than 500 points**

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

---

## 3. Visible evidence named by the challenge

The challenge identifies visible engineering work as scoring evidence.

The named evidence categories include:

- tickets
- pull requests
- code reviews
- design notes
- calls
- other visible engineering work recorded through the Blacksmith project

This document does not assign a fixed point value to any of these artefacts because the available challenge rules do not provide a fixed conversion from an individual ticket, PR, review, note or call to challenge points.

---

## 4. Other challenge requirements relevant to this sprint

The challenge also requires:

- attendance at Demo Day
- a public post about the project
- use of `#BuildItChallenge`
- submission of the public-post link through the challenge share task
- work intended to count toward scoring to remain visible through the Blacksmith project workflow

The project must remain a solo entry owned by the registered participant.

These requirements are recorded separately from the two numerical qualification thresholds.

Meeting the competency and point thresholds does not remove the Demo Day or public-post requirements.

---

## 5. Current qualification snapshot

The figures in this section are a snapshot taken on:

**21 September 2026**

They satisfy the threshold check required by BTLTL-001. They are not intended to be updated after every later score or signal change.

### 5.1 Competency threshold

**Source checked:** Blacksmith Growth page, 21 September 2026.

The Growth page shows:

- **8 of 8 competencies**
- **28 signals**

The BuildIt requirement is:

**at least 4 competencies with signals**

Current confirmed competency coverage:

**8 competencies**

Numerical shortfall:

`max(4 - 8, 0) = 0`

**Competency shortfall: 0**

The competency-count threshold is therefore satisfied in this snapshot.

The 28-signal count is recorded because it is visible on the same Growth page. This document does not convert 28 signals into an estimated challenge score because the available rules do not state a fixed points-per-signal conversion.

### 5.2 Point threshold

**Source checked:** Blacksmith Challenge page, 21 September 2026.

Current confirmed challenge score:

**269 points**

Minimum qualifying score:

**501 points**

Numerical shortfall:

`501 - 269 = 232`

**Point shortfall: 232 points**

The point threshold is therefore not satisfied in this snapshot.

The calculation uses the score displayed by Blacksmith. It does not add estimated future points or assign assumed values to unfinished tickets, PRs, reviews or signals.

### 5.3 Numerical threshold summary

| Threshold           |       Required |        Current |  Shortfall |
| ------------------- | -------------: | -------------: | ---------: |
| Competency coverage | 4 competencies | 8 competencies |          0 |
| Challenge points    |     501 points |     269 points | 232 points |

Of the two numerical qualification thresholds, only the point threshold remains unsatisfied in this snapshot.

---

## 6. Sprint evidence map

Every other ticket in the current sprint is mapped below to the visible artefacts it is expected to produce and the evidence categories named by the challenge.

| Ticket    | Work                                        | Expected visible artefact                                                           | Challenge evidence category                                                  |
| --------- | ------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| BTLTL-008 | Design contract                             | design document, pull request, review history and ticket discussion                 | Design notes, Pull Request, Code Review, Ticket                              |
| BTLTL-002 | Circuit one as data                         | circuit-data changes, implementation pull request, review and ticket activity       | Ticket, Pull Request, Code Review                                            |
| BTLTL-003 | Session memory and evidence                 | implementation changes, tests, pull request, review and ticket activity             | Ticket, Pull Request, Code Review, Other visible engineering work            |
| BTLTL-004 | One next test, refusal and honesty          | reasoning implementation, behaviour tests, pull request, review and ticket activity | Ticket, Pull Request, Code Review, Other visible engineering work            |
| BTLTL-005 | Circuit two through the same engine         | second-circuit changes, pull request, review and ticket activity                    | Ticket, Pull Request, Code Review                                            |
| BTLTL-006 | Voice                                       | voice implementation, pull request, review and ticket activity                      | Ticket, Pull Request, Code Review                                            |
| BTLTL-009 | Going Live                                  | deployment work, reachable deployment and ticket activity                           | Ticket, Pull Request where applicable, Other visible engineering work        |
| BTLTL-010 | File Uploads                                | upload implementation, pull request, review and ticket activity                     | Ticket, Pull Request, Code Review                                            |
| BTLTL-007 | Runbook, public write-up and demo rehearsal | runbook, public-post evidence, rehearsal record and ticket activity                 | Ticket, Design notes, Calls where applicable, Other visible engineering work |

This table identifies the evidence each ticket is expected to leave behind.

It does not claim that every listed artefact will earn points, that every artefact will earn the same number of points, or that producing an artefact automatically creates a competency signal.

---

## 7. What remains unclear

The available challenge rules do not state a fixed conversion between individual visible engineering artefacts and the final challenge score.

No confirmed rule available for this document states that:

- one ticket is worth a fixed number of points
- one pull request is worth a fixed number of points
- one code review is worth a fixed number of points
- one design note is worth a fixed number of points
- one call is worth a fixed number of points
- one competency signal is worth a fixed number of points
- 28 signals correspond to a predictable final challenge score

Those conversions are therefore marked as:

**Unclear**

The score displayed by Blacksmith is used as the confirmed current point total instead of calculating a projected score from the number of visible artefacts or signals.

---

## 8. Acceptance-criteria check

### 01 — Rules are written down with source and read date

**Satisfied**

Source:

**BuildIt Challenge Rules, About and Small Print pages in the Blacksmith Experience challenge interface**

Read date:

**21 September 2026**

### 02 — Deadline is stated in GMT+1 and the reader's local timezone

**Satisfied**

Challenge deadline:

**27 September 2026, 11:59 PM GMT+1**

Local Nigeria deadline:

**27 September 2026, 11:59 PM WAT**

WAT is GMT+1.

### 03 — Every other sprint ticket is mapped to the evidence it is expected to produce

**Satisfied**

Section 6 maps every other sprint ticket to expected visible artefacts and to the evidence categories named by the challenge.

### 04 — Both thresholds are checked and any shortfall is stated numerically

**Satisfied**

Competency threshold:

**4 required, 8 current, shortfall 0**

Point threshold:

**501 required, 269 current, shortfall 232**

### 05 — Anything the rules leave unclear is marked unclear rather than assumed

**Satisfied**

The exact point conversion for individual tickets, PRs, reviews, design notes, calls and competency signals is not stated in the available challenge rules.

No fixed conversion is assumed in this document.
