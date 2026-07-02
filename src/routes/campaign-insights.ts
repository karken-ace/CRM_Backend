import { Router, Response } from 'express';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { Agent, AdSet } from '../models';
import { config } from '../config';
import axios from 'axios';
import { calculateCampaignHealth } from '../utils/campaignOptimizer';

const router = Router();

/**
 * Get comprehensive campaign health analysis
 * Based on industry research and best practices
 */
router.post('/health', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
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
    
    // Read ad sets from Mongo (populated by Layer 3 sync). Falls back to
    // the live agent call when Mongo has nothing — preserves the original
    // behavior for cold-start / first-load scenarios.
    let adSets = await AdSet.find({ agent_id, campaign_id }).lean();
    if (adSets.length === 0) {
      try {
        const agentUrl = `${config.agent.baseUrl}/meta/campaigns/${campaign_id}/adsets`;
        const response = await axios.get(agentUrl, { timeout: 15000 });
        adSets = response.data?.ad_sets || response.data?.data || [];
      } catch (e) {
        // Fall through — adSets stays empty and we return the 404 below.
      }
    }

    if (adSets.length === 0) {
      return res.status(404).json({ detail: 'No ad sets found for this campaign' });
    }
    
    // Calculate campaign health
    const healthAnalysis = calculateCampaignHealth(adSets);
    
    // Add additional context
    const totalSpend = adSets.reduce((sum: number, a: any) => sum + parseFloat(a.performance_metrics?.spend || 0), 0);
    const totalBudget = adSets.reduce((sum: number, a: any) => sum + parseFloat(a.daily_budget || a.lifetime_budget || 0), 0);
    const activeAdSets = adSets.filter((a: any) => a.status === 'ACTIVE').length;
    
    res.json({
      campaign_id,
      health_score: healthAnalysis.score,
      status: healthAnalysis.status,
      summary: {
        total_ad_sets: adSets.length,
        active_ad_sets: activeAdSets,
        total_spend: totalSpend,
        total_daily_budget: totalBudget,
      },
      insights: healthAnalysis.insights,
      // Group insights by category
      insights_by_category: groupInsightsByCategory(healthAnalysis.insights),
      // Calculate potential impact
      total_potential_savings: healthAnalysis.insights.reduce((sum, i) => sum + (i.estimated_savings || 0), 0),
      total_potential_revenue: healthAnalysis.insights.reduce((sum, i) => sum + (i.estimated_revenue_increase || 0), 0),
      analyzed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Campaign health analysis error:', error);
    res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});

/**
 * Get quick wins - top 5 easiest optimizations with highest impact
 */
router.post('/quick-wins', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
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
    
    // Fetch ad sets
    const agentUrl = `${config.agent.baseUrl}/meta/campaigns/${campaign_id}/adsets`;
    const response = await axios.get(agentUrl, { timeout: 15000 });
    const adSets = response.data?.ad_sets || response.data?.data || [];
    
    // Calculate health
    const healthAnalysis = calculateCampaignHealth(adSets);
    
    // Get top 5 quick wins (high impact, high confidence, easy to implement)
    const quickWins = healthAnalysis.insights
      .filter(i => i.confidence >= 65)
      .sort((a, b) => {
        const aScore = ((a.estimated_savings || 0) + (a.estimated_revenue_increase || 0)) * (a.confidence / 100);
        const bScore = ((b.estimated_savings || 0) + (b.estimated_revenue_increase || 0)) * (b.confidence / 100);
        return bScore - aScore;
      })
      .slice(0, 5);
    
    res.json({
      campaign_id,
      quick_wins: quickWins,
      total_potential_impact: quickWins.reduce((sum, w) => 
        sum + (w.estimated_savings || 0) + (w.estimated_revenue_increase || 0), 0
      ),
    });
  } catch (error: any) {
    console.error('Quick wins analysis error:', error);
    res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});

function groupInsightsByCategory(insights: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};
  
  for (const insight of insights) {
    const category = insight.category;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(insight);
  }
  
  return grouped;
}

export default router;

