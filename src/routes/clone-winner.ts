/**
 * Clone Winner API Route
 *
 * Orchestrates the two-step AI pipeline:
 * 1. Gemini video analysis (via agent)
 * 2. Claude concept generation (direct)
 *
 * Includes demo mode when API keys aren't configured — returns
 * realistic pre-built data so the full UI flow can be demonstrated.
 */

import { Router, Response } from 'express';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { Agent, CreativeAnalysis, ConceptCache } from '../models';
import { config } from '../config';
import { agentClient } from '../utils/agentClient';
import { generateConcepts, PerformanceData } from '../utils/cloneWinner';

const router = Router();

/* ─── Demo data for when API keys aren't configured ────────────────────── */

function generateDemoData(adName: string, perf: PerformanceData) {
  const geminiAnalysis = {
    transcript: "Still doing this the hard way? I wasted months before I found this. Let me show you what actually works. First, apply a thin layer — just like this. The difference after two weeks is insane. My friends literally stopped me to ask what changed. Link below if you want to try it.",
    storyboard: [
      { time: "0-3s", visual: "Close-up of person looking frustrated at mirror", audio: "Still doing this the hard way?" },
      { time: "3-8s", visual: "Product being held up to camera, natural lighting", audio: "I wasted months before I found this. Let me show you what actually works." },
      { time: "8-14s", visual: "Hands applying product, close-up skin texture shots", audio: "First, apply a thin layer — just like this." },
      { time: "14-20s", visual: "Before/after split screen transformation", audio: "The difference after two weeks is insane." },
      { time: "20-25s", visual: "Friends reacting, social proof moment", audio: "My friends literally stopped me to ask what changed. Link below if you want to try it." },
    ],
    hook: {
      type: "problem_statement",
      script: "Still doing this the hard way?",
      visual: "Person looking frustrated at mirror, relatable home setting",
      pain_point_or_desire: "Frustration with current routine not delivering results",
    },
    text_overlays: [
      { text: "STOP doing this ❌", purpose: "Pattern interrupt for sound-off viewers — creates curiosity" },
      { text: "2 weeks later...", purpose: "Time-skip creates anticipation for transformation" },
      { text: "Link in bio 👇", purpose: "Clear CTA that works for both sound-on and sound-off" },
    ],
    cta: {
      text: "Link below if you want to try it",
      timing: "22-25 seconds",
      friction_level: "low",
    },
    marketing_psychology: {
      primary_mechanism: "Positions the product as the obvious solution to a painful daily frustration, validated by social proof from real friends",
      psychological_triggers: ["pain_amplification", "social_proof", "transformation", "curiosity_gap", "ease_of_use"],
      winning_formula: "Opens by mirroring the viewer's frustration (they feel seen), then immediately offers relief through a simple routine. The before/after transformation provides visual proof, and the social proof moment ('my friends stopped me') adds third-party validation. The soft CTA at the end feels like a recommendation from a friend, not a sales pitch.",
    },
    format: {
      style: "ugc",
      pacing: "fast",
      duration_seconds: 25,
      product_first_appears_at: 4,
    },
  };

  const concepts = {
    winning_dna: "Mirror the viewer's frustration, then deliver instant relief through a simple routine with visual proof and social validation.",
    concepts: [
      {
        angle: "The Problem",
        angle_rationale: "Leads with the pain point harder than the original — agitates the frustration before offering the solution",
        hook: { visual: "Montage of 5 different products being thrown in a bin", verbal: "I threw away every single one of these. Here's the only thing that worked." },
        visual_script: [
          { time: "0-3s", scene: "Quick cuts of various products being tossed, frustration on face" },
          { time: "3-10s", scene: "Holding up the winning product, calm confident expression" },
          { time: "10-20s", scene: "Application routine with close-ups, mirror scene at 15s" },
          { time: "20-25s", scene: "Glowing result, text overlay with CTA" },
        ],
        voiceover: "I threw away every single one of these. Fourteen serums, three creams, two devices — nothing. Then my dermatologist told me about this. Two weeks in and my friends are asking what happened to my skin. I'm not going back.",
        text_overlays: [
          { text: "14 products later...", timing: "0-3s" },
          { text: "The only one that worked 👇", timing: "3-5s" },
          { text: "2 weeks later ✨", timing: "15-18s" },
        ],
        cta: "Grab it before they raise the price again — link below",
      },
      {
        angle: "The Secret",
        angle_rationale: "Frames the product as insider knowledge — creates exclusivity and curiosity",
        hook: { visual: "Whispering to camera in bathroom, conspiratorial tone", verbal: "Okay I wasn't supposed to share this but I don't care anymore." },
        visual_script: [
          { time: "0-3s", scene: "Leaning into camera, lowered voice, bathroom setting" },
          { time: "3-10s", scene: "Showing product hidden in cabinet, pulling it out dramatically" },
          { time: "10-20s", scene: "Step-by-step application, skin texture close-ups" },
          { time: "20-25s", scene: "Final result, wink to camera, link overlay" },
        ],
        voiceover: "Okay I wasn't supposed to share this but I don't care anymore. My aesthetician uses this on all her high-paying clients and told me not to tell anyone. It's not even expensive. Look what it did in two weeks. You're welcome.",
        text_overlays: [
          { text: "She told me NOT to share this", timing: "0-3s" },
          { text: "Her secret product 🤫", timing: "5-8s" },
          { text: "Before → After", timing: "15-18s" },
        ],
        cta: "I linked it below — don't say I never did anything for you",
      },
      {
        angle: "The Comparison",
        angle_rationale: "Directly compares against known competitors — builds trust through honest evaluation",
        hook: { visual: "Side-by-side products on bathroom counter", verbal: "I bought all five so you don't have to. One winner, four losers." },
        visual_script: [
          { time: "0-3s", scene: "Five products lined up on counter, hand hovering over them" },
          { time: "3-10s", scene: "Quick elimination — crossing out 4 products with reasons" },
          { time: "10-20s", scene: "Winner revealed, application demo, before/after" },
          { time: "20-25s", scene: "Final result with all 5 products, winner highlighted" },
        ],
        voiceover: "I bought all five so you don't have to. This one — broke me out. This one — did nothing. This one — overpriced garbage. This one — okay but not worth it. This one? Game changer. Two weeks. That's all it took.",
        text_overlays: [
          { text: "I tested 5 products", timing: "0-2s" },
          { text: "❌ ❌ ❌ ❌ ✅", timing: "3-8s" },
          { text: "The winner 🏆", timing: "10-12s" },
        ],
        cta: "Save yourself the $200 I wasted — link below",
      },
      {
        angle: "The FOMO",
        angle_rationale: "Uses urgency and social proof numbers to create fear of missing out",
        hook: { visual: "Phone notification showing '2,847 people bought this today'", verbal: "Everyone keeps buying this and I finally understand why." },
        visual_script: [
          { time: "0-3s", scene: "Phone screen with purchase notifications scrolling" },
          { time: "3-10s", scene: "Unboxing the product, first impression reaction" },
          { time: "10-20s", scene: "Daily routine montage over 2 weeks, mini transformations" },
          { time: "20-25s", scene: "Final result, another notification pops up, CTA" },
        ],
        voiceover: "Everyone keeps buying this and I finally understand why. It sold out three times last month. I managed to grab one and honestly? I get the hype now. Look at my skin after just two weeks. No filter. If it's still in stock, don't sleep on it.",
        text_overlays: [
          { text: "Sold out 3x last month", timing: "0-3s" },
          { text: "Day 1 → Day 14", timing: "10-15s" },
          { text: "Still in stock (for now)", timing: "20-23s" },
        ],
        cta: "Grab it while it's still available — link in bio",
      },
      {
        angle: "The Expert",
        angle_rationale: "Positions the creator as an authority figure — adds credibility through expertise",
        hook: { visual: "Person in professional setting, credentials visible", verbal: "As someone who's tested 200 products this year, this is the one." },
        visual_script: [
          { time: "0-3s", scene: "Professional setting, shelves of products behind, authority pose" },
          { time: "3-10s", scene: "Explaining the science simply, ingredient close-ups" },
          { time: "10-20s", scene: "Demonstrating on own skin, showing texture and results" },
          { time: "20-25s", scene: "Direct to camera recommendation, link overlay" },
        ],
        voiceover: "As someone who's tested over 200 products this year, this is the one I keep coming back to. The formula is clean — no fillers, no fragrance. It's the niacinamide concentration that does it. Apply at night, wake up different. I've recommended this to 50 people and every single one has thanked me.",
        text_overlays: [
          { text: "200+ products tested", timing: "0-3s" },
          { text: "The science 🔬", timing: "5-8s" },
          { text: "50/50 recommended it ✓", timing: "18-22s" },
        ],
        cta: "This is the one. Link below. You'll thank me later.",
      },
    ],
  };

  return { geminiAnalysis, concepts };
}

