# Freely

Freely is an electronics reasoning project. The current implementation covers the THL-001 session-state foundation and THL-002 established-status authority: keeping user-reported observations, evidence and hypotheses distinct across turns, preserving provenance, handling corrections without exposing database IDs to the model, and making turn retries deterministic.

Current architecture notes: `docs/design-contract.md`, `docs/thl-001-session-state.md`, and `docs/thl-002-established-status.md`.

Voice and next-test reasoning are design targets; this branch implements the session/extraction foundation, not a complete troubleshooting interface.

## Tests

```bash
npm test
npm run test:integration
npm run test:semantic
```

`test:semantic` calls the configured Gemini API. Integration tests use the configured Supabase project.
