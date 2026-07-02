/**
 * Advanced Campaign Optimization Engine
 * Based on Meta Ads best practices and industry research
 */

export interface OptimizationInsight {
  type: 'cost_reduction' | 'revenue_increase' | 'efficiency' | 'warning' | 'opportunity';
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  affected_entities: string[];
  estimated_savings?: number;
  estimated_revenue_increase?: number;
  confidence: number; // 0-100
}

export interface CampaignHealth {
  score: number; // 0-100
  status: 'excellent' | 'good' | 'needs_attention' | 'critical';
  insights: OptimizationInsight[];
}

/**
 * Analyze ad fatigue based on frequency metrics
 * Research shows frequency > 1.7 increases costs significantly
 */
export function analyzeAdFatigue(adSets: any[]): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  const OPTIMAL_FREQUENCY = 1.7;
  const HIGH_FREQUENCY = 2.5;
  
  for (const adSet of adSets) {
    const frequency = parseFloat(adSet.performance_metrics?.frequency || 0);
    const spend = parseFloat(adSet.performance_metrics?.spend || 0);
    
    if (frequency > HIGH_FREQUENCY && spend > 10) {
      insights.push({
        type: 'warning',
        priority: 'high',
        category: 'Creative Fatigue',
        title: `High Ad Frequency Detected: ${adSet.name}`,
        description: `This ad set has a frequency of ${frequency.toFixed(2)}, well above the optimal level of ${OPTIMAL_FREQUENCY}. High frequency leads to ad fatigue, decreased engagement, and increased costs.`,
        impact: 'Users are seeing your ads too many times, leading to declining performance and wasted budget.',
        recommendation: 'Refresh creatives immediately or pause this ad set. Consider: 1) Creating new ad variations, 2) Expanding audience size, 3) Duplicating ad set with fresh targeting.',
        affected_entities: [adSet.id],
        estimated_savings: spend * 0.20, // Research shows 20% cost reduction with frequency optimization
        confidence: 85,
      });
    } else if (frequency > OPTIMAL_FREQUENCY && spend > 10) {
      insights.push({
        type: 'opportunity',
        priority: 'medium',
        category: 'Creative Fatigue',
        title: `Approaching Ad Fatigue: ${adSet.name}`,
        description: `Frequency is ${frequency.toFixed(2)}, approaching the fatigue threshold. Performance may decline soon.`,
        impact: 'Early signs of ad fatigue. Proactive creative refresh can prevent cost increases.',
        recommendation: 'Prepare new creatives and rotate them within 3-5 days. Test multiple creative variations.',
        affected_entities: [adSet.id],
        estimated_savings: spend * 0.10,
        confidence: 70,
      });
    }
  }
  
  return insights;
}

/**
 * Analyze budget allocation efficiency
 * Research: 55% to proven campaigns, 25% audience testing, 15% creative testing
 */
export function analyzeBudgetAllocation(adSets: any[], totalBudget: number): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  
  // Identify high performers (ROAS > 2.0 or cost per conversion below average)
  const performanceData = adSets.map(adSet => {
    const metrics = adSet.performance_metrics || {};
    const spend = parseFloat(metrics.spend || 0);
    const conversions = getConversions(metrics);
    const purchaseValue = getPurchaseValue(metrics);
    const roas = spend > 0 ? purchaseValue / spend : 0;
    const costPerConversion = conversions > 0 ? spend / conversions : Infinity;
    
    return {
      id: adSet.id,
      name: adSet.name,
      spend,
      roas,
      costPerConversion,
      conversions,
      isProven: roas > 2.0 || (conversions > 5 && costPerConversion < 50),
    };
  });
  
  const provenCampaigns = performanceData.filter(p => p.isProven);
  const provenSpend = provenCampaigns.reduce((sum, p) => sum + p.spend, 0);
  const provenPercentage = totalBudget > 0 ? (provenSpend / totalBudget) * 100 : 0;
  
  // Alert if not following optimal budget allocation
  if (provenPercentage < 45 && provenCampaigns.length > 0) {
    const potentialRevenue = (totalBudget * 0.55 - provenSpend) * 
      (provenCampaigns.reduce((sum, p) => sum + p.roas, 0) / provenCampaigns.length);
    
    insights.push({
      type: 'opportunity',
      priority: 'high',
      category: 'Budget Allocation',
      title: 'Suboptimal Budget Distribution',
      description: `Only ${provenPercentage.toFixed(1)}% of budget is allocated to proven high-performing campaigns. Research shows optimal allocation is 55% to proven winners.`,
      impact: 'Missing significant revenue by under-funding proven performers.',
      recommendation: `Reallocate budget to increase proven campaign spending to 55% ($${(totalBudget * 0.55).toFixed(2)}). Top performers: ${provenCampaigns.slice(0, 3).map(p => p.name).join(', ')}.`,
      affected_entities: provenCampaigns.map(p => p.id),
      estimated_revenue_increase: potentialRevenue,
      confidence: 80,
    });
  }
  
  return insights;
}

