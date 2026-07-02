/**
 * Computed Metrics Calculator
 * Calculates advanced metrics from raw Meta API data
 * 
 * These metrics are not provided directly by Meta's API and must be computed
 * from raw action/insight data.
 */

export interface ComputedMetrics {
  // Video Performance Metrics
  thumbstopRatio: number; // (video_3_sec_watched / impressions) * 100
  holdRate: number; // (video_thruplay / video_3_sec_watched) * 100
  
  // Funnel Metrics
  checkoutRate: number; // (initiate_checkout / landing_page_views) * 100
  clickToLandingRate: number; // (landing_page_views / outbound_clicks) * 100
  
  // Conversion Metrics
  conversionRate: number; // (conversions / clicks) * 100
  landingToConversionRate: number; // (conversions / landing_page_views) * 100
  
  // Cost Efficiency
  cpa: number; // Cost Per Acquisition (spend / conversions)
  roas: number; // Return on Ad Spend (revenue / spend)
  
  // Engagement Metrics
  engagementRate: number; // (engaged_users / reach) * 100
  hookRate: number; // Alias for thumbstopRatio
}

/**
 * Extract action value from Meta's actions array
 */
function getActionValue(actions: any[], actionType: string): number {
  if (!actions || !Array.isArray(actions)) return 0;
  
  const action = actions.find((a: any) => 
    a.action_type === actionType || 
    a.action_type?.includes(actionType)
  );
  
  return action ? parseFloat(action.value || 0) : 0;
}

/**
 * Extract action value from Meta's action_values array (for revenue)
 */
function getActionValueAmount(actionValues: any[], actionType: string): number {
  if (!actionValues || !Array.isArray(actionValues)) return 0;
  
  const action = actionValues.find((a: any) => 
    a.action_type === actionType ||
    a.action_type?.includes(actionType)
  );
  
  return action ? parseFloat(action.value || 0) : 0;
}

/**
 * Calculate all computed metrics for an ad/adset/campaign
 */
export function calculateComputedMetrics(metrics: any): ComputedMetrics {
  // Extract base metrics
  const impressions = parseInt(metrics.impressions || 0);
  const clicks = parseInt(metrics.clicks || 0);
  const reach = parseInt(metrics.reach || 0);
  const spend = parseFloat(metrics.spend || 0);
  
  // Extract action-based metrics
  const actions = metrics.actions || [];
  const actionValues = metrics.action_values || [];
  
  // Video metrics - try multiple possible field names
  let video3SecWatched = 0;
  let videoThruplay = 0;
  
  // Check if video metrics are directly in metrics object
  if (metrics.video_3_sec_watched_actions) {
    video3SecWatched = Array.isArray(metrics.video_3_sec_watched_actions) 
      ? parseInt(metrics.video_3_sec_watched_actions[0]?.value || 0)
      : parseInt(metrics.video_3_sec_watched_actions || 0);
  }
  
  if (metrics.video_thruplay_watched_actions) {
    videoThruplay = Array.isArray(metrics.video_thruplay_watched_actions)
      ? parseInt(metrics.video_thruplay_watched_actions[0]?.value || 0)
      : parseInt(metrics.video_thruplay_watched_actions || 0);
  }
  
  // If not found, try actions array
  if (video3SecWatched === 0) {
    video3SecWatched = getActionValue(actions, 'video_view');
  }
  if (videoThruplay === 0) {
    videoThruplay = getActionValue(actions, 'video_thruplay');
  }
  
  // Landing page metrics
  const landingPageViews = metrics.landing_page_views
    ? parseInt(metrics.landing_page_views || 0)
    : getActionValue(actions, 'landing_page_view');

  // Link Clicks (inline_link_clicks) = what Meta Ads Manager labels "Link Clicks"
  // These are clicks on links within the ad (on or off Facebook properties)
  // Per Meta's 2016 update: distinct from "Clicks (All)" which includes engagement
  const linkClicks = metrics.inline_link_clicks
    ? parseInt(metrics.inline_link_clicks || 0)
    : getActionValue(actions, 'link_click');

  const outboundClicks = metrics.outbound_clicks
    ? parseInt(metrics.outbound_clicks || 0)
    : getActionValue(actions, 'outbound_click');
  
  // Checkout initiation
  const initiateCheckout = getActionValue(actions, 'initiate_checkout');

  // Conversion metrics
  const conversions = getActionValue(actions, 'purchase') ||
                     getActionValue(actions, 'omni_purchase') ||
                     getActionValue(actions, 'lead') ||
                     getActionValue(actions, 'offsite_conversion');
  
  // Revenue metrics
  const revenue = getActionValueAmount(actionValues, 'purchase') ||
                 getActionValueAmount(actionValues, 'omni_purchase') ||
                 0;
  
  // Engagement metrics
  const engagedUsers = getActionValue(actions, 'onsite_conversion.post_save') ||
                      getActionValue(actions, 'link_click') ||
                      0;
  
  // Calculate computed metrics
  const computed: ComputedMetrics = {
    // Video Performance
    thumbstopRatio: impressions > 0 ? (video3SecWatched / impressions) * 100 : 0,
    holdRate: video3SecWatched > 0 ? (videoThruplay / video3SecWatched) * 100 : 0,
    
    // Funnel Metrics
    checkoutRate: landingPageViews > 0 ? (initiateCheckout / landingPageViews) * 100 : 0,
    clickToLandingRate: outboundClicks > 0 ? (landingPageViews / outboundClicks) * 100 : 0,
    
    // Conversion Metrics — use Link Clicks (inline_link_clicks) as denominator,
    // not Clicks (All), since only link clicks can lead to a conversion
    conversionRate: linkClicks > 0 ? (conversions / linkClicks) * 100 : 0,
    landingToConversionRate: landingPageViews > 0 ? (conversions / landingPageViews) * 100 : 0,
    
    // Cost Efficiency
    cpa: conversions > 0 ? spend / conversions : 0,
    roas: spend > 0 ? revenue / spend : 0,
    
    // Engagement
    engagementRate: reach > 0 ? (engagedUsers / reach) * 100 : 0,
    hookRate: impressions > 0 ? (video3SecWatched / impressions) * 100 : 0, // Alias for thumbstopRatio
  };
  
  return computed;
}

