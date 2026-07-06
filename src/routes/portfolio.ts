/**
 * Portfolio API — aggregates data across all of a user's agents (Meta ad
 * accounts) for the universal-shell views: /u/today, /u/accounts,
 * /u/activity.
 *
 * Everything here is read-only and fan-out: hit each agent's hierarchical
 * endpoint, sum / merge / rank in memory, return. Cached at the agent layer
 * (5-min L2 cache on the agent), so repeated calls within a window are cheap.
 */

import { Router, Response } from 'express';
import { Agent, ActionLog, CampaignConfig, Campaign, AdSet } from '../models';
import { IAgent } from '../models/Agent';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { agentClient } from '../utils/agentClient';
import {
  enrichArrayWithComputedMetrics,
  getConversions,
  getRevenue,
  getRegistrations,
} from '../utils/computedMetrics';
import {
  BleedingBudgetDetector,
  CreativeFatigueDetector,
  ScalingOpportunitiesDetector,
  OptimizationRecommendation,
} from '../utils/optimizationModules';

const router = Router();

/* ── shared helpers ──────────────────────────────────────────────────── */

type Period = 'today' | 'yesterday' | 'last_7d' | 'last_30d';
const ALL_PERIODS: Period[] = ['today', 'yesterday', 'last_7d', 'last_30d'];

function userAgentQuery(req: AuthRequest): Record<string, unknown> {
  return req.user!.role === 'ADMIN' ? {} : { user_id: req.user!.id };
}

/** Resolve the agent set a portfolio request should cover: a single agent when
 *  `agent_id` is supplied (and owned by the caller), else all of the caller's
 *  agents. Powers the topbar account filter — "all accounts" vs one account. */
async function scopedAgents(req: AuthRequest, agentId?: unknown) {
  const query = userAgentQuery(req);
  if (typeof agentId === 'string' && agentId && agentId !== 'all') {
    return Agent.find({ ...query, id: agentId });
  }
  return Agent.find(query);
}

/** Sum the standard rollup metrics across a set of ad sets (each carrying a
 *  `performance_metrics` object). All Meta fields are strings — coerce
 *  defensively. Used for both the live-tree path and the Mongo-mirror path. */
function rollupAdSets(adSets: any[]): {
  spend: number; revenue: number; conversions: number;
  linkClicks: number; impressions: number; clicks: number;
} {
  let spend = 0, revenue = 0, conversions = 0, linkClicks = 0, impressions = 0, clicks = 0;
  for (const adSet of adSets) {
    const m = adSet.performance_metrics ?? {};
    spend       += parseFloat(m.spend ?? 0) || 0;
    impressions += parseInt(m.impressions ?? 0) || 0;
    clicks      += parseInt(m.clicks ?? 0) || 0;
    linkClicks  += parseInt(m.inline_link_clicks ?? 0) || 0;
    conversions += getConversions(m);
    revenue     += getRevenue(m);
  }
  return { spend, revenue, conversions, linkClicks, impressions, clicks };
}

/** All ad sets for one agent from the Mongo L3 mirror (populated by the
 *  agent's 5-min sync). This is the fast path — no live agent round-trip —
 *  and reflects the last_30d sync window the agent runs. */
async function mirroredAdSets(agentId: string): Promise<any[]> {
  return AdSet.find({ agent_id: agentId }).lean();
}

/** Derive an account-level ROAS target from the user's CampaignConfig rows.
 *  Average of per-campaign targets; falls back to 3.0× if none set. */
