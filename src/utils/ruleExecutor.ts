import { Agent, ActionLog } from '../models';
import { agentClient, agentBaseUrl } from './agentClient';
import { generateId } from './index';

// Helper function for consistent conversion extraction from Meta actions array
function getConversionsFromActions(actions: any[] | undefined): number {
  if (!actions || !Array.isArray(actions)) return 0;
  const purchase = actions.find((a: any) =>
    a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'lead'
  );
  return purchase ? parseFloat(purchase.value || 0) : 0;
}

// All available operators
export type Operator = 
  // Basic operators
  | 'equals' | 'not_equals' | 'greater_than' | 'less_than' 
  | 'greater_than_or_equal' | 'less_than_or_equal' | 'between'
  | 'contains' | 'not_contains' | 'in' | 'not_in'
  // Advanced operators
  | 'regex' | 'not_regex'
  | 'starts_with' | 'ends_with'
  // Date/Time operators
  | 'date_equals' | 'date_before' | 'date_after' | 'date_between'
  | 'days_ago_less_than' | 'days_ago_greater_than' | 'days_ago_between'
  | 'time_of_day_between'
  // Statistics operators
  | 'above_average' | 'below_average' | 'above_median' | 'below_median'
  | 'above_percentile' | 'below_percentile'
  | 'percent_change_greater' | 'percent_change_less'
  | 'trend_increasing' | 'trend_decreasing' | 'trend_stable'
  // Null checks
  | 'is_null' | 'is_not_null';