/**
 * Analyze scaling opportunities and risks
 * Research: Scale gradually (max 20% every 3-4 days) to avoid learning phase reset
 */
export function analyzeScalingOpportunities(adSets: any[]): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  const ROAS_THRESHOLD = 2.5;
  const MIN_CONVERSIONS = 10;
  const MAX_SCALE_PERCENTAGE = 20;
  
  for (const adSet of adSets) {
    const metrics = adSet.performance_metrics || {};
    const spend = parseFloat(metrics.spend || 0);
    const conversions = getConversions(metrics);
    const purchaseValue = getPurchaseValue(metrics);
    const roas = spend > 0 ? purchaseValue / spend : 0;
    const budget = parseFloat(adSet.daily_budget || adSet.lifetime_budget || 0);
    
    // Identify scaling candidates
    if (roas > ROAS_THRESHOLD && conversions >= MIN_CONVERSIONS && budget > 0) {
      const recommendedIncrease = budget * (MAX_SCALE_PERCENTAGE / 100);
      const estimatedRevenue = recommendedIncrease * roas;
      
      insights.push({
        type: 'opportunity',
        priority: 'high',
        category: 'Scaling',
        title: `Scale Opportunity: ${adSet.name}`,
        description: `Exceptional performance with ROAS of ${roas.toFixed(2)} and ${conversions} conversions. This ad set is a proven winner ready for scaling.`,
        impact: 'Scaling this high-performer can significantly increase revenue while maintaining profitability.',
        recommendation: `Increase budget by ${MAX_SCALE_PERCENTAGE}% (from $${budget.toFixed(2)} to $${(budget * 1.2).toFixed(2)}). Wait 3-4 days before next increase to avoid triggering learning phase reset.`,
        affected_entities: [adSet.id],
        estimated_revenue_increase: estimatedRevenue - recommendedIncrease,
        confidence: 75,
      });
    }
  }
  
  return insights;
}

/**
 * Analyze learning phase status
 * Research: Campaigns need 50 conversions per week to exit learning phase
 */
export function analyzeLearningPhase(adSets: any[]): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  const LEARNING_THRESHOLD = 50; // conversions per week
  
  for (const adSet of adSets) {
    const metrics = adSet.performance_metrics || {};
    const conversions = getConversions(metrics);
    const spend = parseFloat(metrics.spend || 0);
    const createdDate = new Date(adSet.created_time);
    const daysActive = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
    const weeklyConversionRate = daysActive > 0 ? (conversions / daysActive) * 7 : 0;
    
    // Ad set is stuck in learning
    if (daysActive > 7 && weeklyConversionRate < LEARNING_THRESHOLD && spend > 20) {
      insights.push({
        type: 'warning',
        priority: 'high',
        category: 'Learning Phase',
        title: `Stuck in Learning Phase: ${adSet.name}`,
        description: `This ad set has been active for ${daysActive.toFixed(0)} days but only generating ${weeklyConversionRate.toFixed(1)} conversions/week. Meta needs ~50 conversions/week to fully optimize.`,
        impact: 'Suboptimal performance and higher costs due to incomplete algorithm learning.',
        recommendation: 'Consider: 1) Consolidating with similar ad sets, 2) Broadening targeting, 3) Switching to a higher-volume conversion event, 4) Pausing if performance doesn\'t improve.',
        affected_entities: [adSet.id],
        estimated_savings: spend * 0.15,
        confidence: 70,
      });
    }
  }
  
  return insights;
}

