/**
 * Modular Optimization Analysis System
 * 
 * Each module analyzes specific aspects of campaign performance and returns
 * standardized recommendation objects.
 */

import { calculateComputedMetrics, getConversions, getRevenue, calculateBudgetUtilization } from './computedMetrics';

/**
 * Standardized recommendation format (matches the new API contract)
 */
export interface OptimizationRecommendation {
  id: string;
  type: 'budget_waste' | 'creative_alert' | 'scaling_opportunity' | 'cost_efficiency' | 'sentiment_warning' | 'learning_phase' | 'platform_arbitrage' | 'dayparting';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OPPORTUNITY';
  related_entity_id: string;
  related_entity_name: string;
  detected_value?: number;
  benchmark_value?: number;
  metric_label: string;
  message: string;
  action_endpoint?: string;
  estimated_savings?: number;
  estimated_revenue_increase?: number;
  confidence: number; // 0-100
  module: string; // Which module generated this
}

export interface ModuleConfig {
  target_cpa?: number; // User-defined or calculated average
  target_roas?: number; // User-defined target ROAS
  account_avg_cpa?: number; // Calculated from account data
}

/**
 * MODULE 1: Bleeding Budget Detector (Cost Efficiency)
 * Goal: Identify where money is being burned with zero return
 */
export class BleedingBudgetDetector {
  private config: ModuleConfig;
  
  constructor(config: ModuleConfig) {
    this.config = config;
  }
  
  /**
   * Analyze ad sets for budget waste issues
   */
  analyze(adSets: any[]): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    
    // Calculate campaign average CPA for outlier detection
    const campaignAvgCPA = this.calculateCampaignAverageCPA(adSets);
    
    // Use target CPA or fallback to campaign average
    const targetCPA = this.config.target_cpa || this.config.account_avg_cpa || campaignAvgCPA;
    
    for (const adSet of adSets) {
      const metrics = adSet.performance_metrics || {};
      const spend = parseFloat(metrics.spend || 0);
      const conversions = getConversions(metrics);
      const clicks = parseInt(metrics.clicks || 0);
      const adSetCPA = conversions > 0 ? spend / conversions : 0;
      
      const dailyBudget = parseFloat(adSet.daily_budget || 0);
      const lifetimeBudget = parseFloat(adSet.lifetime_budget || 0);
      const effectiveStatus = adSet.effective_status || adSet.status;
      
      // Rule 1.1: Zero-Conversion Spend
      if (targetCPA > 0 && spend > (2 * targetCPA) && conversions === 0 && clicks > 0) {
        recommendations.push({
          id: `rec_bleeding_zero_${adSet.id}`,
          type: 'budget_waste',
          priority: 'CRITICAL',
          related_entity_id: adSet.id,
          related_entity_name: adSet.name,
          detected_value: spend,
          benchmark_value: 0,
          metric_label: 'Wasted Spend (Zero Conversions)',
          message: `🚨 Pause this Ad Set immediately. You have wasted $${spend.toFixed(2)} with 0 results. The ad is getting clicks but no conversions - major conversion issue.`,
          action_endpoint: `/api/adsets/${adSet.id}/pause`,
          estimated_savings: spend,
          confidence: 95,
          module: 'Bleeding Budget Detector',
        });
      }
      
      // Rule 1.2: CPA Outliers (2x more expensive than average)
      if (conversions > 0 && campaignAvgCPA > 0 && adSetCPA > (2 * campaignAvgCPA)) {
        const wastedSpend = spend - (conversions * campaignAvgCPA);
        
        recommendations.push({
          id: `rec_bleeding_cpa_${adSet.id}`,
          type: 'cost_efficiency',
          priority: 'HIGH',
          related_entity_id: adSet.id,
          related_entity_name: adSet.name,
          detected_value: adSetCPA,
          benchmark_value: campaignAvgCPA,
          metric_label: 'Cost Per Acquisition (CPA)',
          message: `💸 This ad set is 2x more expensive than your average. CPA: $${adSetCPA.toFixed(2)} vs Campaign Avg: $${campaignAvgCPA.toFixed(2)}. Turn it off to save budget.`,
          action_endpoint: `/api/adsets/${adSet.id}/pause`,
          estimated_savings: wastedSpend,
          confidence: 85,
          module: 'Bleeding Budget Detector',
        });
      }
      
      // Rule 1.3: Learning Phase Trap (Low budget preventing exit from learning)
      const isLearningLimited = effectiveStatus?.includes('LEARNING') || 
                               effectiveStatus === 'LEARNING_LIMITED' ||
                               (adSet.status === 'ACTIVE' && conversions < 50); // Heuristic: < 50 conversions likely still learning
      
      if (isLearningLimited && targetCPA > 0 && dailyBudget > 0) {
        const recommendedMinBudget = targetCPA / 7; // Meta recommendation
        
        if (dailyBudget < recommendedMinBudget) {
          recommendations.push({
            id: `rec_bleeding_learning_${adSet.id}`,
            type: 'learning_phase',
            priority: 'MEDIUM',
            related_entity_id: adSet.id,
            related_entity_name: adSet.name,
            detected_value: dailyBudget,
            benchmark_value: recommendedMinBudget,
            metric_label: 'Daily Budget (Too Low for Learning)',
            message: `🎓 Your budget ($${dailyBudget.toFixed(2)}/day) is too low to exit the Learning Phase. Meta recommends at least $${recommendedMinBudget.toFixed(2)}/day (Target CPA / 7). Consolidate 3 ad sets into 1 or increase budget.`,
            estimated_savings: 0,
            confidence: 75,
            module: 'Bleeding Budget Detector',
          });
        }
      }
    }
    
