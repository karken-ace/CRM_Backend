import axios from 'axios';
import { config } from '../config';
import { FIELD_CATEGORIES, ALL_FIELDS, calculateCampaignStatistics } from './ruleExecutor';
import { calculateCampaignHealth, OptimizationInsight } from './campaignOptimizer';

// Shared model for every Claude call in this file — same as Clone Winner.
// Ref: https://docs.anthropic.com/en/api/messages
// NOTE: claude-sonnet-5 rejects non-default temperature/top_p/top_k — do not
// add sampling params back; steer output via the prompts instead.
const CLAUDE_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Call Claude with a system + user prompt and parse the first text block as JSON.
 * Strips common ```json markdown fences Claude adds despite instructions.
 * Throws if the key is missing, the HTTP call fails, or the response isn't valid JSON.
 */
async function callClaudeJSON<T = any>(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<T> {
  if (!config.anthropic.apiKey) {
    throw new Error('Anthropic API key is not configured. Please add ANTHROPIC_API_KEY to your environment variables.');
  }
  const { maxTokens = 2048, timeoutMs = 60000 } = opts;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt + '\n\nReturn ONLY valid JSON. No preamble, no markdown fences.' }],
    },
    {
      headers: {
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
    },
  );

  let text: string = response.data?.content?.[0]?.text || '';
  if (!text) throw new Error('Empty response from Claude');
  text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(text) as T;
  } catch (e: any) {
    throw new Error(`Failed to parse Claude JSON response: ${e.message}`);
  }
}

/**
 * Free-form Claude call — returns the raw text reply (not JSON). Used by the
 * dashboard's AI chat panel so the user can ask arbitrary questions and get
 * grounded answers, not just the keyword-matched templates the old panel
 * shipped with.
 */
export async function callClaudeText(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  if (!config.anthropic.apiKey) {
    throw new Error('Anthropic API key is not configured.');
  }
  const { maxTokens = 1024, timeoutMs = 45000 } = opts;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    },
    {
      headers: {
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
    },
  );

  const text: string = response.data?.content?.[0]?.text || '';
  if (!text) throw new Error('Empty response from Claude');
  return text.trim();
}

export interface RuleGenerationRequest {
  naturalLanguage: string;
  campaignData?: any;
  adSetsData?: any[];
  mode?: 'basic' | 'advanced';
}

export interface ConditionConfig {
  field: string;
  operator: string;
  value: any;
  value2?: any;
  time_window?: string;
}

export interface ConditionGroup {
  conditions: ConditionConfig[];
  logical_operator: 'AND' | 'OR';
}

export interface GeneratedRule {
  rule_name: string;
  description?: string;
  filter_config: {
    conditions?: ConditionConfig[];
    condition_groups?: ConditionGroup[];
    logical_operator: 'AND' | 'OR';
  };
  action: {
    type: 'PAUSE' | 'ACTIVATE';
  };
  explanation?: string;
}

export interface CampaignAnalysis {
  summary: {
    total_ad_sets: number;
    active_ad_sets: number;
    paused_ad_sets: number;
    total_spend: number;
    total_impressions: number;
    total_clicks: number;
    total_conversions: number;
    average_ctr: number;
    average_cpc: number;
    average_cost_per_conversion: number;
    average_roas: number;
  };
  health_score: number;
  health_status: string;
  performance_insights: string[];
  optimization_opportunities: OptimizationSuggestion[];
  underperforming_ad_sets: any[];
  top_performing_ad_sets: any[];
  statistics: any;
}

export interface OptimizationSuggestion {
  type: 'pause' | 'activate' | 'budget_adjust' | 'targeting' | 'creative' | 'bidding';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affected_ad_sets: string[];
  potential_savings?: number;
  expected_conversion_increase?: number | string;
  conversion_rate_impact?: string;
  suggested_rule?: GeneratedRule;
}

// All available operators with descriptions
const OPERATORS = {
  // Basic
  equals: { label: 'Equals', description: 'Exact match', types: ['string', 'number', 'enum', 'money'] },
  not_equals: { label: 'Not Equals', description: 'Does not match', types: ['string', 'number', 'enum', 'money'] },
  greater_than: { label: 'Greater Than', description: '> value', types: ['number', 'money', 'percentage'] },
  less_than: { label: 'Less Than', description: '< value', types: ['number', 'money', 'percentage'] },
  greater_than_or_equal: { label: 'Greater Than or Equal', description: '>= value', types: ['number', 'money', 'percentage'] },
  less_than_or_equal: { label: 'Less Than or Equal', description: '<= value', types: ['number', 'money', 'percentage'] },
  between: { label: 'Between', description: 'Value between min and max (inclusive)', types: ['number', 'money', 'percentage'] },
  contains: { label: 'Contains', description: 'String contains substring', types: ['string'] },
  not_contains: { label: 'Does Not Contain', description: 'String does not contain substring', types: ['string'] },
  starts_with: { label: 'Starts With', description: 'String starts with', types: ['string'] },
  ends_with: { label: 'Ends With', description: 'String ends with', types: ['string'] },
  in: { label: 'In List', description: 'Value is in the provided list', types: ['string', 'number', 'enum'] },
  not_in: { label: 'Not In List', description: 'Value is not in the provided list', types: ['string', 'number', 'enum'] },
  
  // Regex
  regex: { label: 'Matches Regex', description: 'Matches regular expression pattern', types: ['string'] },
  not_regex: { label: 'Does Not Match Regex', description: 'Does not match regular expression', types: ['string'] },
  
  // Date/Time
  date_equals: { label: 'Date Equals', description: 'Same day as specified date', types: ['datetime'] },
  date_before: { label: 'Date Before', description: 'Before specified date', types: ['datetime'] },
  date_after: { label: 'Date After', description: 'After specified date', types: ['datetime'] },
  date_between: { label: 'Date Between', description: 'Between two dates', types: ['datetime'] },
  days_ago_less_than: { label: 'Created/Updated Less Than X Days Ago', description: 'Less than X days ago', types: ['datetime'] },
  days_ago_greater_than: { label: 'Created/Updated More Than X Days Ago', description: 'More than X days ago', types: ['datetime'] },
  days_ago_between: { label: 'Created/Updated Between X and Y Days Ago', description: 'Between X and Y days ago', types: ['datetime'] },
  time_of_day_between: { label: 'Time of Day Between', description: 'Hour of day between (0-23)', types: ['datetime'] },
  
  // Statistics
  above_average: { label: 'Above Campaign Average', description: 'Value is above campaign average', types: ['number', 'money', 'percentage'] },
  below_average: { label: 'Below Campaign Average', description: 'Value is below campaign average', types: ['number', 'money', 'percentage'] },
  above_median: { label: 'Above Median', description: 'Value is above campaign median', types: ['number', 'money', 'percentage'] },
  below_median: { label: 'Below Median', description: 'Value is below campaign median', types: ['number', 'money', 'percentage'] },
  above_percentile: { label: 'Above Percentile', description: 'Value is above Nth percentile', types: ['number', 'money', 'percentage'] },
  below_percentile: { label: 'Below Percentile', description: 'Value is below Nth percentile', types: ['number', 'money', 'percentage'] },
  percent_change_greater: { label: 'Percent Change Greater Than', description: 'Metric changed by more than X%', types: ['number', 'money', 'percentage'] },
  percent_change_less: { label: 'Percent Change Less Than', description: 'Metric changed by less than X%', types: ['number', 'money', 'percentage'] },
  trend_increasing: { label: 'Trend Increasing', description: 'Metric is trending upward', types: ['number', 'money', 'percentage'] },
  trend_decreasing: { label: 'Trend Decreasing', description: 'Metric is trending downward', types: ['number', 'money', 'percentage'] },
  trend_stable: { label: 'Trend Stable', description: 'Metric is relatively stable', types: ['number', 'money', 'percentage'] },
  
  // Null checks
  is_null: { label: 'Is Empty/Null', description: 'Field has no value', types: ['string', 'number', 'money', 'datetime', 'array'] },
  is_not_null: { label: 'Is Not Empty', description: 'Field has a value', types: ['string', 'number', 'money', 'datetime', 'array'] },
};

// Build the system prompt for rule generation
function buildSystemPrompt(mode: 'basic' | 'advanced' = 'basic'): string {
  const fieldsByCategory = mode === 'basic' 
    ? {
        basic: FIELD_CATEGORIES.basic,
        performance: FIELD_CATEGORIES.performance,
        conversions: FIELD_CATEGORIES.conversions,
        datetime: FIELD_CATEGORIES.datetime,
      }
    : FIELD_CATEGORIES;

  const fieldsDescription = Object.entries(fieldsByCategory)
    .map(([key, cat]) => {
      const fields = cat.fields.map(f => `  - ${f.id}: ${f.label} (${f.type})`).join('\n');
      return `${cat.name}:\n${fields}`;
    })
    .join('\n\n');

  const operatorsDescription = Object.entries(OPERATORS)
    .map(([key, op]) => `  - ${key}: ${op.description}`)
    .join('\n');

  return `You are an expert AI assistant for Meta (Facebook) Ads optimization. Your role is to help create sophisticated rules for managing Ad Sets based on performance metrics and business logic.

