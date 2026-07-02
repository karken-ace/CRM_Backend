/**
 * Clone Winner — Claude Sonnet Concept Generation
 *
 * Takes a Gemini video analysis + ad performance data and generates
 * 5 new video concepts using Claude Sonnet.
 *
 * This is Step 2 of the Clone Winner pipeline.
 */

import axios from 'axios';
import { config } from '../config';

export interface ConceptResult {
  winning_dna: string;
  concepts: Array<{
    angle: string;
    angle_rationale: string;
    hook: {
      visual: string;
      verbal: string;
    };
    visual_script: Array<{
      time: string;
      scene: string;
    }>;
    voiceover: string;
    text_overlays: Array<{
      text: string;
      timing: string;
    }>;
    cta: string;
  }>;
}

export interface PerformanceData {
  roas: number;
  hook_rate: number;
  hold_rate: number;
  top_audience?: string;
}

const CONCEPT_GENERATOR_PROMPT = `You are a Senior Performance Creative Lead.
Below is the analysis of a high-performing video ad and its performance data.
Use this as your "Success Blueprint."

=== WINNING AD ANALYSIS ===
{gemini_analysis_json}

=== PERFORMANCE DATA ===
ROAS: {roas}x  |  Hook rate: {hook_rate}%  |  Hold rate: {hold_rate}%
Top converting audience: {top_audience}

The source video is approximately {source_duration_seconds} seconds long. Each
generated concept's visual_script MUST cover the same total duration as the
source — do not compress a 60-second ad into 25 seconds, and do not pad an
8-second ad to 25 seconds. Use real seconds in each "time" field that match
the source's pacing.

Generate 5 new video concepts that retain the "Winning DNA" of the original
while testing different narrative angles.

Return ONLY valid JSON. No preamble, no markdown:
{
  "winning_dna": "<one sentence: the core mechanism to preserve>",
  "concepts": [
    {
      "angle": "The Problem | The Secret | The Comparison | The FOMO | The Expert",
      "angle_rationale": "<why this angle tests something new>",
      "hook": {
        "visual": "<what appears on screen in seconds 0-3>",
        "verbal": "<exact words spoken in seconds 0-3>"
      },
      "visual_script": [
        { "time": "<start>-<end>s", "scene": "<description>" }
      ],
      "voiceover": "<full script — conversational, sounds like a real person, not corporate>",
      "text_overlays": [
        { "text": "<on-screen text>", "timing": "<when it appears>" }
      ],
      "cta": "<direct, low-friction closing line>",
      "duration_seconds": <total length, matching the source>
    }
  ]
}

CONSTRAINTS:
- Preserve the winning mechanism exactly — change the angle, not the formula
- Every script must sound like a real person talking, not an ad
- Each concept's total length MUST match the source video's duration ({source_duration_seconds}s)
- Make the 5 concepts distinct enough to function as separate A/B tests`;

export async function generateConcepts(
  geminiAnalysis: Record<string, any>,
  performance: PerformanceData
): Promise<ConceptResult> {
  const apiKey = config.anthropic.apiKey;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // Pull the source video's actual duration from the Gemini analysis so we
  // can pin generated concepts to the same length. Falls back to "unspecified"
  // when missing — Claude will still try to match pacing from the analysis.
  const sourceDuration = (geminiAnalysis as any)?.format?.duration_seconds;
  const sourceDurationLabel = (typeof sourceDuration === 'number' && sourceDuration > 0)
    ? String(sourceDuration)
    : 'unspecified — match the pacing implied by the source storyboard';

  const prompt = CONCEPT_GENERATOR_PROMPT
    .replace('{gemini_analysis_json}', JSON.stringify(geminiAnalysis, null, 2))
    .replace('{roas}', (performance.roas || 0).toFixed(1))
    .replace('{hook_rate}', String(Math.round(performance.hook_rate || 0)))
    .replace('{hold_rate}', String(Math.round(performance.hold_rate || 0)))
    .replace('{top_audience}', performance.top_audience || 'Not available')
    .replace(/\{source_duration_seconds\}/g, sourceDurationLabel);

  // Try up to 2 times (initial + 1 retry with stricter prompt)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const finalPrompt = attempt === 0
        ? prompt
        : prompt + '\n\nYour previous response was not valid JSON. Return ONLY the JSON object, starting with { and ending with }.';

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-sonnet-5',
          max_tokens: 4000,
          messages: [{ role: 'user', content: finalPrompt }],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      let content = response.data.content?.[0]?.text || '';

      // Strip markdown fences
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      const parsed = JSON.parse(content);

      // Validate structure
      if (parsed.winning_dna && Array.isArray(parsed.concepts) && parsed.concepts.length > 0) {
        return parsed as ConceptResult;
      }

      throw new Error('Invalid concept structure from Claude');
    } catch (error: any) {
      if (attempt === 1) {
        console.error('Claude concept generation failed after retry:', error.message);
        throw new Error(`Concept generation failed: ${error.message}`);
      }
      console.warn(`Claude attempt ${attempt + 1} failed, retrying:`, error.message);
    }
  }

  throw new Error('Concept generation failed after all retries');
}