/**
 * Analyze creative performance and staleness
 * Research: Rotate creatives every 7-14 days
 */
export function analyzeCreativePerformance(adSets: any[]): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  const STALE_DAYS = 14;
  
  for (const adSet of adSets) {
    const lastUpdate = new Date(adSet.updated_time || adSet.created_time);
    const daysSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
    const spend = parseFloat(adSet.performance_metrics?.spend || 0);
    
    if (daysSinceUpdate > STALE_DAYS && spend > 10) {
      insights.push({
        type: 'opportunity',
        priority: 'medium',
        category: 'Creative Refresh',
        title: `Stale Creative: ${adSet.name}`,
        description: `Creative hasn't been updated in ${daysSinceUpdate.toFixed(0)} days. Research shows creatives should be refreshed every 7-14 days to maintain performance.`,
        impact: 'Decreasing engagement and increasing costs due to audience saturation.',
        recommendation: 'Launch A/B test with 2-3 new creative variations. Test different formats: video vs static, different messaging angles, new visuals.',
        affected_entities: [adSet.id],
        estimated_savings: spend * 0.15,
        confidence: 65,
      });
    }
  }
  
  return insights;
}

/**
 * Analyze audience overlap issues
 * Research: Overlapping audiences compete in auction, increasing costs
 */
export function analyzeAudienceOverlap(adSets: any[]): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  
  // Group ad sets with similar targeting or from same campaign
  const sameCampaignSets = new Map<string, any[]>();
  
  for (const adSet of adSets) {
    if (adSet.status === 'ACTIVE') {
      const campaignId = adSet.campaign_id || 'unknown';
      if (!sameCampaignSets.has(campaignId)) {
        sameCampaignSets.set(campaignId, []);
      }
      sameCampaignSets.get(campaignId)!.push(adSet);
    }
  }
  
  // Check for campaigns with multiple active ad sets (potential overlap)
  for (const [campaignId, sets] of sameCampaignSets.entries()) {
    if (sets.length > 3) {
      const totalSpend = sets.reduce((sum, s) => sum + parseFloat(s.performance_metrics?.spend || 0), 0);
      
      insights.push({
        type: 'opportunity',
        priority: 'medium',
        category: 'Audience Overlap',
        title: `Potential Audience Overlap in Campaign`,
        description: `${sets.length} active ad sets detected in the same campaign. Multiple ad sets targeting similar audiences compete against each other in Meta's auction, driving up costs.`,
        impact: 'Your own ad sets are competing with each other, inflating CPC and CPA.',
        recommendation: 'Consolidate similar ad sets or use Campaign Budget Optimization (CBO) to let Meta allocate budget efficiently. Consider using Advantage+ campaigns.',
        affected_entities: sets.map(s => s.id),
        estimated_savings: totalSpend * 0.12,
        confidence: 60,
      });
    }
  }
  
  return insights;
}

/**
 * Analyze time-based performance patterns
 * Research: Ad scheduling (dayparting) can reduce costs by 15%
 */
export function analyzeTimeBasedPatterns(adSets: any[], hourlyData?: any): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  
  // This would require hourly breakdown data from Meta API
  // For now, provide general recommendation
  if (adSets.some(a => parseFloat(a.performance_metrics?.spend || 0) > 50)) {
    insights.push({
      type: 'opportunity',
      priority: 'low',
      category: 'Ad Scheduling',
      title: 'Enable Ad Scheduling for Cost Optimization',
      description: 'You\'re running ads 24/7. Research shows that strategic ad scheduling (dayparting) can reduce CPC by up to 15% by avoiding low-conversion hours.',
      impact: 'Wasting budget during low-performing time periods.',
      recommendation: 'Analyze hourly performance data to identify peak conversion times. Schedule ads to run only during high-performing hours (typically business hours for B2B, evenings/weekends for B2C).',
      affected_entities: adSets.map(a => a.id),
      estimated_savings: adSets.reduce((sum, a) => sum + parseFloat(a.performance_metrics?.spend || 0), 0) * 0.15,
      confidence: 55,
    });
  }
  
  return insights;
}