## Available Fields for Filtering

${fieldsDescription}

## Available Operators

${operatorsDescription}

## Time Windows for Statistics
You can specify time_window for metrics: "today", "yesterday", "last_7d", "last_14d", "last_30d"

## Rule Structure

Return a JSON object with this structure:
{
  "rule_name": "Descriptive rule name",
  "description": "What this rule does and why",
  "filter_config": {
    "conditions": [
      {
        "field": "field_name",
        "operator": "operator_name",
        "value": value,
        "value2": optional_value_for_between,
        "time_window": "optional_time_window"
      }
    ],
    "condition_groups": [
      {
        "conditions": [...],
        "logical_operator": "AND" or "OR"
      }
    ],
    "logical_operator": "AND" or "OR"
  },
  "action": {
    "type": "PAUSE" or "ACTIVATE"
  },
  "explanation": "Detailed explanation of the rule logic"
}

## Guidelines

1. For monetary values (spend, cost, budget), use the base currency unit (e.g., 60 for $60)
2. For percentages (ctr, conversion_rate), use decimal format (e.g., 2.5 for 2.5%)
3. Use condition_groups for complex nested logic
4. Use statistical operators (above_average, below_percentile) for relative comparisons
5. Use date operators for time-based rules
6. Use regex for pattern matching on names
7. Consider using multiple conditions with AND/OR logic for precise targeting
8. Always explain your reasoning in the explanation field

Return ONLY valid JSON, no additional text.`;
}

// Build the system prompt for campaign analysis - FOCUSED ON CONVERSION RATE OPTIMIZATION
function buildAnalysisPrompt(): string {
  return `You are an expert Meta Ads analyst specializing in CONVERSION RATE OPTIMIZATION. Your primary goal is to maximize the number of conversions and improve conversion rates across all campaigns.

🎯 PRIMARY FOCUS: Boosting Conversion Rate

Your analysis should prioritize strategies that directly increase conversions:

1. **Conversion Rate Analysis** (HIGHEST PRIORITY)
   - Identify ad sets with low conversion rates despite good engagement (high CTR but low conversions)
   - Find conversion bottlenecks in the funnel (clicks but no purchases)
   - Detect targeting misalignment (wrong audience for conversion goals)
   - Spot creative-conversion mismatches (engaging ads that don't convert)

2. **High-Converting Audience Identification**
   - Identify demographics, interests, or behaviors with highest conversion rates
   - Find ad sets ready for scaling that have proven conversion success
   - Recommend audience expansion for high-converting segments

3. **Conversion-Focused Budget Allocation**
   - Reallocate budget from low-converting to high-converting ad sets
   - Recommend increased investment in proven conversion drivers
   - Identify wasted spend on engagement without conversions

4. **Creative & Messaging for Conversions**
   - Analyze which ad formats drive the most conversions (not just clicks)
   - Identify creative fatigue affecting conversion rates
   - Recommend testing angles that drive purchase intent

5. **Optimization Opportunities** - Ranked by conversion impact:
   - Actions that will increase total conversions
   - Improvements to cost-per-conversion
   - Strategies to move users from click to purchase
   - A/B test recommendations focused on conversion rate

6. **Conversion Funnel Optimization**
   - Landing page performance signals
   - Post-click conversion rate analysis
   - Add-to-cart to purchase conversion analysis

For each opportunity, estimate:
- Expected conversion rate improvement (%)
- Potential increase in total conversions
- Impact on cost-per-conversion

Return a JSON object with this structure:
{
  "performance_insights": ["insight1 focused on conversions", "insight2", ...],
  "optimization_opportunities": [
    {
      "type": "pause|activate|budget_adjust|targeting|creative|bidding",
      "priority": "high|medium|low",
      "title": "Short title focused on conversion improvement",
      "description": "How this will boost conversion rate",
      "affected_ad_sets": ["ad_set_id1", ...],
      "potential_savings": number_or_null,
      "expected_conversion_increase": number_or_percentage,
      "conversion_rate_impact": "describe the impact on conversion rate",
      "suggested_rule": { rule_object_or_null }
    }
  ],
  "conversion_funnel_insights": "Analysis of conversion funnel performance",
  "high_converting_patterns": "Patterns identified in best performing converters",
  "budget_recommendations": "Budget reallocation to maximize conversions",
  "summary_text": "Overall conversion performance summary"
}`;
}

export async function generateRuleFromNaturalLanguage(
  request: RuleGenerationRequest
): Promise<GeneratedRule> {
  const mode = request.mode || 'basic';
  const systemPrompt = buildSystemPrompt(mode);

  let userPrompt = `Convert this natural language request into a rule configuration:
"${request.naturalLanguage}"`;

  if (request.campaignData) {
    userPrompt += `\n\nCampaign context:
- Name: ${request.campaignData.name}
- Status: ${request.campaignData.status}
- Objective: ${request.campaignData.objective || 'N/A'}`;
  }

  if (request.adSetsData && request.adSetsData.length > 0) {
    const stats = calculateCampaignStatistics(request.adSetsData);
    userPrompt += `\n\nCampaign Statistics:
- Total Ad Sets: ${request.adSetsData.length}
- Average Spend: ${stats.averages.spend?.toFixed(2) || 'N/A'}
- Average CPC: ${stats.averages.cpc?.toFixed(2) || 'N/A'}
- Average CTR: ${stats.averages.ctr?.toFixed(2) || 'N/A'}%
- Average Cost per Conversion: ${stats.averages.cost_per_conversion?.toFixed(2) || 'N/A'}`;
  }

  userPrompt += `\n\nCreate a ${mode === 'advanced' ? 'sophisticated' : 'simple'} rule based on this request.`;

  try {
    const parsed = await callClaudeJSON<GeneratedRule>(systemPrompt, userPrompt, { timeoutMs: 30000 });
    if (!parsed.rule_name || !parsed.filter_config || !parsed.action) {
      throw new Error('Invalid rule structure from AI');
    }
    return parsed;
  } catch (error: any) {
    if (error.response) {
      throw new Error(`Anthropic API error: ${error.response.data?.error?.message || error.message}`);
    }
    throw error;
  }
}

export async function analyzeCampaign(
  campaignData: any,
  adSetsData: any[]
): Promise<CampaignAnalysis> {
  // Run advanced campaign health analysis
  const healthAnalysis = calculateCampaignHealth(adSetsData);
  
  // Calculate statistics
  const stats = calculateCampaignStatistics(adSetsData);
  
  // Calculate summary
  const activeAdSets = adSetsData.filter(a => a.status === 'ACTIVE');
  const pausedAdSets = adSetsData.filter(a => a.status === 'PAUSED');
  
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalConversions = 0;
  let totalPurchaseValue = 0;

  for (const adSet of adSetsData) {
    const metrics = adSet.performance_metrics || {};
    totalSpend += parseFloat(metrics.spend || 0);
    totalImpressions += parseInt(metrics.impressions || 0);
    // Use Link Clicks (inline_link_clicks) — Meta's "Link Clicks" metric, not "Clicks (All)"
    // Per Meta's 2016 update: inline_link_clicks = clicks on links within the ad
    totalClicks += parseInt(metrics.inline_link_clicks || 0) || getLinkClicksFromActions(metrics);
    
    if (metrics.actions && Array.isArray(metrics.actions)) {
      const purchase = metrics.actions.find((a: any) => 
        a.action_type === 'purchase' || a.action_type === 'omni_purchase'
      );
      if (purchase) {
        totalConversions += parseInt(purchase.value || 0);
      }
    }
    
    if (metrics.action_values && Array.isArray(metrics.action_values)) {
      const purchaseValue = metrics.action_values.find((a: any) => 
        a.action_type === 'purchase' || a.action_type === 'omni_purchase'
      );
      if (purchaseValue) {
        totalPurchaseValue += parseFloat(purchaseValue.value || 0);
      }
    }
  }

  const summary = {
    total_ad_sets: adSetsData.length,
    active_ad_sets: activeAdSets.length,
    paused_ad_sets: pausedAdSets.length,
    total_spend: totalSpend,
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
    total_conversions: totalConversions,
    average_ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    average_cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    average_cost_per_conversion: totalConversions > 0 ? totalSpend / totalConversions : 0,
    average_roas: totalSpend > 0 ? totalPurchaseValue / totalSpend : 0,
  };

  // Identify underperforming ad sets (high spend, low/no conversions)
  const underperforming = adSetsData
    .filter(adSet => {
      const metrics = adSet.performance_metrics || {};
      const spend = parseFloat(metrics.spend || 0);
      const conversions = getConversions(metrics);
      const costPerConversion = conversions > 0 ? spend / conversions : Infinity;
      
      // High spend with no conversions, or cost per conversion is way above average
      return (spend > 10 && conversions === 0) || 
             (costPerConversion > summary.average_cost_per_conversion * 2 && spend > 5);
    })
    .slice(0, 10);

  // Identify top performing ad sets
  const topPerforming = adSetsData
    .filter(adSet => {
      const metrics = adSet.performance_metrics || {};
      const conversions = getConversions(metrics);
      return conversions > 0;
    })
    .sort((a, b) => {
      const aMetrics = a.performance_metrics || {};
      const bMetrics = b.performance_metrics || {};
      const aCPC = getConversions(aMetrics) > 0 ? parseFloat(aMetrics.spend || 0) / getConversions(aMetrics) : Infinity;
      const bCPC = getConversions(bMetrics) > 0 ? parseFloat(bMetrics.spend || 0) / getConversions(bMetrics) : Infinity;
      return aCPC - bCPC;
    })
    .slice(0, 10);

  // Add research-based insights to the basic insights
  const researchBasedInsights = generateResearchBasedInsights(healthAnalysis, summary, adSetsData);
  
  // Use AI for deeper insights if API key is available
  let performanceInsights: string[] = [];
  let optimizationOpportunities: OptimizationSuggestion[] = [];

  if (config.anthropic.apiKey) {
    try {
      const aiAnalysis = await getAIAnalysis(campaignData, adSetsData, summary, stats);
      performanceInsights = aiAnalysis.performance_insights || [];
      optimizationOpportunities = aiAnalysis.optimization_opportunities || [];
    } catch (error) {
      console.error('AI analysis failed:', error);
      // Fall back to rule-based insights
      performanceInsights = generateBasicInsights(summary, underperforming, topPerforming);
      optimizationOpportunities = generateBasicOptimizations(underperforming, summary);
    }
  } else {
    performanceInsights = generateBasicInsights(summary, underperforming, topPerforming);
    optimizationOpportunities = generateBasicOptimizations(underperforming, summary);
  }

  // Combine AI insights with research-based insights
  const allInsights = [...researchBasedInsights, ...performanceInsights];
  const allOpportunities = [
    ...convertInsightsToOpportunities(healthAnalysis.insights),
    ...optimizationOpportunities
  ];
  
  return {
    summary,
    health_score: healthAnalysis.score,
    health_status: healthAnalysis.status,
    performance_insights: allInsights,
    optimization_opportunities: allOpportunities,
    underperforming_ad_sets: underperforming,
    top_performing_ad_sets: topPerforming,
    statistics: stats,
  };
}

function generateResearchBasedInsights(
  healthAnalysis: any,
  summary: any,
  adSetsData: any[]
): string[] {
  const insights: string[] = [];
  
  // PRIMARY FOCUS: Conversion Rate Metrics
  const totalClicks = summary.total_clicks || 0;
  const totalConversions = summary.total_conversions || 0;
  const overallConversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;
  
  insights.push(`🎯 Conversion Rate Focus: ${overallConversionRate.toFixed(2)}% (${totalConversions} conversions from ${totalClicks} clicks)`);
  
  // Calculate conversion rate distribution
  const adSetsWithConversions = adSetsData.filter(a => {
    const metrics = a.performance_metrics || {};
    const linkClicks = parseInt(metrics.inline_link_clicks || 0) || getLinkClicksFromActions(metrics);
    const conversions = getConversions(metrics);
    return linkClicks > 0 && conversions > 0;
  });

  if (adSetsWithConversions.length > 0) {
    const bestConversionRate = Math.max(...adSetsWithConversions.map(a => {
      const linkClicks = parseInt(a.performance_metrics?.inline_link_clicks || 0) || getLinkClicksFromActions(a.performance_metrics);
      const conversions = getConversions(a.performance_metrics);
      return linkClicks > 0 ? (conversions / linkClicks) * 100 : 0;
    }));
    
    insights.push(`🏆 Best Converting Ad Set: ${bestConversionRate.toFixed(2)}% conversion rate - ${adSetsWithConversions.length} ad sets are generating conversions`);
  } else {
    insights.push(`⚠️ No ad sets have conversions yet - focus on fixing conversion tracking and landing pages`);
  }
  
  // Add health score insight
  insights.push(`📊 Campaign Health Score: ${healthAnalysis.score}/100 (${healthAnalysis.status.toUpperCase()})`);
  
  // Conversion-focused critical warnings
  const conversionInsights = healthAnalysis.insights.filter((i: any) => 
    i.category === 'Conversion Rate' || i.category === 'Conversion Funnel'
  );
  if (conversionInsights.length > 0) {
    const criticalConversion = conversionInsights.filter((i: any) => i.priority === 'critical' || i.priority === 'high').length;
    insights.push(`🚨 ${criticalConversion} CRITICAL conversion issues detected - addressing these will directly boost conversion rates`);
  }
  
  // Budget allocation insights - conversion focused
  const totalBudget = adSetsData.reduce((sum, a) => sum + parseFloat(a.daily_budget || a.lifetime_budget || 0), 0);
  if (totalBudget > 0) {
    const budgetOnConverters = adSetsWithConversions.reduce((sum, a) => 
      sum + parseFloat(a.daily_budget || a.lifetime_budget || 0), 0
    );
    const percentOnConverters = totalBudget > 0 ? (budgetOnConverters / totalBudget) * 100 : 0;
    
    insights.push(`💰 Budget Allocation: ${percentOnConverters.toFixed(0)}% of $${totalBudget.toFixed(2)} daily budget is on converting ad sets`);
    
    if (percentOnConverters < 60 && adSetsWithConversions.length > 0) {
      insights.push(`⚠️ OPPORTUNITY: Shift more budget to proven converters to maximize total conversions`);
    }
  }
  
  // High engagement, low conversion detection — use Link Clicks not Clicks (All)
  const highEngagementLowConversion = adSetsData.filter(a => {
    const metrics = a.performance_metrics || {};
    const ctr = parseFloat(metrics.ctr || 0);
    const linkClicks = parseInt(metrics.inline_link_clicks || 0) || getLinkClicksFromActions(metrics);
    const conversions = getConversions(metrics);
    const conversionRate = linkClicks > 0 ? (conversions / linkClicks) * 100 : 0;
    return ctr > 1.5 && linkClicks > 20 && conversionRate < overallConversionRate * 0.5;
  });
  
  if (highEngagementLowConversion.length > 0) {
    insights.push(`⚠️ ${highEngagementLowConversion.length} ad set(s) have high engagement but poor conversion - fix these to unlock significant conversion growth`);
  }
  
  // Frequency insights (impacts conversion rate)
  const highFrequency = adSetsData.filter(a => parseFloat(a.performance_metrics?.frequency || 0) > 1.7);
  if (highFrequency.length > 0) {
    insights.push(`⚠️ ${highFrequency.length} ad set(s) showing ad fatigue (frequency > 1.7) - this hurts conversion rates as users see the same ad too often`);
  }
  
  // Learning phase insights
  const inLearning = adSetsData.filter(a => {
    const createdDate = new Date(a.created_time);
    const daysActive = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysActive > 7 && daysActive < 30;
  });
  if (inLearning.length > 0) {
    insights.push(`🎯 ${inLearning.length} ad set(s) in learning phase - need 50 conversions/week to exit and optimize conversion delivery`);
  }
  
  // High-priority action items
  const criticalInsights = healthAnalysis.insights.filter((i: any) => i.priority === 'critical' || i.priority === 'high');
  if (criticalInsights.length > 0) {
    insights.push(`🚨 ${criticalInsights.length} high-priority actions will boost conversions - implement these first`);
  }
  
  return insights;
}

function convertInsightsToOpportunities(insights: OptimizationInsight[]): OptimizationSuggestion[] {
  return insights.slice(0, 10).map(insight => ({
    type: insight.category.toLowerCase().includes('budget') ? 'budget_adjust' :
          insight.category.toLowerCase().includes('creative') ? 'creative' :
          insight.category.toLowerCase().includes('audience') ? 'targeting' :
          insight.type === 'warning' ? 'pause' : 'activate',
    priority: insight.priority === 'critical' || insight.priority === 'high' ? 'high' :
              insight.priority === 'medium' ? 'medium' : 'low',
    title: insight.title,
    description: `${insight.description}\n\n💡 ${insight.recommendation}`,
    affected_ad_sets: insight.affected_entities,
    potential_savings: insight.estimated_savings,
  }));
}

async function getAIAnalysis(
  campaignData: any,
  adSetsData: any[],
  summary: any,
  stats: any
): Promise<any> {
  const systemPrompt = buildAnalysisPrompt();

  const adSetsSummary = adSetsData.slice(0, 20).map(adSet => {
    const metrics = adSet.performance_metrics || {};
    const linkClicks = parseInt(metrics.inline_link_clicks || 0) || getLinkClicksFromActions(metrics);
    const conversions = getConversions(metrics);
    return {
      id: adSet.id,
      name: adSet.name,
      status: adSet.status,
      spend: metrics.spend,
      impressions: metrics.impressions,
      link_clicks: linkClicks,       // inline_link_clicks — Meta's "Link Clicks"
      clicks_all: metrics.clicks,    // Clicks (All) — includes engagement, not just link clicks
      ctr: metrics.ctr,
      cpc: metrics.cpc,
      conversions,
      cost_per_conversion: conversions > 0
        ? (parseFloat(metrics.spend || 0) / conversions).toFixed(2)
        : 'N/A',
    };
  });

  const userPrompt = `🎯 CONVERSION RATE OPTIMIZATION ANALYSIS - Analyze this campaign to maximize conversions:

Campaign: ${campaignData.name}
Status: ${campaignData.status}
Objective: ${campaignData.objective || 'N/A'}

🔍 KEY CONVERSION METRICS:
- Total Conversions: ${summary.total_conversions}
- Overall Conversion Rate: ${summary.total_clicks > 0 ? ((summary.total_conversions / summary.total_clicks) * 100).toFixed(2) : '0.00'}% (conversions / link clicks)
- Cost per Conversion: $${summary.average_cost_per_conversion.toFixed(2)}
- Link Click-to-Conversion Rate: ${summary.total_clicks > 0 ? ((summary.total_conversions / summary.total_clicks) * 100).toFixed(2) : '0.00'}%

NOTE: "link_clicks" in ad set data = Meta's "Link Clicks" (inline_link_clicks) — clicks on links within the ad.
"clicks_all" = Meta's "Clicks (All)" — includes post likes, comments, and other engagement, NOT just link clicks.
Use link_clicks for conversion rate analysis; use clicks_all for engagement breadth only.

Campaign Overview:
- Total Ad Sets: ${summary.total_ad_sets} (Active: ${summary.active_ad_sets}, Paused: ${summary.paused_ad_sets})
- Total Spend: $${summary.total_spend.toFixed(2)}
- Total Link Clicks: ${summary.total_clicks}
- Average CTR: ${summary.average_ctr.toFixed(2)}%
- Average CPC: $${summary.average_cpc.toFixed(2)}
- ROAS: ${summary.average_roas.toFixed(2)}

Conversion Performance Distribution:
- Median Cost per Conversion: $${stats.medians.cost_per_conversion?.toFixed(2) || 'N/A'}
- 75th Percentile Cost per Conversion: $${stats.percentiles.cost_per_conversion?.[75]?.toFixed(2) || 'N/A'}
- Best Performing Conversion Rate: ${adSetsSummary.length > 0 ? Math.max(...adSetsSummary.map((a: any) => {
    const clicks = parseInt(a.clicks || 0);
    const conversions = parseInt(a.conversions || 0);
    return clicks > 0 ? ((conversions / clicks) * 100) : 0;
  })).toFixed(2) : '0.00'}%

Ad Sets Performance (sample):
${JSON.stringify(adSetsSummary, null, 2)}

🎯 YOUR TASK:
1. Identify ad sets with HIGH ENGAGEMENT but LOW CONVERSIONS (wasted potential)
2. Find HIGH-CONVERTING ad sets that should be scaled
3. Detect conversion bottlenecks (good CTR → poor conversion rate)
4. Recommend budget shifts to maximize total conversions
5. Suggest targeting/creative changes to improve conversion rates
6. Provide specific, actionable rules to boost conversions

Focus exclusively on strategies that will INCREASE the number of conversions and IMPROVE conversion rates.`;

  return callClaudeJSON(systemPrompt, userPrompt, { timeoutMs: 60000, maxTokens: 4000 });
}

// ── Creative Analysis with AI ────────────────────────────────────────────

export interface CreativeAnalysisResult {
  analysis: {
    hook: string;
    visual: string;
    emotion: string;
    cta: string;
    hookLift: string;
    ctrLift: string;
    budget: string;
  };
  brief: {
    title: string;
    concept: string;
    visual: string;
    script: string;
    format: string;
  };
  hooks: string[];
}

export async function analyzeCreative(
  creativeData: any,
  campaignContext?: any,
  currency?: string | null,
): Promise<CreativeAnalysisResult> {
  const fallback = generateFallbackCreativeAnalysis(creativeData, currency);

  if (!config.anthropic.apiKey) {
    return fallback;
  }

  const currencyCode = (currency || 'USD').toUpperCase();
  const currencyExample = currencyCode === 'EUR' ? '€50/day'
    : currencyCode === 'GBP' ? '£50/day'
    : currencyCode === 'USD' ? '$50/day'
    : `50 ${currencyCode}/day`;

  const systemPrompt = `You are ACES AI, an expert Meta advertising creative analyst. You analyze ad creatives and generate actionable insights based on performance data.

The ad account's billing currency is ${currencyCode}. ALL monetary values you produce
(spend, budgets, costs) must be written in ${currencyCode}. Never use a different
currency symbol. If you write a budget, format it like ${currencyExample}.

You MUST respond with a JSON object matching this EXACT structure:
{
  "analysis": {
    "hook": "1-2 sentence analysis of the ad's opening hook effectiveness",
    "visual": "1-2 sentence analysis of visual composition and style",
    "emotion": "1-2 sentence analysis of emotional resonance with the audience",
    "cta": "1-2 sentence analysis of the call-to-action clarity and effectiveness",
    "hookLift": "predicted hook rate improvement if recommendations are applied, e.g. '+8-15%'",
    "ctrLift": "predicted CTR improvement, e.g. '+0.3-0.5%'",
    "budget": "recommended daily test budget in ${currencyCode}, e.g. '${currencyExample}'"
  },
  "brief": {
    "title": "A short name for the new creative variation (3-5 words)",
    "concept": "2-3 sentences describing the new creative concept. Use <b>bold</b> for emphasis.",
    "visual": "2-3 sentences on visual direction. Use <b>bold</b> for key techniques.",
    "script": "Script structure with timestamps. Use <b>bold</b> for section labels. e.g. '<b>0-2s:</b> Hook · <b>2-8s:</b> Problem'",
    "format": "Format spec. Use <b>bold</b> for key specs. e.g. '<b>15-20 seconds</b> · Vertical 9:16'"
  },
  "hooks": ["hook variant 1 in quotes", "hook variant 2", "hook variant 3", "hook variant 4"]
}

RULES:
- Every field must be filled with specific, actionable content
- Tailor ALL analysis to the actual performance metrics provided
- Hook variants must be different angles/approaches, not slight rewrites
- If ROAS is high (>2.5x), focus on scaling and replication strategies
- If ROAS is low (<1.5x), focus on what needs fixing
- If creative is new (<3 days), be encouraging but suggest early tests
- Make briefs specific to the ad format (Video vs Image vs Carousel vs Dynamic)
- Use plain language a media buyer would use, not marketing jargon`;

  const roas = creativeData.roas || 0;
  const hookRate = creativeData.hookRate;
  const ctr = creativeData.ctr || 0;
  const freq = creativeData.frequency || 0;
  const spend = creativeData.spend || 0;
  const purchases = creativeData.purchases || 0;
  const format = creativeData.format || 'Unknown';
  const status = creativeData.status || 'active';
  const daysRunning = creativeData.createdTime
    ? Math.max(1, Math.round((Date.now() - new Date(creativeData.createdTime).getTime()) / 86400000))
    : 0;

  const userPrompt = `Analyze this Meta ad creative and generate insights:

CREATIVE: "${creativeData.name}"
Format: ${format}
Campaign: ${creativeData.campaignName || 'Unknown'}
Ad Set: ${creativeData.adSetName || 'Unknown'}
Status: ${status}
Days running: ${daysRunning}

PERFORMANCE METRICS:
- ROAS: ${roas > 0 ? roas.toFixed(2) + 'x' : 'No purchase data'}
- Hook Rate: ${hookRate !== null && hookRate !== undefined ? hookRate.toFixed(1) + '%' : 'N/A (not a video)'}
- CTR: ${ctr > 0 ? ctr.toFixed(2) + '%' : '0%'}
- Frequency: ${freq > 0 ? freq.toFixed(1) : 'N/A'}
- Amount Spent: $${spend.toFixed(2)}
- Purchases: ${purchases}
- Impressions: ${creativeData.impressions || 0}
${campaignContext ? `
CAMPAIGN CONTEXT:
- Campaign objective: ${campaignContext.objective || 'Unknown'}
- Campaign total spend: $${campaignContext.totalSpend?.toFixed(2) || '0'}
- Campaign ROAS: ${campaignContext.roas?.toFixed(2) || 'N/A'}x
- Number of ads in campaign: ${campaignContext.adCount || 'Unknown'}
` : ''}
BENCHMARKS:
- Good ROAS: >2.5x | Average: 1.5-2.5x | Poor: <1.5x
- Good Hook Rate: >40% | Average: 25-40% | Poor: <25%
- Good CTR: >2% | Average: 1-2% | Poor: <1%
- High Frequency (fatigue risk): >3.5

Based on these metrics, provide your analysis. Be specific about what's working, what's not, and what to do next. Reference the actual numbers.`;

  try {
    const parsed = await callClaudeJSON<CreativeAnalysisResult>(systemPrompt, userPrompt, { timeoutMs: 30000, maxTokens: 2048 });
    if (parsed.analysis && parsed.brief && Array.isArray(parsed.hooks)) {
      return parsed;
    }
    console.error('AI returned unexpected structure, using fallback');
    return fallback;
  } catch (error: any) {
    console.error('Creative AI analysis failed:', error.message);
    return fallback;
  }
}

function formatBudgetAmount(amount: number, currency?: string | null): string {
  const code = (currency || 'USD').toUpperCase();
  const symbol = code === 'EUR' ? '€' : code === 'GBP' ? '£' : code === 'USD' ? '$' : '';
  return symbol ? `${symbol}${amount}` : `${amount} ${code}`;
}

function generateFallbackCreativeAnalysis(c: any, currency?: string | null): CreativeAnalysisResult {
  const roas = c.roas || 0;
  const hookRate = c.hookRate;
  const ctr = c.ctr || 0;
  const freq = c.frequency || 0;
  const isVideo = c.format === 'Video';

  return {
    analysis: {
      hook: hookRate && hookRate > 40
        ? `Strong hook at ${hookRate.toFixed(0)}% — captures attention effectively in the first seconds.`
        : hookRate !== null
        ? `Hook rate at ${hookRate.toFixed(0)}% is below the 40% benchmark. Consider opening with a bolder problem statement or question.`
        : 'Not applicable for this format — hook rate is measured for video ads only.',
      visual: isVideo
        ? 'Video format — handheld, authentic footage tends to outperform polished studio content on Meta. Quick cuts (1-2s) keep attention.'
        : c.format === 'Carousel'
        ? 'Carousel — the lead card drives all engagement. First image should feature a face or transformation, not just a product.'
        : 'Static image — clean composition with a clear focal point. Faces outperform product-only shots by 30-40% on average.',
      emotion: roas >= 2.5
        ? `Strong emotional resonance — ${roas.toFixed(1)}x ROAS suggests the creative connects well with audience desires and pain points.`
        : roas > 0
        ? `Moderate emotional impact at ${roas.toFixed(1)}x ROAS. Consider shifting from rational appeal (features/price) to transformation stories.`
        : 'Limited conversion data available. Focus on building emotional connection through relatable scenarios.',
      cta: ctr >= 2
        ? `CTA is effective — ${ctr.toFixed(1)}% CTR shows people are taking action. Keep it soft and curiosity-driven.`
        : `CTR at ${ctr.toFixed(2)}% needs improvement. Try softer language like "see the results" instead of "Shop Now".`,
      hookLift: hookRate && hookRate < 40 ? '+8-15%' : '+3-5%',
      ctrLift: ctr < 2 ? '+0.5-0.8%' : '+0.2-0.4%',
      budget: roas >= 2.5
        ? `${formatBudgetAmount(100, currency)}/day`
        : freq > 4
          ? `${formatBudgetAmount(0, currency)} — pause first`
          : `${formatBudgetAmount(50, currency)}/day`,
    },
    brief: {
      title: roas >= 2.5 ? 'Scale Variation' : freq > 4 ? 'Fresh Replacement' : 'Optimized Iteration',
      concept: roas >= 2.5
        ? 'Build on this winner. Keep the <b>core emotional hook</b> but test a new angle — add social proof or third-party validation for extra credibility.'
        : 'Rethink the creative approach. Lead with a <b>transformation outcome</b> instead of features or discounts. Show the result first, then explain how.',
      visual: isVideo
        ? 'Keep authentic, handheld feel. Add <b>close-up shots at 6-8 seconds</b>. Quick cuts (1.2s avg). End on results.'
        : 'Lead with a <b>face or transformation image</b>, not product alone. Lifestyle setting, not studio. Minimal text overlay.',
      script: isVideo
        ? '<b>0-2s:</b> Hook (problem/question) · <b>2-8s:</b> Agitation · <b>8-14s:</b> Product reveal · <b>14-18s:</b> Result + CTA'
        : '<b>Headline:</b> Transformation statement · <b>Sub:</b> Social proof or specific result · <b>CTA:</b> Soft, curiosity-driven',
      format: isVideo
        ? '<b>15-20 seconds</b> · Vertical 9:16 for Reels · Square 1:1 for Feed'
        : c.format === 'Carousel'
        ? '<b>5 cards</b> · Square 1:1 · Each card must work standalone'
        : '<b>Static image</b> · Square 1:1 for Feed',
    },
    hooks: [
      '"Everyone keeps asking what changed. Here\'s what it was."',
      '"I almost didn\'t try this. Biggest mistake I nearly made."',
      '"My friend stopped mid-conversation to ask about this."',
      '"I\'ve tried everything else. This is the only one that worked."',
    ],
  };
}

function getConversions(metrics: any): number {
  if (!metrics.actions || !Array.isArray(metrics.actions)) return 0;
  const purchase = metrics.actions.find((a: any) =>
    a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'lead'
  );
  return purchase ? parseInt(purchase.value || 0) : 0;
}

/**
 * Extract Link Clicks from actions array (link_click action type)
 * Fallback when inline_link_clicks field is not present in metrics
 */
function getLinkClicksFromActions(metrics: any): number {
  if (!metrics.actions || !Array.isArray(metrics.actions)) return 0;
  const action = metrics.actions.find((a: any) => a.action_type === 'link_click');
  return action ? parseInt(action.value || 0) : 0;
}

function generateBasicInsights(summary: any, underperforming: any[], topPerforming: any[]): string[] {
  const insights: string[] = [];

  // PRIMARY FOCUS: Conversion Rate Insights
  const overallConversionRate = summary.total_clicks > 0 
    ? (summary.total_conversions / summary.total_clicks) * 100 
    : 0;

  if (summary.total_conversions === 0 && summary.total_spend > 0) {
    insights.push(`🚨 CRITICAL: Zero conversions despite $${summary.total_spend.toFixed(2)} in spend and ${summary.total_clicks} clicks. This is a complete conversion failure - check tracking, landing pages, and offer alignment immediately.`);
  } else if (summary.total_conversions > 0) {
    insights.push(`📊 Current Conversion Rate: ${overallConversionRate.toFixed(2)}% (${summary.total_conversions} conversions from ${summary.total_clicks} clicks). Industry average is 2-5%.`);
  }

  // Identify high engagement but low conversion
  if (summary.average_ctr > 1.5 && overallConversionRate < 1.5) {
    insights.push(`⚠️ High engagement (${summary.average_ctr.toFixed(2)}% CTR) but low conversion rate (${overallConversionRate.toFixed(2)}%). Your ads are attracting clicks but not converting - review landing page alignment and offer strength.`);
  }

  if (underperforming.length > 0) {
    insights.push(`📉 ${underperforming.length} ad sets are draining budget without generating conversions. Pausing these and reallocating budget to high-converters could significantly boost total conversions.`);
  }

  if (topPerforming.length > 0) {
    const bestCPC = topPerforming[0].performance_metrics?.spend / getConversions(topPerforming[0].performance_metrics);
    const bestLinkClicks = parseInt(topPerforming[0].performance_metrics?.inline_link_clicks || 0) || getLinkClicksFromActions(topPerforming[0].performance_metrics);
    const bestConversions = getConversions(topPerforming[0].performance_metrics);
    const bestConversionRate = bestLinkClicks > 0 ? (bestConversions / bestLinkClicks) * 100 : 0;
    
    insights.push(`🎯 Top converter: ${bestConversionRate.toFixed(2)}% conversion rate at $${bestCPC?.toFixed(2) || 'N/A'} cost per conversion. Scale this winning formula to maximize conversions.`);
  }

  if (summary.average_ctr < 1) {
    insights.push(`📊 Low CTR (${summary.average_ctr.toFixed(2)}%) means you're not even getting users to click. Test more compelling ad copy, visuals, and value propositions to drive traffic that can convert.`);
  }

  if (summary.average_roas > 0 && summary.average_roas < 1) {
    insights.push(`💰 ROAS ${summary.average_roas.toFixed(2)} means you're losing money. Focus on conversion rate optimization: improve landing pages, test higher-intent audiences, and strengthen your offer.`);
  } else if (summary.average_roas >= 3) {
    insights.push(`✅ Strong ROAS of ${summary.average_roas.toFixed(2)}! You have a profitable conversion funnel - now scale your best-performing ad sets to multiply conversions.`);
  }

  // Conversion cost insights
  if (summary.average_cost_per_conversion > 0) {
    insights.push(`💵 Average cost per conversion: $${summary.average_cost_per_conversion.toFixed(2)}. Lowering this by improving conversion rates will make every dollar more productive.`);
  }

  return insights;
}

