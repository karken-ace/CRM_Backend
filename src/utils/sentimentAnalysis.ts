/**
 * Sentiment Analysis Module
 * Analyzes ad comments for negative sentiment to protect brand reputation
 */

import { OptimizationRecommendation } from './optimizationModules';

/**
 * Negative keyword clusters for sentiment detection
 */
const NEGATIVE_KEYWORDS = {
  scam: ['scam', 'scammer', 'scamming', 'fraud', 'fraudulent', 'fake', 'phishing', 'ripoff', 'rip off'],
  pricing: ['too expensive', 'overpriced', 'not worth', 'waste of money', 'rip-off', 'expensive', 'costly', 'pricey'],
  quality: ['broken', 'doesn\'t work', 'not working', 'defective', 'poor quality', 'cheap quality', 'terrible', 'horrible', 'awful'],
  service: ['bad service', 'poor customer service', 'no response', 'ignored', 'rude', 'unhelpful'],
  delivery: ['never arrived', 'didn\'t receive', 'lost package', 'late delivery', 'missing'],
  general: ['hate', 'worst', 'never again', 'avoid', 'warning', 'beware', 'disappointed', 'regret'],
};

/**
 * Positive keywords (for balanced analysis)
 */
const POSITIVE_KEYWORDS = ['love', 'great', 'amazing', 'perfect', 'excellent', 'best', 'recommend', 'worth it', 'quality'];

/**
 * Comment sentiment result
 */
export interface CommentSentiment {
  comment_id: string;
  message: string;
  sentiment: 'negative' | 'neutral' | 'positive';
  negative_keywords_found: string[];
  created_time: string;
}

/**
 * Sentiment analysis result for an ad
 */
export interface AdSentimentResult {
  ad_id: string;
  ad_name: string;
  total_comments: number;
  negative_comments: number;
  positive_comments: number;
  neutral_comments: number;
  negative_percentage: number;
  sentiment_score: number; // -100 to 100
  negative_themes: Record<string, number>; // Category -> count
  sample_negative_comments: CommentSentiment[];
}

/**
 * Analyze sentiment of a single comment
 */
export function analyzeCommentSentiment(commentText: string): {
  sentiment: 'negative' | 'neutral' | 'positive';
  negativeKeywords: string[];
  positiveKeywords: string[];
} {
  if (!commentText) {
    return { sentiment: 'neutral', negativeKeywords: [], positiveKeywords: [] };
  }
  
  const lowerText = commentText.toLowerCase();
  
  // Find negative keywords
  const negativeKeywords: string[] = [];
  for (const [category, keywords] of Object.entries(NEGATIVE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        negativeKeywords.push(keyword);
      }
    }
  }
  
  // Find positive keywords
  const positiveKeywords: string[] = [];
  for (const keyword of POSITIVE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      positiveKeywords.push(keyword);
    }
  }
  
  // Determine sentiment
  if (negativeKeywords.length > positiveKeywords.length) {
    return { sentiment: 'negative', negativeKeywords, positiveKeywords };
  } else if (positiveKeywords.length > negativeKeywords.length) {
    return { sentiment: 'positive', negativeKeywords, positiveKeywords };
  } else {
    // Equal or no keywords found
    if (negativeKeywords.length > 0) {
      return { sentiment: 'negative', negativeKeywords, positiveKeywords };
    }
    return { sentiment: 'neutral', negativeKeywords, positiveKeywords };
  }
}

/**
 * Analyze all comments for an ad
 */
export function analyzeAdComments(adId: string, adName: string, comments: any[]): AdSentimentResult {
  const analyzedComments: CommentSentiment[] = [];
  const negativeThemes: Record<string, number> = {
    scam: 0,
    pricing: 0,
    quality: 0,
    service: 0,
    delivery: 0,
    general: 0,
  };
  
  let negativeCount = 0;
  let positiveCount = 0;
  let neutralCount = 0;
  
  for (const comment of comments) {
    const message = comment.message || '';
    const analysis = analyzeCommentSentiment(message);
    
    analyzedComments.push({
      comment_id: comment.id,
      message: message.substring(0, 200), // Truncate long comments
      sentiment: analysis.sentiment,
      negative_keywords_found: analysis.negativeKeywords,
      created_time: comment.created_time,
    });
    
    if (analysis.sentiment === 'negative') {
      negativeCount++;
      
      // Categorize negative theme
      const lowerMessage = message.toLowerCase();
      for (const [category, keywords] of Object.entries(NEGATIVE_KEYWORDS)) {
        for (const keyword of keywords) {
          if (lowerMessage.includes(keyword)) {
            negativeThemes[category]++;
            break; // Only count once per category per comment
          }
        }
      }
    } else if (analysis.sentiment === 'positive') {
      positiveCount++;
    } else {
      neutralCount++;
    }
  }
  
  const totalComments = comments.length;
  const negativePercentage = totalComments > 0 ? (negativeCount / totalComments) * 100 : 0;
  
  // Calculate sentiment score: -100 (all negative) to +100 (all positive)
  const sentimentScore = totalComments > 0 
    ? ((positiveCount - negativeCount) / totalComments) * 100 
    : 0;
  
  // Get sample of negative comments (up to 5)
  const sampleNegative = analyzedComments
    .filter(c => c.sentiment === 'negative')
    .slice(0, 5);
  
  return {
    ad_id: adId,
    ad_name: adName,
    total_comments: totalComments,
    negative_comments: negativeCount,
    positive_comments: positiveCount,
    neutral_comments: neutralCount,
    negative_percentage: negativePercentage,
    sentiment_score: sentimentScore,
    negative_themes: negativeThemes,
    sample_negative_comments: sampleNegative,
  };
}

/**
 * Generate optimization recommendations based on sentiment analysis
 */
