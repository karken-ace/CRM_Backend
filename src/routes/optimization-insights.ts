/**
 * Optimization Insights API Routes
 * New modular optimization system with standardized response format
 */

import { Router, Response } from 'express';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { Agent, ActionLog } from '../models';
import { agentClient } from '../utils/agentClient';
import { generateId } from '../utils';
import {
  BleedingBudgetDetector,
  CreativeFatigueDetector,
  ScalingOpportunitiesDetector,
  runAllOptimizationModules,
  ModuleConfig,
  OptimizationRecommendation,
} from '../utils/optimizationModules';
import { 
  batchAnalyzeAdSentiments,
  AdSentimentResult,
} from '../utils/sentimentAnalysis';
import { enrichArrayWithComputedMetrics } from '../utils/computedMetrics';

const router = Router();

/**
 * Get campaign configuration (Target CPA, Target ROAS, etc.)
 */
async function getCampaignConfig(agentId: string, campaignId: string): Promise<ModuleConfig> {
  // TODO: Implement database storage for campaign-specific configs
  // For now, return defaults and calculate from data
  
  return {
    target_cpa: undefined, // Will be calculated if not set
    target_roas: 4.0, // Default target
    account_avg_cpa: undefined, // Will be calculated
  };
}

/**
 * Calculate account average CPA from ad sets
 */
function calculateAccountAverageCPA(adSets: any[]): number {
  let totalSpend = 0;
  let totalConversions = 0;
  
  for (const adSet of adSets) {
    const metrics = adSet.performance_metrics || {};
    totalSpend += parseFloat(metrics.spend || 0);
    
    const actions = metrics.actions || [];
    const conversions = actions.find((a: any) => 
      a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'lead'
    );
    totalConversions += conversions ? parseInt(conversions.value || 0) : 0;
  }
  
  return totalConversions > 0 ? totalSpend / totalConversions : 0;
}

/**
 * POST /api/optimization-insights/analyze
 * Run all optimization modules and return standardized recommendations
 */
