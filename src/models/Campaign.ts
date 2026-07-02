import mongoose, { Schema, Document } from 'mongoose';

/**
 * Campaign — synced view of Meta's campaign object.
 *
 * Layer 3 architecture: the agent's scheduled task writes to this collection
 * every ~5 min, and the backend dashboard reads from here instead of hitting
 * Meta live. Indexed by agent_id so reads scope cleanly per user.
 *
 * `meta_id` and `id` are the same Meta campaign ID; the duplicate field is
 * kept for backward compatibility with code that already references `id`.
 */
export interface ICampaign extends Document {
  id: string;
  agent_id: string;
  user_id: string;
  ad_account_id: string;
  meta_id: string;
  name: string;
  status: string;
  effective_status?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time?: Date;
  updated_time?: Date;
  performance_metrics?: Record<string, any>;
  raw?: Record<string, any>;
  last_synced_at: Date;
}

const CampaignSchema = new Schema<ICampaign>({
  id: { type: String, required: true, unique: true },
  agent_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true, index: true },
  ad_account_id: { type: String, required: true, index: true },
  meta_id: { type: String, required: true, index: true },
  name: { type: String, required: true },
  status: { type: String, required: true },
  effective_status: { type: String },
  objective: { type: String },
  daily_budget: { type: String },
  lifetime_budget: { type: String },
  created_time: { type: Date },
  updated_time: { type: Date },
  performance_metrics: { type: Schema.Types.Mixed, default: {} },
  raw: { type: Schema.Types.Mixed },
  last_synced_at: { type: Date, required: true, default: Date.now, index: true },
});

CampaignSchema.index({ agent_id: 1, status: 1 });

export const Campaign = mongoose.model<ICampaign>('Campaign', CampaignSchema);
