# THL-002 — Established-status authority

The model may interpret language, but it cannot grant authority.

`verificationStatus` is derived from item type and trusted provenance:

- user-reported measurement -> `established`
- user-reported test result -> `established`
- backend-supplied trusted circuit fact -> `established`
- observation -> `unverified`
- user diagnostic/identity/causal claim -> `unverified`
- model diagnostic/identity/causal claim -> `unverified`

The extraction schema deliberately has no established/status field and no
`trusted_fact` kind. Trusted circuit facts enter through a backend-only builder
with an explicit trusted source identifier.

Model-generated hypotheses use model provenance and remain unverified. There is
no model-generated evidence provenance shape.

Evidence reported by a user must remain grounded in that user's current message:
`sourceText` is an exact span, measurement values are attested by that span, and
non-measurement test results must also occur literally in that span. A model
interpretation of a result is not itself evidence.

PostgreSQL owns the final status through a generated `verification_status`
column and a provenance/type constraint. Consequently a caller cannot persist an
established hypothesis or model-authored evidence even if application code is
bypassed.

Repeating a hypothesis or adding measurements consistent with it does not change
the hypothesis status. New measurements are separate established evidence; they
do not promote the earlier claim.


## Repair after live validation

Migration `202610010003` is already applied and is retained unchanged. Apply
`202610010004_repair_verification_authority.sql` after every repair preflight row
passes. The repair removes the live legacy `session_items_kind_check`, replaces
nullable category/provenance checks with fail-closed checks, and validates the
structured shape of each supported item. Existing invalid rows abort the whole
migration; no row is deleted or silently relabelled. Source identifiers are
nonblank strings of at most 200 characters in both Node and PostgreSQL.

Run `supabase/verification/preflight_thl002_repair.sql` before repair and
`supabase/verification/verify_thl002.sql` after it. The latter includes the
THL-001 lifecycle/privilege checks as well as the THL-002 checks. A successful
read-only verifier is a schema/data audit, not a substitute for raw-RPC attack
tests or live semantic evaluation.

## Limits of the guarantee

The database rejects model-provenance evidence, malformed provenance, malformed
structured values, and hypotheses claiming established status. Runtime callers
are trusted backend code; Gemini cannot call the service-role RPC directly.
A source identifier records an explicit backend trust decision; its existence
is not an independent verification of the document or circuit.

Semantic classification still belongs to the extractor. Exact source spans and
literal value checks establish textual support, not that an actual measurement
occurred or that the subject/unit/interpretation is correct. For example, a
faulty extractor could label `TP1 should be 5 V` as a user measurement whose
value appears in the source. The current structural checks alone cannot detect
that semantic error. The live semantic suite tests this boundary; it does not
prove absence of all semantic mistakes. Established user evidence means a
user-reported reading/result, not independently verified physical truth.

The appearance-identity semantic regression requires at least one item and
requires every item to be a hypothesis. Its two clauses can yield more than one
identity claim; item count alone is not the ticket's honesty requirement.


## Post-audit turn boundary hardening

The live 1 October audit showed valid current records and all 24 THL-002
checks passing. Full function inspection exposed an inherited NULL completion
kind bypass in `finalize_turn` and its table CHECK. A raw service-role call
could complete a turn without replay metadata; Node validation normally rejects
that input. Migration 005 rejects NULL completion kinds, rejects missing or
mismatched per-item session/turn IDs, and makes the completion-state CHECK
fail-closed. Malformed clarification payloads are also rejected by the CHECK.

The audit additionally found PostgreSQL 17 `MAINTAIN` grants surviving the old
privilege normalization. They permit maintenance and locking, not ordinary row
INSERT/UPDATE/DELETE. Migration 005 removes that excess runtime authority.
It requires PostgreSQL 17+; preflight verifies this requirement. Database-owner
and automatic maintenance authority remain unchanged.

Before 005 run `preflight_turn_boundary.sql` (4 PASS rows); after 005 run
`verify_thl002.sql` (24 PASS rows) and `verify_turn_boundary.sql` (5 PASS rows),
then the existing unit, live integration and semantic suites. Applied migrations
are not rewritten and no session record is deleted or silently corrected.

## Specialist review repair (migration 006)

Tunde's review was based on the implementation summary, not a remote code diff.
The confirmed remaining blockers were incomplete clarification-payload validation
and unattested measurement metadata. Applied migrations 001–005 remain unchanged.

`valid_turn_clarification` validates the complete Node clarification shape at
both the RPC and the table CHECK: exact keys, JSON string types, bounded strings,
nonempty unresolved arrays, and complete unresolved entries. Unrecoverable detail
must contain a non-whitespace character in both layers. PostgreSQL string limits
match the installed Zod parser's Unicode code-point limits. A shared 55-case raw
RPC differential matrix compares acceptance with the Node parser, then reads each
accepted turn through the repository. This is regression coverage, not a proof
for every possible JSON document or future parser version.

Disposition for existing data is **audit and abort without modification**.
The read-only preflight lists incompatible finalized-turn IDs. Migration 006
repeats the audit inside its transaction and refuses to proceed if any exist.
The validated CHECK then covers every row, including a concurrently finalized
row. No malformed history is silently backfilled, deleted, or excluded from
replay. Any failure requires inspecting the named rows and choosing an explicit
source-grounded repair before proceeding.