    return recommendations;
  }
  
  /**
   * Calculate campaign average CPA
   */
  private calculateCampaignAverageCPA(adSets: any[]): number {
    let totalSpend = 0;
    let totalConversions = 0;
    
    for (const adSet of adSets) {
      const metrics = adSet.performance_metrics || {};
      totalSpend += parseFloat(metrics.spend || 0);
      totalConversions += getConversions(metrics);
    }
    
    return totalConversions > 0 ? totalSpend / totalConversions : 0;
  }
}

/**
 * MODULE 2: Creative Fatigue & Health
 * Goal: Detect when ads are "dying" before the user notices
 */
export class CreativeFatigueDetector {
  
  /**
   * Analyze ad sets/ads for creative fatigue
   */
  analyze(adSets: any[], timeComparisonData?: Map<string, any>): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    
    for (const adSet of adSets) {
      const metrics = adSet.performance_metrics || {};
      const frequency = parseFloat(metrics.frequency || 0);
      const ctr = parseFloat(metrics.ctr || 0);
      const spend = parseFloat(metrics.spend || 0);
      
      // Get computed metrics
      const computed = calculateComputedMetrics(metrics);
      
      // Get time comparison if available
      const timeComparison = timeComparisonData?.get(adSet.id);
      const ctrLast7Days = timeComparison?.last_7d?.ctr || ctr;
      const ctrLast30Days = timeComparison?.last_30d?.ctr || ctr;
      
      // Rule 2.1: Fatigue Detection (Frequency > 4.0 AND declining CTR)
      if (frequency > 4.0 && ctrLast7Days < ctrLast30Days && spend > 10) {
        const ctrDecline = ((ctrLast30Days - ctrLast7Days) / ctrLast30Days) * 100;
        
        recommendations.push({
          id: `rec_fatigue_${adSet.id}`,
          type: 'creative_alert',
          priority: 'HIGH',
          related_entity_id: adSet.id,
          related_entity_name: adSet.name,
          detected_value: frequency,
          benchmark_value: 4.0,
          metric_label: 'Frequency (Ad Fatigue)',
          message: `😴 Ad Fatigue Detected: People are seeing this ad too often (${frequency.toFixed(2)}x frequency) and ignoring it. CTR declined ${ctrDecline.toFixed(1)}% in the last 7 days. Swap creative now.`,
          estimated_savings: spend * 0.25, // Estimated 25% savings from creative refresh
          confidence: 85,
          module: 'Creative Fatigue Detector',
        });
      }
      
      // Rule 2.2: Format Diversity Check
      // Note: This requires ad creatives data - checking if we have it
      if (adSet.ads && Array.isArray(adSet.ads)) {
        const hasReels = adSet.ads.some((ad: any) => 
          this.isVerticalVideo(ad.creative)
        );
        
        if (!hasReels && spend > 20) {
          recommendations.push({
            id: `rec_format_diversity_${adSet.id}`,
            type: 'creative_alert',
            priority: 'MEDIUM',
            related_entity_id: adSet.id,
            related_entity_name: adSet.name,
            metric_label: 'Format Diversity (Missing Vertical Video)',
            message: `📱 You are missing 40% of inventory by not having 9:16 vertical video assets (Reels/Stories). Add 2 Reels to capture Instagram/Facebook Reels placements.`,
            estimated_revenue_increase: spend * 0.4, // Estimated 40% revenue increase from new placements
            confidence: 70,
            module: 'Creative Fatigue Detector',
          });
        }
      }
      
      // Rule 2.3: Hook Rate Diagnosis (Thumbstop Ratio < 25%)
      if (computed.thumbstopRatio > 0 && computed.thumbstopRatio < 25 && spend > 15) {
        recommendations.push({
          id: `rec_hook_rate_${adSet.id}`,
          type: 'creative_alert',
          priority: 'MEDIUM',
          related_entity_id: adSet.id,
          related_entity_name: adSet.name,
          detected_value: computed.thumbstopRatio,
          benchmark_value: 25.0,
          metric_label: 'Thumbstop Ratio (Hook Rate)',
          message: `🎬 Your video hook is weak (${computed.thumbstopRatio.toFixed(1)}%). Industry average is 25%. The first 3 seconds are losing ${(100 - computed.thumbstopRatio).toFixed(0)}% of viewers. Test a new intro with a stronger pattern interrupt.`,
          estimated_savings: spend * 0.3, // Better hooks = better efficiency
          confidence: 80,
          module: 'Creative Fatigue Detector',
        });
      }
      
      // Additional: Hold Rate (are people watching past 3 seconds?)
      if (computed.holdRate > 0 && computed.holdRate < 30 && computed.thumbstopRatio > 25) {
        recommendations.push({
          id: `rec_hold_rate_${adSet.id}`,
          type: 'creative_alert',
          priority: 'MEDIUM',
          related_entity_id: adSet.id,
          related_entity_name: adSet.name,
          detected_value: computed.holdRate,
          benchmark_value: 50.0,
          metric_label: 'Hold Rate (Video Completion)',
          message: `⏱️ Your hook is working (${computed.thumbstopRatio.toFixed(1)}% thumbstop), but only ${computed.holdRate.toFixed(1)}% watch beyond 3 seconds. The content after the hook is boring. Make the body more engaging.`,
          confidence: 75,
          module: 'Creative Fatigue Detector',
        });
      }
      
      // Additional: Checkout Rate (visitors who reach landing page but don't initiate checkout)
      if (computed.checkoutRate > 0 && computed.checkoutRate < 5 && spend > 10) {
        recommendations.push({
          id: `rec_checkout_rate_${adSet.id}`,
          type: 'creative_alert',
          priority: 'HIGH',
          related_entity_id: adSet.id,
          related_entity_name: adSet.name,
          detected_value: computed.checkoutRate,
          benchmark_value: 5.0,
          metric_label: 'Checkout Rate',
          message: `🛒 Only ${computed.checkoutRate.toFixed(1)}% of landing page visitors are initiating checkout. Possible issues: unclear CTA, pricing concerns, or poor page experience. Review and optimise your checkout flow.`,
          estimated_savings: spend * ((5 - computed.checkoutRate) / 100),
          confidence: 85,
          module: 'Creative Fatigue Detector',
        });
      }
    }
    