// All available fields organized by category
export const FIELD_CATEGORIES = {
  basic: {
    name: 'Basic',
    fields: [
      { id: 'name', label: 'Ad Set Name', type: 'string' },
      { id: 'status', label: 'Status', type: 'enum', values: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED'] },
      { id: 'effective_status', label: 'Effective Status', type: 'enum', values: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS'] },
      { id: 'daily_budget', label: 'Daily Budget', type: 'money' },
      { id: 'lifetime_budget', label: 'Lifetime Budget', type: 'money' },
      { id: 'optimization_goal', label: 'Optimization Goal', type: 'enum', values: ['NONE', 'APP_INSTALLS', 'AD_RECALL_LIFT', 'ENGAGED_USERS', 'EVENT_RESPONSES', 'IMPRESSIONS', 'LEAD_GENERATION', 'QUALITY_LEAD', 'LINK_CLICKS', 'OFFSITE_CONVERSIONS', 'PAGE_LIKES', 'POST_ENGAGEMENT', 'QUALITY_CALL', 'REACH', 'LANDING_PAGE_VIEWS', 'VISIT_INSTAGRAM_PROFILE', 'VALUE', 'THRUPLAY', 'DERIVED_EVENTS', 'APP_INSTALLS_AND_OFFSITE_CONVERSIONS', 'CONVERSATIONS', 'IN_APP_VALUE', 'MESSAGING_PURCHASE_CONVERSION', 'MESSAGING_APPOINTMENT_CONVERSION'] },
    ]
  },
  datetime: {
    name: 'Date & Time',
    fields: [
      { id: 'created_time', label: 'Created Time', type: 'datetime' },
      { id: 'updated_time', label: 'Updated Time', type: 'datetime' },
      { id: 'start_time', label: 'Start Time', type: 'datetime' },
      { id: 'end_time', label: 'End Time', type: 'datetime' },
    ]
  },
  performance: {
    name: 'Performance Metrics',
    fields: [
      { id: 'spend', label: 'Amount Spent', type: 'money' },
      { id: 'impressions', label: 'Impressions', type: 'number' },
      { id: 'clicks', label: 'Clicks', type: 'number' },
      { id: 'reach', label: 'Reach', type: 'number' },
      { id: 'frequency', label: 'Frequency', type: 'number' },
      { id: 'ctr', label: 'CTR (Click-Through Rate)', type: 'percentage' },
      { id: 'cpc', label: 'CPC (Cost per Click)', type: 'money' },
      { id: 'cpm', label: 'CPM (Cost per 1000 Impressions)', type: 'money' },
    ]
  },
  conversions: {
    name: 'Conversions & Results',
    fields: [
      { id: 'conversions', label: 'Conversions', type: 'number' },
      { id: 'conversion_rate', label: 'Conversion Rate', type: 'percentage' },
      { id: 'cost_per_conversion', label: 'Cost per Conversion', type: 'money' },
      { id: 'cost_per_action', label: 'Cost per Action', type: 'money' },
      { id: 'actions', label: 'Actions', type: 'number' },
      { id: 'roas', label: 'ROAS (Return on Ad Spend)', type: 'number' },
      { id: 'purchase_value', label: 'Purchase Value', type: 'money' },
    ]
  },
  advanced: {
    name: 'Advanced Settings',
    fields: [
      { id: 'bid_amount', label: 'Bid Amount', type: 'money' },
      { id: 'bid_strategy', label: 'Bid Strategy', type: 'enum', values: ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS'] },
      { id: 'billing_event', label: 'Billing Event', type: 'enum', values: ['IMPRESSIONS', 'LINK_CLICKS', 'APP_INSTALLS', 'PAGE_LIKES', 'POST_ENGAGEMENT', 'VIDEO_VIEWS', 'THRUPLAY'] },
      { id: 'destination_type', label: 'Destination Type', type: 'enum', values: ['WEBSITE', 'APP', 'MESSENGER', 'APPLINKS_AUTOMATIC', 'FACEBOOK', 'INSTAGRAM_DIRECT', 'ON_AD', 'ON_POST', 'ON_EVENT', 'ON_VIDEO', 'SHOP_AUTOMATIC'] },
      { id: 'pacing_type', label: 'Pacing Type', type: 'array', values: ['standard', 'no_pacing', 'day_parting'] },
    ]
  },
  targeting: {
    name: 'Targeting',
    fields: [
      { id: 'targeting.age_min', label: 'Minimum Age', type: 'number' },
      { id: 'targeting.age_max', label: 'Maximum Age', type: 'number' },
      { id: 'targeting.genders', label: 'Genders', type: 'array', values: ['male', 'female'] },
      { id: 'targeting.geo_locations.countries', label: 'Countries', type: 'array' },
      { id: 'targeting.publisher_platforms', label: 'Platforms', type: 'array', values: ['facebook', 'instagram', 'audience_network', 'messenger'] },
      { id: 'targeting.facebook_positions', label: 'Facebook Positions', type: 'array', values: ['feed', 'right_hand_column', 'instant_article', 'marketplace', 'video_feeds', 'story', 'search', 'instream_video'] },
      { id: 'targeting.instagram_positions', label: 'Instagram Positions', type: 'array', values: ['stream', 'story', 'explore', 'reels', 'profile_feed', 'ig_search'] },
    ]
  }
};

// Flatten all fields for easy lookup
export const ALL_FIELDS = Object.values(FIELD_CATEGORIES).flatMap(cat => cat.fields);

// Helper function to evaluate filter conditions
export function evaluateFilterConditions(
  adSet: any, 
  filterConfig: any,
  campaignStats?: CampaignStatistics
): boolean {
  const { conditions, condition_groups, logical_operator = 'AND' } = filterConfig;

  // Handle nested condition groups (for complex rules)
  if (condition_groups && condition_groups.length > 0) {
    const groupResults = condition_groups.map((group: any) => 
      evaluateFilterConditions(adSet, group, campaignStats)
    );
    
    return logical_operator === 'AND' 
      ? groupResults.every((r: boolean) => r)
      : groupResults.some((r: boolean) => r);
  }

  if (!conditions || conditions.length === 0) {
    return true;
  }

  const results = conditions.map((condition: any) => {
    return evaluateSingleCondition(adSet, condition, campaignStats);
  });

  return logical_operator === 'AND' 
    ? results.every((r: boolean) => r)
    : results.some((r: boolean) => r);
}

// Campaign statistics for comparison operators
export interface CampaignStatistics {
  averages: Record<string, number>;
  medians: Record<string, number>;
  percentiles: Record<string, Record<number, number>>;
  trends: Record<string, 'increasing' | 'decreasing' | 'stable'>;
  totals: Record<string, number>;
}

// Evaluate a single condition
function evaluateSingleCondition(
  adSet: any, 
  condition: any,
  campaignStats?: CampaignStatistics
): boolean {
  const { field, operator, value, value2, time_window } = condition;
  let fieldValue = getFieldValue(adSet, field, time_window);

  // Handle null checks first
  if (operator === 'is_null') return fieldValue === null || fieldValue === undefined;
  if (operator === 'is_not_null') return fieldValue !== null && fieldValue !== undefined;

  // Skip if field value is null/undefined for other operators
  if (fieldValue === null || fieldValue === undefined) return false;

  switch (operator) {
    // Basic operators
    case 'equals':
      return fieldValue === value;
    case 'not_equals':
      return fieldValue !== value;
    case 'greater_than':
      return Number(fieldValue) > Number(value);
    case 'less_than':
      return Number(fieldValue) < Number(value);
    case 'greater_than_or_equal':
      return Number(fieldValue) >= Number(value);
    case 'less_than_or_equal':
      return Number(fieldValue) <= Number(value);
    case 'between':
      return Number(fieldValue) >= Number(value) && Number(fieldValue) <= Number(value2);
    case 'contains':
      return String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
    case 'not_contains':
      return !String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
    case 'starts_with':
      return String(fieldValue).toLowerCase().startsWith(String(value).toLowerCase());
    case 'ends_with':
      return String(fieldValue).toLowerCase().endsWith(String(value).toLowerCase());
    case 'in':
      return Array.isArray(value) && value.includes(fieldValue);
    case 'not_in':
      return Array.isArray(value) && !value.includes(fieldValue);

    // Regex operators
    case 'regex':
      try {
        const regex = new RegExp(value, 'i');
        return regex.test(String(fieldValue));
      } catch {
        return false;
      }
    case 'not_regex':
      try {
        const regex = new RegExp(value, 'i');
        return !regex.test(String(fieldValue));
      } catch {
        return false;
      }

    // Date operators
    case 'date_equals':
      return isSameDay(new Date(fieldValue), new Date(value));
    case 'date_before':
      return new Date(fieldValue) < new Date(value);
    case 'date_after':
      return new Date(fieldValue) > new Date(value);
    case 'date_between':
      const date = new Date(fieldValue);
      return date >= new Date(value) && date <= new Date(value2);
    case 'days_ago_less_than':
      return getDaysAgo(new Date(fieldValue)) < Number(value);
    case 'days_ago_greater_than':
      return getDaysAgo(new Date(fieldValue)) > Number(value);
    case 'days_ago_between':
      const daysAgo = getDaysAgo(new Date(fieldValue));
      return daysAgo >= Number(value) && daysAgo <= Number(value2);
    case 'time_of_day_between':
      const hour = new Date(fieldValue).getHours();
      return hour >= Number(value) && hour <= Number(value2);

    // Statistics operators (require campaign stats)
    case 'above_average':
      if (!campaignStats) return false;
      return Number(fieldValue) > (campaignStats.averages[field] || 0);
    case 'below_average':
      if (!campaignStats) return false;
      return Number(fieldValue) < (campaignStats.averages[field] || Infinity);
    case 'above_median':
      if (!campaignStats) return false;
      return Number(fieldValue) > (campaignStats.medians[field] || 0);
    case 'below_median':
      if (!campaignStats) return false;
      return Number(fieldValue) < (campaignStats.medians[field] || Infinity);
    case 'above_percentile':
      if (!campaignStats) return false;
      const abovePercentile = campaignStats.percentiles[field]?.[Number(value)] || 0;
      return Number(fieldValue) > abovePercentile;
    case 'below_percentile':
      if (!campaignStats) return false;
      const belowPercentile = campaignStats.percentiles[field]?.[Number(value)] || Infinity;
      return Number(fieldValue) < belowPercentile;
    case 'percent_change_greater':
      // This requires historical data comparison
      const percentChange = getPercentChange(adSet, field, time_window);
      return percentChange > Number(value);
    case 'percent_change_less':
      const percentChangeLess = getPercentChange(adSet, field, time_window);
      return percentChangeLess < Number(value);
    case 'trend_increasing':
      if (!campaignStats) return false;
      return campaignStats.trends[field] === 'increasing';
    case 'trend_decreasing':
      if (!campaignStats) return false;
      return campaignStats.trends[field] === 'decreasing';
    case 'trend_stable':
      if (!campaignStats) return false;
      return campaignStats.trends[field] === 'stable';

    default:
      console.warn(`Unknown operator: ${operator}`);
      return false;
  }
}

// Helper: Check if two dates are the same day
function isSameDay(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate();
}

// Helper: Get days ago from a date
function getDaysAgo(date: Date): number {
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// Helper: Get percent change (placeholder - requires historical data)
function getPercentChange(adSet: any, field: string, timeWindow?: string): number {
  // This would need historical data to calculate
  // For now, check if we have comparison data in the ad set
  const currentValue = getFieldValue(adSet, field);
  const previousValue = adSet.previous_metrics?.[field];
  
  if (previousValue && previousValue !== 0) {
    return ((currentValue - previousValue) / previousValue) * 100;
  }
  return 0;
}

// Helper function to get field value from ad set (including nested fields)
function getFieldValue(adSet: any, field: string, timeWindow?: string): any {
  // Handle nested field paths (e.g., "targeting.age_min")
  if (field.includes('.')) {
    const parts = field.split('.');
    let value = adSet;
    for (const part of parts) {
      if (value === null || value === undefined) return null;
      value = value[part];
    }
    return value;
  }

  // Check if it's a performance metric with time window
  if (timeWindow && adSet.time_windowed_metrics?.[timeWindow]) {
    const windowedMetrics = adSet.time_windowed_metrics[timeWindow];
    if (windowedMetrics[field] !== undefined) {
      return windowedMetrics[field];
    }
  }

  // Check performance metrics
  if (adSet.performance_metrics) {
    // Direct metric
    if (adSet.performance_metrics[field] !== undefined) {
      return adSet.performance_metrics[field];
    }
    
    // Handle special computed metrics
    if (field === 'cost_per_conversion' || field === 'cost_per_action') {
      // First try cost_per_action_type (what Meta actually returns)
      const costPerActionType = adSet.performance_metrics.cost_per_action_type;
      if (costPerActionType && Array.isArray(costPerActionType)) {
        const purchaseCost = costPerActionType.find((c: any) =>
          c.action_type === 'purchase' || c.action_type === 'omni_purchase'
        );
        if (purchaseCost) return parseFloat(purchaseCost.value || 0);
      }
      // Fallback: calculate from spend/conversions
      const spend = parseFloat(adSet.performance_metrics.spend || 0);
      const conversions = getConversionsFromActions(adSet.performance_metrics.actions);
      return conversions > 0 ? spend / conversions : 0;
    }

    if (field === 'conversion_rate') {
      const conversions = getConversionsFromActions(adSet.performance_metrics.actions);
      const clicks = adSet.performance_metrics.clicks || 0;
      return clicks > 0 ? (conversions / Number(clicks)) * 100 : 0;
    }

    if (field === 'conversions' || field === 'actions') {
      const actions = adSet.performance_metrics.actions;
      if (actions && Array.isArray(actions)) {
        const purchase = actions.find((a: any) =>
          a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'lead'
        );
        return purchase ? parseFloat(purchase.value || 0) : 0;
      }
      return 0;
    }

    if (field === 'roas') {
      const purchaseValue = adSet.performance_metrics.purchase_roas?.[0]?.value || 
                           adSet.performance_metrics.action_values?.[0]?.value || 0;
      const spend = adSet.performance_metrics.spend || 0;
      return spend > 0 ? Number(purchaseValue) / Number(spend) : 0;
    }

    if (field === 'purchase_value') {
      const actionValues = adSet.performance_metrics.action_values;
      if (actionValues && Array.isArray(actionValues)) {
        const purchase = actionValues.find((av: any) => 
          av.action_type === 'purchase' || av.action_type === 'omni_purchase'
        );
        return purchase ? parseFloat(purchase.value || 0) : 0;
      }
      return 0;
    }
  }
  
  // Check direct field on ad set
  if (adSet[field] !== undefined) {
    return adSet[field];
  }

  return null;
}

// Calculate campaign statistics for comparison operators
export function calculateCampaignStatistics(adSets: any[]): CampaignStatistics {
  const metrics = ['spend', 'impressions', 'clicks', 'conversions', 'ctr', 'cpc', 'cpm', 'cost_per_conversion', 'roas'];
  
  const stats: CampaignStatistics = {
    averages: {},
    medians: {},
    percentiles: {},
    trends: {},
    totals: {},
  };

  for (const metric of metrics) {
    const values = adSets
      .map(adSet => getFieldValue(adSet, metric))
      .filter(v => v !== null && v !== undefined && !isNaN(Number(v)))
      .map(v => Number(v))
      .sort((a, b) => a - b);

    if (values.length === 0) continue;

    // Calculate average
    const sum = values.reduce((a, b) => a + b, 0);
    stats.averages[metric] = sum / values.length;
    stats.totals[metric] = sum;

    // Calculate median
    const mid = Math.floor(values.length / 2);
    stats.medians[metric] = values.length % 2 !== 0
      ? values[mid]
      : (values[mid - 1] + values[mid]) / 2;

    // Calculate percentiles (25th, 50th, 75th, 90th, 95th)
    stats.percentiles[metric] = {};
    for (const p of [25, 50, 75, 90, 95]) {
      const index = Math.ceil((p / 100) * values.length) - 1;
      stats.percentiles[metric][p] = values[Math.max(0, index)];
    }
  }

  return stats;
}

/** Execute a rule against its agent.
 *  @param actor — 'auto' for scheduled runs; pass the signed-in user's id when
 *    the user clicks Execute on the rule. The actor lands on every ActionLog
 *    row produced by this run and drives the AUTO/MANUAL chip in /u/activity. */
export async function executeRule(rule: any, actor: string = 'auto'): Promise<any> {
  // Get ad sets from agent
  const agent = await Agent.findOne({ id: rule.agent_id });
  if (!agent || agent.status !== 'ONLINE') {
    throw new Error('Agent not found or offline');
  }

  const client = agentClient(agent);
  let adSetsResponse;
  try {
    adSetsResponse = await client.get(`/meta/campaigns/${rule.campaign_id}/adsets`, { timeout: 15000 });
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
    throw new Error('Failed to fetch ad sets from agent');
  }

  const adSets = adSetsResponse.data?.ad_sets || adSetsResponse.data?.data || [];
  
  // Calculate campaign statistics for comparison operators
  const campaignStats = calculateCampaignStatistics(adSets);
  
  // Find matching ad sets
  const matchingAdSets = adSets.filter((adSet: any) => {
    return evaluateFilterConditions(adSet, rule.filter_config, campaignStats);
  });

  // Execute action on matching ad sets
  const results = [];
  for (const adSet of matchingAdSets) {
    try {
      const newStatus = rule.action.type === 'PAUSE' ? 'PAUSED' : 'ACTIVE';

      const response = await client.put(`/meta/adsets/${adSet.id}/status`, { status: newStatus }, { timeout: 10000 });
      
      // Check for application-level errors in the response
      if (response.data && response.data.status === 'error') {
        const errorMessage = response.data.message || response.data.error_details || 'Agent returned an error';
        results.push({
          ad_set_id: adSet.id,
          ad_set_name: adSet.name,
          action: rule.action.type,
          success: false,
          error: errorMessage,
        });
        continue;
      }

      // Audit-feed write — automated rule runs surface in /u/activity as
      // `Auto · R<rule_id>`. Best-effort; never blocks the rule from running.
      try {
        const verb: 'pause' | 'activate' = rule.action.type === 'PAUSE' ? 'pause' : 'activate';
        await ActionLog.create({
          id: generateId('act'),
          user_id: rule.user_id,
          agent_id: rule.agent_id,
          campaign_id: rule.campaign_id,
          ad_set_id: adSet.id,
          source: `rule:${rule.id}`,
          actor,
          action_type: verb,
          description: `${verb === 'pause' ? 'Paused' : 'Activated'} <b>${adSet.name}</b> — matched rule "${rule.rule_name}"`,
          context: { rule_name: rule.rule_name, mode: rule.execution_mode },
        });
      } catch (logErr) {
        console.error('ActionLog write failed (rule executor):', logErr);
      }

      results.push({
        ad_set_id: adSet.id,
        ad_set_name: adSet.name,
        action: rule.action.type,
        success: true,
      });
    } catch (error: any) {
      let errorMessage = error.message || 'Unknown error';
      
      // Extract detailed error message from response
      if (error.response) {
        if (error.response.data) {
          if (error.response.data.status === 'error') {
            errorMessage = error.response.data.message || error.response.data.error_details || errorMessage;
          } else if (error.response.data.error) {
            const metaError = error.response.data.error;
            errorMessage = metaError.message || errorMessage;
            if (metaError.error_subcode) {
              errorMessage += ` (Error Code: ${metaError.code || 'N/A'}, Subcode: ${metaError.error_subcode})`;
            } else if (metaError.code) {
              errorMessage += ` (Error Code: ${metaError.code})`;
            }
          } else if (error.response.data.detail) {
            errorMessage = error.response.data.detail;
          } else if (typeof error.response.data === 'string') {
            errorMessage = error.response.data;
          }
        } else {
          errorMessage = `HTTP ${error.response.status}: ${error.response.statusText || errorMessage}`;
        }
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Request timed out';
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Cannot connect to agent';
      }
      
      results.push({
        ad_set_id: adSet.id,
        ad_set_name: adSet.name,
        action: rule.action.type,
        success: false,
        error: errorMessage,
      });
    }
  }

  // Calculate success/failure stats
  const successfulCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  
  // Update rule execution stats
  rule.last_executed_at = new Date();
  rule.execution_count += 1;
  rule.last_matched_count = matchingAdSets.length;
  rule.last_action = `${rule.action.type} ${successfulCount} ad set(s)${failedCount > 0 ? ` (${failedCount} failed)` : ''}`;
  await rule.save();

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    action: rule.action.type,
    matched_count: matchingAdSets.length,
    total_count: adSets.length,
    successful_count: successfulCount,
    failed_count: failedCount,
    has_errors: failedCount > 0,
    error_summary: failedCount > 0 ? `${failedCount} out of ${matchingAdSets.length} ad sets failed to update` : null,
    results,
    campaign_statistics: campaignStats,
  };
}