function generateBasicOptimizations(underperforming: any[], summary: any): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  // Focus on conversion rate optimization
  if (underperforming.length > 0) {
    const totalWastedSpend = underperforming.reduce((sum, a) => sum + parseFloat(a.performance_metrics?.spend || 0), 0);
    const potentialConversions = Math.floor(totalWastedSpend / (summary.average_cost_per_conversion || 50));
    
    suggestions.push({
      type: 'pause',
      priority: 'high',
      title: '🎯 Eliminate Conversion Killers - Pause Non-Converting Ad Sets',
      description: `${underperforming.length} ad sets have spent $${totalWastedSpend.toFixed(2)} with minimal/no conversions. This wasted budget could have generated an estimated ${potentialConversions} conversions if allocated to high-performing ad sets. Pausing these immediately will boost your conversion efficiency.`,
      affected_ad_sets: underperforming.map(a => a.id),
      potential_savings: totalWastedSpend,
      expected_conversion_increase: potentialConversions,
      conversion_rate_impact: `Redirecting budget to proven converters could increase total conversions by ${potentialConversions}`,
      suggested_rule: {
        rule_name: 'Auto-Pause Zero-Conversion Budget Drains',
        description: 'Automatically pause ad sets wasting spend without conversions',
        filter_config: {
          conditions: [
            { field: 'spend', operator: 'greater_than', value: 15 },
            { field: 'conversions', operator: 'equals', value: 0 },
            { field: 'clicks', operator: 'greater_than', value: 5 },
          ],
          logical_operator: 'AND',
        },
        action: { type: 'PAUSE' },
        explanation: 'Pauses ad sets that spent >$15 and got clicks but zero conversions (conversion failure, not traffic problem)',
      },
    });
  }

  if (summary.average_cost_per_conversion > 0) {
    const threshold = summary.average_cost_per_conversion * 2.5;
    suggestions.push({
      type: 'pause',
      priority: 'high',
      title: '💰 Reduce Cost Per Conversion - Pause Expensive Converters',
      description: `Some ad sets are converting but at 2.5x the average cost ($${threshold.toFixed(2)}+). These inefficient converters drain budget that could generate MORE conversions in better-performing sets. Pausing them improves overall conversion rate and reduces average cost per conversion.`,
      affected_ad_sets: [],
      conversion_rate_impact: 'Reallocating this budget to efficient converters will increase total conversions by 30-50%',
      suggested_rule: {
        rule_name: 'Pause Inefficient Expensive Converters',
        description: 'Pause ad sets with conversion costs far above average',
        filter_config: {
          conditions: [
            { field: 'cost_per_conversion', operator: 'above_percentile', value: 75 },
            { field: 'spend', operator: 'greater_than', value: 20 },
          ],
          logical_operator: 'AND',
        },
        action: { type: 'PAUSE' },
        explanation: 'Pauses ad sets in the worst 25% for conversion efficiency, freeing budget for top performers',
      },
    });
  }

  // Add recommendation to scale high converters
  suggestions.push({
    type: 'budget_adjust',
    priority: 'high',
    title: '📈 Maximize Conversions - Scale Your Best Converters',
    description: 'Identify ad sets with the highest conversion rates and lowest cost per conversion. These are proven winners. Increasing their budgets by 15-20% every 3-4 days will multiply your total conversions while maintaining efficiency.',
    affected_ad_sets: [],
    expected_conversion_increase: '25-40%',
    conversion_rate_impact: 'Scaling proven converters is the fastest way to increase total conversions without risk',
    suggested_rule: {
      rule_name: 'Auto-Identify Scale-Ready High Converters',
      description: 'Flag ad sets ready for scaling based on conversion performance',
      filter_config: {
        conditions: [
          { field: 'conversions', operator: 'greater_than', value: 8 },
          { field: 'cost_per_conversion', operator: 'below_percentile', value: 50 },
          { field: 'spend', operator: 'greater_than', value: 20 },
        ],
        logical_operator: 'AND',
      },
      action: { type: 'ACTIVATE' },
      explanation: 'Identifies top 50% converters with proven track record (8+ conversions) ready for budget increase',
    },
  });

  return suggestions;
}

// Export operators and fields for frontend
export function getAvailableOperators() {
  return OPERATORS;
}

export function getAvailableFields(mode: 'basic' | 'advanced' = 'basic') {
  if (mode === 'basic') {
    return {
      basic: FIELD_CATEGORIES.basic,
      performance: FIELD_CATEGORIES.performance,
      conversions: FIELD_CATEGORIES.conversions,
      datetime: FIELD_CATEGORIES.datetime,
    };
  }
  return FIELD_CATEGORIES;
}