    return recommendations;
  }
  
  /**
   * Check if creative is vertical video (9:16 for Reels/Stories)
   */
  private isVerticalVideo(creative: any): boolean {
    if (!creative) return false;
    
    // Check object_story_spec for video_data
    const objectStorySpec = creative.object_story_spec;
    if (objectStorySpec) {
      const videoData = objectStorySpec.video_data;
      if (videoData && videoData.call_to_action?.type?.includes('STORY')) {
        return true;
      }
    }
    
    // Check asset_feed_spec for STORY placements
    const assetFeedSpec = creative.asset_feed_spec;
    if (assetFeedSpec) {
      const bodies = assetFeedSpec.bodies || [];
      const videos = assetFeedSpec.videos || [];
      
      // Check if any video asset has 9:16 aspect ratio or Story placement
      for (const video of videos) {
        if (video.aspect_ratio === '9:16' || video.placement_asset === 'STORY') {
          return true;
        }
      }
    }
    
    return false;
  }
}

/**
 * MODULE 3: Scaling Opportunities (The "Winner's Circle")
 * Goal: Tell the user how to make more money
 */
export class ScalingOpportunitiesDetector {
  private config: ModuleConfig;
  
  constructor(config: ModuleConfig) {
    this.config = config;
  }
  
  /**
   * Analyze campaigns/ad sets for scaling opportunities
   */
  analyze(
    adSets: any[], 
    platformBreakdowns?: Map<string, any[]>,
    hourlyBreakdowns?: Map<string, any[]>
  ): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    
    for (const adSet of adSets) {
      const metrics = adSet.performance_metrics || {};
      const spend = parseFloat(metrics.spend || 0);
      const revenue = getRevenue(metrics);
      const conversions = getConversions(metrics);
      
      const dailyBudget = parseFloat(adSet.daily_budget || 0);
      const lifetimeBudget = parseFloat(adSet.lifetime_budget || 0);
      
      const roas = spend > 0 ? revenue / spend : 0;
      const budgetUtilization = calculateBudgetUtilization(spend, dailyBudget, lifetimeBudget);
      
      // Rule 3.1: Restricted Winner (High ROAS + High Budget Utilization)
      const targetROAS = this.config.target_roas || 4.0;
      if (roas > targetROAS && budgetUtilization > 95 && dailyBudget > 0) {
        const recommendedIncrease = dailyBudget * 0.20; // 20% increase
        const estimatedRevenue = recommendedIncrease * roas;
        
        recommendations.push({
          id: `rec_scaling_winner_${adSet.id}`,
          type: 'scaling_opportunity',
          priority: 'OPPORTUNITY',
          related_entity_id: adSet.id,
          related_entity_name: adSet.name,
          detected_value: roas,
          benchmark_value: targetROAS,
          metric_label: 'ROAS (Scaling Ready)',
          message: `🚀 Uncap Growth: This campaign is highly profitable (${roas.toFixed(1)}x ROAS) but limited by budget (${budgetUtilization.toFixed(0)}% utilized). Increase daily budget by 20% (to $${(dailyBudget * 1.2).toFixed(2)}) immediately to capture more revenue.`,
          estimated_revenue_increase: estimatedRevenue,
          confidence: 85,
          module: 'Scaling Opportunities',
        });
      }
      
      // Rule 3.2: Dayparting Opportunity (Time-based conversion rate analysis)
      const hourlyData = hourlyBreakdowns?.get(adSet.id);
      if (hourlyData && hourlyData.length > 0) {
        const daypartingOpp = this.analyzeDayparting(hourlyData, adSet);
        if (daypartingOpp) {
          recommendations.push(daypartingOpp);
        }
      }
      
      // Rule 3.3: Platform Arbitrage (Platform-based CPA analysis)
      const platformData = platformBreakdowns?.get(adSet.id);
      if (platformData && platformData.length > 1) {
        const platformOpp = this.analyzePlatformArbitrage(platformData, adSet);
        if (platformOpp) {
          recommendations.push(platformOpp);
        }
      }
      
      // Rule 3.4: Horizontal Scaling (Lookalike audience expansion)
      if (adSet.targeting) {
        const targeting = adSet.targeting;
        const customAudiences = targeting.custom_audiences || [];
        
        // Check if using 1% lookalike
        const has1PercentLookalike = customAudiences.some((aud: any) => 
          aud.name?.includes('1%') || aud.name?.includes('LAL') || aud.subtype === 'LOOKALIKE'
        );
        
        if (has1PercentLookalike && roas > (this.config.target_roas || 2.0)) {
          recommendations.push({
            id: `rec_scaling_horizontal_${adSet.id}`,
            type: 'scaling_opportunity',
            priority: 'OPPORTUNITY',
            related_entity_id: adSet.id,
            related_entity_name: adSet.name,
            detected_value: roas,
            metric_label: 'Lookalike Expansion',
            message: `📊 Your 1% Lookalike is maxed out (${roas.toFixed(1)}x ROAS). Launch a 3-5% Lookalike audience using the same creative to expand your reach while maintaining profitability.`,
            estimated_revenue_increase: spend * 2, // Estimated 2x revenue from broader audience
            confidence: 70,
            module: 'Scaling Opportunities',
          });
        }
      }
    }
    
