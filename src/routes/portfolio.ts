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
import { Agent, ActionLog, CampaignConfig } from '../models';
import { IAgent } from '../models/Agent';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { agentClient } from '../utils/agentClient';
import {
  enrichArrayWithComputedMetrics,
  getConversions,
  getRevenue,
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

/** Fetch the hierarchical campaign tree for one agent over one period.
 *  Returns `[]` on any error so a single bad agent doesn't take the page down. */
async function fetchHierarchical(agent: IAgent, period: Period): Promise<any[]> {
  try {
    const r = await agentClient(agent).get(`/meta/campaigns/hierarchical?date_preset=${period}`, { timeout: 60000 });
    const root = r.data?.data ?? r.data;
    return root?.campaigns ?? [];
  } catch (e) {
    console.error(`portfolio: hierarchical fetch failed for agent ${agent.id}`, e);
    return [];
  }
}

/** Sum the standard rollup metrics across every ad set in a campaign tree.
 *  All Meta fields are strings in their API — coerce defensively. */
function rollupCampaigns(campaigns: any[]): {
  spend: number; revenue: number; conversions: number;
  linkClicks: number; impressions: number; clicks: number;
} {
  let spend = 0, revenue = 0, conversions = 0, linkClicks = 0, impressions = 0, clicks = 0;
  for (const c of campaigns) {
    for (const adSet of (c.ad_sets ?? [])) {
      const m = adSet.performance_metrics ?? {};
      spend       += parseFloat(m.spend ?? 0);
      impressions += parseInt(m.impressions ?? 0);
      clicks      += parseInt(m.clicks ?? 0);
      linkClicks  += parseInt(m.inline_link_clicks ?? 0);
      conversions += getConversions(m);
      revenue     += getRevenue(m);
    }
  }
  return { spend, revenue, conversions, linkClicks, impressions, clicks };
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
      const campaigns = await fetchHierarchical(agent, 'last_7d');
      const totals = rollupCampaigns(campaigns);
      const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
      const target = await deriveAccountTarget(agent.id);
      // Status thresholds mirror the prototype: at target → green; >=80% → amber; else red.
      const status: 'green' | 'amber' | 'red' =
        roas >= target ? 'green' : roas >= target * 0.8 ? 'amber' : 'red';

      const flagCount = await countAgentFlags(agent);
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

/** Count the recommendations a given agent would surface in the action queue.
 *  Used as the "Flags" column on the accounts table. We run the same
 *  analyzers /action-queue uses, against the same date range. */
async function countAgentFlags(agent: IAgent): Promise<number> {
  const campaigns = await fetchHierarchical(agent, 'last_30d');
  let count = 0;
  for (const c of campaigns) {
    const adSets = enrichArrayWithComputedMetrics(c.ad_sets ?? []);
    if (!adSets.length) continue;
    const cfg = { target_cpa: undefined, target_roas: 3.0, account_avg_cpa: undefined };
    count += new BleedingBudgetDetector(cfg).analyze(adSets).length;
    count += new CreativeFatigueDetector().analyze(adSets).length;
    count += new ScalingOpportunitiesDetector(cfg).analyze(adSets).length;
  }
  return count;
}

/* ── GET /api/portfolio/kpis?period= ─────────────────────────────────── */

router.get('/kpis', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const period = (req.query.period as Period) || 'last_7d';
    if (!ALL_PERIODS.includes(period)) {
      return res.status(400).json({ detail: `period must be one of ${ALL_PERIODS.join(', ')}` });
    }

    const agents = await Agent.find(userAgentQuery(req));
    // Sum across all the user's agents. For N=1 this is a single fetch.
    const totals = (await Promise.all(agents.map(async (agent) => {
      const campaigns = await fetchHierarchical(agent, period);
      return rollupCampaigns(campaigns);
    }))).reduce((acc, t) => ({
      spend:       acc.spend + t.spend,
      revenue:     acc.revenue + t.revenue,
      conversions: acc.conversions + t.conversions,
      linkClicks:  acc.linkClicks + t.linkClicks,
      impressions: acc.impressions + t.impressions,
      clicks:      acc.clicks + t.clicks,
    }), { spend: 0, revenue: 0, conversions: 0, linkClicks: 0, impressions: 0, clicks: 0 });

    const cpa  = totals.conversions > 0 ? totals.spend / totals.conversions : 0;
    const cpc  = totals.linkClicks  > 0 ? totals.spend / totals.linkClicks  : 0;
    const roas = totals.spend       > 0 ? totals.revenue / totals.spend    : 0;

    res.json({
      period,
      kpis: {
        spend:       totals.spend,
        revenue:     totals.revenue,
        conversions: totals.conversions,
        cpa,
        link_clicks: totals.linkClicks,
        cpc,
        roas,
      },
    });
  } catch (error) {
    console.error('portfolio/kpis error:', error);
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
    const agents = await Agent.find(userAgentQuery(req));
    const allItems: ReturnType<typeof shapeQueueItem>[] = [];

    for (const agent of agents) {
      const campaigns = await fetchHierarchical(agent, 'last_30d');
      for (const c of campaigns) {
        const adSets = enrichArrayWithComputedMetrics(c.ad_sets ?? []);
        if (!adSets.length) continue;
        const target_roas = await deriveAccountTarget(agent.id);
        const cfg = { target_cpa: undefined, target_roas, account_avg_cpa: undefined };
        const recs: OptimizationRecommendation[] = [
          ...new BleedingBudgetDetector(cfg).analyze(adSets),
          ...new CreativeFatigueDetector().analyze(adSets),
          ...new ScalingOpportunitiesDetector(cfg).analyze(adSets),
        ];
        for (const r of recs) allItems.push(shapeQueueItem(r, { id: agent.id, name: agent.name }));
      }
    }

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