/**
 * Analyze conversion rate optimization opportunities
 * Focus: Maximize conversions and improve conversion rates
 */
export function analyzeConversionRateOptimization(adSets: any[]): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  
  // Calculate conversion rates for all ad sets
  // Use inline_link_clicks (Link Clicks) as denominator — per Meta's 2016 update,
  // this is distinct from clicks (Clicks All) which includes non-link engagement
  const adSetsWithConversionData = adSets.map(adSet => {
    const metrics = adSet.performance_metrics || {};
    const linkClicks = parseInt(metrics.inline_link_clicks || 0) || getLinkClicksFromActions(metrics);
    const conversions = getConversions(metrics);
    const spend = parseFloat(metrics.spend || 0);
    const conversionRate = linkClicks > 0 ? (conversions / linkClicks) * 100 : 0;
    const ctr = parseFloat(metrics.ctr || 0);

    return {
      ...adSet,
      clicks: linkClicks,
      conversions,
      conversionRate,
      ctr,
      spend,
    };
  });

  // Find the average conversion rate
  const totalClicks = adSetsWithConversionData.reduce((sum, a) => sum + a.clicks, 0);
  const totalConversions = adSetsWithConversionData.reduce((sum, a) => sum + a.conversions, 0);
  const averageConversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;
  
  // 1. HIGH ENGAGEMENT, LOW CONVERSION - Critical opportunity
  for (const adSet of adSetsWithConversionData) {
    if (adSet.clicks > 20 && adSet.ctr > 1.5 && adSet.conversionRate < averageConversionRate * 0.5) {
      insights.push({
        type: 'warning',
        priority: 'critical',
        category: 'Conversion Rate',
        title: `High Engagement, Low Conversions: ${adSet.name}`,
        description: `This ad set has excellent engagement (${adSet.ctr.toFixed(2)}% CTR, ${adSet.clicks} clicks) but poor conversion rate (${adSet.conversionRate.toFixed(2)}% vs ${averageConversionRate.toFixed(2)}% average). This indicates a disconnect between ad promise and landing page/offer.`,
        impact: 'Wasting high-quality traffic due to conversion bottleneck. Fixing this could dramatically increase total conversions.',
        recommendation: 'IMMEDIATE ACTION: 1) Review landing page alignment with ad message, 2) Check if offer/pricing is competitive, 3) Test clearer CTAs, 4) Verify targeting matches purchase intent, 5) Consider retargeting these engaged users with different offers.',
        affected_entities: [adSet.id],
        estimated_revenue_increase: adSet.clicks * (averageConversionRate / 100) * 50, // Estimate $50 per conversion
        confidence: 90,
      });
    }
  }
  
  // 2. HIGH-CONVERTING AD SETS READY FOR SCALING
  const highConverters = adSetsWithConversionData.filter(a => 
    a.conversions > 5 && 
    a.conversionRate > averageConversionRate * 1.5 &&
    a.spend > 10
  );
  
  for (const adSet of highConverters) {
    const currentBudget = parseFloat(adSet.daily_budget || adSet.lifetime_budget || 0);
    if (currentBudget > 0) {
      const estimatedNewConversions = (currentBudget * 0.2 / adSet.spend) * adSet.conversions;
      
      insights.push({
        type: 'opportunity',
        priority: 'high',
        category: 'Conversion Rate',
        title: `Scale High-Converting Winner: ${adSet.name}`,
        description: `Exceptional conversion rate of ${adSet.conversionRate.toFixed(2)}% (${adSet.conversions} conversions). This is ${((adSet.conversionRate / averageConversionRate - 1) * 100).toFixed(0)}% better than average.`,
        impact: `This ad set has proven conversion success. Scaling it could add an estimated ${estimatedNewConversions.toFixed(0)} more conversions.`,
        recommendation: `Increase budget by 20% (from $${currentBudget.toFixed(2)} to $${(currentBudget * 1.2).toFixed(2)}) to capture more conversions while maintaining this excellent conversion rate. Wait 3-4 days before next increase.`,
        affected_entities: [adSet.id],
        estimated_revenue_increase: estimatedNewConversions * 50,
        confidence: 85,
      });
    }
  }
  
  // 3. LOW-CONVERTING AD SETS DRAINING BUDGET
  for (const adSet of adSetsWithConversionData) {
    if (adSet.spend > 20 && adSet.clicks > 10 && adSet.conversionRate < averageConversionRate * 0.3) {
      insights.push({
        type: 'warning',
        priority: 'high',
        category: 'Conversion Rate',
        title: `Poor Conversion Rate: ${adSet.name}`,
        description: `Conversion rate of ${adSet.conversionRate.toFixed(2)}% is significantly below average (${averageConversionRate.toFixed(2)}%). Spent $${adSet.spend.toFixed(2)} with minimal conversions.`,
        impact: 'Budget is being wasted on traffic that doesn\'t convert. These funds could generate more conversions in better-performing ad sets.',
        recommendation: 'Pause this ad set and reallocate budget to high-converting ad sets. If you want to salvage it: 1) Completely refresh creative, 2) Narrow targeting to high-intent audiences, 3) Test different landing pages.',
        affected_entities: [adSet.id],
        estimated_savings: adSet.spend * 0.5,
        confidence: 80,
      });
    }
  }
  
  // 4. ZERO CONVERSIONS WITH SIGNIFICANT SPEND
  for (const adSet of adSetsWithConversionData) {
    if (adSet.spend > 30 && adSet.conversions === 0 && adSet.clicks > 0) {
      insights.push({
        type: 'warning',
        priority: 'critical',
        category: 'Conversion Rate',
        title: `Zero Conversions Despite Spend: ${adSet.name}`,
        description: `Spent $${adSet.spend.toFixed(2)} and generated ${adSet.clicks} clicks but ZERO conversions. This is a complete conversion failure.`,
        impact: 'Total waste of ad spend. This budget could be generating conversions in better-targeted campaigns.',
        recommendation: 'PAUSE IMMEDIATELY. This ad set has fundamental issues: wrong audience, poor offer match, broken tracking, or ineffective landing page. Do not resume until root cause is identified and fixed.',
        affected_entities: [adSet.id],
        estimated_savings: adSet.spend,
        confidence: 95,
      });
    }
  }
  
  // 5. IDENTIFY CONVERSION RATE TRENDS
  const recentAdSets = adSetsWithConversionData.filter(a => {
    const created = new Date(a.created_time);
    const daysOld = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    return daysOld < 7;
  });
  
  if (recentAdSets.length > 2) {
    const recentConversionRate = recentAdSets.reduce((sum, a) => sum + a.conversionRate, 0) / recentAdSets.length;
    const olderAdSets = adSetsWithConversionData.filter(a => {
      const created = new Date(a.created_time);
      const daysOld = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
      return daysOld >= 7;
    });
    const olderConversionRate = olderAdSets.length > 0 
      ? olderAdSets.reduce((sum, a) => sum + a.conversionRate, 0) / olderAdSets.length 
      : 0;
    
    if (recentConversionRate < olderConversionRate * 0.7) {
      insights.push({
        type: 'warning',
        priority: 'high',
        category: 'Conversion Rate',
        title: 'Declining Conversion Rate Trend',
        description: `Recent ad sets (last 7 days) have ${recentConversionRate.toFixed(2)}% conversion rate vs ${olderConversionRate.toFixed(2)}% for older sets. Conversion performance is deteriorating.`,
        impact: 'New campaigns are less effective at converting. This trend will reduce overall profitability.',
        recommendation: 'Analyze what changed: 1) Review recent targeting changes, 2) Compare new vs old creatives, 3) Check for seasonal factors, 4) Test returning to proven targeting/creative strategies, 5) Consider market saturation in current audiences.',
        affected_entities: recentAdSets.map(a => a.id),
        estimated_savings: 0,
        confidence: 70,
      });
    }
  }
  
  return insights;
}