/**
 * Add computed metrics to an object (mutates the object)
 */
export function enrichWithComputedMetrics(obj: any): any {
  if (!obj) return obj;
  
  // If object has performance_metrics, calculate for those
  if (obj.performance_metrics) {
    const computed = calculateComputedMetrics(obj.performance_metrics);
    obj.computed_metrics = computed;
  }
  
  // If object itself looks like metrics, calculate directly
  else if (obj.impressions || obj.spend) {
    const computed = calculateComputedMetrics(obj);
    obj.computed_metrics = computed;
  }
  
  return obj;
}

/**
 * Enrich an array of objects with computed metrics
 */
export function enrichArrayWithComputedMetrics(arr: any[]): any[] {
  if (!arr || !Array.isArray(arr)) return arr;
  
  return arr.map(item => enrichWithComputedMetrics(item));
}

/**
 * Calculate budget utilization percentage
 */
export function calculateBudgetUtilization(spend: number, dailyBudget: number, lifetimeBudget?: number): number {
  if (dailyBudget > 0) {
    return (spend / dailyBudget) * 100;
  }
  
  if (lifetimeBudget && lifetimeBudget > 0) {
    return (spend / lifetimeBudget) * 100;
  }
  
  return 0;
}

/**
 * Helper to get conversion count from metrics
 */
export function getConversions(metrics: any): number {
  if (!metrics) return 0;
  
  const actions = metrics.actions || [];
  
  return getActionValue(actions, 'purchase') || 
         getActionValue(actions, 'omni_purchase') ||
         getActionValue(actions, 'lead') ||
         getActionValue(actions, 'offsite_conversion') ||
         0;
}

/**
 * Helper to get revenue from metrics
 */
export function getRevenue(metrics: any): number {
  if (!metrics) return 0;
  
  const actionValues = metrics.action_values || [];
  
  return getActionValueAmount(actionValues, 'purchase') ||
         getActionValueAmount(actionValues, 'omni_purchase') ||
         0;
}

/**
 * Calculate metrics for a specific time window from insights data
 */
export interface TimeWindowMetrics {
  ctr: number;
  conversionRate: number;
  cpa: number;
  spend: number;
  conversions: number;
  clicks: number;
  impressions: number;
}

export function calculateTimeWindowMetrics(insights: any): TimeWindowMetrics {
  const impressions = parseInt(insights.impressions || 0);
  const clicks = parseInt(insights.clicks || 0);
  const spend = parseFloat(insights.spend || 0);
  const conversions = getConversions(insights);
  
  return {
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    conversionRate: clicks > 0 ? (conversions / clicks) * 100 : 0,
    cpa: conversions > 0 ? spend / conversions : 0,
    spend,
    conversions,
    clicks,
    impressions,
  };
}