The current service calls one atomic finalization RPC and makes no second write
after successful finalization. The new payload guard runs before item insertion;
the final table CHECK and item constraints remain within the same PostgreSQL
transaction. Runtime direct writes to turns/session_items remain prohibited.
Database owners remain privileged administrators, not runtime callers.

Measurement subjects must be literal in their source span or exactly match the
backend requestedSubject when the response type is measurement. Context has
referential authority only; it cannot establish that a test occurred. Units must
be explicitly present, preserve scale and symbol case, and may use a small fixed
spelling equivalence such as volts → V. Omitted units remain null. Other
normalizations require clarification rather than an invented measurand/unit.
These checks run in the extraction service before persistence; a service-role
RPC caller is trusted backend code, not Gemini or an end user.

Trusted facts now carry a factType limited to topology, rating, label, or
part_number. They are stored under the owning session, not in a mutable shared
trust pool. Existing untyped trusted facts require explicit source/type curation;
006 stops rather than inventing their type. The builder cannot accept a diagnosis
or causal_claim type. A trusted backend can still mislabel diagnostic prose as a
label: the enum restricts representation, not the semantic truth of arbitrary
text. Only curated circuit data should reach this builder. Verified part numbers
or documented identities are legitimate circuit data; appearance-only identity
and diagnoses remain unverified hypotheses.

The semantic bound is explicit: **a classification error landing on a genuine
span can become established evidence**. Source/value/unit/subject checks reduce
fabrication but cannot prove a measurement occurred. Both a deterministic bound
fixture and a live semantic case cover an expected, unperformed reading with a
plausible numeric span. Live semantic tests also cover a unitless reading.

Run preflight_reader_authority.sql (2 PASS rows), migration 006 once,
verify_thl002.sql (24 PASS), verify_turn_boundary.sql (5 PASS), and
verify_reader_authority.sql (4 PASS), then all three suites. Do not commit secrets.


## Final pre-push attestation audit

Numeric attestation accepts complete numeric tokens and valid thousands grouping;
ambiguous decimal commas are rejected rather than deleted. A unit must follow its
attested reading, with identifier boundaries and preserved symbol case/scale.
This prevents V in TP5V or V2, or a unit attached to another numeric reading, from
attesting the current value. Adjacent readings such as 1000V and scientific
notation remain supported. Unusual unit-before-value phrasing may require
clarification. Clause-to-subject interpretation still remains semantic work.

The 2 October forward migration reconciles PostgreSQL's whitespace class with
Node's nonblank trusted-source rule. Non-breaking, ideographic and BOM-only source
IDs are rejected by raw-RPC regression cases. Preflight and migration audit identify
existing incompatible records; migration aborts without inventing replacements.
This is scoped to the promised trusted-source contract, not generic JSONB hardening.

## Lars review: numeric separators and runtime wiring

Numeric token boundaries accept list punctuation after a complete reading, e.g.
`TP1 reads 4.8, TP2 reads 5.0`. A digit immediately after comma/underscore remains
ambiguous unless a complete valid thousands group consumes it. Removing that
protection entirely would reintroduce truncated decimal-comma readings. Regression
cases cover both readings, a span ending at a comma, valid thousands grouping,
underscore punctuation, malformed grouping, and extraction without a repair call.

### Coverage and sequencing

The current production service `processUserTurn` performs **user-message
extraction only**. It calls `buildSessionItem`, not `buildModelHypothesis` or
`buildTrustedCircuitFact`. There is no troubleshooting reasoning provider or
circuit-ingestion runtime in this branch. These builders are deliberately backend
entry contracts for those future paths, not a claim that an end-to-end reasoning
loop already calls them. Routing extracted user claims through the model builder
would incorrectly change their provenance and is not an appropriate wiring fix.

| Requirement | Current coverage | Remaining runtime work |
| --- | --- | --- |
| User claims remain unverified | Extraction/turn processing and persistence tests | None for this extraction path |
| Model causal/identity claims cannot grant themselves authority | Forced-hypothesis builder tests; raw-RPC forged-status and persisted-repeat integration tests; database-generated status | Connect actual reasoning-provider output to the builder |
| Trusted metadata requires explicit backend authority | Typed builder, database constraints and session-isolation integration tests | Connect curated circuit data to the owning session |

The later reasoning-engine work identified as THL-003/THL-004 in the THL-001
architecture notes owns the planned integration. This sequencing must be
acknowledged in review; schema/builder/persistence coverage must not be described
as a completed runtime reasoning path. If THL-002 is required to include that
end-to-end path now, the scope must include the actual reasoning provider and
outcome contract rather than an otherwise unused adapter.

Before the reasoning loop is considered complete, its integration tests must
exercise real orchestration: a provider-generated diagnosis claiming established
status, repeated diagnoses beside consistent measurements, model provenance on
persisted items, and replay without another provider call. Every generated
causal/identity claim must enter through `buildModelHypothesis` before the single
atomic finalization RPC. Trusted circuit metadata must enter through the typed
trusted builder from curated backend data and stay isolated by session.