/* ─── Main endpoint ────────────────────────────────────────────────────── */

router.post('/', authenticate, requireRoles('USER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { agent_id, ad_id, creative_id, performance, date_range, demo_video_path } = req.body;

    if (!agent_id || !ad_id || !creative_id) {
      return res.status(400).json({ detail: 'agent_id, ad_id, and creative_id are required' });
    }

    const dateRange = date_range || 'last_30d';
    const perfData: PerformanceData = {
      roas: performance?.roas || 0,
      hook_rate: performance?.hook_rate || 0,
      hold_rate: performance?.hold_rate || 0,
      top_audience: performance?.top_audience || 'Not available',
    };

    // Verify agent access
    const agent = await Agent.findOne({ id: agent_id });
    if (!agent) {
      return res.status(404).json({ detail: 'Agent not found' });
    }

    // Step 0: Check concept cache.
    // Skip the cache hit if the paired stored analysis was a demo fallback
    // (video_id === 'demo'). Such rows pre-date the no-cache-demo policy and
    // their concepts are derived from generic demo input — serving them would
    // misrepresent the actual creative.
    const cachedConcepts = await ConceptCache.findOne({ ad_id, date_range: dateRange });
    if (cachedConcepts && cachedConcepts.expires_at > new Date()) {
      const storedAnalysis = await CreativeAnalysis.findOne({ ad_id });
      const storedIsDemo = storedAnalysis?.video_id === 'demo';
      if (!storedIsDemo) {
        return res.json({
          success: true,
          data: {
            gemini_analysis: storedAnalysis?.gemini_analysis || null,
            concepts: cachedConcepts.concepts_json,
            winning_dna: (cachedConcepts.concepts_json as any)?.winning_dna || '',
            from_cache: true,
          },
        });
      }
    }

    // Step 1: Get or run Gemini analysis.
    // A row with video_id === 'demo' indicates a previous demo fallback that
    // was persisted by older code. Treat it as no-cache so we re-attempt real
    // Gemini analysis on the next call — otherwise the demo (always
    // skincare-themed) would be pinned to that ad forever.
    let geminiAnalysis: Record<string, any> | null = null;
    let geminiFromDemo = false;
    let geminiError: string | null = null;
    const storedAnalysis = await CreativeAnalysis.findOne({ ad_id });
    const hasRealStoredAnalysis = !!storedAnalysis && storedAnalysis.video_id !== 'demo';

    if (hasRealStoredAnalysis) {
      geminiAnalysis = storedAnalysis!.gemini_analysis;
    } else {
      // Try Gemini via agent (local demo video or Meta creative)
      let geminiSucceeded = false;

      if (agent.status !== 'ONLINE') {
        geminiError = `Agent "${agent.name}" is ${agent.status}. Bring the agent online to run real Gemini analysis on this creative.`;
      } else {
        try {
          // Use local video endpoint if demo_video_path is provided
          const agentPath = demo_video_path
            ? '/meta/creatives/clone-analyze-local'
            : '/meta/creatives/clone-analyze';
          const agentBody = demo_video_path
            ? { video_path: demo_video_path, creative_name: req.body.ad_name || 'Demo Ad' }
            : { creative_id, ad_id }; // ad_id lets the agent fall back to preview-iframe extraction when source_url is gated
          const agentResponse = await agentClient(agent).post(
            agentPath,
            agentBody,
            { timeout: 180000 }
          );

          if (agentResponse.data?.status === 'success' && agentResponse.data?.analysis) {
            geminiAnalysis = agentResponse.data.analysis;
            geminiSucceeded = true;

            await CreativeAnalysis.findOneAndUpdate(
              { ad_id },
              {
                ad_id,
                video_id: agentResponse.data.video_id || '',
                creative_name: agentResponse.data.creative_name || '',
                gemini_analysis: geminiAnalysis,
                created_at: new Date(),
              },
              { upsert: true, new: true }
            );
          } else {
            geminiError = agentResponse.data?.message || 'Gemini analysis returned no result';
          }
        } catch (error: any) {
          geminiError = `Gemini request failed: ${error.message}`;
          console.warn('Gemini analysis via agent failed:', error.message);
        }
      }

      // Fallback: Demo mode. Use pre-built data for this response only — do
      // NOT persist it. Caching demo-derived analysis poisons the row for that
      // ad: the next call would serve the cached skincare-themed demo instead
      // of running real Gemini once the agent is back online. Mirrors the
      // same precaution applied to the concept cache below.
      if (!geminiSucceeded) {
        console.log('Clone Winner: Using demo Gemini analysis —', geminiError || 'unknown reason');
        const demo = generateDemoData(req.body.ad_name || 'Ad Creative', perfData);
        geminiAnalysis = demo.geminiAnalysis;
        geminiFromDemo = true;
      }
    }

    if (!geminiAnalysis) {
      return res.status(500).json({ detail: 'No analysis available' });
    }

    // Step 2: Generate concepts with Claude (or use demo fallback)
    let conceptsResult: any = null;
    let claudeError: string | null = null;
    let conceptsFromDemo = false;

    if (config.anthropic.apiKey) {
      try {
        conceptsResult = await generateConcepts(geminiAnalysis, perfData);
      } catch (error: any) {
        claudeError = `Claude request failed: ${error.message}`;
        console.warn('Claude concept generation failed:', error.message);
      }
    } else {
      claudeError = 'ANTHROPIC_API_KEY not configured on the backend.';
    }

    // Fallback: demo concepts. Only cache real Claude output — and only when
    // the input Gemini analysis was real, not demo — so a transient failure
    // anywhere in the pipeline can't poison the cache for 30 days.
    if (!conceptsResult) {
      console.log('Clone Winner: Using demo concepts —', claudeError || 'unknown reason');
      const demo = generateDemoData(req.body.ad_name || 'Ad Creative', perfData);
      conceptsResult = demo.concepts;
      conceptsFromDemo = true;
    } else if (!geminiFromDemo) {
      await ConceptCache.findOneAndUpdate(
        { ad_id, date_range: dateRange },
        {
          ad_id,
          date_range: dateRange,
          concepts_json: conceptsResult,
          created_at: new Date(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        { upsert: true, new: true }
      );
    }

    // Build a single human-readable explanation of which leg fell back.
    // The frontend uses this verbatim — it must point at the actual cause
    // (agent offline, Gemini error, missing key, Claude error) and not at a
    // generic "fix the key" message.
    let demoReason: string | null = null;
    if (geminiFromDemo && conceptsFromDemo) {
      demoReason = `${geminiError || 'Gemini did not run.'} ${claudeError || 'Claude did not run.'}`.trim();
    } else if (geminiFromDemo) {
      demoReason = geminiError || 'Gemini analysis fell back to demo data.';
    } else if (conceptsFromDemo) {
      demoReason = claudeError || 'Concept generation fell back to demo data.';
    }

    return res.json({
      success: true,
      data: {
        gemini_analysis: geminiAnalysis,
        concepts: conceptsResult,
        winning_dna: conceptsResult.winning_dna || '',
        from_cache: false,
        from_demo: geminiFromDemo || conceptsFromDemo,
        gemini_from_demo: geminiFromDemo,
        concepts_from_demo: conceptsFromDemo,
        gemini_error: geminiError,
        claude_error: claudeError,
        demo_reason: demoReason,
      },
    });

  } catch (error: any) {
    console.error('Clone Winner error:', error);
    return res.status(500).json({ detail: error.message || 'Clone Winner failed' });
  }
});

export default router;