export function generateSentimentRecommendations(
  sentimentResults: AdSentimentResult[],
  threshold: number = 20 // 20% negative threshold
): OptimizationRecommendation[] {
  const recommendations: OptimizationRecommendation[] = [];
  
  for (const result of sentimentResults) {
    if (result.negative_percentage > threshold && result.total_comments >= 10) {
      // Find dominant negative theme
      const dominantTheme = Object.entries(result.negative_themes)
        .sort((a, b) => b[1] - a[1])[0];
      
      const themeMessages: Record<string, string> = {
        scam: 'People are commenting "Scam" or "Fraud"',
        pricing: 'People say it\'s "Too Expensive" or "Not Worth It"',
        quality: 'People report "Broken" or "Poor Quality" products',
        service: 'People complain about "Bad Customer Service"',
        delivery: 'People report "Never Arrived" or "Late Delivery"',
        general: 'People express strong negative emotions',
      };
      
      const themeDetail = dominantTheme ? themeMessages[dominantTheme[0]] || '' : '';
      
      recommendations.push({
        id: `rec_sentiment_${result.ad_id}`,
        type: 'sentiment_warning',
        priority: result.negative_percentage > 40 ? 'CRITICAL' : 'HIGH',
        related_entity_id: result.ad_id,
        related_entity_name: result.ad_name,
        detected_value: result.negative_percentage,
        benchmark_value: threshold,
        metric_label: 'Negative Comment Percentage',
        message: `⚠️ HIGH NEGATIVE SENTIMENT: ${result.negative_percentage.toFixed(0)}% of comments (${result.negative_comments}/${result.total_comments}) are negative. ${themeDetail}. Pause this ad to protect brand reputation and investigate the issue.`,
        confidence: 90,
        module: 'Sentiment Analysis',
        action_endpoint: `/api/ads/${result.ad_id}/pause`,
      });
      
      // Add specific recommendation based on dominant theme
      if (dominantTheme && dominantTheme[1] > 3) {
        const actionableAdvice = getActionableAdvice(dominantTheme[0]);
        
        recommendations.push({
          id: `rec_sentiment_action_${result.ad_id}`,
          type: 'sentiment_warning',
          priority: 'MEDIUM',
          related_entity_id: result.ad_id,
          related_entity_name: result.ad_name,
          metric_label: `${dominantTheme[0].charAt(0).toUpperCase() + dominantTheme[0].slice(1)} Issue`,
          message: `🔍 Root Cause: "${dominantTheme[0]}" is the main complaint (${dominantTheme[1]} mentions). ${actionableAdvice}`,
          confidence: 80,
          module: 'Sentiment Analysis',
        });
      }
    }
    
    // Positive sentiment opportunity
    if (result.sentiment_score > 50 && result.total_comments >= 20) {
      recommendations.push({
        id: `rec_sentiment_positive_${result.ad_id}`,
        type: 'scaling_opportunity',
        priority: 'OPPORTUNITY',
        related_entity_id: result.ad_id,
        related_entity_name: result.ad_name,
        detected_value: result.sentiment_score,
        benchmark_value: 50,
        metric_label: 'Positive Sentiment Score',
        message: `✨ STRONG POSITIVE SENTIMENT: This ad has ${result.sentiment_score.toFixed(0)}/100 sentiment score with ${result.positive_comments} positive comments. Use this social proof in your creatives or launch similar ads.`,
        confidence: 85,
        module: 'Sentiment Analysis',
      });
    }
  }
  
  return recommendations;
}

/**
 * Get actionable advice based on negative theme
 */
function getActionableAdvice(theme: string): string {
  const advice: Record<string, string> = {
    scam: 'Review your ad copy for misleading claims. Ensure your offer matches what\'s advertised. Add trust signals (reviews, guarantees).',
    pricing: 'Consider adjusting pricing, offering discounts, or better communicating value proposition. Highlight what makes it worth the price.',
    quality: 'Investigate product quality issues immediately. Improve product or stop advertising until fixed. Offer refunds to affected customers.',
    service: 'Improve customer service response times. Add live chat or better support documentation. Address complaints promptly.',
    delivery: 'Fix fulfillment issues. Set realistic delivery expectations. Provide tracking information. Partner with reliable shipping providers.',
    general: 'Conduct a comprehensive review of your entire customer journey. Survey customers to identify root causes.',
  };
  
  return advice[theme] || 'Investigate the root cause and address before resuming advertising.';
}

/**
 * Batch analyze multiple ads with comments
 */
export async function batchAnalyzeAdSentiments(
  adsWithComments: Array<{ ad: any; comments: any[] }>
): Promise<{
  results: AdSentimentResult[];
  recommendations: OptimizationRecommendation[];
  summary: {
    total_ads_analyzed: number;
    ads_with_negative_sentiment: number;
    ads_with_positive_sentiment: number;
    average_sentiment_score: number;
  };
}> {
  const results: AdSentimentResult[] = [];
  
  for (const { ad, comments } of adsWithComments) {
    const result = analyzeAdComments(ad.id, ad.name, comments);
    results.push(result);
  }
  
  // Generate recommendations
  const recommendations = generateSentimentRecommendations(results);
  
  // Calculate summary
  const adsWithNegative = results.filter(r => r.negative_percentage > 20).length;
  const adsWithPositive = results.filter(r => r.sentiment_score > 50).length;
  const avgSentiment = results.length > 0
    ? results.reduce((sum, r) => sum + r.sentiment_score, 0) / results.length
    : 0;
  
  return {
    results,
    recommendations,
    summary: {
      total_ads_analyzed: results.length,
      ads_with_negative_sentiment: adsWithNegative,
      ads_with_positive_sentiment: adsWithPositive,
      average_sentiment_score: avgSentiment,
    },
  };
}



