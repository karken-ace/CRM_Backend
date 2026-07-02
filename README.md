# ACES Backend — CRM API Server

Node.js + Express + TypeScript API server for the ACES CRM, a Meta Ads management platform. Owns MongoDB, authentication, the deterministic optimization engine, the rules engine, and all AI integrations. It manages a **fleet of remote agent services** (Python/FastAPI, separate repo), each running on its own VPS and wrapping one Meta ad account.

## Role in the multi-VPS architecture

```
                         CENTRAL VPS  (this repo + frontend + MongoDB)
        ┌──────────────────────────────────────────────┐
        │  nginx ──► Frontend (static /dist)           │
        │        └─► Backend  (Express :8000)  ← this  │
        │  MongoDB (auth enabled, firewalled)          │
        └───────┬──────────────────▲───────────────────┘
                │ HTTPS +          │ Mongo writes
                │ shared secret    │ (agent sync loop)
   ┌────────────┼─────────┬────────┴─────┐
┌──▼─────┐  ┌───▼────┐  ┌─▼──────┐       │
│Agent 1 │  │Agent 2 │  │Agent N │  one VPS per Meta account,
│VPS/IP 1│  │VPS/IP 2│  │VPS/IP N│  each with its own public IP
└────────┘  └────────┘  └────────┘
     ▼           ▼           ▼
  Meta API   Meta API    Meta API
```

- **Backend → agent (outbound):** live Meta reads, breakdowns, status/budget mutations, sync triggers, Clone Winner video analysis. Each agent is reachable at its own base URL (public IP or domain), protected by TLS + a shared secret. ⚠️ *This per-agent routing is the one part the current code does not implement yet — see "Multi-VPS: required changes".*
- **Agent → backend (inbound):** heartbeat, config:pull, commands:pull, meta:sync status — authenticated with the agent's bearer token (bcrypt-compared against `Agent.token_hash`).
- **Agent → MongoDB (direct):** the agents' 5-minute sync loops upsert campaigns/adsets/ads straight into this backend's MongoDB. The backend serves most dashboard reads from those collections (L3 cache) and only dials the agent when data is stale.
- **Frontend:** static build served on the same origin; all `/api/*` and `/api/meta/*` requests are reverse-proxied to this server. The frontend never talks to agents directly.

## Commands

```bash
npm install
npm run dev            # tsx watch (development), port 8000
npm run build          # tsc → dist/
npm start              # run compiled dist/
npm run create-admin   # seed an admin user
```

No test suite, linting, or CI is configured.

## Configuration (environment variables)

Loaded in `src/config/index.ts`:

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `8000` |
| `NODE_ENV` | Environment | `development` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/acesmaster` |
| `JWT_SECRET` | HS256 signing secret — **set a strong value in production** | insecure placeholder |
| `ACCESS_TTL_MINUTES` / `REFRESH_TTL_MINUTES` | Token lifetimes | `30` / `43200` (30 days) |
| `FRONTEND_URL` | CORS origin + password-reset link base | `http://localhost:3000` |
| `AGENT_BASE_URL` | Base URL of *the* agent — single global value (see "Multi-VPS: required changes") | `http://localhost:9000` |
| `ANTHROPIC_API_KEY` | Claude (rule generation, campaign analysis, AI chat, Clone Winner concepts) | — |
| `GEMINI_API_KEY` | Gemini (referenced by config; video analysis itself runs on the agent) | — |
| `SMTP_SERVER` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | Password-reset email (sending currently stubbed to console.log) | gmail defaults |

> ⚠️ **Secrets hygiene:** a `.env` with real-looking API keys and a weak `JWT_SECRET` has lived in this directory during development. Before publishing this repo anywhere: ensure `.env` is gitignored **and absent from git history**, rotate any keys that were ever committed, and set a strong `JWT_SECRET`.

## API surface

Mounted in `src/index.ts`. Global middleware: CORS → JSON body → security headers → request logging → general rate limiter (100 req/min; auth endpoints 10/min).

