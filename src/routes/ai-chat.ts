import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { callClaudeText } from '../utils/ai';

const router = Router();

/**
 * POST /api/ai-chat/ask
 *
 * Free-form chat the simple dashboard's AI panel uses. Caller passes the
 * user's question plus a small "context" object summarising current ad
 * data (totals, top winners, top losers, top recommendations). Claude
 * answers in the voice the dashboard uses: short, opinionated, grounded
 * in the numbers in the context — never invents campaigns or stats.
 *
 * Returns HTML-light text (one short paragraph, optional <strong> tags
 * for emphasis). No markdown lists, no preamble.
 */
router.post(
  '/ask',
  authenticate,
  requireRoles('USER', 'ADMIN'),
  [
    body('question').isString().trim().notEmpty().withMessage('question is required').isLength({ max: 1000 }),
    body('context').optional().isObject(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { question, context } = req.body as {
      question: string;
      context?: ChatContext;
    };

    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = `User question: ${question}

Answer in 2–4 short sentences. Use the data above to ground your reply — quote a real ad name or a real number where it strengthens the answer. If the question can't be answered from the data, say so plainly. Use <strong>bold</strong> for the key number or action. No bullet lists, no markdown fences, no preamble like "Based on your data…" — go straight to the point.`;

    try {
      const text = await callClaudeText(systemPrompt, userPrompt, {
        maxTokens: 400,
        temperature: 0.4,
        timeoutMs: 30000,
      });
      // Strip any accidental markdown fences and normalise whitespace.
      const cleaned = text.replace(/```[\s\S]*?```/g, '').trim();
      return res.json({ answer: cleaned });
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Claude request failed';
      return res.status(502).json({ detail: msg });
    }
  },
);

interface ChatContext {
  date_range?: string;
  totals?: {
    spend?: number;
    revenue?: number;
    roas?: number;
    cpa?: number;
    purchases?: number;
    impressions?: number;
    clicks?: number;
    weighted_frequency?: number;
  };
  account?: { name?: string; ad_set_count?: number; campaign_count?: number };
  top_winners?: Array<{ name: string; roas?: number; cpa?: number; freq?: number; spend?: number }>;
  top_losers?: Array<{ name: string; roas?: number; cpa?: number; freq?: number; spend?: number }>;
  recommendations?: Array<{ title?: string; priority?: string; type?: string }>;
}

function fmtMoney(n: number | undefined): string {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1000) return `$${Math.round(n).toLocaleString()}`;
  if (Math.abs(n) >= 10) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function buildSystemPrompt(ctx?: ChatContext): string {
  const lines: string[] = [
    'You are ACES, an AI inside a Meta Ads management dashboard. You speak directly to the marketer who owns the account.',
    'Voice: short, sharp, opinionated. No filler, no warm-up. Always ground replies in the user data below — never invent ad names or numbers. If data is missing for what they asked, say so in one sentence and offer the next best move.',
    '',
    '### Current account context',
  ];

  if (!ctx) {
    lines.push('No context provided.');
    return lines.join('\n');
  }

  if (ctx.date_range) lines.push(`Date range: ${ctx.date_range}`);
  if (ctx.account?.name) lines.push(`Account: ${ctx.account.name} (${ctx.account.campaign_count ?? 0} campaigns, ${ctx.account.ad_set_count ?? 0} ad sets)`);

  const t = ctx.totals || {};
  lines.push(
    `Spend: ${fmtMoney(t.spend)} · Revenue: ${fmtMoney(t.revenue)} · ROAS: ${t.roas != null ? t.roas.toFixed(2) + '×' : '—'} · CPA: ${fmtMoney(t.cpa)} · Purchases: ${t.purchases ?? 0} · Impressions: ${t.impressions != null ? t.impressions.toLocaleString() : '—'} · Clicks: ${t.clicks != null ? t.clicks.toLocaleString() : '—'} · Avg freq: ${t.weighted_frequency != null ? t.weighted_frequency.toFixed(2) : '—'}`
  );

  if (ctx.top_winners && ctx.top_winners.length > 0) {
    lines.push('');
    lines.push('Top winning ads:');
    for (const w of ctx.top_winners.slice(0, 5)) {
      lines.push(
        `- ${w.name} — ROAS ${w.roas != null ? w.roas.toFixed(2) + '×' : '—'}, CPA ${fmtMoney(w.cpa)}, freq ${w.freq != null ? w.freq.toFixed(1) : '—'}, spend ${fmtMoney(w.spend)}`,
      );
    }
  }

  if (ctx.top_losers && ctx.top_losers.length > 0) {
    lines.push('');
    lines.push('Top losing / fading ads:');
    for (const l of ctx.top_losers.slice(0, 5)) {
      lines.push(
        `- ${l.name} — ROAS ${l.roas != null ? l.roas.toFixed(2) + '×' : '—'}, CPA ${fmtMoney(l.cpa)}, freq ${l.freq != null ? l.freq.toFixed(1) : '—'}, spend ${fmtMoney(l.spend)}`,
      );
    }
  }

  if (ctx.recommendations && ctx.recommendations.length > 0) {
    lines.push('');
    lines.push('Open optimization recommendations:');
    for (const r of ctx.recommendations.slice(0, 6)) {
      lines.push(`- [${r.priority || 'MEDIUM'}] ${r.title || r.type || 'recommendation'}`);
    }
  }

  return lines.join('\n');
}

export default router;