/**
 * Analyze post-click conversion funnel
 * Identify where users drop off after clicking ads
 */
export function analyzeConversionFunnel(adSets: any[]): OptimizationInsight[] {
  const insights: OptimizationInsight[] = [];
  
  for (const adSet of adSets) {
    const metrics = adSet.performance_metrics || {};
    // Use Link Clicks (inline_link_clicks) — only link clicks can lead to conversions
    const clicks = parseInt(metrics.inline_link_clicks || 0) || getLinkClicksFromActions(metrics);
    const conversions = getConversions(metrics);
    const spend = parseFloat(metrics.spend || 0);

    // Look for "add to cart" or "initiate checkout" actions if available
    let addToCarts = 0;
    let initiateCheckouts = 0;
    
    if (metrics.actions && Array.isArray(metrics.actions)) {
      const addToCartAction = metrics.actions.find((a: any) => a.action_type === 'add_to_cart');
      const checkoutAction = metrics.actions.find((a: any) => a.action_type === 'initiate_checkout');
      
      addToCarts = addToCartAction ? parseInt(addToCartAction.value || 0) : 0;
      initiateCheckouts = checkoutAction ? parseInt(checkoutAction.value || 0) : 0;
    }
    
    // Analyze funnel drop-offs
    if (clicks > 20 && addToCarts > 5 && conversions < addToCarts * 0.3) {
      insights.push({
        type: 'opportunity',
        priority: 'high',
        category: 'Conversion Funnel',
        title: `High Cart Abandonment: ${adSet.name}`,
        description: `${addToCarts} users added to cart but only ${conversions} converted (${((conversions / addToCarts) * 100).toFixed(0)}% cart conversion rate). Major drop-off at checkout.`,
        impact: 'Losing high-intent customers at the final step. These are warm leads ready to buy.',
        recommendation: 'URGENT: 1) Set up cart abandonment retargeting, 2) Review checkout process for friction (long forms, unexpected costs, payment issues), 3) Test offering incentives (free shipping, discount for completing purchase), 4) Ensure mobile checkout is optimized.',
        affected_entities: [adSet.id],
        estimated_revenue_increase: (addToCarts - conversions) * 0.3 * 50, // 30% recovery rate
        confidence: 85,
      });
    }
    
    if (clicks > 30 && conversions === 0 && spend > 20) {
      insights.push({
        type: 'warning',
        priority: 'critical',
        category: 'Conversion Funnel',
        title: `Complete Funnel Breakdown: ${adSet.name}`,
        description: `${clicks} clicks but zero conversions. Users are clicking but not taking any conversion action.`,
        impact: 'Fundamental conversion problem. Either tracking is broken, landing page is ineffective, or audience has no purchase intent.',
        recommendation: 'IMMEDIATE ACTIONS: 1) Verify conversion tracking is working, 2) Test landing page with A/B test tool, 3) Review audience targeting for purchase intent, 4) Compare landing page on mobile vs desktop, 5) Pause if issues persist after 48 hours.',
        affected_entities: [adSet.id],
        estimated_savings: spend,
        confidence: 90,
      });
    }
  }
  
  return insights;
}

