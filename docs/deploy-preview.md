# Render preview deployment

This app needs a Node web service. GitHub Pages cannot run this backend. Source: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

1. Check `git status --short` and the branch before committing. Include only intended runtime code, tests, fixtures and public docs. Never commit `.env`, credentials, logs, node_modules or `docs/thl-003-specialist-review.md`. Do not use a blind `git add .`.
2. Push the intended branch to your GitHub repo after checking the staged diff. A PR can remain open while a preview deploy uses that branch; it does not mean the tickets are approved.
3. On Render, sign in with GitHub and choose New > Web Service. Connect Sheebazz/Freely and select the exact branch containing the complete patch. Choose Node and Free compute. Build: `npm ci`. Start: `npm start`. Root: repo root. Keep one instance because current concurrency/rate guards are process-local.
4. Add server environment variables using your existing values: SUPABASE_URL, SUPABASE_SECRET_KEY, GEMINI_API_KEY. Set GEMINI_MODEL=gemini-3.5-flash-lite, GEMINI_REASONING_MODEL=gemini-3.5-flash, REASONING_FALLBACK_ENABLED=false, NODE_ENV=production. Set PUBLIC_ORIGIN to the exact assigned HTTPS address, with no trailing slash, before the app can start in production. Do not copy the example values as credentials. Keep Render's provided PORT.
5. Deploy. If the assigned address is only visible after service creation, update PUBLIC_ORIGIN and redeploy. No new migration is required by this browser/delivery patch; earlier chat-input and context migrations must already be installed.
6. Open the published address. Check the footer version against Render's deployed commit, and open `/api/version`. `serving` proves process/version only. Create a demo session and run one live turn, then refresh and check history. Check microphone and image preview on HTTPS. Use the browser controls and runbook rather than a terminal-only demonstration.
7. Push fixes to the connected branch to trigger redeployment. Keep Supabase for data. An old conversation in localhost will not automatically appear on the new origin because its access token lives in the localhost browser storage. Start a new public session. A release may interrupt in-flight calls; retry the same saved message explicitly after it settles, rather than sending duplicates.

Render Free sleeps after 15 minutes without traffic and takes about a minute to wake up. Open the site before presenting. Do not describe this as guaranteed always-on production service. Watch the actual account usage and Gemini daily quota.

Sources: https://render.com/docs/free ; https://render.com/docs/deploys ; https://render.com/docs/deploy-node-express-app

Release record: actual live URL, commit, first-live timestamp, independent runner, runbook results and rehearsal date must be filled by the author after those events. None are claimed here.

## Firebase comparison

Firebase Hosting's static Spark plan can serve HTML/CSS/JavaScript, but it cannot by itself run Freely's Node API. Uploading only `public/` would leave session creation and model requests broken. Never move server API keys into the browser to work around that.

Firebase Hosting can route requests to a Node service on Cloud Run. That requires a billing-linked Blaze project, container/service setup and Hosting rewrite configuration. Firebase App Hosting also requires Blaze. No-cost allowances are not a guarantee of a zero bill. Hosting rewrites have a 60-second request timeout, which must be considered against Freely's full extraction/reasoning/database request duration. A fast CDN does not shorten the model's reasoning time.

For this existing Node app and a phone-based deployment today, use the Render instructions above. Firebase is an option for a later deliberately configured deployment; this patch does not add an untested Firebase configuration or migrate Supabase.

Sources: https://firebase.google.com/docs/hosting/cloud-run ; https://firebase.google.com/docs/app-hosting/costs ; https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