    return recommendations;
  }
  
  /**
   * Analyze hourly data for dayparting opportunities
   */
  private analyzeDayparting(hourlyData: any[], adSet: any): OptimizationRecommendation | null {
    // Group by broad time periods
    const morningHours = [6, 7, 8, 9, 10, 11];
    const afternoonHours = [12, 13, 14, 15, 16, 17];
    const eveningHours = [18, 19, 20, 21, 22, 23];
    const nightHours = [0, 1, 2, 3, 4, 5];
    
    const periods = {
      morning: { conversions: 0, spend: 0, clicks: 0 },
      afternoon: { conversions: 0, spend: 0, clicks: 0 },
      evening: { conversions: 0, spend: 0, clicks: 0 },
      night: { conversions: 0, spend: 0, clicks: 0 },
    };
    
    // Aggregate data by period
    for (const hourData of hourlyData) {
      const hour = parseInt(hourData.hourly_stats_aggregated_by_advertiser_time_zone || 0);
      const conversions = getConversions(hourData);
      const spend = parseFloat(hourData.spend || 0);
      const clicks = parseInt(hourData.clicks || 0);
      
      if (morningHours.includes(hour)) {
        periods.morning.conversions += conversions;
        periods.morning.spend += spend;
        periods.morning.clicks += clicks;
      } else if (afternoonHours.includes(hour)) {
        periods.afternoon.conversions += conversions;
        periods.afternoon.spend += spend;
        periods.afternoon.clicks += clicks;
      } else if (eveningHours.includes(hour)) {
        periods.evening.conversions += conversions;
        periods.evening.spend += spend;
        periods.evening.clicks += clicks;
      } else {
        periods.night.conversions += conversions;
        periods.night.spend += spend;
        periods.night.clicks += clicks;
      }
    }
    
    // Calculate conversion rates
    const conversionRates = Object.entries(periods).map(([period, data]) => ({
      period,
      conversionRate: data.clicks > 0 ? (data.conversions / data.clicks) * 100 : 0,
      conversions: data.conversions,
      spend: data.spend,
    }));
    
    // Find best and worst periods
    const sorted = conversionRates.sort((a, b) => b.conversionRate - a.conversionRate);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    
    // Check if best is 2x better than worst
    if (best.conversionRate > worst.conversionRate * 2 && best.conversions > 0) {
      const timeRange = this.getPeriodTimeRange(best.period);
      
      return {
        id: `rec_scaling_dayparting_${adSet.id}`,
        type: 'dayparting',
        priority: 'OPPORTUNITY',
        related_entity_id: adSet.id,
        related_entity_name: adSet.name,
        detected_value: best.conversionRate,
        benchmark_value: worst.conversionRate,
        metric_label: 'Conversion Rate by Time of Day',
        message: `⏰ Dayparting Opp: Your customers convert best during ${best.period} (${best.conversionRate.toFixed(1)}% vs ${worst.conversionRate.toFixed(1)}% in ${worst.period}). Shift 70% of your budget to ${timeRange} to lower CPA.`,
        estimated_savings: worst.spend * 0.5, // Estimated savings from not running during poor times
        confidence: 75,
        module: 'Scaling Opportunities',
      };
    }
    
    return null;
  }
  
  /**
   * Get time range string for period
   */
  private getPeriodTimeRange(period: string): string {
    const ranges: Record<string, string> = {
      morning: '6 AM - 12 PM',
      afternoon: '12 PM - 6 PM',
      evening: '6 PM - 12 AM',
      night: '12 AM - 6 AM',
    };
    return ranges[period] || period;
  }
  
  /**
   * Analyze platform breakdown for arbitrage opportunities
   */
  private analyzePlatformArbitrage(platformData: any[], adSet: any): OptimizationRecommendation | null {
    const platforms: Record<string, { conversions: number; spend: number; cpa: number }> = {};
    
    for (const data of platformData) {
      const platform = data.publisher_platform || 'unknown';
      const conversions = getConversions(data);
      const spend = parseFloat(data.spend || 0);
      const cpa = conversions > 0 ? spend / conversions : 0;
      
      if (!platforms[platform]) {
        platforms[platform] = { conversions: 0, spend: 0, cpa: 0 };
      }
      
      platforms[platform].conversions += conversions;
      platforms[platform].spend += spend;
      platforms[platform].cpa = platforms[platform].conversions > 0 
        ? platforms[platform].spend / platforms[platform].conversions 
        : 0;
    }
    
    // Check for Instagram vs Facebook arbitrage
    const instagram = platforms['instagram'] || platforms['ig'];
    const facebook = platforms['facebook'] || platforms['fb'];
    
    if (instagram && facebook && instagram.conversions > 0 && facebook.conversions > 0) {
      if (instagram.cpa < facebook.cpa * 0.5) {
        // Instagram is less than half the cost
        return {
          id: `rec_scaling_platform_${adSet.id}`,
          type: 'platform_arbitrage',
          priority: 'OPPORTUNITY',
          related_entity_id: adSet.id,
          related_entity_name: adSet.name,
          detected_value: instagram.cpa,
          benchmark_value: facebook.cpa,
          metric_label: 'Platform CPA (Instagram vs Facebook)',
          message: `📱 Platform Win: Instagram is generating conversions at $${instagram.cpa.toFixed(2)} vs Facebook at $${facebook.cpa.toFixed(2)} (${((1 - instagram.cpa / facebook.cpa) * 100).toFixed(0)}% cheaper). Shift budget to 'Instagram Only' placements.`,
          estimated_savings: facebook.spend * 0.5,
          confidence: 85,
          module: 'Scaling Opportunities',
        };
      } else if (facebook.cpa < instagram.cpa * 0.5) {
        // Facebook is less than half the cost
        return {
          id: `rec_scaling_platform_${adSet.id}`,
          type: 'platform_arbitrage',
          priority: 'OPPORTUNITY',
          related_entity_id: adSet.id,
          related_entity_name: adSet.name,
          detected_value: facebook.cpa,
          benchmark_value: instagram.cpa,
          metric_label: 'Platform CPA (Facebook vs Instagram)',
          message: `📘 Platform Win: Facebook is generating conversions at $${facebook.cpa.toFixed(2)} vs Instagram at $${instagram.cpa.toFixed(2)} (${((1 - facebook.cpa / instagram.cpa) * 100).toFixed(0)}% cheaper). Shift budget to 'Facebook Only' placements.`,
          estimated_savings: instagram.spend * 0.5,
          confidence: 85,
          module: 'Scaling Opportunities',
        };
      }
    }
    
    return null;
  }
}

