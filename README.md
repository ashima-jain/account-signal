# Account Signal

Evidence-first account execution for teams selling and deploying **Devin**, Cognition's autonomous
AI software engineer.

Type a company name. Claude researches it across four criteria, and the app fills an account plan
with evidence, stakeholders, use-case wedges and a thesis. From there the seller marks each piece of
evidence as a fact or a hypothesis, runs an eight-signal champion test on the people they have met,
and gets a Next Best Action that is computed, not generated.

**The model's job is research. The code's job is judgment.** Nothing the model returns is trusted:
every status it proposes is re-derived server-side from the evidence actually cited.

## The four criteria

| Criterion | The question it answers |
| --- | --- |
| Engineering Scale | How many engineers, how many repos, how much legacy surface is there to work on? |
| Devin Use-Case Fit | Is there parallelisable, well-specified engineering work Devin sessions can own end to end? |
| Urgency / Trigger | What happened recently that makes this a this-quarter problem? |
| Right to Win | Why us, why now, and what access or proof do we have that a competitor does not? |

Wedges are typed by the work Devin actually does: migrations, large-scale refactors, test coverage
backfill, bug backlog burn-down, dependency and CVE remediation, PR review, codebase Q&A and
onboarding, incident triage, CI maintenance, parallel feature delivery.

## The rules the code enforces

These are in `src/domain/`, are pure functions, and are the only place judgment lives.

**A FACT must be earned** (`claims.ts`)

- Every cited evidence id must exist.
- A FACT must cite at least one item from a verifiable source. `inference` is never verifiable, so
  reasoning alone tops out at HYPOTHESIS.
- An UNKNOWN cannot cite anything: if you have evidence, it is at least a hypothesis.
- Deleting evidence demotes the claims that rested on it and writes the reason to the change log.
- A claim goes stale after 90 days unless it is revalidated or its evidence is fresher than that.
- Right to Win cannot be a fact from desk research; only a conversation or a document establishes it.

**A champion is a behaviour, not a feeling** (`champion.ts`)

Eight signals, each of which must point at a piece of evidence to count.

- 0–1 evidenced signals → Contact
- 2–3 → Coach
- 4+ including access-granting behaviour → Potential Champion
- 4+ including advocacy when absent and a personal motivation → Validated Champion

Ticking a signal without citing evidence does not move the tier; it is reported as uncounted.

**The Next Best Action is a rule, not a prompt** (`nba.ts`)

Around twenty rules look for one specific gap each — no economic buyer, an untested champion, a
wedge with no evidence, a stale fact, no booked action — and score it by deal stage. The same gap is
worth different amounts at different times: "no economic buyer" is Low in Discovery and Critical in
Negotiation. Stage itself is derived (claims → Evaluation, a validated wedge → Negotiation) so it
cannot drift from what the account contains.

## Architecture

```
src/domain/        pure judgment: types, claim invariant, champion test, NBA   (70 unit tests)
src/screens/       command center, thesis, evidence, stakeholders, wedges, actions, change log
netlify/lib/       blobs store with revision CAS, HTTP plumbing, Anthropic access
netlify/functions/ one function per resource + seed and thesis generation
```

One Netlify Blob per account holds the whole aggregate, so a claim and the evidence it cites can
never be half-written. Every mutation returns the entire aggregate with `ETag: "rev-N"`, and the next
write must send it back as `If-Match` — a write from a stale view is rejected rather than silently
clobbering someone else's edit.

## API

```
GET    /api/accounts                          portfolio index
POST   /api/accounts                          create
GET    /api/accounts/:id                      full aggregate
PATCH  /api/accounts/:id                      rename / set domain
DELETE /api/accounts/:id
POST   /api/accounts/:id/seed                 research with Claude + web search
POST   /api/accounts/:id/thesis/generate      rewrite thesis and claims from the ledger
CRUD   /api/accounts/:id/{evidence,claims,stakeholders,signals,wedges,actions}[/:id]
GET    /api/accounts/:id/actions              also returns the ranked NBA candidates
```

## Running it

Requires Node 22+.

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY
npx netlify dev           # app + functions + local blobs on :8888
```

`npm run dev` alone serves the UI only; the API needs the Netlify dev server. Without an
`ANTHROPIC_API_KEY` everything works except research and thesis generation, which return 503.

```bash
npm test        # vitest, domain rules
npm run lint    # oxlint
npm run build   # tsc -b && vite build
```

## Deploying

Netlify, with `ANTHROPIC_API_KEY` set as a site environment variable. Blobs need no configuration.
Research can outrun a function invocation; a timeout is not a failure — the account page polls until
the findings land.
