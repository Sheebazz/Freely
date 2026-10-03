# Freely

Freely is a voice-first electronics workbench companion. This release is a troubleshooting preview: users describe a fault, share observations and receive one next check or a focused question. The long-term direction includes finding relevant schematics and datasheets; online research is not implemented in this release.

## Current capabilities

- Text chat, browser dictation with transcript confirmation, and bounded board images.
- Saved conversations in the same browser, with server-side session records.
- A reviewed 5 V LED timer fixture and limited external-observation guidance for unfamiliar boards.
- Four reasoning outcomes: next test, request for context, challenge to an unsupported claim, and an explanation that the cause remains uncertain.
- Reported evidence remains separate from model hypotheses. Backend validation checks structure, references, allowed tests and persistence; it does not certify a diagnosis.

Circuit two is deferred. Complete voice equivalence, live image accuracy and the full public walkthrough remain under evaluation.

## Run locally

Use a supported Node.js installation. Install dependencies with `npm ci`. Copy `.env.example` to `.env` only when `.env` does not already exist, and configure `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `GEMINI_API_KEY`. Never commit these values.

Apply the repository's Supabase migrations in filename order. Existing installations should apply only missing migrations. See the setup and verification notes in [the reasoning loop guide](docs/enforced-circuit-one-loop.md).

Run `npm start`, then open http://localhost:3000. Production also requires `NODE_ENV=production` and `PUBLIC_ORIGIN` set to the exact HTTPS origin, without a trailing slash. See [deployment](docs/deploy-preview.md).

The browser retains session access tokens in local storage; the database retains their hashes. Clearing browser data removes access to those conversations. No user account is required.

## Validate

| Command | Purpose | External service |
| --- | --- | --- |
| `npm test` | Logic, evidence guards, HTTP boundary and browser state | None |
| `npm run test:integration` | Persistence, isolation and atomic updates | Supabase |
| `npm run test:semantic` | Live extraction behaviour | Gemini |
| `npm run test:reasoning` | Live reasoning outcomes | Gemini |
| `npm run test:chat` | Live extraction-to-reasoning flow | Gemini |
| `npm run walkthrough -- --case case-01` | One simulated fixture case | Supabase and Gemini |

Live evaluations consume API quota. Follow the [acceptance runbook](docs/demo-runbook.md) to select checks and record results. Runtime fixtures are registered in `data/runtime-circuits.json`; hidden fault answers remain outside model context.

After a fixture procedure changes, start a new demo conversation. Saved responses remain readable, but old fixture-bound conversations must not continue against changed circuit data.

## Design references

[Session state](docs/thl-001-session-state.md), [evidence authority](docs/thl-002-established-status.md), and [reasoning loop](docs/thl-003-reasoning-loop.md) document the existing contracts and their limits. Historical review notes are not product instructions.