/**
 * Calculate overall campaign health score
 * UPDATED: Prioritizes conversion rate optimization
 */
export function calculateCampaignHealth(adSets: any[]): CampaignHealth {
  const allInsights: OptimizationInsight[] = [];
  
  // Run all analysis functions - CONVERSION RATE ANALYSIS FIRST (HIGHEST PRIORITY)
  allInsights.push(...analyzeConversionRateOptimization(adSets));
  allInsights.push(...analyzeConversionFunnel(adSets));
  
  // Then run supporting analysis functions
  allInsights.push(...analyzeAdFatigue(adSets));
  allInsights.push(...analyzeBudgetAllocation(adSets, calculateTotalBudget(adSets)));
  allInsights.push(...analyzeScalingOpportunities(adSets));
  allInsights.push(...analyzeLearningPhase(adSets));
  allInsights.push(...analyzeCreativePerformance(adSets));
  allInsights.push(...analyzeAudienceOverlap(adSets));
  allInsights.push(...analyzeTimeBasedPatterns(adSets));
  
  // Calculate health score. Each warning category contributes at most a
  // bounded amount to the deduction — previously every warning deducted
  // independently, which dropped the score to 0 on any account with many
  // small issues (e.g. 19 insights ⇒ floor of 0). The fix: group by
  // category, sum within group, then cap each group's total contribution.
  // This preserves the "more issues = lower score" signal while preventing
  // bottoming out.
  const PER_CATEGORY_CAP = 25;          // any one category can drop at most 25 pts
  const CONVERSION_CAP = 35;            // CRO issues are weightier but still bounded
  const conversionCategories = new Set(['Conversion Rate', 'Conversion Funnel']);

  const deductionByCategory: Record<string, number> = {};
  for (const insight of allInsights) {
    if (insight.type !== 'warning') continue;
    const base = insight.priority === 'critical' ? 20 : insight.priority === 'high' ? 12 : 6;
    const isConversion = conversionCategories.has(insight.category);
    const weighted = isConversion ? base * 1.5 : base;
    deductionByCategory[insight.category] = (deductionByCategory[insight.category] || 0) + weighted;
  }

  let score = 100;
  for (const [category, raw] of Object.entries(deductionByCategory)) {
    const cap = conversionCategories.has(category) ? CONVERSION_CAP : PER_CATEGORY_CAP;
    score -= Math.min(raw, cap);
  }

  score = Math.max(0, Math.min(100, score));
  
  const status = score >= 80 ? 'excellent' : 
                 score >= 60 ? 'good' : 
                 score >= 40 ? 'needs_attention' : 'critical';
  
  // Sort insights - CONVERSION RATE INSIGHTS ALWAYS FIRST
  allInsights.sort((a, b) => {
    // Conversion insights always come first
    const aIsConversion = a.category === 'Conversion Rate' || a.category === 'Conversion Funnel';
    const bIsConversion = b.category === 'Conversion Rate' || b.category === 'Conversion Funnel';
    
    if (aIsConversion && !bIsConversion) return -1;
    if (!aIsConversion && bIsConversion) return 1;
    
    // Then sort by priority
    const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
    const aPriority = priorityWeight[a.priority] || 0;
    const bPriority = priorityWeight[b.priority] || 0;
    
    if (aPriority !== bPriority) return bPriority - aPriority;
    
    // Finally by estimated impact
    const aImpact = (a.estimated_savings || 0) + (a.estimated_revenue_increase || 0);
    const bImpact = (b.estimated_savings || 0) + (b.estimated_revenue_increase || 0);
    
    return bImpact - aImpact;
  });
  
  return {
    score,
    status,
    insights: allInsights,
  };
}

// Helper functions

/**
 * Extract Link Clicks from actions array (link_click action type)
 * Fallback for when inline_link_clicks field is not present
 */
function getLinkClicksFromActions(metrics: any): number {
  if (!metrics.actions || !Array.isArray(metrics.actions)) return 0;
  const action = metrics.actions.find((a: any) => a.action_type === 'link_click');
  return action ? parseInt(action.value || 0) : 0;
}

function getConversions(metrics: any): number {
  if (!metrics.actions || !Array.isArray(metrics.actions)) return 0;
  const purchase = metrics.actions.find((a: any) => 
    a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'lead'
  );
  return purchase ? parseInt(purchase.value || 0) : 0;
}

function getPurchaseValue(metrics: any): number {
  if (!metrics.action_values || !Array.isArray(metrics.action_values)) return 0;
  const purchase = metrics.action_values.find((a: any) => 
    a.action_type === 'purchase' || a.action_type === 'omni_purchase'
  );
  return purchase ? parseFloat(purchase.value || 0) : 0;
}

function calculateTotalBudget(adSets: any[]): number {
  return adSets.reduce((sum, adSet) => {
    return sum + parseFloat(adSet.daily_budget || adSet.lifetime_budget || 0);
  }, 0);
}

