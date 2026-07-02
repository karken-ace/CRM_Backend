import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { AdSetRule, Agent } from '../models';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { generateId } from '../utils';
import { 
  generateRuleFromNaturalLanguage, 
  analyzeCampaign,
  getAvailableOperators,
  getAvailableFields,
} from '../utils/ai';
import { 
  executeRule, 
  evaluateFilterConditions, 
  calculateCampaignStatistics,
  FIELD_CATEGORIES,
} from '../utils/ruleExecutor';
import { agentClient } from '../utils/agentClient';

const router = Router();

// Get available fields and operators for rule building
router.get('/schema', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const mode = (req.query.mode as 'basic' | 'advanced') || 'basic';
    
    res.json({
      fields: getAvailableFields(mode),
      operators: getAvailableOperators(),
      actions: ['PAUSE', 'ACTIVATE'],
      time_windows: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d'],
    });
  } catch (error) {
    console.error('Get schema error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// List rules
router.get('/', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, campaign_id } = req.query;
    
    let query: any = {};
    if (req.user!.role !== 'ADMIN') {
      query.user_id = req.user!.id;
    }
    if (agent_id) query.agent_id = agent_id;
    if (campaign_id) query.campaign_id = campaign_id;

    const rules = await AdSetRule.find(query).sort({ created_at: -1 });
    res.json(rules);
  } catch (error) {
    console.error('List rules error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Get rule
router.get('/:rule_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { rule_id } = req.params;
    const rule = await AdSetRule.findOne({ id: rule_id });

    if (!rule) {
      return res.status(404).json({ detail: 'Rule not found' });
    }

    if (req.user!.role !== 'ADMIN' && rule.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    res.json(rule);
  } catch (error) {
    console.error('Get rule error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Generate rule from natural language (AI endpoint)
router.post('/generate', authenticate, requireRoles('USER', 'ADMIN'), [
  body('natural_language').notEmpty().withMessage('Natural language description is required'),
  body('agent_id').notEmpty().withMessage('Agent ID is required'),
  body('campaign_id').notEmpty().withMessage('Campaign ID is required'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { natural_language, agent_id, campaign_id, mode = 'basic' } = req.body;

    // Verify agent and campaign access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    // Fetch campaign and ad sets data for context
    let campaignData = null;
    let adSetsData: any[] = [];
    
    try {
      const campaignsResponse = await agentClient(agent).get('/meta/test/hierarchical', { timeout: 15000 });
      const campaigns = campaignsResponse.data?.hierarchical_structure?.campaigns || [];
      campaignData = campaigns.find((c: any) => c.id === campaign_id);

      if (campaignData) {
        adSetsData = campaignData.ad_sets || [];
      }
    } catch (error) {
      console.warn('Could not fetch campaign context for AI:', error);
    }

    // Generate rule using AI with context
    const generatedRule = await generateRuleFromNaturalLanguage({
      naturalLanguage: natural_language,
      campaignData,
      adSetsData,
      mode,
    });

    res.json({
      ...generatedRule,
      agent_id,
      campaign_id,
    });
  } catch (error: any) {
    console.error('Generate rule error:', error);
    if (error.message.includes('Anthropic') || error.message.includes('API key')) {
      return res.status(503).json({ detail: error.message });
    }
    res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});

// Analyze campaign and get optimization suggestions
router.post('/analyze', authenticate, requireRoles('USER', 'ADMIN'), [
  body('agent_id').notEmpty().withMessage('Agent ID is required'),
  body('campaign_id').notEmpty().withMessage('Campaign ID is required'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { agent_id, campaign_id } = req.body;

    // Verify agent access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    // Fetch campaign and ad sets data
    let campaignData = null;
    let adSetsData: any[] = [];
    
    try {
      const campaignsResponse = await agentClient(agent).get('/meta/test/hierarchical', { timeout: 20000 });
      const campaigns = campaignsResponse.data?.hierarchical_structure?.campaigns || [];
      campaignData = campaigns.find((c: any) => c.id === campaign_id);
      
      if (!campaignData) {
        return res.status(404).json({ detail: 'Campaign not found' });
      }
      
      adSetsData = campaignData.ad_sets || [];
    } catch (error: any) {
      console.error('Failed to fetch campaign data:', error);
      return res.status(503).json({ detail: 'Failed to fetch campaign data from agent' });
    }

    // Analyze campaign
    const analysis = await analyzeCampaign(campaignData, adSetsData);

    res.json(analysis);
  } catch (error: any) {
    console.error('Analyze campaign error:', error);
    res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});

// Preview rule (shows which ad sets would match)
router.post('/preview', authenticate, requireRoles('USER', 'ADMIN'), [
  body('agent_id').notEmpty(),
  body('campaign_id').notEmpty(),
  body('filter_config').notEmpty(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { agent_id, campaign_id, filter_config } = req.body;

    // Verify agent access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    // Get ad sets from agent
    let adSetsResponse;
    try {
      adSetsResponse = await agentClient(agent).get(`/meta/campaigns/${campaign_id}/adsets`, { timeout: 15000 });
    } catch (error: any) {
      return res.status(503).json({ detail: 'Failed to fetch ad sets from agent' });
    }

    const adSets = adSetsResponse.data?.ad_sets || adSetsResponse.data?.data || [];
    
    // Calculate campaign statistics for comparison operators
    const campaignStats = calculateCampaignStatistics(adSets);
    
    // Apply filter to find matching ad sets
    const matchingAdSets = adSets.filter((adSet: any) => {
      return evaluateFilterConditions(adSet, filter_config, campaignStats);
    });

    res.json({
      total_ad_sets: adSets.length,
      matching_ad_sets: matchingAdSets.length,
      matched_ad_sets: matchingAdSets.map((adSet: any) => ({
        id: adSet.id,
        name: adSet.name,
        status: adSet.status,
        effective_status: adSet.effective_status,
        daily_budget: adSet.daily_budget,
        lifetime_budget: adSet.lifetime_budget,
        performance_metrics: adSet.performance_metrics,
      })),
      campaign_statistics: campaignStats,
    });
  } catch (error: any) {
    console.error('Preview rule error:', error);
    res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});

// Create rule - ALWAYS creates on both CRM and Meta
router.post('/', authenticate, requireRoles('USER', 'ADMIN'), [
  body('agent_id').notEmpty(),
  body('campaign_id').notEmpty(),
  body('rule_name').notEmpty(),
  body('filter_config').notEmpty(),
  body('action').notEmpty(),
  body('execution_mode').optional().isIn(['AUTO', 'MANUAL']),
  body('execute_immediately').optional().isBoolean(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      agent_id,
      campaign_id,
      rule_name,
      description,
      filter_config,
      action,
      execution_mode,
      execute_immediately,
    } = req.body;

    // Verify agent access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    if (req.user!.role !== 'ADMIN' && agent.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    const rule_id = generateId('rule');

    const rule = new AdSetRule({
      id: rule_id,
      user_id: req.user!.id,
      agent_id,
      campaign_id,
      rule_name,
      description,
      is_active: true,
      execution_mode: execution_mode || 'MANUAL',
      filter_config,
      action,
    });

    await rule.save();

    let executionResult = null;
    let metaRuleResult = null;

    // Execute immediately if requested (applies action to matching ad sets NOW)
    if (execute_immediately) {
      try {
        executionResult = await executeRule(rule, req.user!.id);
      } catch (execError: any) {
        console.error('Immediate execution error:', execError);
        executionResult = {
          success: false,
          error: execError.message || 'Execution failed'
        };
      }
    }

    // ALWAYS create rule on Meta - this makes the rule appear in Meta Ads Manager
    try {
      // Convert our filter_config to Meta's evaluation_spec format
      // Pass campaign_id to scope the rule to this campaign
      const evaluationSpec = convertToMetaEvaluationSpec(filter_config, campaign_id, 'LAST_7D');
      const executionSpec = convertToMetaExecutionSpec(action);

      const metaResponse = await agentClient(agent).post('/meta/rules', {
        name: `[CRM] ${rule_name}`,  // Prefix to identify CRM-created rules
        evaluation_spec: evaluationSpec,
        execution_spec: executionSpec,
        schedule_spec: {
          schedule_type: execution_mode === 'AUTO' ? 'SEMI_HOURLY' : 'DAILY'
        },
        status: 'ENABLED'
      }, { timeout: 30000 });

      metaRuleResult = metaResponse.data;

      // Store Meta rule ID in our rule for future reference
      if (metaRuleResult.data?.id) {
        rule.meta_rule_id = metaRuleResult.data.id;
        await rule.save();
      }
    } catch (metaError: any) {
      console.error('Create Meta rule error:', metaError);
      metaRuleResult = {
        status: 'error',
        error: metaError.response?.data?.message || metaError.message || 'Failed to create Meta rule'
      };
      // Don't fail the whole request - the CRM rule was created successfully
    }

    res.status(201).json({
      ...rule.toObject(),
      execution_result: executionResult,
      meta_rule_result: metaRuleResult,
    });
  } catch (error) {
    console.error('Create rule error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Helper function to convert our filter config to Meta's evaluation_spec
// Meta Automated Rules require specific filters to work:
// - entity_type: "AD", "ADSET", or "CAMPAIGN"
// - time_preset: "LAST_7D", "LAST_14D", "LAST_30D", "LIFETIME", etc.
// - campaign.id or adset.id: to scope the rule to specific entities
function convertToMetaEvaluationSpec(filterConfig: any, campaignId: string, timePreset: string = 'LAST_7D'): any {
  const filters: any[] = [];

  // REQUIRED: Add entity_type filter - we're creating rules for ad sets
  filters.push({
    field: 'entity_type',
    operator: 'EQUAL',
    value: 'ADSET'
  });

  // REQUIRED: Add time_preset filter for metrics evaluation period
  filters.push({
    field: 'time_preset',
    operator: 'EQUAL',
    value: timePreset
  });

  // REQUIRED: Add campaign.id filter to scope rule to specific campaign
  filters.push({
    field: 'campaign.id',
    operator: 'IN',
    value: [campaignId]
  });

  // Add user-defined conditions
  if (filterConfig.conditions) {
    for (const condition of filterConfig.conditions) {
      const metaFilter: any = {
        field: mapFieldToMeta(condition.field),
        operator: mapOperatorToMeta(condition.operator),
        value: condition.value
      };
      filters.push(metaFilter);
    }
  }

  return {
    evaluation_type: 'SCHEDULE',
    filters
  };
}

// Helper function to convert our action to Meta's execution_spec
function convertToMetaExecutionSpec(action: any): any {
  let executionType = 'NOTIFICATION_ONLY';

  if (action.type === 'PAUSE') {
    executionType = 'PAUSE';
  } else if (action.type === 'ACTIVATE') {
    executionType = 'UNPAUSE';
  } else if (action.type === 'CHANGE_BUDGET') {
    executionType = 'CHANGE_BUDGET';
  }

  return {
    execution_type: executionType
  };
}

// Map our field names to Meta field names
// Reference: https://developers.facebook.com/docs/marketing-api/reference/ad-rules-library/
function mapFieldToMeta(field: string): string {
  const fieldMap: Record<string, string> = {
    // Spend and cost fields
    'spend': 'spent',
    'cost_per_conversion': 'cost_per_result',
    'cost_per_action': 'cost_per_result',
    'cost_per_result': 'cost_per_result',
    // Engagement metrics
    'ctr': 'ctr',
    'cpc': 'cpc',
    'cpm': 'cpm',
    'impressions': 'impressions',
    'clicks': 'clicks',
    'reach': 'reach',
    'frequency': 'frequency',
    // Conversion/results
    'conversions': 'results',
    'results': 'results',
    'actions': 'results',
    // ROAS
    'roas': 'purchase_roas',
    'purchase_roas': 'purchase_roas',
    // Status fields
    'status': 'adset.effective_status',
    'effective_status': 'adset.effective_status',
  };
  return fieldMap[field] || field;
}

// Map our operators to Meta operators
// Meta supports: GREATER_THAN, LESS_THAN, EQUAL, NOT_EQUAL, IN, IN_RANGE, CONTAIN, NOT_CONTAIN, ANY, ALL, NONE
function mapOperatorToMeta(operator: string): string {
  const operatorMap: Record<string, string> = {
    'greater_than': 'GREATER_THAN',
    'less_than': 'LESS_THAN',
    'equal': 'EQUAL',
    'equals': 'EQUAL',
    'not_equal': 'NOT_EQUAL',
    'not_equals': 'NOT_EQUAL',
    'greater_than_or_equal': 'GREATER_THAN',  // Meta doesn't have GTE, use GT
    'less_than_or_equal': 'LESS_THAN',        // Meta doesn't have LTE, use LT
    'between': 'IN_RANGE',
    'in_range': 'IN_RANGE',
    'in': 'IN',
    'not_in': 'NOT_EQUAL',  // Map to NOT_EQUAL for simple cases
    'contains': 'CONTAIN',
    'not_contains': 'NOT_CONTAIN',
  };
  return operatorMap[operator] || operator.toUpperCase();
}

// Update rule - syncs status changes to Meta
router.put('/:rule_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { rule_id } = req.params;
    const rule = await AdSetRule.findOne({ id: rule_id });

    if (!rule) {
      return res.status(404).json({ detail: 'Rule not found' });
    }

    if (req.user!.role !== 'ADMIN' && rule.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    const wasActive = rule.is_active;

    if (req.body.rule_name) rule.rule_name = req.body.rule_name;
    if (req.body.description !== undefined) rule.description = req.body.description;
    if (req.body.is_active !== undefined) rule.is_active = req.body.is_active;
    if (req.body.execution_mode) rule.execution_mode = req.body.execution_mode;
    if (req.body.filter_config) rule.filter_config = req.body.filter_config;
    if (req.body.action) rule.action = req.body.action;
    rule.updated_at = new Date();

    await rule.save();

    let metaUpdateResult = null;

    // Sync status change to Meta if rule exists there
    if (rule.meta_rule_id && req.body.is_active !== undefined && wasActive !== rule.is_active) {
      try {
        // Update Meta rule status (ENABLED/DISABLED)
        const metaStatus = rule.is_active ? 'ENABLED' : 'DISABLED';
        const ruleAgent = await Agent.findOne({ id: rule.agent_id });
        const metaResponse = await agentClient(ruleAgent).put(`/meta/rules/${rule.meta_rule_id}/status`, {
          status: metaStatus
        }, { timeout: 15000 });
        metaUpdateResult = metaResponse.data;
      } catch (metaError: any) {
        console.error('Update Meta rule status error:', metaError);
        metaUpdateResult = {
          status: 'error',
          error: metaError.response?.data?.message || metaError.message || 'Failed to update Meta rule status'
        };
      }
    }

    res.json({
      ...rule.toObject(),
      meta_update_result: metaUpdateResult
    });
  } catch (error) {
    console.error('Update rule error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Delete rule
router.delete('/:rule_id', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { rule_id } = req.params;
    const rule = await AdSetRule.findOne({ id: rule_id });

    if (!rule) {
      return res.status(404).json({ detail: 'Rule not found' });
    }

    if (req.user!.role !== 'ADMIN' && rule.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    let metaDeleteResult = null;

    // Also delete from Meta if the rule was created there
    if (rule.meta_rule_id) {
      try {
        const ruleAgent = await Agent.findOne({ id: rule.agent_id });
        const metaResponse = await agentClient(ruleAgent).delete(`/meta/rules/${rule.meta_rule_id}`, { timeout: 15000 });
        metaDeleteResult = metaResponse.data;
      } catch (metaError: any) {
        console.error('Delete Meta rule error:', metaError);
        metaDeleteResult = {
          status: 'error',
          error: metaError.response?.data?.message || metaError.message || 'Failed to delete Meta rule'
        };
        // Continue with CRM deletion even if Meta deletion fails
      }
    }

    await AdSetRule.deleteOne({ id: rule_id });
    res.json({
      message: 'Rule deleted successfully',
      meta_delete_result: metaDeleteResult
    });
  } catch (error) {
    console.error('Delete rule error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Execute rule manually
router.post('/:rule_id/execute', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { rule_id } = req.params;
    const rule = await AdSetRule.findOne({ id: rule_id });

    if (!rule) {
      return res.status(404).json({ detail: 'Rule not found' });
    }

    if (req.user!.role !== 'ADMIN' && rule.user_id !== req.user!.id) {
      return res.status(403).json({ detail: 'Access denied' });
    }

    if (!rule.is_active) {
      return res.status(400).json({ detail: 'Rule is not active' });
    }

    // Execute the rule. Manual invocations: actor is the signed-in user so
    // the activity feed renders MANUAL instead of AUTO.
    const result = await executeRule(rule, req.user!.id);

    res.json(result);
  } catch (error: any) {
    console.error('Execute rule error:', error);
    res.status(500).json({ 
      detail: error.message || 'Internal server error',
      has_errors: true,
    });
  }
});

export default router;
