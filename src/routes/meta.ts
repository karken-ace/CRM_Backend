import { Router, Response } from 'express';
import { Agent, Campaign, AdSet, Ad } from '../models';
import { authenticate, requireRoles, AuthRequest, verifyAgentRequest } from '../middleware/auth';
import { agentClient, agentBaseUrl } from '../utils/agentClient';

// Layer 3 staleness threshold: if Mongo's most recent sync for this agent
// is within MONGO_FRESH_MS, serve from Mongo. Otherwise fall back to a live
// agent call so first-time / stale-deploy users still get data.
const MONGO_FRESH_MS = 15 * 60 * 1000; // 15 min

const router = Router();

/** Build a `?a=1&b=2` string from the whitelisted query params present on the
 *  request, so the agent receives the caller's date range/level instead of
 *  the agent-side defaults. Values are URL-encoded. Returns '' when none set. */
function forwardQuery(req: AuthRequest, keys: string[]): string {
  const parts: string[] = [];
  for (const k of keys) {
    const v = req.query[k];
    if (typeof v === 'string' && v.length > 0) {
      parts.push(`${k}=${encodeURIComponent(v)}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

async function getAgentMetaData(agentId: string, endpoint: string): Promise<any> {
  const agent = await Agent.findOne({ id: agentId });
  
  if (!agent) {
    throw new Error('Agent not found');
  }
  
  if (agent.status !== 'ONLINE') {
    throw new Error('Agent is offline. Meta data is only available when agent is connected.');
  }

  try {
    // 240s — hierarchical campaigns + thumbnails + any brief rate-limit retry in
    // the agent. Must be ≤ nginx proxy_read_timeout (300s) and large enough for
    // Meta's cold-cache response plus one short backoff.
    const response = await agentClient(agent).get(`/meta/${endpoint}`, { timeout: 240000 });
    return response.data;
  } catch (error: any) {
    if (error.code === 'ECONNABORTED') {
      throw new Error('Agent request timed out');
    }
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to agent. Make sure the agent is running on ' + agentBaseUrl(agent));
    }
    if (error.response) {
      throw new Error(`Agent returned error: ${error.response.status} ${error.response.statusText}`);
    }
    throw new Error('Agent returned an error');
  }
}

async function updateAgentMetaData(agentId: string, endpoint: string, data: any): Promise<any> {
  const agent = await Agent.findOne({ id: agentId });
  
  if (!agent) {
    throw new Error('Agent not found');
  }
  
  if (agent.status !== 'ONLINE') {
    throw new Error('Agent is offline. Meta data is only available when agent is connected.');
  }

  try {
    const response = await agentClient(agent).put(`/meta/${endpoint}`, data, { timeout: 10000 });
    
    // Check for application-level errors in the response
    if (response.data && response.data.status === 'error') {
      const errorMessage = response.data.message || response.data.error_details || 'Agent returned an error';
      throw new Error(errorMessage);
    }
    
    return response.data;
  } catch (error: any) {
    if (error.code === 'ECONNABORTED') {
      throw new Error('Agent request timed out');
    }
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to agent. Make sure the agent is running on ' + agentBaseUrl(agent));
    }
    if (error.response) {
      // If the agent returned an error response, try to extract the message
      if (error.response.data && error.response.data.status === 'error') {
        const errorMessage = error.response.data.message || error.response.data.error_details || 'Agent returned an error';
        throw new Error(errorMessage);
      }
      throw new Error(`Agent returned error: ${error.response.status} ${error.response.statusText}`);
    }
    // If error.message already exists (from our check above), throw it
    if (error.message) {
      throw error;
    }
    throw new Error('Agent returned an error');
  }
}

// Test Meta connection
router.get('/test', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    const data = await getAgentMetaData(agent_id, 'test');
    res.json(data);
  } catch (error: any) {
    if (error.message === 'Agent not found') {
      return res.status(404).json({ detail: error.message });
    }
    if (error.message.includes('offline')) {
      return res.status(503).json({ detail: error.message });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ detail: error.message });
    }
    if (error.message.includes('connect')) {
      return res.status(503).json({ detail: error.message });
    }
    return res.status(502).json({ detail: error.message });
  }
});

// Get Meta account
router.get('/account', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    const data = await getAgentMetaData(agent_id, 'account');
    res.json(data);
  } catch (error: any) {
    if (error.message === 'Agent not found') {
      return res.status(404).json({ detail: error.message });
    }
    if (error.message.includes('offline')) {
      return res.status(503).json({ detail: error.message });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ detail: error.message });
    }
    if (error.message.includes('connect')) {
      return res.status(503).json({ detail: error.message });
    }
    return res.status(502).json({ detail: error.message });
  }
});

// Get Meta campaigns
router.get('/campaigns', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    const data = await getAgentMetaData(agent_id, 'campaigns');
    res.json(data);
  } catch (error: any) {
    if (error.message === 'Agent not found') {
      return res.status(404).json({ detail: error.message });
    }
    if (error.message.includes('offline')) {
      return res.status(503).json({ detail: error.message });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ detail: error.message });
    }
    if (error.message.includes('connect')) {
      return res.status(503).json({ detail: error.message });
    }
    return res.status(502).json({ detail: error.message });
  }
});

// Get Meta insights
router.get('/insights', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    // Forward the date range / level so the agent doesn't fall back to its
    // "account, today" default (which reads as all-zero for paused accounts).
    const qs = forwardQuery(req, ['date_preset', 'since', 'until', 'level']);
    const data = await getAgentMetaData(agent_id, `insights${qs}`);
    res.json(data);
  } catch (error: any) {
    if (error.message === 'Agent not found') {
      return res.status(404).json({ detail: error.message });
    }
    if (error.message.includes('offline')) {
      return res.status(503).json({ detail: error.message });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ detail: error.message });
    }
    if (error.message.includes('connect')) {
      return res.status(503).json({ detail: error.message });
    }
    return res.status(502).json({ detail: error.message });
  }
});

/**
 * Get hierarchical campaigns — Layer 3 read path.
 *
 * Reads campaigns + nested ad_sets + nested ads from Mongo (populated by
 * the agent's scheduled sync_meta_data_loop). When Mongo has data that's
 * fresher than MONGO_FRESH_MS, serves it directly — typical response time
 * <100ms vs ~10-60s for the live Meta path.
 *
 * Falls back to a live agent call when Mongo is empty or stale (e.g. fresh
 * deploy, sync hasn't completed yet, agent has been down). This preserves
 * the old behavior for first-load scenarios per Q4 of the Layer 3 plan.
 */
router.get('/campaigns/hierarchical', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, date_preset } = req.query;
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    const datePreset = typeof date_preset === 'string' ? date_preset : 'last_30d';

    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    // The scheduled agent sync only writes data for `last_30d`. For any
    // other preset (today/yesterday/last_7d/this_month), the Mongo cache
    // would silently return last_30d totals — making the dashboard's time
    // pills look broken. Bypass the cache and go live for those presets.
    // The agent's own meta_client has L1+L2 caches keyed by preset, so the
    // first call costs ~5–10s and subsequent calls are sub-second.
    const cachePresetMatches = datePreset === 'last_30d';

    // Try Mongo first (only when the requested preset matches the synced one).
    const mongoCampaigns = cachePresetMatches
      ? await Campaign.find({ agent_id }).lean()
      : [];
    if (mongoCampaigns.length > 0) {
      // Find the freshest sync timestamp across this agent's campaigns.
      const lastSync = mongoCampaigns.reduce((max: Date, c: any) =>
        c.last_synced_at && c.last_synced_at > max ? c.last_synced_at : max,
        new Date(0)
      );
      const ageMs = Date.now() - lastSync.getTime();
      if (ageMs < MONGO_FRESH_MS) {
        // Re-assemble the hierarchical tree the dashboard expects: each
        // campaign carries its ad_sets array, each ad_set carries its ads.
        const campaignIds = mongoCampaigns.map((c: any) => c.id);
        const [allAdSets, allAds] = await Promise.all([
          AdSet.find({ agent_id, campaign_id: { $in: campaignIds } }).lean(),
          Ad.find({ agent_id, campaign_id: { $in: campaignIds } }).lean(),
        ]);
        const adsByAdSet: Record<string, any[]> = {};
        for (const ad of allAds) {
          (adsByAdSet[(ad as any).ad_set_id] ||= []).push(ad);
        }
        const adSetsByCampaign: Record<string, any[]> = {};
        for (const as of allAdSets) {
          const id = (as as any).id;
          const cid = (as as any).campaign_id;
          (adSetsByCampaign[cid] ||= []).push({ ...as, ads: adsByAdSet[id] || [] });
        }
        const campaignsTree = mongoCampaigns.map((c: any) => ({
          ...c,
          ad_sets: adSetsByCampaign[c.id] || [],
        }));
        return res.json({
          status: 'success',
          source: 'mongo',
          last_synced_at: lastSync.toISOString(),
          age_seconds: Math.round(ageMs / 1000),
          data: { campaigns: campaignsTree },
        });
      }
      // Stale — fall through to live fetch below.
    }

    // Fallback: live agent call. Wraps the agent's hierarchical endpoint.
    const endpoint = date_preset ? `campaigns/hierarchical?date_preset=${datePreset}` : 'campaigns/hierarchical';
    const data = await getAgentMetaData(agent_id, endpoint);
    const liveCampaigns = data?.data?.campaigns || data?.campaigns || [];

    // Defensive fallback: when Meta rate-limits the account (subcode 80004)
    // or the response is otherwise empty, the agent returns `campaigns: []`
    // gracefully — but that empties out the dashboard. If we have *any*
    // recent Mongo data, serve that instead and flag it as stale so the
    // frontend can show a "Showing 30-day cache (Meta rate-limited)" hint.
    if (liveCampaigns.length === 0) {
      const fallbackCampaigns = await Campaign.find({ agent_id }).lean();
      if (fallbackCampaigns.length > 0) {
        const lastSync = fallbackCampaigns.reduce((max: Date, c: any) =>
          c.last_synced_at && c.last_synced_at > max ? c.last_synced_at : max,
          new Date(0)
        );
        const ageMs = Date.now() - lastSync.getTime();
        const campaignIds = fallbackCampaigns.map((c: any) => c.id);
        const [allAdSets, allAds] = await Promise.all([
          AdSet.find({ agent_id, campaign_id: { $in: campaignIds } }).lean(),
          Ad.find({ agent_id, campaign_id: { $in: campaignIds } }).lean(),
        ]);
        const adsByAdSet: Record<string, any[]> = {};
        for (const ad of allAds) {
          (adsByAdSet[(ad as any).ad_set_id] ||= []).push(ad);
        }
        const adSetsByCampaign: Record<string, any[]> = {};
        for (const as of allAdSets) {
          const id = (as as any).id;
          const cid = (as as any).campaign_id;
          (adSetsByCampaign[cid] ||= []).push({ ...as, ads: adsByAdSet[id] || [] });
        }
        const campaignsTree = fallbackCampaigns.map((c: any) => ({
          ...c,
          ad_sets: adSetsByCampaign[c.id] || [],
        }));
        return res.json({
          status: 'success',
          source: 'mongo-fallback',
          last_synced_at: lastSync.toISOString(),
          age_seconds: Math.round(ageMs / 1000),
          stale_reason: 'Meta returned empty for this date range (likely rate-limited). Showing the most recent 30-day sync instead.',
          requested_preset: datePreset,
          data: { campaigns: campaignsTree },
        });
      }
    }
    res.json({ ...data, source: 'live' });
  } catch (error: any) {
    if (error.message === 'Agent not found') {
      return res.status(404).json({ detail: error.message });
    }
    if (error.message.includes('offline')) {
      return res.status(503).json({ detail: error.message });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ detail: error.message });
    }
    if (error.message.includes('connect')) {
      return res.status(503).json({ detail: error.message });
    }
    return res.status(502).json({ detail: error.message });
  }
});

// Get campaign ad sets
router.get('/campaigns/:campaign_id/adsets', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    const { campaign_id } = req.params;
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    const qs = forwardQuery(req, ['date_preset', 'since', 'until']);
    const data = await getAgentMetaData(agent_id, `campaigns/${campaign_id}/adsets${qs}`);
    res.json(data);
  } catch (error: any) {
    if (error.message === 'Agent not found') {
      return res.status(404).json({ detail: error.message });
    }
    if (error.message.includes('offline')) {
      return res.status(503).json({ detail: error.message });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ detail: error.message });
    }
    if (error.message.includes('connect')) {
      return res.status(503).json({ detail: error.message });
    }
    return res.status(502).json({ detail: error.message });
  }
});

// Get ad set ads
router.get('/adsets/:adset_id/ads', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    const { adset_id } = req.params;
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    const data = await getAgentMetaData(agent_id, `adsets/${adset_id}/ads`);
    res.json(data);
  } catch (error: any) {
    if (error.message === 'Agent not found') {
      return res.status(404).json({ detail: error.message });
    }
    if (error.message.includes('offline')) {
      return res.status(503).json({ detail: error.message });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ detail: error.message });
    }
    if (error.message.includes('connect')) {
      return res.status(503).json({ detail: error.message });
    }
    return res.status(502).json({ detail: error.message });
  }
});

// Get campaign optimization data
router.get('/optimization/:campaign_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    const { campaign_id } = req.params;
    
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    
    // Fetch campaign ad sets data
    const adSetsData = await getAgentMetaData(agent_id, `campaigns/${campaign_id}/adsets`);
    const adSets = adSetsData?.ad_sets || adSetsData?.data || [];
    
    // Return basic optimization data for the old optimization view
    res.json({
      data: {
        campaign_id,
        campaign_insights: {
          spend: adSets.reduce((sum: number, a: any) => sum + parseFloat(a.performance_metrics?.spend || 0), 0),
          impressions: adSets.reduce((sum: number, a: any) => sum + parseInt(a.performance_metrics?.impressions || 0), 0),
          clicks: adSets.reduce((sum: number, a: any) => sum + parseInt(a.performance_metrics?.clicks || 0), 0),
          cost_per_action_type: [
            {
              action_type: 'purchase',
              value: adSets.reduce((sum: number, a: any) => {
                const conversions = a.performance_metrics?.actions?.find((act: any) => 
                  act.action_type === 'purchase' || act.action_type === 'omni_purchase'
                );
                const spend = parseFloat(a.performance_metrics?.spend || 0);
                const conversionCount = conversions ? parseInt(conversions.value || 0) : 0;
                return sum + (conversionCount > 0 ? spend / conversionCount : 0);
              }, 0) / adSets.length
            }
          ]
        },
        ad_sets: adSets,
        demographic_waste: [],
        location_waste: []
      }
    });
  } catch (error: any) {
    if (error.message === 'Agent not found') {
      return res.status(404).json({ detail: error.message });
    }
    if (error.message.includes('offline')) {
      return res.status(503).json({ detail: error.message });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ detail: error.message });
    }
    if (error.message.includes('connect')) {
      return res.status(503).json({ detail: error.message });
    }
    return res.status(502).json({ detail: error.message });
  }
});

// Update ad set status
router.put('/adsets/:adset_id/status', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    const { adset_id } = req.params;
    const { status } = req.body;
    
    console.log('Update ad set status request:', { agent_id, adset_id, status, body: req.body });
    
    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ detail: 'status is required' });
    }
    
    if (!['ACTIVE', 'PAUSED', 'ARCHIVED'].includes(status)) {
      return res.status(400).json({ detail: 'Invalid status. Must be ACTIVE, PAUSED, or ARCHIVED' });
    }
    
    const data = await updateAgentMetaData(agent_id, `adsets/${adset_id}/status`, { status });
    console.log('Update ad set status response:', data);

    // After a successful mutation, immediately reflect the new status in
    // Mongo so the dashboard's next read returns it without waiting for the
    // 5-min sync cycle. Optimistic frontend writes already flip the UI; this
    // keeps backend state consistent across page reloads, other tabs, etc.
    try {
      await AdSet.updateOne(
        { id: adset_id, agent_id },
        { $set: { status, effective_status: status, last_synced_at: new Date() } }
      );
    } catch (e) {
      console.warn('Mongo AdSet patch after mutation failed (non-fatal):', e);
    }

    res.json(data);
  } catch (error: any) {
    console.error('Update ad set status error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
      status: error.response?.status
    });
    
    if (error.message === 'Agent not found') {
      return res.status(404).json({ detail: error.message });
    }
    if (error.message.includes('offline')) {
      return res.status(503).json({ detail: error.message });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ detail: error.message });
    }
    if (error.message.includes('connect')) {
      return res.status(503).json({ detail: error.message });
    }
    return res.status(502).json({ detail: error.message || 'Failed to update ad set status' });
  }
});

// Update a single Ad's status (distinct from adset). Used by Top Creatives
// Pause / Resume buttons, which operate on one ad_id at a time.
router.put('/ads/:ad_id/status', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    const { ad_id } = req.params;
    const { status } = req.body;

    if (!agent_id || typeof agent_id !== 'string') {
      return res.status(400).json({ detail: 'agent_id is required' });
    }
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ detail: 'status is required' });
    }
    if (!['ACTIVE', 'PAUSED', 'ARCHIVED'].includes(status)) {
      return res.status(400).json({ detail: 'Invalid status. Must be ACTIVE, PAUSED, or ARCHIVED' });
    }

    const data = await updateAgentMetaData(agent_id, `ads/${ad_id}/status`, { status });

    // Mirror the change into Mongo so the dashboard reflects it immediately
    // on next read. Frontend optimistic updates handle the in-flight UX;
    // this keeps backend state consistent across reloads/tabs.
    try {
      await Ad.updateOne(
        { id: ad_id, agent_id },
        { $set: { status, effective_status: status, last_synced_at: new Date() } }
      );
    } catch (e) {
      console.warn('Mongo Ad patch after mutation failed (non-fatal):', e);
    }

    res.json(data);
  } catch (error: any) {
    console.error('Update ad status error:', error);
    if (error.message === 'Agent not found') return res.status(404).json({ detail: error.message });
    if (error.message.includes('offline')) return res.status(503).json({ detail: error.message });
    if (error.message.includes('timeout')) return res.status(504).json({ detail: error.message });
    if (error.message.includes('connect')) return res.status(503).json({ detail: error.message });
    return res.status(502).json({ detail: error.message || 'Failed to update ad status' });
  }
});

// ── Breakdown & Analytics Routes ──

const breakdownErrorHandler = (error: any, res: Response) => {
  if (error.message === 'Agent not found') return res.status(404).json({ detail: error.message });
  if (error.message.includes('offline')) return res.status(503).json({ detail: error.message });
  if (error.message.includes('timeout')) return res.status(504).json({ detail: error.message });
  if (error.message.includes('connect')) return res.status(503).json({ detail: error.message });
  return res.status(502).json({ detail: error.message });
};

// Age/Gender breakdown
router.get('/breakdowns/age-gender/:campaign_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, date_preset } = req.query;
    const { campaign_id } = req.params;
    if (!agent_id || typeof agent_id !== 'string') return res.status(400).json({ detail: 'agent_id is required' });
    const dp = typeof date_preset === 'string' ? date_preset : 'last_7d';
    const data = await getAgentMetaData(agent_id, `breakdowns/age-gender/${campaign_id}?date_preset=${dp}`);
    res.json(data);
  } catch (error: any) { breakdownErrorHandler(error, res); }
});

// Platform breakdown
router.get('/breakdowns/platform/:campaign_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, date_preset } = req.query;
    const { campaign_id } = req.params;
    if (!agent_id || typeof agent_id !== 'string') return res.status(400).json({ detail: 'agent_id is required' });
    const dp = typeof date_preset === 'string' ? date_preset : 'last_7d';
    const data = await getAgentMetaData(agent_id, `breakdowns/platform/${campaign_id}?date_preset=${dp}`);
    res.json(data);
  } catch (error: any) { breakdownErrorHandler(error, res); }
});

// Daily breakdown (sparklines)
router.get('/breakdowns/daily/:campaign_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, date_preset } = req.query;
    const { campaign_id } = req.params;
    if (!agent_id || typeof agent_id !== 'string') return res.status(400).json({ detail: 'agent_id is required' });
    const dp = typeof date_preset === 'string' ? date_preset : 'last_7d';
    const data = await getAgentMetaData(agent_id, `breakdowns/daily/${campaign_id}?date_preset=${dp}`);
    res.json(data);
  } catch (error: any) { breakdownErrorHandler(error, res); }
});

// Hourly breakdown (dayparting)
router.get('/breakdowns/hourly/:campaign_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, date_preset } = req.query;
    const { campaign_id } = req.params;
    if (!agent_id || typeof agent_id !== 'string') return res.status(400).json({ detail: 'agent_id is required' });
    const dp = typeof date_preset === 'string' ? date_preset : 'last_7d';
    const data = await getAgentMetaData(agent_id, `breakdowns/hourly/${campaign_id}?date_preset=${dp}`);
    res.json(data);
  } catch (error: any) { breakdownErrorHandler(error, res); }
});

// Time comparison (7d vs 30d)
router.get('/time-comparison/:campaign_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    const { campaign_id } = req.params;
    if (!agent_id || typeof agent_id !== 'string') return res.status(400).json({ detail: 'agent_id is required' });
    const data = await getAgentMetaData(agent_id, `time-comparison/${campaign_id}`);
    res.json(data);
  } catch (error: any) { breakdownErrorHandler(error, res); }
});

// Pixel quality
router.get('/pixel-quality', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    if (!agent_id || typeof agent_id !== 'string') return res.status(400).json({ detail: 'agent_id is required' });
    const data = await getAgentMetaData(agent_id, 'pixel-quality');
    res.json(data);
  } catch (error: any) { breakdownErrorHandler(error, res); }
});

// Ad video URL — direct MP4, extracted from Meta's preview iframe. Lets
// the frontend render a clean <video> tag instead of embedding the full
// Meta preview iframe (which loads ~1MB of FB JS and pollutes the browser
// console with internal errors from useCometRouterIsPermalink etc).
router.get('/ads/:ad_id/video-url', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id } = req.query;
    const { ad_id } = req.params;
    if (!agent_id || typeof agent_id !== 'string') return res.status(400).json({ detail: 'agent_id is required' });
    const data = await getAgentMetaData(agent_id, `ads/${ad_id}/video-url`);
    res.json(data);
  } catch (error: any) { breakdownErrorHandler(error, res); }
});

// Ad preview iframe (uses Meta's Ad Previews API)
router.get('/ads/:ad_id/preview', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, ad_format } = req.query;
    const { ad_id } = req.params;
    if (!agent_id || typeof agent_id !== 'string') return res.status(400).json({ detail: 'agent_id is required' });
    const format = (typeof ad_format === 'string' ? ad_format : 'MOBILE_FEED_STANDARD');
    const data = await getAgentMetaData(agent_id, `ads/${ad_id}/preview?ad_format=${format}`);
    res.json(data);
  } catch (error: any) { breakdownErrorHandler(error, res); }
});

// Creative thumbnails (POST because it sends a list of IDs)
router.post('/creatives/thumbnails', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, creative_ids } = req.body;
    if (!agent_id || typeof agent_id !== 'string') return res.status(400).json({ detail: 'agent_id is required' });
    if (!creative_ids || !Array.isArray(creative_ids)) return res.status(400).json({ detail: 'creative_ids array is required' });

    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) return res.status(404).json({ detail: 'Agent not found' });
    if (agent.status !== 'ONLINE') return res.status(503).json({ detail: 'Agent is offline' });

    const response = await agentClient(agent).post('/meta/creatives/thumbnails', { creative_ids }, { timeout: 60000 });
    res.json(response.data);
  } catch (error: any) { breakdownErrorHandler(error, res); }
});

export default router;