/**
 * Unified module executor - runs all modules and combines results
 */
export function runAllOptimizationModules(
  adSets: any[],
  config: ModuleConfig,
  additionalData?: {
    timeComparisons?: Map<string, any>;
    platformBreakdowns?: Map<string, any[]>;
    hourlyBreakdowns?: Map<string, any[]>;
  }
): OptimizationRecommendation[] {
  const allRecommendations: OptimizationRecommendation[] = [];
  
  // Module 1: Bleeding Budget
  const bleedingBudget = new BleedingBudgetDetector(config);
  allRecommendations.push(...bleedingBudget.analyze(adSets));
  
  // Module 2: Creative Fatigue
  const creativeFatigue = new CreativeFatigueDetector();
  allRecommendations.push(...creativeFatigue.analyze(
    adSets,
    additionalData?.timeComparisons
  ));
  
  // Module 3: Scaling Opportunities
  const scalingOpp = new ScalingOpportunitiesDetector(config);
  allRecommendations.push(...scalingOpp.analyze(
    adSets,
    additionalData?.platformBreakdowns,
    additionalData?.hourlyBreakdowns
  ));
  
  // Sort by priority and confidence
  allRecommendations.sort((a, b) => {
    const priorityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, OPPORTUNITY: 0 };
    const aPriority = priorityOrder[a.priority] || 0;
    const bPriority = priorityOrder[b.priority] || 0;
    
    if (aPriority !== bPriority) {
      return bPriority - aPriority;
    }
    
    return b.confidence - a.confidence;
  });
  
  return allRecommendations;
}



