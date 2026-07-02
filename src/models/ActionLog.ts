import mongoose, { Schema, Document } from 'mongoose';

/** Audit feed for the universal-shell Activity view. Every pause / activate /
 *  budget change — whether triggered by an automated rule or a manual click —
 *  writes one row here. Filterable by date, account, campaign, and source. */
export interface IActionLog extends Document {
  id: string;
  user_id: string;
  agent_id: string;
  campaign_id?: string;
  ad_set_id?: string;
  ad_id?: string;
  /** 'manual' for user-initiated actions; 'rule:<rule_id>' for automated runs;
   *  'optimization' for the inline action buttons in the recommendation cards. */
  source: string;
  /** The signed-in user's id for manual actions, 'auto' for automated runs. */
  actor: string;
  /** Canonical action verbs: pause, activate, budget_adjust, alert, flag. */
  action_type: 'pause' | 'activate' | 'budget_adjust' | 'alert' | 'flag';
  /** Human-readable description shown in the feed (e.g.
   *  "Paused Coastal · Lookalike_2% Cold — ROAS 1.61× over 7d"). May include
   *  <b>…</b> tags for emphasis; the frontend renders it as HTML. */
  description: string;
  /** Optional structured payload — the metric values that triggered the
   *  action, the previous/next budget, etc. Free-form so each call site can
   *  attach what it needs without a schema change. */
  context?: Record<string, unknown>;
  created_at: Date;
}

const ActionLogSchema = new Schema<IActionLog>({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  agent_id: { type: String, required: true, index: true },
  campaign_id: { type: String, index: true },
  ad_set_id: { type: String },
  ad_id: { type: String },
  source: { type: String, required: true },
  actor: { type: String, required: true },
  action_type: {
    type: String,
    enum: ['pause', 'activate', 'budget_adjust', 'alert', 'flag'],
    required: true,
  },
  description: { type: String, required: true },
  context: { type: Schema.Types.Mixed },
  created_at: { type: Date, default: Date.now, index: true },
});

// Compound index for the activity feed query — (user, recent) is the hot path.
ActionLogSchema.index({ user_id: 1, created_at: -1 });

export const ActionLog = mongoose.model<IActionLog>('ActionLog', ActionLogSchema);
