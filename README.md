# Account Signal

A simple hosted web app for Factory account executives to research a target account and turn that research into better outbound.

## What it does

Enter a company name, optional target person, and research notes (e.g. pasted from LinkedIn Navigator). The app generates:

1. Known facts — only things supported by the supplied research
2. Three falsifiable account hypotheses
3. Ten potential targets in the account, classified by persona
4. Likely priorities for each target persona
5. A short personalized outbound email
6. A 30-second cold-call opener
7. Three discovery questions
8. A confidence/evidence section that separates facts from assumptions

## Architecture

- **Frontend:** Vite + React + TypeScript, hosted on Netlify
- **Backend:** Netlify Functions (serverless)
  - `/api/research` — calls OpenAI with a structured-output schema
  - `/api/accounts` — CRUD for saved accounts using Netlify Blobs
- **Persistence:** Netlify Blobs (native key/value storage)
- **AI:** OpenAI `gpt-4o-mini` via structured outputs

## Personas

The app classifies each target into one of four personas:

- **Planners** — Line of Business Owners, Product Managers, Architects
- **Operations** — IT Infrastructure, SREs, DevOps, Platform Engineers, Engineering Management
- **Builders** — Backend, Front End, Mobile Engineers, Engineering Management
- **Other Folks** — Sales, Security, Legal, Procurement, Data Scientists, Business Analysts

## Local development

1. Install Node.js 22+ and npm.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with your OpenAI API key:
   ```bash
   cp .env.example .env
   # Edit .env and add your OPENAI_API_KEY
   ```
4. Run the Netlify dev server (this serves both the frontend and the functions):
   ```bash
   npx netlify dev
   ```
5. Open http://localhost:8888.

> The frontend alone can be started with `npm run dev`, but the Netlify Functions and Netlify Blobs will only work through `npx netlify dev`.

## Deploy to Netlify

### Option A: Git-connected deploy (recommended)

1. Push this repo to GitHub.
2. In Netlify, create a new site from Git and connect the repo.
3. In **Site settings → Environment variables**, add:
   - `OPENAI_API_KEY` = your OpenAI API key
4. Netlify will read `netlify.toml` for the build settings and deploy the functions automatically.

### Option B: Manual deploy

```bash
npx netlify deploy --prod --build
```

Make sure you are logged in to Netlify (`npx netlify login`) and have set the `OPENAI_API_KEY` environment variable in the Netlify UI or via the CLI.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key used by the research function. |

## Project structure

```
netlify/
  functions/
    accounts.ts       # CRUD for saved accounts using Netlify Blobs
    research.ts       # OpenAI structured-output research function
src/
  api.ts              # Frontend API wrappers
  types.ts            # Shared TypeScript types
  components/
    AccountForm.tsx   # Input form
    ResearchPanel.tsx # Research output display
    TargetsList.tsx   # 10 targets with persona badges
    OutboundKit.tsx   # Email, cold-call opener, discovery questions
    ConfidenceBadge.tsx
    SavedAccounts.tsx
  App.tsx
  App.css
netlify.toml          # Netlify build and redirect config
```

## Future roadmap

- Multiple stakeholders per account
- Saved accounts with team sharing
- Post-call notes and automatic hypothesis updates
- CRM integrations (Salesforce, HubSpot, Outreach)
- LinkedIn / third-party data source integration

## Notes

- LinkedIn data is currently entered manually (company page + people pasted from LinkedIn Navigator). This avoids LinkedIn Terms-of-Service risk and keeps the first version simple.
- All AI-generated insights are labeled as facts or assumptions. Facts are only those directly supported by the supplied research.