async function deriveAccountTarget(agentId: string): Promise<number> {
  const configs = await CampaignConfig.find({ agent_id: agentId, target_roas: { $ne: null } });
  const vals = configs.map(c => c.target_roas).filter((v): v is number => typeof v === 'number');
  if (!vals.length) return 3.0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/* ── GET /api/portfolio/accounts ─────────────────────────────────────── */

router.get('/accounts', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const agents = await Agent.find(userAgentQuery(req));
    const rows = await Promise.all(agents.map(async (agent) => {
      const adSets = await mirroredAdSets(agent.id);   // fast — Mongo mirror
      const totals = rollupAdSets(adSets);
      const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
      const target = await deriveAccountTarget(agent.id);
      // Status thresholds mirror the prototype: at target → green; >=80% → amber; else red.
      const status: 'green' | 'amber' | 'red' =
        roas >= target ? 'green' : roas >= target * 0.8 ? 'amber' : 'red';

      const flagCount = countAgentFlags(adSets, target);
      return {
        id: agent.id,
        name: agent.name,
        status,
        spend: totals.spend,
        revenue: totals.revenue,
        roas,
        target,
        flags: flagCount,
        agent_status: agent.status,
      };
    }));
    res.json({ accounts: rows });
  } catch (error) {
    console.error('portfolio/accounts error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/** Count the recommendations the analyzers would surface for one agent's ad
 *  sets — the "Flags" column. Runs the same detectors as /action-queue, over
 *  the Mongo-mirrored ad sets (no live call). */
function countAgentFlags(rawAdSets: any[], targetRoas: number): number {
  const adSets = enrichArrayWithComputedMetrics(rawAdSets);
  if (!adSets.length) return 0;
  const cfg = { target_cpa: undefined, target_roas: targetRoas, account_avg_cpa: undefined };
  return new BleedingBudgetDetector(cfg).analyze(adSets).length
    + new CreativeFatigueDetector().analyze(adSets).length
    + new ScalingOpportunitiesDetector(cfg).analyze(adSets).length;
}

/* ── GET /api/portfolio/kpis?period= ─────────────────────────────────── */

/** YYYY-MM-DD for a date offset by `d` days from today (server clock —
 *  Meta interprets since/until in the ad account's own timezone, close
 *  enough for portfolio-level deltas). */
function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Current + previous comparison windows per period. Presets follow Meta's
 *  own semantics (last_7d/last_30d exclude today). */
function periodWindows(period: Period) {
  switch (period) {
    case 'today':
      return { note: 'vs yesterday', cur: [isoDay(0), isoDay(0)], prev: [isoDay(-1), isoDay(-1)] };
    case 'yesterday':
      return { note: 'vs 2 days ago', cur: [isoDay(-1), isoDay(-1)], prev: [isoDay(-2), isoDay(-2)] };
    case 'last_7d':
      return { note: 'vs prior 7 days', cur: [isoDay(-7), isoDay(-1)], prev: [isoDay(-14), isoDay(-8)] };
    case 'last_30d':
      return { note: 'vs prior 30 days', cur: [isoDay(-30), isoDay(-1)], prev: [isoDay(-60), isoDay(-31)] };
  }
}

/** Account-level insights row for one agent over an explicit window.
 *  Returns zeros on any error so one bad agent doesn't sink the portfolio. */
async function fetchAccountInsights(agent: IAgent, since: string, until: string): Promise<any> {
  try {
    const r = await agentClient(agent).get(
      `/meta/insights?since=${since}&until=${until}&level=account`,
      { timeout: 60000 },
    );
    return r.data?.data || {};
  } catch (e) {
    console.error(`portfolio/kpis: insights fetch failed for agent ${agent.id} (${since}..${until})`, e);
    return {};
  }
}

/** The seven design KPIs from a summed set of account-insight rows. */
function kpisFromRows(rows: any[]) {
  let spend = 0, revenue = 0, results = 0, registrations = 0;
  for (const row of rows) {
    spend += parseFloat(row.spend ?? 0) || 0;
    revenue += getRevenue(row);
    results += getConversions(row);
    registrations += getRegistrations(row);
  }
  return {
    net_profit: revenue - spend,
    revenue,
    results,
    cost_per_result: results > 0 ? spend / results : 0,
    registrations,
    cost_per_registration: registrations > 0 ? spend / registrations : 0,
    roas: spend > 0 ? revenue / spend : 0,
    spend,
  };
}

router.get('/kpis', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const period = (req.query.period as Period) || 'last_7d';
    if (!ALL_PERIODS.includes(period)) {
      return res.status(400).json({ detail: `period must be one of ${ALL_PERIODS.join(', ')}` });
    }

    const { note, cur, prev } = periodWindows(period);
    // Optional account scope from the topbar dropdown; omitted/'all' → whole portfolio.
    const agents = await scopedAgents(req, req.query.agent_id);

    const [curRows, prevRows] = await Promise.all([
      Promise.all(agents.map(a => fetchAccountInsights(a, cur[0], cur[1]))),
      Promise.all(agents.map(a => fetchAccountInsights(a, prev[0], prev[1]))),
    ]);

    const current = kpisFromRows(curRows);
    const previous = kpisFromRows(prevRows);

    // Freshest sync timestamp across the portfolio, for the "Synced X min
    // ago" pill.
    const lastSync = await Campaign.findOne(
      { agent_id: { $in: agents.map(a => a.id) } },
      { last_synced_at: 1 },
    ).sort({ last_synced_at: -1 }).lean();

    res.json({
      period,
      note,
      synced_at: (lastSync as any)?.last_synced_at ?? null,
      kpis: current,
      previous,
    });
  } catch (error) {
    console.error('portfolio/kpis error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/* ── GET /api/portfolio/targets ──────────────────────────────────────── */
/** Accounts, campaigns, and ad sets across the user's portfolio (from the
 *  Mongo mirror) — powers the rule-builder scope picker and the activity
 *  campaign filter. */
router.get('/targets', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const agents = await Agent.find(userAgentQuery(req));
    const agentIds = agents.map(a => a.id);
    const [campaigns, adsets] = await Promise.all([
      Campaign.find({ agent_id: { $in: agentIds } }).select('id name agent_id -_id').lean(),
      AdSet.find({ agent_id: { $in: agentIds } }).select('id name agent_id campaign_id -_id').lean(),
    ]);
    res.json({
      accounts: agents.map(a => ({ id: a.id, name: a.name, status: a.status })),
      campaigns,
      adsets,
    });
  } catch (error) {
    console.error('portfolio/targets error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/* ── POST /api/portfolio/action-queue ────────────────────────────────── */

/** Maps an OptimizationRecommendation to the action-card shape the UI uses.
 *  Severity: CRITICAL/HIGH → 'high', MEDIUM → 'med', LOW/OPPORTUNITY → 'low'.
 *  Type: drives which action buttons the UI shows. */
function shapeQueueItem(
  rec: OptimizationRecommendation,
  agent: { id: string; name: string },
): {
  id: string; sev: 'high' | 'med' | 'low'; acct: string; acct_name: string;
  entity_id: string; entity_type: 'adset' | 'ad';
  unit: string; roas: number | null; issue: string; stake: number;
  type: 'kill' | 'budget' | 'watch'; module: string; priority: string;
  confidence: number;
} {
  const sev = rec.priority === 'CRITICAL' || rec.priority === 'HIGH'
    ? 'high' as const
    : rec.priority === 'MEDIUM' ? 'med' as const : 'low' as const;
  const queueType: 'kill' | 'budget' | 'watch' =
    rec.type === 'budget_waste' || rec.type === 'creative_alert' || rec.type === 'sentiment_warning'
      ? 'kill'
      : rec.type === 'scaling_opportunity' || rec.type === 'platform_arbitrage' || rec.type === 'dayparting'
      ? 'budget'
      : 'watch';
  const stake = Math.max(rec.estimated_savings ?? 0, rec.estimated_revenue_increase ?? 0);
  return {
    id: rec.id,
    sev,
    acct: agent.id,
    acct_name: agent.name,
    entity_id: rec.related_entity_id,
    entity_type: 'adset',
    unit: `Ad set · ${rec.related_entity_name}`,
    roas: rec.detected_value && rec.metric_label.toLowerCase().includes('roas') ? rec.detected_value : null,
    issue: rec.message,
    stake,
    type: queueType,
    module: rec.module,
    priority: rec.priority,
    confidence: rec.confidence,
  };
}

router.post('/action-queue', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    // Account scope may come from the body or query (topbar dropdown).
    const agents = await scopedAgents(req, req.body?.agent_id ?? req.query.agent_id);
    const allItems: ReturnType<typeof shapeQueueItem>[] = [];

    // Read ad sets from the Mongo mirror (fast) instead of a live hierarchical
    // fetch per agent. Reflects the agent's most recent 5-min sync.
    await Promise.all(agents.map(async (agent) => {
      const adSets = enrichArrayWithComputedMetrics(await mirroredAdSets(agent.id));
      if (!adSets.length) return;
      const target_roas = await deriveAccountTarget(agent.id);
      const cfg = { target_cpa: undefined, target_roas, account_avg_cpa: undefined };
      const recs: OptimizationRecommendation[] = [
        ...new BleedingBudgetDetector(cfg).analyze(adSets),
        ...new CreativeFatigueDetector().analyze(adSets),
        ...new ScalingOpportunitiesDetector(cfg).analyze(adSets),
      ];
      for (const r of recs) allItems.push(shapeQueueItem(r, { id: agent.id, name: agent.name }));
    }));

    // Rank by money at risk, desc. Ties broken by priority weight.
    const priorityWeight: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, OPPORTUNITY: 0 };
    allItems.sort((a, b) =>
      b.stake - a.stake || (priorityWeight[b.priority] - priorityWeight[a.priority])
    );

    res.json({ items: allItems, count: allItems.length });
  } catch (error) {
    console.error('portfolio/action-queue error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/* ── GET /api/portfolio/activity ─────────────────────────────────────── */

router.get('/activity', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, campaign_id, source_type, since } = req.query;
    const query: Record<string, unknown> = {};
    if (req.user!.role !== 'ADMIN') query.user_id = req.user!.id;
    if (agent_id) query.agent_id = agent_id;
    if (campaign_id) query.campaign_id = campaign_id;

    if (source_type === 'auto') {
      query.actor = 'auto';
    } else if (source_type === 'manual') {
      query.actor = { $ne: 'auto' };
    }

    if (since) {
      const days = Number(since);
      if (!Number.isFinite(days) || days < 0) {
        return res.status(400).json({ detail: 'since must be a non-negative number of days' });
      }
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      query.created_at = { $gte: cutoff };
    }

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const entries = await ActionLog.find(query)
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();

    res.json({ entries, count: entries.length });
  } catch (error) {
    console.error('portfolio/activity error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