| Mount | Auth | Purpose |
|---|---|---|
| `GET /healthz`, `/readyz` | none | Liveness/readiness |
| `/api/auth` | rate-limited | `POST /login`, `/refresh`, `/request-password-reset`, `/reset-password` |
| `/api/users` | JWT + ADMIN | User CRUD |
| `/api/agents` | mixed | Agent CRUD (JWT) **plus agent-facing endpoints** (agent bearer token): `POST /:id/heartbeat`, `/:id/config:pull`, `/:id/commands:pull`, `/commands/:command_id/result` |
| `/api/ad-accounts` | JWT | Link Meta ad accounts to agents |
| `/api/commands` | JWT | Enqueue/inspect agent commands (idempotency-keyed) |
| `/api/ingest` | **none** ⚠️ | `POST /metrics` — metric snapshot ingest (see required changes) |
| `/api/ad-set-rules` | JWT | Rule CRUD, `/schema`, `/generate` (AI NL→rule), `/analyze`, `/preview`, `/:id/execute` |
| `/api/campaign-insights` | JWT | `POST /health`, `POST /quick-wins` |
| `/api/optimization-insights` | JWT | `/analyze`, `/module/:name`, `/sentiment`, `/config`, `/execute-action`, `/creative-analysis` |
| `/api/notifications` | JWT | Notification feed CRUD |
| `/api/clone-winner` | JWT | Two-step Gemini→Claude creative-cloning pipeline |
| `/api/sync` | JWT | `POST /trigger` — force an agent Meta sync |
| `/api/ai-chat` | JWT | Free-form Claude chat over campaign data |
| `/api/portfolio` | JWT | Cross-agent aggregation: `/accounts`, `/kpis`, `/action-queue`, `/activity` |
| `/meta/*` | JWT | Proxy of Meta data endpoints to the agent (reads use a 240s timeout; mutations 10s; hierarchical reads served from Mongo when < 15 min fresh, live agent call otherwise, stale-Mongo fallback on empty live results) |

Note the frontend calls some routes as `/api/api/...` due to a base-URL quirk on its side — nginx just forwards the `/api` prefix and Express handles both shapes because routers are mounted at `/api/...` while the frontend's axios base adds another `/api`. See the frontend README ("API base URL and the double-prefix quirk") before changing any mount path.

## Data model (Mongoose, `src/models/`)

Every document carries a string `id` (app-generated, e.g. `agent-xxxxxxxx`, `ms_...`). **Multi-tenancy is by `user_id`** on nearly every collection; agent-scoped collections also carry `agent_id`. Every query must stay scoped to its tenant.

- **User** — email, bcrypt `password_hash`, role `ADMIN|USER`, `is_active`.
- **Agent** — `id`, `user_id`, `name`, `status` (ONLINE/OFFLINE), `last_heartbeat_at`, `allowed_ip`, `token` (returned to owner once), `token_hash` (bcrypt). *No `base_url` field yet — see required changes.* Created via `POST /api/agents`, which generates the ID + a random 24-byte token and returns a `docker_run` bootstrap string.
- **AdAccount** — links a Meta ad account (`meta_ad_account_id`) to an agent; `cred_ref` is an opaque credential reference handed to the agent via config:pull.
- **Campaign / AdSet / Ad** — synced mirror of Meta objects **written directly by the agents' sync loops** (not through this API): `meta_id`, `status`, `effective_status`, `performance_metrics`, `raw`, `last_synced_at`, indexed by `agent_id`.
- **MetricSnapshot / DailyMetric** — raw time-series points (via `/api/ingest/metrics`) and the 90-day daily rollups.
- **Command / CommandResult** — queued agent commands (QUEUED→RUNNING→SUCCEEDED/FAILED, unique `idempotency_key`).
- **AdSetRule** — user automation rules: `filter_config` (nested condition groups, AND/OR), `action` (PAUSE/ACTIVATE), `execution_mode` (AUTO runs every 5 min / MANUAL).
- **CampaignConfig** — per-campaign `target_cpa` / `target_roas` driving optimization thresholds.
- **Notification**, **ActionLog** (audit feed for every destructive/automated action), **CreativeAnalysis** (permanent Gemini analysis per ad), **ConceptCache** (Claude concepts, 30-day TTL index), **PasswordReset**.