router.post('/analyze', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, campaign_id, modules, include_sentiment } = req.body;
    
    if (!agent_id || !campaign_id) {
      return res.status(400).json({ detail: 'agent_id and campaign_id are required' });
    }
    
    // Verify agent access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }
    
    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }
    
    // Fetch ad sets from the hierarchical endpoint instead of the per-campaign
    // /adsets endpoint. The hierarchical fetch is cached for 5 minutes (L2),
    // already runs as part of every dashboard load, and contains identical
    // ad-set data nested under each campaign. The per-campaign endpoint hits
    // a different cache key and ends up making a fresh Meta call every time —
    // which is the main reason this route returned zero recommendations
    // whenever Meta was rate-limited (the rate-limit cycle the dashboard
    // itself triggers).
    const response = await agentClient(agent).get('/meta/campaigns/hierarchical?date_preset=last_30d', { timeout: 60000 });
    const allCampaigns = response.data?.hierarchical_structure?.campaigns
      || response.data?.data?.campaigns
      || response.data?.campaigns
      || [];
    const matchingCampaign = allCampaigns.find((c: any) => c.id === campaign_id);
    const adSets = matchingCampaign?.ad_sets || [];

    if (adSets.length === 0) {
      return res.json({
        campaign_id,
        recommendations: [],
        summary: { total_recommendations: 0, critical_issues: 0, opportunities: 0, total_estimated_savings: 0, total_estimated_revenue_increase: 0 },
        analyzed_at: new Date().toISOString(),
      });
    }

    // Enrich with computed metrics
    const enrichedAdSets = enrichArrayWithComputedMetrics(adSets);
    
    // Get campaign config
    const campaignConfig = await getCampaignConfig(agent_id, campaign_id);
    
    // Calculate account average CPA if not set
    if (!campaignConfig.account_avg_cpa) {
      campaignConfig.account_avg_cpa = calculateAccountAverageCPA(enrichedAdSets);
    }
    
    // Determine which modules to run
    const modulesToRun = modules || ['all'];
    const runAll = modulesToRun.includes('all');
    
    let recommendations: OptimizationRecommendation[] = [];
    
    // Module 1: Bleeding Budget
    if (runAll || modulesToRun.includes('bleeding_budget')) {
      const detector = new BleedingBudgetDetector(campaignConfig);
      recommendations.push(...detector.analyze(enrichedAdSets));
    }
    
    // Module 2: Creative Fatigue
    if (runAll || modulesToRun.includes('creative_fatigue')) {
      const detector = new CreativeFatigueDetector();
      // TODO: Fetch time comparison data from Meta API
      recommendations.push(...detector.analyze(enrichedAdSets));
    }
    
    // Module 3: Scaling Opportunities
    if (runAll || modulesToRun.includes('scaling')) {
      const detector = new ScalingOpportunitiesDetector(campaignConfig);
      // TODO: Fetch platform and hourly breakdowns from Meta API
      recommendations.push(...detector.analyze(enrichedAdSets));
    }
    
    // Module 4: Sentiment Analysis (optional, requires comments data)
    let sentimentResults: AdSentimentResult[] = [];
    if (include_sentiment) {
      try {
        // TODO: Fetch comments for each ad
        // For now, skip sentiment analysis if not available
      } catch (error) {
        console.error('Sentiment analysis error:', error);
      }
    }
    
    // Calculate summary statistics
    const summary = {
      total_recommendations: recommendations.length,
      critical_issues: recommendations.filter(r => r.priority === 'CRITICAL').length,
      high_priority: recommendations.filter(r => r.priority === 'HIGH').length,
      opportunities: recommendations.filter(r => r.priority === 'OPPORTUNITY').length,
      total_estimated_savings: recommendations.reduce((sum, r) => sum + (r.estimated_savings || 0), 0),
      total_estimated_revenue_increase: recommendations.reduce((sum, r) => sum + (r.estimated_revenue_increase || 0), 0),
      modules_run: runAll ? ['Bleeding Budget', 'Creative Fatigue', 'Scaling Opportunities'] : modulesToRun,
    };
    
    res.json({
      campaign_id,
      recommendations,
      summary,
      config: {
        target_cpa: campaignConfig.target_cpa || campaignConfig.account_avg_cpa,
        target_roas: campaignConfig.target_roas,
        account_avg_cpa: campaignConfig.account_avg_cpa,
      },
      analyzed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Optimization analysis error:', error);
    res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/optimization-insights/module/:module_name
 * Run a specific optimization module
 */
router.post('/module/:module_name', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { module_name } = req.params;
    const { agent_id, campaign_id } = req.body;
    
    if (!agent_id || !campaign_id) {
      return res.status(400).json({ detail: 'agent_id and campaign_id are required' });
    }
    
    // Verify agent access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }
    
    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }
    
    // Fetch ad sets data
    const response = await agentClient(agent).get(`/meta/campaigns/${campaign_id}/adsets?date_preset=last_30d`, { timeout: 15000 });
    const adSets = response.data?.ad_sets || response.data?.data || [];

    if (adSets.length === 0) {
      return res.json({
        campaign_id,
        recommendations: [],
        summary: { total_recommendations: 0, critical_issues: 0, opportunities: 0, total_estimated_savings: 0, total_estimated_revenue_increase: 0 },
        analyzed_at: new Date().toISOString(),
      });
    }

    // Enrich with computed metrics
    const enrichedAdSets = enrichArrayWithComputedMetrics(adSets);
    
    // Get campaign config
    const campaignConfig = await getCampaignConfig(agent_id, campaign_id);
    if (!campaignConfig.account_avg_cpa) {
      campaignConfig.account_avg_cpa = calculateAccountAverageCPA(enrichedAdSets);
    }
    
    let recommendations: OptimizationRecommendation[] = [];
    
    // Run specific module
    switch (module_name) {
      case 'bleeding_budget':
        const bleedingBudget = new BleedingBudgetDetector(campaignConfig);
        recommendations = bleedingBudget.analyze(enrichedAdSets);
        break;
        
      case 'creative_fatigue':
        const creativeFatigue = new CreativeFatigueDetector();
        recommendations = creativeFatigue.analyze(enrichedAdSets);
        break;
        
      case 'scaling':
        const scaling = new ScalingOpportunitiesDetector(campaignConfig);
        recommendations = scaling.analyze(enrichedAdSets);
        break;
        
      default:
        return res.status(400).json({ 
          detail: `Unknown module: ${module_name}. Available: bleeding_budget, creative_fatigue, scaling` 
        });
    }
    
    res.json({
      campaign_id,
      module: module_name,
      recommendations,
      count: recommendations.length,
      analyzed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(`Module ${req.params.module_name} error:`, error);
    res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/optimization-insights/sentiment
 * Run sentiment analysis on ad comments
 */
router.post('/sentiment', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, ad_ids } = req.body;
    
    if (!agent_id || !ad_ids || !Array.isArray(ad_ids)) {
      return res.status(400).json({ detail: 'agent_id and ad_ids (array) are required' });
    }
    
    // Verify agent access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }
    
    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }
    
    // Fetch comments for each ad from Meta API
    // TODO: Implement Meta API comment fetching through agent
    const adsWithComments: Array<{ ad: any; comments: any[] }> = [];
    
    // For now, return placeholder
    const result = await batchAnalyzeAdSentiments(adsWithComments);
    
    res.json({
      ...result,
      analyzed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Sentiment analysis error:', error);
    res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/optimization-insights/config
 * Update campaign optimization config (Target CPA, Target ROAS)
 */
router.post('/config', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, campaign_id, target_cpa, target_roas } = req.body;
    
    if (!agent_id || !campaign_id) {
      return res.status(400).json({ detail: 'agent_id and campaign_id are required' });
    }
    
    // Verify agent access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }
    
    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }
    
    // TODO: Store config in database (create CampaignConfig model)
    // For now, just validate and return
    
    const config: ModuleConfig = {};
    
    if (target_cpa !== undefined) {
      if (typeof target_cpa !== 'number' || target_cpa <= 0) {
        return res.status(400).json({ detail: 'target_cpa must be a positive number' });
      }
      config.target_cpa = target_cpa;
    }
    
    if (target_roas !== undefined) {
      if (typeof target_roas !== 'number' || target_roas <= 0) {
        return res.status(400).json({ detail: 'target_roas must be a positive number' });
      }
      config.target_roas = target_roas;
    }
    
    res.json({
      campaign_id,
      config,
      message: 'Configuration updated successfully',
      updated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Config update error:', error);
    res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/optimization-insights/execute-action
 * Execute a recommended action (pause, activate, budget change) on a Meta ad set
 */
router.post('/execute-action', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, action_type, entity_id, entity_type, action_params } = req.body;

    if (!agent_id || !action_type || !entity_id) {
      return res.status(400).json({ detail: 'agent_id, action_type, and entity_id are required' });
    }

    // Verify agent access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    // entity_type defaults to 'adset' for backward-compatibility with the
    // existing action center. Budget changes only apply at the ad-set level
    // on Meta — individual ads inherit from the parent set.
    const entityType: 'ad' | 'adset' = entity_type === 'ad' ? 'ad' : 'adset';
    const statusPath = entityType === 'ad' ? `ads/${entity_id}/status` : `adsets/${entity_id}/status`;

    const client = agentClient(agent);
    let result;

    switch (action_type) {
      case 'pause': {
        const response = await client.put(`/meta/${statusPath}`, { status: 'PAUSED' }, { timeout: 15000 });
        result = response.data;
        break;
      }

      case 'activate': {
        const response = await client.put(`/meta/${statusPath}`, { status: 'ACTIVE' }, { timeout: 15000 });
        result = response.data;
        break;
      }

      case 'budget': {
        // Meta only allows budget edits at the ad-set level.
        if (entityType === 'ad') {
          return res.status(400).json({ detail: 'Budget changes must be applied at the ad-set level. Provide the parent ad_set_id as entity_id.' });
        }
        if (!action_params || (!action_params.daily_budget && !action_params.lifetime_budget)) {
          return res.status(400).json({ detail: 'budget action requires daily_budget or lifetime_budget in action_params' });
        }
        const budgetPayload: any = {};
        if (action_params.daily_budget) budgetPayload.daily_budget = action_params.daily_budget;
        if (action_params.lifetime_budget) budgetPayload.lifetime_budget = action_params.lifetime_budget;
        const budgetResponse = await client.put(`/meta/adsets/${entity_id}/budget`, budgetPayload, { timeout: 15000 });
        result = budgetResponse.data;
        break;
      }

      case 'archive': {
        // Permanent state — different from pause (Meta exposes a distinct
        // ARCHIVED status). Archived entities can't be re-activated; user
        // must duplicate to recover.
        const response = await client.put(`/meta/${statusPath}`, { status: 'ARCHIVED' }, { timeout: 15000 });
        result = response.data;
        break;
      }

      case 'duplicate': {
        // Mirrors Meta Ads Manager's "Duplicate" button. New copy lands as
        // PAUSED so the user can review before turning it on.
        if (entityType !== 'adset') {
          return res.status(400).json({ detail: 'Duplicate is currently only supported for ad sets.' });
        }
        const body: any = {
          status_option: action_params?.status_option || 'PAUSED',
          rename_suffix: action_params?.rename_suffix || ' (Copy)',
        };
        const response = await client.post(`/meta/adsets/${entity_id}/duplicate`, body, { timeout: 20000 });
        result = response.data;
        break;
      }

      case 'set_frequency_cap': {
        if (entityType !== 'adset') {
          return res.status(400).json({ detail: 'Frequency caps live on ad sets.' });
        }
        if (!action_params?.max_frequency) {
          return res.status(400).json({ detail: 'set_frequency_cap requires action_params.max_frequency' });
        }
        const body = {
          max_frequency: action_params.max_frequency,
          interval_days: action_params.interval_days || 7,
          event: action_params.event || 'IMPRESSIONS',
        };
        const response = await client.put(`/meta/adsets/${entity_id}/frequency-cap`, body, { timeout: 15000 });
        result = response.data;
        break;
      }

      case 'set_bid_strategy': {
        if (entityType !== 'adset') {
          return res.status(400).json({ detail: 'Bid strategy applies to ad sets.' });
        }
        if (!action_params?.bid_strategy) {
          return res.status(400).json({ detail: 'set_bid_strategy requires action_params.bid_strategy' });
        }
        const body: any = { bid_strategy: action_params.bid_strategy };
        if (action_params.bid_amount != null) body.bid_amount = action_params.bid_amount;
        const response = await client.put(`/meta/adsets/${entity_id}/bid-strategy`, body, { timeout: 15000 });
        result = response.data;
        break;
      }

      default:
        return res.status(400).json({
          detail: `Unknown action_type: ${action_type}. Supported: pause, activate, archive, budget, duplicate, set_frequency_cap, set_bid_strategy`
        });
    }

    // Check for application-level errors in the response
    if (result && result.status === 'error') {
      return res.status(400).json({
        success: false,
        detail: result.message || result.error_details || 'Agent returned an error',
        agent_response: result,
      });
    }

    // Audit-feed write. Best-effort: a logging failure must not break the
    // user's action. Only the action types that map onto our verbs land here;
    // duplicate / frequency_cap / bid_strategy stay off the feed until we
    // extend the enum.
    const logVerb: 'pause' | 'activate' | 'budget_adjust' | null =
      action_type === 'pause' ? 'pause'
      : action_type === 'activate' ? 'activate'
      : action_type === 'budget' ? 'budget_adjust'
      : null;
    if (logVerb) {
      try {
        await ActionLog.create({
          id: generateId('act'),
          user_id: agent.user_id,
          agent_id: agent.id,
          [entityType === 'ad' ? 'ad_id' : 'ad_set_id']: entity_id,
          source: 'optimization',
          actor: req.user!.id,
          action_type: logVerb,
          description: `${logVerb === 'pause' ? 'Paused' : logVerb === 'activate' ? 'Activated' : 'Adjusted budget on'} <b>${agent.name} · ${entity_id}</b>`,
          context: { entity_type: entityType, action_params: action_params ?? null },
        });
      } catch (logErr) {
        console.error('ActionLog write failed (optimization execute-action):', logErr);
      }
    }

    res.json({
      success: true,
      action_type,
      entity_id,
      result,
      executed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Execute action error:', error);

    let errorMessage = error.message || 'Internal server error';

    // Extract detailed error from axios response
    if (error.response) {
      if (error.response.data) {
        if (error.response.data.status === 'error') {
          errorMessage = error.response.data.message || error.response.data.error_details || errorMessage;
        } else if (error.response.data.detail) {
          errorMessage = error.response.data.detail;
        }
      }
    }

    res.status(500).json({
      success: false,
      detail: errorMessage,
    });
  }
});

/**
 * AI Creative Analysis
 * Analyzes a specific ad creative using Claude and returns insights, brief, and hook variants
 */
router.post('/creative-analysis', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, creative_data, campaign_context, currency } = req.body;

    if (!agent_id || !creative_data) {
      return res.status(400).json({ detail: 'agent_id and creative_data are required' });
    }

    // Import analyzeCreative dynamically to avoid circular deps
    const { analyzeCreative } = await import('../utils/ai');
    const result = await analyzeCreative(creative_data, campaign_context, currency);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Creative analysis error:', error);
    res.status(500).json({
      success: false,
      detail: error.message || 'Creative analysis failed',
    });
  }
});

export default router;



