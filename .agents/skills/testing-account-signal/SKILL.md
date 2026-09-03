---
name: testing-account-signal
description: How to run and end-to-end test the Account Signal SPA (Vite + React + Netlify Functions + Netlify Blobs + Claude research) locally in a browser, including the local function-timeout pitfall and the evidence-first invariants to assert.
---

# Testing Account Signal locally

## Bring the app up

```bash
export PATH=$HOME/.nvm/versions/node/v22.12.0/bin:$PATH   # Node 22 is required
cd /path/to/account-signal
npm install
cp -n .env.example .env        # set ANTHROPIC_API_KEY and ACCESS_PASSCODE (never print/commit them)
npx netlify dev                # UI + /api functions + local blobs on http://localhost:8888
```

`npm run dev` (plain Vite, :5173) serves the UI but **not** `/api/*`, so every write fails.
Always test through `netlify dev` on :8888. Tail the dev-server output to a file
(`npx netlify dev > /tmp/netlifydev.log 2>&1 &`) and grep it for
`Response with status 5` / `status 409` while testing — that is the cheapest 500/stale-revision detector.

## Getting in: the passcode gate

Every `/api/*` route requires `Authorization: Bearer $ACCESS_PASSCODE` and the API fails closed (503)
when the variable is unset. The UI shows a passcode gate on first load and stores the value in
`localStorage` under `account-signal.passcode`, clearing it on any 401.

## Research is a background function

Creating an account fires `POST /api/accounts/:id/seed`, which returns `202` immediately and runs
Claude with web search for 1–3 minutes. Progress lives in the aggregate: `seedStatus`
(`running`/`complete`/`failed`), `seedStartedAt`, `seedError`. The account page polls every 4s, so
expect an empty account with a "Research is still running" banner first and findings later — do not
treat the empty first render as a failure. A run stuck in `running` for over 15 minutes counts as
stalled and the **Research** button becomes usable again.

## Invariants worth asserting through the UI

These are enforced in `src/domain/` and `netlify/functions/`; the UI should never contradict them:

- FACT claims must cite at least one *verifiable* (non-inference) evidence item.
- Deleting evidence demotes claims that relied on it; a `confirm()` names the affected claims and the
  change log records the demotion reason.
- Right to Win cannot be FACT from web/desk research alone — thesis generation clamps it to HYPOTHESIS
  unless conversation/document (first-party) evidence exists.
- Champion tiers count only *cited* signals (0–1 Contact, 2–3 Coach, 4+ Potential/Validated). A signal
  ticked without a citation shows a `No citation` badge and the rationale says it "did not count".
- A wedge cannot become Validated with zero citations (server returns 422 and a red banner).
- Validating a wedge moves the deal stage to Negotiation; the ranked Next Best Action list is
  deterministic and stage-weighted (`src/domain/nba.ts`).
- Change log is reverse chronological (`src/screens/ChangeLog.tsx` reverses `aggregate.events`).

## UI navigation notes

- Tabs: Thesis / Evidence / Stakeholders / Wedges / Actions / Change log; header shows
  `<Stage> · rev N` — the rev increments on every successful mutation, useful as a save confirmation.
- Wedge citations live behind a per-card **Citations** button (checkbox list → **Save citations**).
- Action completion uses a native `window.prompt` ("What happened?"); type the outcome then accept.
- An action due *today* is rendered as **Overdue** and spawns a Critical "Clear 1 overdue action" NBA.

## Devin Secrets Needed

- `ANTHROPIC_API_KEY` — required for `/api/accounts/:id/seed` and `/api/accounts/:id/thesis/generate`.
  Read from the repo `.env`; never print or commit it.