## Key subsystems (`src/utils/`)

- **`computedMetrics.ts`** — metrics Meta doesn't provide, derived from raw insights: Thumbstop Ratio, Hold Rate, Click-to-Landing, Checkout Rate, Conversion Rate (denominator is `inline_link_clicks`, not `clicks`), CPA, ROAS, Engagement Rate. Conversion priority: `purchase → omni_purchase → lead → offsite_conversion`.
- **`optimizationModules.ts`** — three **deterministic** analyzers (no LLM): BleedingBudgetDetector (zero-conversion spend, CPA outliers, learning-phase traps), CreativeFatigueDetector (frequency + declining CTR, weak hook/hold rates), ScalingOpportunitiesDetector (budget-restricted winners, dayparting, platform arbitrage, lookalikes). All return `OptimizationRecommendation` objects with priority (CRITICAL…OPPORTUNITY), detected/benchmark values, estimated savings/revenue, confidence 0–100.
- **`campaignOptimizer.ts`** — earlier-generation health scoring (0–100, conversion issues weighted 1.5×) feeding `/api/campaign-insights`. Both generations feed the frontend's Action Center.
- **`ruleExecutor.ts`** — the rules engine: ~40 operators (comparison, regex, date/time, statistical, trend, null checks), nested condition groups, campaign statistics (percentiles). `executeRule` fetches ad sets from the agent, evaluates, PUTs status changes back, and writes `ActionLog` rows. Deterministic — **no LLM in the execution path**.
- **`sentimentAnalysis.ts`** — keyword-cluster comment sentiment (scam/pricing/quality/service/delivery), not ML. Flags ads >20% negative.
- **`ai.ts`** — Anthropic Claude integration (`claude-sonnet-4-*` via `ANTHROPIC_API_KEY`): natural-language → rule JSON, campaign analysis narratives, creative critique. Every AI feature has a deterministic fallback when the key is absent. **AI is never used for budget or pause/activate decisions.**
- **`cloneWinner.ts`** — Clone Winner step 2: Claude generates 5 video concepts from the Gemini analysis (step 1 runs on the agent). Orchestrated in `routes/clone-winner.ts` with demo-mode fallback.

## Background jobs (`src/tasks/index.ts`, node-cron)

| Job | Schedule | Action |
|---|---|---|
| Metric retention | hourly | Roll `MetricSnapshot`s older than 90 days into `DailyMetric`, delete the raw snapshots |
| Agent liveness | every 30 s | Mark agents OFFLINE when no heartbeat for 2 minutes |
| Auto rules | every 5 min | Execute every active `AdSetRule` with `execution_mode: 'AUTO'` |

## Authentication

- **Users:** JWT HS256, access token 30 min / refresh 30 days, both stateless (refresh tokens are not stored server-side and cannot be revoked individually — rotating `JWT_SECRET` invalidates everything). Role-based access (`USER`, `ADMIN`) via `requireRoles`. Passwords bcrypt (cost 10), policy ≥8 chars + digit + uppercase.
- **Agents:** bearer token per agent, bcrypt-verified against `token_hash`, optional `allowed_ip` pinning. Agent-facing routes live in `routes/agents.ts`.
- **Rate limits:** 100/min general, 10/min auth (a 30/min agent limiter exists but is not mounted).

## Multi-VPS: required changes ⚠️

The code currently assumes **one agent co-located on localhost**. To run a fleet of agent VPSs, these changes are required, in order of importance:

1. **Per-agent base URL (blocker for >1 agent).** `config.agent.baseUrl` is a single global env value. The `Agent` model needs a `base_url` field (set at registration), and every outbound call site must use the target agent's URL instead of the global. Full call-site list:
   - `routes/meta.ts:26, 58, 672`
   - `routes/ad-set-rules.ts:110, 172, 222, 337, 525, 568`
   - `routes/optimization-insights.ts:93, 211, 395, 402, 416, 429, 441, 458, 476`
   - `routes/portfolio.ts:43` — `fetchHierarchical()` takes no agent argument; the fan-out loop at `portfolio.ts:87-89` hits the *same* URL for every agent today
   - `routes/clone-winner.ts:230-231`
   - `routes/campaign-insights.ts:38, 104`
   - `routes/sync.ts:41`
   - `utils/ruleExecutor.ts:446, 478`

   Recommended shape: an `agentClient(agent)` helper that returns a pre-configured axios instance (`baseURL: agent.base_url`, shared-secret header, timeouts), then mechanically replace the ~25 sites. Keep `AGENT_BASE_URL` as a dev-mode fallback when `agent.base_url` is empty. (This matches Part B of `docs/UNIVERSAL_DASHBOARD_PLAN.md` in the original monorepo.)
2. **Shared secret on backend→agent calls.** Agents' inbound APIs are unauthenticated; with public base URLs each agent should sit behind TLS and require a secret header (e.g. `X-Agent-Key`). Send it from `agentClient` and enforce it at the agent's nginx (or in the agent app). Per-agent secrets can reuse the existing agent token.
3. **Authenticate `/api/ingest/metrics`.** It currently has *no* auth (`routes/metrics.ts`) — any host that reaches it can write metrics. Reuse the agent bearer-token check (`verifyAgentRequest` in `middleware/auth.ts` already exists but is unused by this route).
4. **MongoDB exposure.** Agents write to this Mongo directly, so it must be reachable from the agent VPSs: enable auth, create a least-privilege user for agents (`campaigns`, `adsets`, `ads`, `meta_cache`, read on `agents`), bind beyond localhost, and firewall the port to the agent IPs (or use a WireGuard/Tailscale private network). **Never expose an auth-less Mongo publicly.**
5. **CORS / URLs.** Set `FRONTEND_URL` to the production origin. Password-reset links use it too.

## Deployment (central VPS)

1. Install Node 20+, MongoDB 6+ (with `--auth`), nginx.
2. Clone, `npm install && npm run build`, create `.env` (see Configuration).
3. systemd unit:
   ```ini
   [Service]
   WorkingDirectory=/opt/aces-backend
   EnvironmentFile=/opt/aces-backend/.env
   ExecStart=/usr/bin/node dist/index.js
   Restart=always
   ```
4. nginx: serve the frontend `dist/` as static files and proxy the API to :8000 —
   ```nginx
   server {
     listen 443 ssl;
     server_name crm.example.com;
     root /opt/aces-frontend/dist;
     location /api/ { proxy_pass http://127.0.0.1:8000; proxy_read_timeout 300s; }
     location / { try_files $uri /index.html; }
   }
   ```
   The long `proxy_read_timeout` matters: hierarchical Meta reads proxied to agents use up to 240 s.
5. `npm run create-admin`, log in, register agents (each registration yields the id + token to place on that agent's VPS).
6. Firewall: expose only 443 (and 22). MongoDB's port opens only to agent VPS IPs.

## Splitting out of the monorepo

This directory was `backend/` in the `CRM` monorepo. Extract with history:

```bash
git clone /path/to/CRM aces-backend && cd aces-backend
git filter-repo --subdirectory-filter backend
git remote add origin git@github.com:<org>/aces-backend.git
git push -u origin main
```

Before pushing: confirm `.env` is not in history (`git log --all --full-history -- .env`); if it ever was, **rotate the JWT secret and every API key it contained** and scrub it (`git filter-repo --invert-paths --path .env`). Related repos after the split: `aces-frontend` (React UI, deployed on this same VPS) and `aces-agent` (Python Meta agent, one per account VPS).
