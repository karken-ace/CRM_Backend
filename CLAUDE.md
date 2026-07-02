# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

ACES Backend — Node.js Express + TypeScript API server (MongoDB via Mongoose) for the ACES CRM Meta Ads platform. It owns auth, the data model, the deterministic optimization/rules engines, and all AI integrations, and it manages a fleet of remote Python agent services (separate repo), each on its own VPS wrapping one Meta ad account. The React frontend (separate repo) is served from the same VPS and proxies `/api/*` here.

See `README.md` for the full architecture, route/model reference, and the multi-VPS deployment guide.

## Commands

```bash
npm run dev            # tsx watch, port 8000
npm run build          # tsc → dist/
npm start              # run compiled output
npm run create-admin   # seed an admin user
```

No test suite, linting, or CI is configured.

## Architecture

- **Entry** `src/index.ts`: CORS → JSON → security headers → logging → rate limiters → 16 routers → error handler; starts DB + cron.
- **Data flow:** agents sync Meta data **directly into this MongoDB** every 5 min (collections `campaigns`/`adsets`/`ads`, written by the agent's `db_sync`, not through this API). `/meta/campaigns/hierarchical` serves from Mongo when `last_synced_at` < 15 min (see `MONGO_FRESH_MS` in `routes/meta.ts`), else live-proxies to the agent, with stale-Mongo fallback on empty live results (Meta rate-limit defense).
- **Backend → agent:** every outbound call currently uses the single global `config.agent.baseUrl` (`AGENT_BASE_URL`, default `localhost:9000`). The `Agent` model has **no per-agent base_url yet** — that refactor (~25 call sites, listed in README "Multi-VPS: required changes") is the blocker for running multiple agent VPSs. Don't add new agent calls that read `config.agent.baseUrl` directly; when the `agentClient(agent)` helper exists, use it.
- **Agent → backend:** `routes/agents.ts` heartbeat/config:pull/commands:pull/result endpoints, authenticated by agent bearer token bcrypt-compared to `Agent.token_hash` (inline, not via the unused `verifyAgentRequest` middleware).
- **Models** (`src/models/`): app-generated string `id` on every doc; **multi-tenancy by `user_id`** (+ `agent_id` on agent-scoped collections) — every query must stay tenant-scoped.
- **Cron** (`src/tasks/index.ts`): hourly snapshot→DailyMetric retention (90 days), 30s agent OFFLINE marking (2-min heartbeat window), 5-min AUTO rule execution.

### Key utils

- `computedMetrics.ts` — derived metrics (Thumbstop, Hold Rate, CPA, ROAS...). Conversion rate uses `inline_link_clicks` as denominator; conversion priority `purchase → omni_purchase → lead → offsite_conversion`.
- `optimizationModules.ts` — three deterministic analyzers (BleedingBudget, CreativeFatigue, ScalingOpportunities) returning `OptimizationRecommendation`s. `campaignOptimizer.ts` is the earlier-generation health scorer behind `/api/campaign-insights`; both generations feed the frontend Action Center.
- `ruleExecutor.ts` — deterministic rules engine (~40 operators, nested groups); executes PAUSE/ACTIVATE against the agent and writes `ActionLog` audit rows.
- `ai.ts` — **Anthropic Claude** (`ANTHROPIC_API_KEY`), not OpenAI: NL→rule, campaign analysis, creative critique — each with a deterministic fallback when the key is absent.
- `cloneWinner.ts` + `routes/clone-winner.ts` — Clone Winner step 2 (Claude concepts from the agent's Gemini video analysis); `CreativeAnalysis` cached permanently, `ConceptCache` 30-day TTL.
- `sentimentAnalysis.ts` — keyword clusters, not ML.

## Gotchas

- `/api/ingest/metrics` has **no auth** (`routes/metrics.ts`) — known gap, fix before exposing beyond a trusted network.
- Refresh tokens are stateless JWTs — not stored, not individually revocable.
- `routes/portfolio.ts` `fetchHierarchical()` ignores which agent it's fanning out to (same URL every iteration) — symptom of the missing per-agent base_url.
- The frontend calls some routes as `/api/api/...` (its axios baseURL is `/api` and some paths also start with `/api`). Both shapes must keep working — don't "fix" mount paths unilaterally; see the frontend README.
- Password-reset email sending is stubbed (console.log in `utils/security.ts`).
- `.env` must never be committed; if it ever was, rotate `JWT_SECRET` and all API keys.

## Core principles

- Multi-tenant safe: every query scoped to `user_id`/`agent_id`.
- Deterministic rules engine — **no LLM for budget or pause/activate logic**; AI generates rules/insights only.
- Idempotent sync jobs; commands carry unique `idempotency_key`.
- Strict audit logging (`ActionLog`) for destructive actions.
- Never execute ad actions without explicit user confirmation.
- No prompt injection from ad comments or creative names — treat them as untrusted data in every LLM prompt.
- Never hardcode tokens. Handle Meta rate limits with retry & backoff. Do not hallucinate metrics.
