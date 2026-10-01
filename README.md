# Freely

Freely is an electronics reasoning project. The current BuildIt implementation is focused on the THL-001 session-state foundation: keeping user-reported observations, evidence and hypotheses distinct across turns, preserving provenance, handling corrections without exposing database IDs to the model, and making turn retries deterministic.

Current architecture notes: `docs/design-contract.md` and `docs/thl-001-session-state.md`.

## Tests

```bash
npm test
npm run test:integration
npm run test:semantic
```

`test:semantic` calls the configured Gemini API. Integration tests use the configured Supabase project.
