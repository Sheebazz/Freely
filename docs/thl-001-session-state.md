# THL-001 — Session state and evidence flow

This note describes the production path implemented for THL-001. It is not a second contract; it maps the BTLTL-008 design contract onto the current code and database boundaries.

## Canonical turn flow

For one `(session_id, turn_id)` request:

1. The backend computes a SHA-256 fingerprint of the exact user message plus validated minimal turn context.
2. The turn is created as `processing` through `create_turn(...)`. Direct runtime `INSERT`/`UPDATE`/`DELETE` on `turns` is not permitted.
3. Existing session items are read. Superseded items remain in history, while correction candidates are built only from the current items.
4. Gemini receives the current user message, minimal referential turn context, and temporary correction-candidate refs. It never receives session-item database IDs.
5. The backend validates the extraction, exact `sourceText`, correction refs and stored-item shape. Unresolved information is never stored as a session item.
6. Valid items and the turn completion outcome are committed together through `finalize_turn(...)`. Direct runtime mutation of `session_items` is not permitted.
7. A completed retry replays the stored turn outcome and that turn's items without another model call.

## Authority boundaries

- Gemini owns semantic interpretation: observation vs measurement/test result vs hypothesis, correction intent, and unresolved semantic ambiguity.
- The backend owns IDs, provenance, request fingerprints, correction-ref resolution, current-vs-superseded state, schema validation and retry behavior.
- PostgreSQL owns relational and transactional guarantees, including session/turn ownership, no direct correction fork, atomic turn finalization and controlled lifecycle mutation.
- Hidden evaluation ground truth is not part of session state or model context.

`correctionRef` is temporary model-facing data. `supersedesId` is backend-owned persisted data. They are not interchangeable.

A correction may only replace an item of the same stored category and, for evidence, the same evidence kind. THL-001 does not allow correction to act as a promotion or reclassification path. If a future ticket needs category-changing revision, it must define a separate attested transition rather than overloading `supersedesId`.
The same invariant is enforced inside `finalize_turn()`, the SECURITY DEFINER persistence boundary for `session_items`, so a caller cannot bypass the Node validation by invoking finalization directly.

For measurement evidence, the backend also checks that the structured value is actually supported by the exact user quote in `sourceText`. Numeric readings must match a numeric token in that quote; nonnumeric readings must occur literally in it. This prevents the model from silently rounding, tidying, or inventing the persisted reading while still quoting the user correctly.

## Turn outcomes used by THL-001

A turn is `processing`, `failed`, or `completed`.

A completed turn records either:

- `accepted` with no completion payload; or
- `clarification_required` with either semantic ambiguity details or an unrecoverable-extraction detail.

These are persistence outcomes for THL-001. They do not replace the four troubleshooting-engine outcomes defined for THL-003/THL-004.

## History and current state

`getItemsForSession()` returns immutable history, including superseded items. `currentItems()` removes items that have been superseded and is the current-state boundary used when correction context is built. Callers must not treat raw session history as current troubleshooting state.

Currentness is derived from the `supersedesId` graph, not timestamp ordering. Completed-turn replay reads only that turn's items and orders them by the turn-local `itemIndex`, which is unique within `(session_id, turn_id)`. Repeated hypotheses do not gain evidentiary status or support weight in THL-001; no support-counting mechanism exists in this ticket.

## Retry behavior

- completed turn + same request fingerprint: replay; no model call
- processing turn + same request fingerprint: report already processing; no model call
- failed turn + same request fingerprint: controlled `failed -> processing` retry
- same turn id + different request fingerprint: reject

A hard process crash can leave a turn in `processing`. THL-001 does not invent a time-based stale-turn threshold; recovery requires an explicit lifecycle action rather than guessing that an in-progress turn is abandoned.
